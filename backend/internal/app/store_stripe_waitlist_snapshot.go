package app

import (
	"context"
	"errors"
	"time"

	"github.com/redis/go-redis/v9"
)

// Redis key for hourly CronJob + admin UI: JSON blob of paid waitlist purchasers from Stripe API.
const stripeWaitlistSnapshotKey = keyPrefix + ":admin:stripe_waitlist_snapshot"

// Stripe waitlist snapshot TTL: slightly longer than hourly cron so a missed run still has data.
const stripeWaitlistSnapshotTTL = 90 * time.Minute

// SaveStripeWaitlistSnapshot stores JSON from refreshStripeWaitlistSnapshot (PII).
func (s *Store) SaveStripeWaitlistSnapshot(ctx context.Context, jsonBlob []byte) error {
	if s == nil {
		return errors.New("nil store")
	}
	return s.rdb.Set(ctx, stripeWaitlistSnapshotKey, jsonBlob, stripeWaitlistSnapshotTTL).Err()
}

// GetStripeWaitlistSnapshot returns raw JSON or redis.Nil if missing/expired.
func (s *Store) GetStripeWaitlistSnapshot(ctx context.Context) (string, error) {
	if s == nil {
		return "", errors.New("nil store")
	}
	return s.rdb.Get(ctx, stripeWaitlistSnapshotKey).Result()
}

// ErrStripeWaitlistSnapshotMissing is returned when no snapshot exists yet.
var ErrStripeWaitlistSnapshotMissing = errors.New("stripe waitlist snapshot missing")

// GetStripeWaitlistSnapshotBytes returns snapshot bytes or ErrStripeWaitlistSnapshotMissing.
func (s *Store) GetStripeWaitlistSnapshotBytes(ctx context.Context) ([]byte, error) {
	raw, err := s.GetStripeWaitlistSnapshot(ctx)
	if err == redis.Nil {
		return nil, ErrStripeWaitlistSnapshotMissing
	}
	if err != nil {
		return nil, err
	}
	return []byte(raw), nil
}
