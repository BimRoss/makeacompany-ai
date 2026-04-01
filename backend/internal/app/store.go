package app

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

const keyPrefix = "makeacompany"

// WaitlistCap is the maximum number of distinct paid waitlist signups we accept.
const WaitlistCap int64 = 100

const (
	statsSignupsKey     = keyPrefix + ":stats:signups"
	statsAmountCentsKey = keyPrefix + ":stats:amount_cents"
)

// maxWaitlistList caps SCAN/HGETALL work for admin listing (pathological keyspace guard).
const maxWaitlistList = 500

const waitlistKeyMatch = keyPrefix + ":waitlist:*"

// ErrWaitlistFull is returned when the waitlist has reached WaitlistCap.
var ErrWaitlistFull = errors.New("waitlist full")

// KEYS: session key, stats signups, stats amount cents, user hash key
// ARGV: cap, email, stripeCustomer, paymentStatus, sessionID, currency, amountTotal (decimal string), updatedAt (RFC3339)
const saveWaitlistLua = `
if redis.call("EXISTS", KEYS[1]) == 1 then
  return 2
end
local cap = tonumber(ARGV[1])
local n = tonumber(redis.call("GET", KEYS[2])) or 0
if n >= cap then
  return 0
end
redis.call("SET", KEYS[1], ARGV[2])
redis.call("INCR", KEYS[2])
local amt = tonumber(ARGV[7])
if amt and amt > 0 then
  redis.call("INCRBY", KEYS[3], amt)
end
redis.call("HSET", KEYS[4],
  "email", ARGV[2],
  "stripeSessionId", ARGV[5],
  "stripeCustomer", ARGV[3],
  "paymentStatus", ARGV[4],
  "amountTotal", ARGV[7],
  "currency", ARGV[6],
  "updatedAt", ARGV[8],
  "source", "waitlist")
return 1
`

type Store struct {
	rdb *redis.Client
}

func NewStore(redisURL string) (*Store, error) {
	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, fmt.Errorf("parse redis url: %w", err)
	}
	return &Store{rdb: redis.NewClient(opts)}, nil
}

func (s *Store) Close() error {
	return s.rdb.Close()
}

func (s *Store) Ping(ctx context.Context) error {
	return s.rdb.Ping(ctx).Err()
}

// SaveWaitlistSignup stores waitlist purchaser info; idempotent per checkout session id.
// If the waitlist is at capacity and this session has not been stored before, returns ErrWaitlistFull.
func (s *Store) SaveWaitlistSignup(ctx context.Context, sessionID, email, stripeCustomer, paymentStatus string, amountTotal int64, currency string) error {
	email = strings.TrimSpace(strings.ToLower(email))
	if email == "" {
		return fmt.Errorf("missing email")
	}
	if sessionID == "" {
		return fmt.Errorf("missing session id")
	}

	sessKey := fmt.Sprintf("%s:checkout:%s", keyPrefix, sessionID)
	userKey := fmt.Sprintf("%s:waitlist:%s", keyPrefix, email)
	now := time.Now().UTC().Format(time.RFC3339)
	res, err := s.rdb.Eval(ctx, saveWaitlistLua,
		[]string{sessKey, statsSignupsKey, statsAmountCentsKey, userKey},
		strconv.FormatInt(WaitlistCap, 10),
		email,
		stripeCustomer,
		paymentStatus,
		sessionID,
		currency,
		strconv.FormatInt(amountTotal, 10),
		now,
	).Int64()
	if err != nil {
		return err
	}
	switch res {
	case 0:
		return ErrWaitlistFull
	case 1, 2:
		return nil
	default:
		return fmt.Errorf("waitlist save: unexpected script status %d", res)
	}
}

// GetWaitlistStats returns aggregate counters maintained on successful first-time session processing.
func (s *Store) GetWaitlistStats(ctx context.Context) (signups int64, amountCents int64, err error) {
	n, err := s.rdb.Get(ctx, statsSignupsKey).Int64()
	if err == redis.Nil {
		n = 0
	} else if err != nil {
		return 0, 0, err
	}
	a, err := s.rdb.Get(ctx, statsAmountCentsKey).Int64()
	if err == redis.Nil {
		a = 0
	} else if err != nil {
		return 0, 0, err
	}
	return n, a, nil
}

// WaitlistUser is one row from Redis hash makeacompany:waitlist:<email>.
type WaitlistUser struct {
	Email           string `json:"email"`
	StripeSessionID string `json:"stripeSessionId"`
	StripeCustomer  string `json:"stripeCustomer"`
	PaymentStatus   string `json:"paymentStatus"`
	AmountTotal     string `json:"amountTotal"`
	Currency        string `json:"currency"`
	UpdatedAt       string `json:"updatedAt"`
	Source          string `json:"source"`
}

// ListWaitlistUsers returns waitlist signup hashes via SCAN (not KEYS), newest updatedAt first.
// At most maxWaitlistList rows are returned.
func (s *Store) ListWaitlistUsers(ctx context.Context) ([]WaitlistUser, error) {
	var users []WaitlistUser
	var cursor uint64
outer:
	for {
		keys, next, err := s.rdb.Scan(ctx, cursor, waitlistKeyMatch, 64).Result()
		if err != nil {
			return nil, err
		}
		for _, key := range keys {
			if len(users) >= maxWaitlistList {
				break outer
			}
			vals, err := s.rdb.HGetAll(ctx, key).Result()
			if err != nil {
				return nil, err
			}
			if len(vals) == 0 {
				continue
			}
			users = append(users, WaitlistUser{
				Email:           vals["email"],
				StripeSessionID: vals["stripeSessionId"],
				StripeCustomer:  vals["stripeCustomer"],
				PaymentStatus:   vals["paymentStatus"],
				AmountTotal:     vals["amountTotal"],
				Currency:        vals["currency"],
				UpdatedAt:       vals["updatedAt"],
				Source:          vals["source"],
			})
		}
		cursor = next
		if cursor == 0 {
			break
		}
	}
	sort.Slice(users, func(i, j int) bool {
		ti, _ := time.Parse(time.RFC3339, users[i].UpdatedAt)
		tj, _ := time.Parse(time.RFC3339, users[j].UpdatedAt)
		if ti.IsZero() && tj.IsZero() {
			return users[i].Email < users[j].Email
		}
		if ti.IsZero() {
			return false
		}
		if tj.IsZero() {
			return true
		}
		return ti.After(tj)
	})
	return users, nil
}
