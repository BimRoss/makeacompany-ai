package app

import (
	"context"
	"encoding/json"
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
const adminSessionKeyPrefix = keyPrefix + ":admin_session:"

// maxWaitlistList caps SCAN/HGETALL work for admin listing (pathological keyspace guard).
const maxWaitlistList = 500

// maxCompanyChannelsList caps HGETALL company channel registry rows returned to admin UI.
const maxCompanyChannelsList = 200

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
	rdb                *redis.Client
	companyChannelsRdb *redis.Client // optional second Redis for shared employee-factory registry; nil = use rdb
}

// NewStore opens the primary Redis client. If companyChannelsRedisURL is non-empty and differs from redisURL,
// a second client is used only for ListCompanyChannels (same pattern as employee-factory vs makeacompany-ai split).
func NewStore(redisURL, companyChannelsRedisURL string) (*Store, error) {
	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, fmt.Errorf("parse redis url: %w", err)
	}
	primary := redis.NewClient(opts)
	ccURL := strings.TrimSpace(companyChannelsRedisURL)
	if ccURL == "" || ccURL == strings.TrimSpace(redisURL) {
		return &Store{rdb: primary}, nil
	}
	ccOpts, err := redis.ParseURL(ccURL)
	if err != nil {
		_ = primary.Close()
		return nil, fmt.Errorf("parse company channels redis url: %w", err)
	}
	return &Store{rdb: primary, companyChannelsRdb: redis.NewClient(ccOpts)}, nil
}

func (s *Store) Close() error {
	if s == nil {
		return nil
	}
	if s.companyChannelsRdb != nil {
		_ = s.companyChannelsRdb.Close()
	}
	return s.rdb.Close()
}

func (s *Store) companyChannelsRedis() *redis.Client {
	if s == nil {
		return nil
	}
	if s.companyChannelsRdb != nil {
		return s.companyChannelsRdb
	}
	return s.rdb
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

type AdminSession struct {
	Token     string `json:"token"`
	Email     string `json:"email"`
	CreatedAt string `json:"createdAt"`
	ExpiresAt string `json:"expiresAt"`
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

func adminSessionKey(token string) string {
	return adminSessionKeyPrefix + strings.TrimSpace(token)
}

func (s *Store) CreateAdminSession(ctx context.Context, token, email string, expiresAt time.Time) error {
	token = strings.TrimSpace(token)
	email = strings.ToLower(strings.TrimSpace(email))
	if token == "" || email == "" {
		return fmt.Errorf("missing admin session token/email")
	}
	if expiresAt.IsZero() {
		return fmt.Errorf("missing admin session expiration")
	}
	ttl := time.Until(expiresAt)
	if ttl <= 0 {
		return fmt.Errorf("admin session already expired")
	}
	now := time.Now().UTC().Format(time.RFC3339)
	err := s.rdb.HSet(ctx, adminSessionKey(token), map[string]any{
		"email":     email,
		"createdAt": now,
		"expiresAt": expiresAt.UTC().Format(time.RFC3339),
	}).Err()
	if err != nil {
		return err
	}
	return s.rdb.Expire(ctx, adminSessionKey(token), ttl).Err()
}

func (s *Store) GetAdminSession(ctx context.Context, token string) (AdminSession, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return AdminSession{}, fmt.Errorf("missing admin session token")
	}
	vals, err := s.rdb.HGetAll(ctx, adminSessionKey(token)).Result()
	if err != nil {
		return AdminSession{}, err
	}
	if len(vals) == 0 {
		return AdminSession{}, redis.Nil
	}
	out := AdminSession{
		Token:     token,
		Email:     strings.ToLower(strings.TrimSpace(vals["email"])),
		CreatedAt: strings.TrimSpace(vals["createdAt"]),
		ExpiresAt: strings.TrimSpace(vals["expiresAt"]),
	}
	if out.Email == "" {
		return AdminSession{}, redis.Nil
	}
	return out, nil
}

func (s *Store) DeleteAdminSession(ctx context.Context, token string) error {
	token = strings.TrimSpace(token)
	if token == "" {
		return nil
	}
	return s.rdb.Del(ctx, adminSessionKey(token)).Err()
}

// CompanyChannel mirrors employee-factory/config.CompanyChannelRuntime JSON for Redis HASH values.
type CompanyChannel struct {
	CompanySlug                string   `json:"company_slug"`
	ChannelID                  string   `json:"channel_id"`
	DisplayName                string   `json:"display_name,omitempty"`
	PrimaryOwner               string   `json:"primary_owner,omitempty"`
	AllowedOperatorIDs         []string `json:"allowed_operator_ids,omitempty"`
	ThreadsEnabled             bool     `json:"threads_enabled"`
	GeneralAutoReactionEnabled bool     `json:"general_auto_reaction_enabled"`
}

func normalizeCompanyChannel(e CompanyChannel, hashField string) CompanyChannel {
	e.ChannelID = strings.TrimSpace(e.ChannelID)
	e.CompanySlug = strings.TrimSpace(e.CompanySlug)
	e.DisplayName = strings.TrimSpace(e.DisplayName)
	e.PrimaryOwner = strings.TrimSpace(e.PrimaryOwner)
	for i := range e.AllowedOperatorIDs {
		e.AllowedOperatorIDs[i] = strings.TrimSpace(e.AllowedOperatorIDs[i])
	}
	if e.ChannelID == "" {
		e.ChannelID = strings.TrimSpace(hashField)
	}
	return e
}

// ListCompanyChannels reads the shared Redis HASH used by employee-factory (field = channel id, value = JSON).
// Results are sorted by company_slug then channel_id. If more than maxCompanyChannelsList entries exist, truncated is true.
func (s *Store) ListCompanyChannels(ctx context.Context, hashKey string) ([]CompanyChannel, bool, error) {
	rdb := s.companyChannelsRedis()
	if s == nil || rdb == nil {
		return nil, false, fmt.Errorf("company channels: nil store")
	}
	k := strings.TrimSpace(hashKey)
	if k == "" {
		k = "employee-factory:company_channels"
	}
	raw, err := rdb.HGetAll(ctx, k).Result()
	if err != nil {
		return nil, false, err
	}
	if len(raw) == 0 {
		return []CompanyChannel{}, false, nil
	}
	out := make([]CompanyChannel, 0, len(raw))
	for field, val := range raw {
		val = strings.TrimSpace(val)
		if val == "" {
			continue
		}
		var e CompanyChannel
		if err := json.Unmarshal([]byte(val), &e); err != nil {
			continue
		}
		e = normalizeCompanyChannel(e, field)
		if e.ChannelID == "" {
			continue
		}
		if e.ChannelID != strings.TrimSpace(field) {
			continue
		}
		out = append(out, e)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].CompanySlug != out[j].CompanySlug {
			return out[i].CompanySlug < out[j].CompanySlug
		}
		return out[i].ChannelID < out[j].ChannelID
	})
	truncated := len(out) > maxCompanyChannelsList
	if truncated {
		out = out[:maxCompanyChannelsList]
	}
	return out, truncated, nil
}
