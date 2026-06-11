package app

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/redis/go-redis/v9"
)

const slackActivityDailyKeyPrefix = keyPrefix + ":admin:slack_activity_daily:"

// Per-day blob retained ~120 days; daily cron rewrites the current key in-place.
const slackActivityDailyTTL = 120 * 24 * time.Hour

// ErrSlackActivityDailyMissing is returned when no snapshot exists for the requested day.
var ErrSlackActivityDailyMissing = errors.New("slack activity daily snapshot missing")

func slackActivityDailyKey(day string) string {
	return slackActivityDailyKeyPrefix + day
}

// SaveSlackActivityDaily writes the per-day activity blob under a TTL'd key.
func (s *Store) SaveSlackActivityDaily(ctx context.Context, day string, blob []byte) error {
	if s == nil {
		return errors.New("nil store")
	}
	return s.rdb.Set(ctx, slackActivityDailyKey(day), blob, slackActivityDailyTTL).Err()
}

// GetSlackActivityDailyBytes returns the day blob or ErrSlackActivityDailyMissing.
func (s *Store) GetSlackActivityDailyBytes(ctx context.Context, day string) ([]byte, error) {
	if s == nil {
		return nil, errors.New("nil store")
	}
	raw, err := s.rdb.Get(ctx, slackActivityDailyKey(day)).Result()
	if err == redis.Nil {
		return nil, ErrSlackActivityDailyMissing
	}
	if err != nil {
		return nil, err
	}
	return []byte(raw), nil
}

// MarshalSlackActivityDay returns JSON for Redis storage and HTTP responses.
func MarshalSlackActivityDay(day SlackActivityDay) ([]byte, error) {
	return json.Marshal(day)
}

// ParseSlackActivityDay unmarshals a Redis blob into the typed struct.
func ParseSlackActivityDay(raw []byte) (SlackActivityDay, error) {
	var out SlackActivityDay
	if err := json.Unmarshal(raw, &out); err != nil {
		return SlackActivityDay{}, err
	}
	return out, nil
}
