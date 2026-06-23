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

// DeletedOrBotSlackUserIDs returns the set of Slack user ids in the cached snapshot
// that are deactivated (deleted=true) or bots/apps (is_bot=true). The lifecycle
// sweeper uses this to drop those rows from the cohort counts so the graph tracks
// the same "active humans" the admin Slack Users table shows with deleted hidden.
//
// Returns ErrSlackUsersSnapshotMissing when no snapshot has been written yet; the
// caller should treat that as "exclude nothing" rather than blanking the graph.
func (s *Store) DeletedOrBotSlackUserIDs(ctx context.Context) (map[string]struct{}, error) {
	if s == nil {
		return nil, errors.New("nil store")
	}
	raw, err := s.GetSlackUsersSnapshotBytes(ctx)
	if err != nil {
		return nil, err
	}
	env, err := ParseSlackUsersSnapshotEnvelope(raw)
	if err != nil {
		return nil, err
	}
	out := make(map[string]struct{})
	for i := range env.Users {
		if !env.Users[i].IsDeleted && !env.Users[i].IsBot {
			continue
		}
		if id := strings.TrimSpace(env.Users[i].SlackUserID); id != "" {
			out[id] = struct{}{}
		}
	}
	return out, nil
}

// LookupSlackWorkspaceUserByEmail returns the cached snapshot row for a workspace
// member by profile email. Returns (zero, false, nil) when the snapshot is
// missing or the email isn't in it.
func (s *Store) LookupSlackWorkspaceUserByEmail(ctx context.Context, email string) (SlackWorkspaceUser, bool, error) {
	if s == nil {
		return SlackWorkspaceUser{}, false, errors.New("nil store")
	}
	raw, err := s.GetSlackUsersSnapshotBytes(ctx)
	if err != nil {
		if errors.Is(err, ErrSlackUsersSnapshotMissing) {
			return SlackWorkspaceUser{}, false, nil
		}
		return SlackWorkspaceUser{}, false, err
	}
	env, err := ParseSlackUsersSnapshotEnvelope(raw)
	if err != nil {
		return SlackWorkspaceUser{}, false, err
	}
	want := normalizeProfileEmail(strings.TrimSpace(email))
	if want == "" {
		return SlackWorkspaceUser{}, false, nil
	}
	for i := range env.Users {
		if normalizeProfileEmail(env.Users[i].Email) == want {
			return env.Users[i], true, nil
		}
	}
	return SlackWorkspaceUser{}, false, nil
}

// SlackWorkspaceUsersByID returns the cached users.list snapshot keyed by Slack
// user id. A missing snapshot yields an empty map (not an error) so callers can
// degrade to "no avatars" rather than failing. Used by the public lander
// personal-agents row to resolve each agent bot's profile image from one cached
// snapshot instead of a per-agent Slack round trip.
func (s *Store) SlackWorkspaceUsersByID(ctx context.Context) (map[string]SlackWorkspaceUser, error) {
	if s == nil {
		return nil, errors.New("nil store")
	}
	raw, err := s.GetSlackUsersSnapshotBytes(ctx)
	if err != nil {
		if errors.Is(err, ErrSlackUsersSnapshotMissing) {
			return map[string]SlackWorkspaceUser{}, nil
		}
		return nil, err
	}
	env, err := ParseSlackUsersSnapshotEnvelope(raw)
	if err != nil {
		return nil, err
	}
	out := make(map[string]SlackWorkspaceUser, len(env.Users))
	for i := range env.Users {
		if id := strings.TrimSpace(env.Users[i].SlackUserID); id != "" {
			out[id] = env.Users[i]
		}
	}
	return out, nil
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
