package app

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/redis/go-redis/v9"
)

// Dedup-by-fingerprint counters for /admin "messages sent in Slack" (issue
// #498 follow-up after the dedup audit). Replaces the per-bot HINCRBY
// counters in [[store_user_engagement]] — those double-counted any message
// in a channel both Ross and Joanne were members of, and missed thread
// replies entirely. The legacy counters stay around for now (no harm) but
// reads come from here.
//
// Storage shape:
//
//   makeacompany:user_messages:<slack_user_id>              (SET, no TTL)
//     members = "<channel_id>:<message_ts>" — message fingerprints
//     SCARD = lifetime messages sent
//
//   makeacompany:user_messages_daily:<slack_user_id>:<YYYY-MM-DD>  (SET, 60d TTL)
//     members = same fingerprints, sliced by UTC day
//     SCARD = messages sent that day, backs the /admin sparkline
//
//   makeacompany:user_messages:totals                      (SORTED SET)
//     score = SCARD(<user>), member = slack_user_id
//     bumped by 1 only when an SADD into the lifetime set returned 1 (new
//     fingerprint), so concurrent observations from two bots don't
//     inflate the score.
//
//   makeacompany:user_messages_meta:<slack_user_id>        (HASH, no TTL)
//     first_seen_at  RFC3339 — HSETNX on every event
//     last_seen_at   RFC3339 — overwritten if newer than current

const (
	userMessagesKeyPrefix      = keyPrefix + ":user_messages:"
	userMessagesDailyKeyPrefix = keyPrefix + ":user_messages_daily:"
	userMessagesMetaKeyPrefix  = keyPrefix + ":user_messages_meta:"
	userMessagesSortedSetKey   = keyPrefix + ":user_messages:totals"
	userMessagesDailyTTL       = 60 * 24 * time.Hour
	userMessagesSparklineWin   = 30
)

func userMessagesKey(slackUserID string) string {
	return userMessagesKeyPrefix + slackUserID
}

func userMessagesDailyKey(slackUserID, day string) string {
	return userMessagesDailyKeyPrefix + slackUserID + ":" + day
}

func userMessagesMetaKey(slackUserID string) string {
	return userMessagesMetaKeyPrefix + slackUserID
}

// UserMessagesSummary is the rolled-up view returned to /admin. One number,
// one sparkline, plus first/last-seen for context.
type UserMessagesSummary struct {
	SlackUserID   string             `json:"slack_user_id"`
	TotalMessages int64              `json:"total_messages"`
	FirstSeenAt   string             `json:"first_seen_at,omitempty"`
	LastSeenAt    string             `json:"last_seen_at,omitempty"`
	Sparkline     []EngagementDayBin `json:"sparkline"`
}

// IngestUserMessagesBatch records a batch of message fingerprints. Dedup is
// at the SADD level: two bots seeing the same `(channel_id, message_ts)`
// produce one set entry. Events missing channel_id or message_ts are
// dropped (they have no usable fingerprint).
func (s *Store) IngestUserMessagesBatch(ctx context.Context, events []IngestEvent) error {
	if s == nil {
		return errors.New("nil store")
	}
	if len(events) == 0 {
		return nil
	}
	pipe := s.rdb.Pipeline()
	sadds := make([]*redis.IntCmd, 0, len(events))
	users := make([]string, 0, len(events))
	for _, ev := range events {
		if ev.SlackUserID == "" || ev.ChannelID == "" || ev.MessageTS == "" {
			continue
		}
		fingerprint := ev.ChannelID + ":" + ev.MessageTS
		when := ev.OccurredAt
		if when.IsZero() {
			when = time.Now().UTC()
		}
		dayKey := userMessagesDailyKey(ev.SlackUserID, when.UTC().Format("2006-01-02"))
		metaKey := userMessagesMetaKey(ev.SlackUserID)
		sadds = append(sadds, pipe.SAdd(ctx, userMessagesKey(ev.SlackUserID), fingerprint))
		users = append(users, ev.SlackUserID)
		pipe.SAdd(ctx, dayKey, fingerprint)
		pipe.Expire(ctx, dayKey, userMessagesDailyTTL)
		pipe.HSetNX(ctx, metaKey, "first_seen_at", when.UTC().Format(time.RFC3339))
		// last_seen is read-modify-write; do it after the pipeline exec
		// once we know the timestamp won't roll back.
		pipe.HSet(ctx, metaKey, "last_seen_at_candidate", when.UTC().Format(time.RFC3339))
	}
	if _, err := pipe.Exec(ctx); err != nil {
		return fmt.Errorf("ingest pipeline: %w", err)
	}
	// Bump the sorted set only for fingerprints SADD said were new (1).
	// Doing this here rather than inside the pipeline lets us read SADD
	// results — Redis pipeline returns the IntCmd values after Exec.
	zPipe := s.rdb.Pipeline()
	dirtyUsers := map[string]bool{}
	for i, cmd := range sadds {
		if cmd.Val() == 1 {
			zPipe.ZIncrBy(ctx, userMessagesSortedSetKey, 1, users[i])
			dirtyUsers[users[i]] = true
		}
	}
	if _, err := zPipe.Exec(ctx); err != nil {
		return fmt.Errorf("ingest sorted-set pipeline: %w", err)
	}
	// last_seen: only roll forward, never back. Compare-and-set per
	// dirty user.
	for u := range dirtyUsers {
		k := userMessagesMetaKey(u)
		candidate, err := s.rdb.HGet(ctx, k, "last_seen_at_candidate").Result()
		if err != nil {
			continue
		}
		existing, _ := s.rdb.HGet(ctx, k, "last_seen_at").Result()
		if existing == "" || existing < candidate {
			_ = s.rdb.HSet(ctx, k, "last_seen_at", candidate).Err()
		}
		_ = s.rdb.HDel(ctx, k, "last_seen_at_candidate").Err()
	}
	return nil
}

// LoadUserMessages returns the deduped summary for one user, including a
// 30-day sparkline. Empty summary on no activity (so /admin can render
// the row without special-casing).
func (s *Store) LoadUserMessages(ctx context.Context, slackUserID string) (UserMessagesSummary, error) {
	out := UserMessagesSummary{SlackUserID: slackUserID, Sparkline: []EngagementDayBin{}}
	if s == nil {
		return out, errors.New("nil store")
	}
	if slackUserID == "" {
		return out, errors.New("slack_user_id required")
	}
	total, err := s.rdb.SCard(ctx, userMessagesKey(slackUserID)).Result()
	if err != nil && !errors.Is(err, redis.Nil) {
		return out, fmt.Errorf("scard: %w", err)
	}
	out.TotalMessages = total
	meta, err := s.rdb.HGetAll(ctx, userMessagesMetaKey(slackUserID)).Result()
	if err != nil && !errors.Is(err, redis.Nil) {
		return out, fmt.Errorf("meta hgetall: %w", err)
	}
	out.FirstSeenAt = meta["first_seen_at"]
	out.LastSeenAt = meta["last_seen_at"]

	today := time.Now().UTC()
	pipe := s.rdb.Pipeline()
	labels := make([]string, userMessagesSparklineWin)
	cmds := make([]*redis.IntCmd, userMessagesSparklineWin)
	for i := 0; i < userMessagesSparklineWin; i++ {
		d := today.AddDate(0, 0, -(userMessagesSparklineWin - 1 - i))
		labels[i] = d.Format("2006-01-02")
		cmds[i] = pipe.SCard(ctx, userMessagesDailyKey(slackUserID, labels[i]))
	}
	_, _ = pipe.Exec(ctx)
	for i, c := range cmds {
		v, err := c.Result()
		if err != nil {
			out.Sparkline = append(out.Sparkline, EngagementDayBin{Day: labels[i], Messages: 0})
			continue
		}
		out.Sparkline = append(out.Sparkline, EngagementDayBin{Day: labels[i], Messages: v})
	}
	return out, nil
}

// TopUsersByMessages returns up to `limit` users ordered by total messages
// descending. Reads the deduped sorted set, so two-bot channels don't
// inflate ranks.
func (s *Store) TopUsersByMessages(ctx context.Context, limit int) ([]UserMessagesSummary, error) {
	if s == nil {
		return nil, errors.New("nil store")
	}
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	zs, err := s.rdb.ZRevRangeWithScores(ctx, userMessagesSortedSetKey, 0, int64(limit-1)).Result()
	if err != nil && !errors.Is(err, redis.Nil) {
		return nil, fmt.Errorf("zrevrange: %w", err)
	}
	out := make([]UserMessagesSummary, 0, len(zs))
	for _, z := range zs {
		userID, ok := z.Member.(string)
		if !ok {
			continue
		}
		summary, err := s.LoadUserMessages(ctx, userID)
		if err != nil {
			continue
		}
		out = append(out, summary)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].TotalMessages != out[j].TotalMessages {
			return out[i].TotalMessages > out[j].TotalMessages
		}
		return out[i].SlackUserID < out[j].SlackUserID
	})
	return out, nil
}

// BackfillUserMessagesEvent is the per-message tuple the backfill cmd
// produces from a Slack history walk: who sent it, where, and when (in
// channel-ts form, which is also the dedup fingerprint).
type BackfillUserMessagesEvent struct {
	SlackUserID string
	ChannelID   string
	MessageTS   string
}

// BackfillUserMessagesDay applies a batch of historical fingerprints for
// one UTC day. Idempotent via a SETNX day-marker key — re-running the same
// day is a no-op. last_seen_at is rolled forward only if the backfilled
// day is more recent than what's already stored.
func (s *Store) BackfillUserMessagesDay(ctx context.Context, day string, events []BackfillUserMessagesEvent) (applied bool, _ error) {
	if s == nil {
		return false, errors.New("nil store")
	}
	if _, err := time.Parse("2006-01-02", day); err != nil {
		return false, fmt.Errorf("bad day %q: %w", day, err)
	}
	markerKey := userMessagesBackfillMarkerKey(day)
	ok, err := s.rdb.SetNX(ctx, markerKey, "1", 90*24*time.Hour).Result()
	if err != nil {
		return false, fmt.Errorf("setnx marker: %w", err)
	}
	if !ok {
		return false, nil
	}
	if len(events) == 0 {
		return true, nil
	}
	dayStart, _ := time.Parse("2006-01-02", day)
	dayStartRFC := dayStart.UTC().Format(time.RFC3339)

	pipe := s.rdb.Pipeline()
	sadds := make([]*redis.IntCmd, 0, len(events))
	users := make([]string, 0, len(events))
	seenUsers := map[string]bool{}
	for _, ev := range events {
		if ev.SlackUserID == "" || ev.ChannelID == "" || ev.MessageTS == "" {
			continue
		}
		fingerprint := ev.ChannelID + ":" + ev.MessageTS
		sadds = append(sadds, pipe.SAdd(ctx, userMessagesKey(ev.SlackUserID), fingerprint))
		users = append(users, ev.SlackUserID)
		dayKey := userMessagesDailyKey(ev.SlackUserID, day)
		pipe.SAdd(ctx, dayKey, fingerprint)
		pipe.Expire(ctx, dayKey, userMessagesDailyTTL)
		seenUsers[ev.SlackUserID] = true
	}
	if _, err := pipe.Exec(ctx); err != nil {
		return false, fmt.Errorf("backfill pipeline: %w", err)
	}
	zPipe := s.rdb.Pipeline()
	for i, cmd := range sadds {
		if cmd.Val() == 1 {
			zPipe.ZIncrBy(ctx, userMessagesSortedSetKey, 1, users[i])
		}
	}
	if _, err := zPipe.Exec(ctx); err != nil {
		return false, fmt.Errorf("backfill sorted-set pipeline: %w", err)
	}
	// first_seen_at and last_seen_at: roll forward / backward only.
	// HSETNX inside the pipeline used to lose to the live-ingest path when
	// a new pod warm-started before backfill ran, freezing first_seen_at to
	// the deploy time instead of the earliest historical day.
	for u := range seenUsers {
		metaKey := userMessagesMetaKey(u)
		first, _ := s.rdb.HGet(ctx, metaKey, "first_seen_at").Result()
		if first == "" || first > dayStartRFC {
			_ = s.rdb.HSet(ctx, metaKey, "first_seen_at", dayStartRFC).Err()
		}
		last, _ := s.rdb.HGet(ctx, metaKey, "last_seen_at").Result()
		if last == "" || last < dayStartRFC {
			_ = s.rdb.HSet(ctx, metaKey, "last_seen_at", dayStartRFC).Err()
		}
	}
	return true, nil
}

const userMessagesBackfillMarkerKeyPrefix = keyPrefix + ":user_messages_backfill:"

func userMessagesBackfillMarkerKey(day string) string {
	return userMessagesBackfillMarkerKeyPrefix + day
}
