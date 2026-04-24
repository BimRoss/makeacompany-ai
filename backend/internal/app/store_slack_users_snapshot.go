package app

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

// Redis key for hourly CronJob + admin UI: JSON from Slack users.list.
const slackUsersSnapshotKey = keyPrefix + ":admin:slack_users_snapshot"

// SaveSlackUsersSnapshot stores JSON from refresh (PII when emails present). TTL 0 = no Redis expiry;
// the blob is replaced on the next refresh/cron (admin reload reads the same key employee-factory expects).
const slackUsersSnapshotTTL = time.Duration(0)

func (s *Store) SaveSlackUsersSnapshot(ctx context.Context, jsonBlob []byte) error {
	if s == nil {
		return errors.New("nil store")
	}
	return s.rdb.Set(ctx, slackUsersSnapshotKey, jsonBlob, slackUsersSnapshotTTL).Err()
}

// GetSlackUsersSnapshot returns raw JSON or redis.Nil if missing.
func (s *Store) GetSlackUsersSnapshot(ctx context.Context) (string, error) {
	if s == nil {
		return "", errors.New("nil store")
	}
	return s.rdb.Get(ctx, slackUsersSnapshotKey).Result()
}

// ErrSlackUsersSnapshotMissing is returned when no snapshot exists yet.
var ErrSlackUsersSnapshotMissing = errors.New("slack users snapshot missing")

// GetSlackUsersSnapshotBytes returns snapshot bytes or ErrSlackUsersSnapshotMissing.
func (s *Store) GetSlackUsersSnapshotBytes(ctx context.Context) ([]byte, error) {
	raw, err := s.GetSlackUsersSnapshot(ctx)
	if err == redis.Nil {
		return nil, ErrSlackUsersSnapshotMissing
	}
	if err != nil {
		return nil, err
	}
	return []byte(raw), nil
}

// LookupSlackFirstNameByEmail returns the first token of Slack real_name/display_name for a workspace
// member whose profile email matches (from the cached users.list snapshot). Returns "" when unknown.
func (s *Store) LookupSlackFirstNameByEmail(ctx context.Context, email string) string {
	if s == nil {
		return ""
	}
	raw, err := s.GetSlackUsersSnapshotBytes(ctx)
	if err != nil {
		return ""
	}
	env, err := ParseSlackUsersSnapshotEnvelope(raw)
	if err != nil {
		return ""
	}
	want := normalizeProfileEmail(strings.TrimSpace(email))
	if want == "" {
		return ""
	}
	for i := range env.Users {
		if normalizeProfileEmail(env.Users[i].Email) == want {
			return firstGivenNameFromSlackWorkspaceUser(env.Users[i])
		}
	}
	return ""
}
