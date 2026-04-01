package app

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

const keyPrefix = "makeacompany"

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
func (s *Store) SaveWaitlistSignup(ctx context.Context, sessionID, email, stripeCustomer, paymentStatus string, amountTotal int64, currency string) error {
	email = strings.TrimSpace(strings.ToLower(email))
	if email == "" {
		return fmt.Errorf("missing email")
	}
	if sessionID == "" {
		return fmt.Errorf("missing session id")
	}

	sessKey := fmt.Sprintf("%s:checkout:%s", keyPrefix, sessionID)
	ok, err := s.rdb.SetNX(ctx, sessKey, email, 0).Result()
	if err != nil {
		return err
	}
	if !ok {
		return nil
	}

	userKey := fmt.Sprintf("%s:waitlist:%s", keyPrefix, email)
	now := time.Now().UTC().Format(time.RFC3339)
	return s.rdb.HSet(ctx, userKey, map[string]interface{}{
		"email":           email,
		"stripeSessionId": sessionID,
		"stripeCustomer":  stripeCustomer,
		"paymentStatus":   paymentStatus,
		"amountTotal":     amountTotal,
		"currency":        currency,
		"updatedAt":       now,
		"source":          "waitlist",
	}).Err()
}
