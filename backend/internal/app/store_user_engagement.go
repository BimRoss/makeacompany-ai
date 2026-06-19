package app

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
)

// User-engagement counters power the /admin expandable row that shows how
// much each trialer has talked to Ross and Joanne — a leading indicator for
// trial-to-paid conversion (issue #498). Writes come from the bot pods via
// /v1/internal/ingest-user-engagement; reads serve the /admin UI.
//
// Storage shape:
//
//   makeacompany:user_engagement:<slack_user_id>              (HASH)
//     total_messages           int
//     ross_messages            int
//     joanne_messages          int
//     ross_mentions            int
//     joanne_mentions          int
//     first_seen_at            RFC3339
//     last_seen_at             RFC3339
//
//   makeacompany:user_engagement_daily:<slack_user_id>:<YYYY-MM-DD>  (HASH, 60d TTL)
//     messages                 int
//     ross_messages            int
//     joanne_messages          int
//
//   makeacompany:user_engagement:total_messages              (SORTED SET)
//     score = total_messages, member = slack_user_id
//     — backs the sortable /admin column without scanning every per-user
//       hash on every page render.
//
// Per-user hash is unbounded in time (we want lifetime counters); daily
// rollup carries a 60-day TTL since the /admin sparkline only renders a
// 30-day window.

const (
	userEngagementKeyPrefix       = keyPrefix + ":user_engagement:"
	userEngagementDailyKeyPrefix  = keyPrefix + ":user_engagement_daily:"
	userEngagementSortedSetKey    = keyPrefix + ":user_engagement:total_messages"
	userEngagementDailyTTL        = 60 * 24 * time.Hour
	userEngagementSparklineWindow = 30
)

// IngestEvent is one Slack message observed by a bot. The bot identifier
// ("ross" or "joanne") tells the store which per-bot counter to bump.
type IngestEvent struct {
	WorkspaceID string
	SlackUserID string
	ChannelID   string
	ChannelType string
	MessageTS   string
	OccurredAt  time.Time
	MentionsBot bool
}

// EngagementSummary is the rolled-up view returned to /admin.
type EngagementSummary struct {
	SlackUserID    string             `json:"slack_user_id"`
	TotalMessages  int64              `json:"total_messages"`
	RossMessages   int64              `json:"ross_messages"`
	JoanneMessages int64              `json:"joanne_messages"`
	RossMentions   int64              `json:"ross_mentions"`
	JoanneMentions int64              `json:"joanne_mentions"`
	FirstSeenAt    string             `json:"first_seen_at,omitempty"`
	LastSeenAt     string             `json:"last_seen_at,omitempty"`
	Sparkline      []EngagementDayBin `json:"sparkline"`
}

// EngagementDayBin is one day of the sparkline.
type EngagementDayBin struct {
	Day      string `json:"day"`
	Messages int64  `json:"messages"`
}

func userEngagementKey(slackUserID string) string {
	return userEngagementKeyPrefix + slackUserID
}

func userEngagementDailyKey(slackUserID, day string) string {
	return userEngagementDailyKeyPrefix + slackUserID + ":" + day
}

// IngestUserEngagementBatch applies a batch of events from a single bot
// atomically per event via pipelined HINCRBYs. Pipelined rather than a
// single Lua script because the batch is small (≤50 events per bot tick)
// and pipelining keeps the code readable.
//
// botName is "ross" or "joanne"; anything else returns an error so a
// misconfigured bot pod fails loudly rather than poisoning the counters.
func (s *Store) IngestUserEngagementBatch(ctx context.Context, botName string, events []IngestEvent) error {
	if s == nil {
		return errors.New("nil store")
	}
	if botName != "ross" && botName != "joanne" {
		return fmt.Errorf("user_engagement: unknown bot %q", botName)
	}
	if len(events) == 0 {
		return nil
	}
	pipe := s.rdb.Pipeline()
	// firstSeenCmds holds the HSetNX BoolCmd for the FIRST event we see per
	// slack_user_id in this batch. If the BoolCmd returns true after Exec,
	// that means we just stamped first_seen_at — which is the funnel's
	// "first message ever" signal. Subsequent events for the same user in
	// the same batch are no-ops on first_seen_at and don't need tracking.
	firstSeenCmds := make(map[string]*redis.BoolCmd, len(events))
	for _, ev := range events {
		if ev.SlackUserID == "" {
			continue
		}
		k := userEngagementKey(ev.SlackUserID)
		when := ev.OccurredAt
		if when.IsZero() {
			when = time.Now().UTC()
		}
		dayKey := userEngagementDailyKey(ev.SlackUserID, when.UTC().Format("2006-01-02"))

		pipe.HIncrBy(ctx, k, "total_messages", 1)
		pipe.HIncrBy(ctx, k, botName+"_messages", 1)
		if ev.MentionsBot {
			pipe.HIncrBy(ctx, k, botName+"_mentions", 1)
		}
		// HSetNX so first_seen_at sticks; last_seen_at is overwritten
		// every event but cheap.
		firstSeenCmd := pipe.HSetNX(ctx, k, "first_seen_at", when.UTC().Format(time.RFC3339))
		if _, dup := firstSeenCmds[ev.SlackUserID]; !dup {
			firstSeenCmds[ev.SlackUserID] = firstSeenCmd
		}
		pipe.HSet(ctx, k, "last_seen_at", when.UTC().Format(time.RFC3339))

		pipe.HIncrBy(ctx, dayKey, "messages", 1)
		pipe.HIncrBy(ctx, dayKey, botName+"_messages", 1)
		pipe.Expire(ctx, dayKey, userEngagementDailyTTL)

		// Sorted-set score = total_messages. Bump by 1 per event; ZADD
		// with INCR semantics so we don't need a follow-up HGET.
		pipe.ZIncrBy(ctx, userEngagementSortedSetKey, 1, ev.SlackUserID)
	}
	_, err := pipe.Exec(ctx)
	if err != nil {
		return fmt.Errorf("ingest pipeline: %w", err)
	}
	for _, cmd := range firstSeenCmds {
		if flipped, cmdErr := cmd.Result(); cmdErr == nil && flipped {
			firstMessageTotal.WithLabelValues(botName).Inc()
		}
	}
	return nil
}

// LoadUserEngagement returns the rolled-up summary for one Slack user,
// including a 30-day daily sparkline. Returns an empty (zero) summary
// rather than an error when the user has no recorded engagement, so the
// /admin row can render a "no activity yet" state without special-casing.
func (s *Store) LoadUserEngagement(ctx context.Context, slackUserID string) (EngagementSummary, error) {
	out := EngagementSummary{SlackUserID: slackUserID, Sparkline: []EngagementDayBin{}}
	if s == nil {
		return out, errors.New("nil store")
	}
	if slackUserID == "" {
		return out, errors.New("slack_user_id required")
	}
	h, err := s.rdb.HGetAll(ctx, userEngagementKey(slackUserID)).Result()
	if err != nil && !errors.Is(err, redis.Nil) {
		return out, fmt.Errorf("hgetall: %w", err)
	}
	out.TotalMessages = parseInt64(h["total_messages"])
	out.RossMessages = parseInt64(h["ross_messages"])
	out.JoanneMessages = parseInt64(h["joanne_messages"])
	out.RossMentions = parseInt64(h["ross_mentions"])
	out.JoanneMentions = parseInt64(h["joanne_mentions"])
	out.FirstSeenAt = h["first_seen_at"]
	out.LastSeenAt = h["last_seen_at"]

	// 30-day sparkline: pipelined HGET for each day in the window.
	// Most users won't have a row for every day, so MGET-like miss
	// handling is cheaper than fanning out N round-trips.
	today := time.Now().UTC()
	pipe := s.rdb.Pipeline()
	dayKeys := make([]string, userEngagementSparklineWindow)
	dayLabels := make([]string, userEngagementSparklineWindow)
	cmds := make([]*redis.StringCmd, userEngagementSparklineWindow)
	for i := 0; i < userEngagementSparklineWindow; i++ {
		d := today.AddDate(0, 0, -(userEngagementSparklineWindow - 1 - i))
		dayLabels[i] = d.Format("2006-01-02")
		dayKeys[i] = userEngagementDailyKey(slackUserID, dayLabels[i])
		cmds[i] = pipe.HGet(ctx, dayKeys[i], "messages")
	}
	_, _ = pipe.Exec(ctx) // individual cmd errors handled below
	for i, c := range cmds {
		v, err := c.Result()
		if err != nil {
			// redis.Nil = no activity that day, render as 0
			out.Sparkline = append(out.Sparkline, EngagementDayBin{Day: dayLabels[i], Messages: 0})
			continue
		}
		out.Sparkline = append(out.Sparkline, EngagementDayBin{Day: dayLabels[i], Messages: parseInt64(v)})
	}
	return out, nil
}

// TopUsersByEngagement returns the top-N slack_user_ids ordered by
// total_messages descending. The /admin frontend uses this for the
// sortable column; explicit page sizing keeps Redis work bounded.
func (s *Store) TopUsersByEngagement(ctx context.Context, limit int) ([]EngagementSummary, error) {
	if s == nil {
		return nil, errors.New("nil store")
	}
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	zs, err := s.rdb.ZRevRangeWithScores(ctx, userEngagementSortedSetKey, 0, int64(limit-1)).Result()
	if err != nil && !errors.Is(err, redis.Nil) {
		return nil, fmt.Errorf("zrevrange: %w", err)
	}
	out := make([]EngagementSummary, 0, len(zs))
	for _, z := range zs {
		userID, ok := z.Member.(string)
		if !ok {
			continue
		}
		summary, err := s.LoadUserEngagement(ctx, userID)
		if err != nil {
			continue
		}
		out = append(out, summary)
	}
	// Sort defensively: ZRevRange is already in score order but a tied
	// score yields an unspecified Slack-user-ID order. Stable secondary
	// sort makes the UI deterministic.
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].TotalMessages != out[j].TotalMessages {
			return out[i].TotalMessages > out[j].TotalMessages
		}
		return out[i].SlackUserID < out[j].SlackUserID
	})
	return out, nil
}

// BackfillUserEngagementDay applies a one-shot, idempotent bulk update for
// one UTC day: byUser is keyed by slack_user_id with the message count for
// that day, attributed to botName. Uses a SETNX marker key so re-running
// the script does not double-count.
//
// Backfill nuances:
//
//   - first_seen_at is set with HSETNX only when missing, using midnight of
//     the backfilled day as the timestamp (we don't have per-message ts).
//   - last_seen_at is set only when the backfilled day is more recent than
//     the existing value — backfill must never roll lifetime "last seen"
//     backward.
//   - The per-bot mentions counter is not touched (we have no mention info
//     in the historical snapshot).
func (s *Store) BackfillUserEngagementDay(ctx context.Context, botName, day string, byUser map[string]int) (applied bool, _ error) {
	if s == nil {
		return false, errors.New("nil store")
	}
	if botName != "ross" && botName != "joanne" {
		return false, fmt.Errorf("user_engagement: unknown bot %q", botName)
	}
	if _, err := time.Parse("2006-01-02", day); err != nil {
		return false, fmt.Errorf("user_engagement: bad day %q: %w", day, err)
	}
	if len(byUser) == 0 {
		// Mark applied with no work so subsequent runs don't try.
		_, _ = s.rdb.SetNX(ctx, userEngagementBackfillMarkerKey(botName, day), "1", 90*24*time.Hour).Result()
		return false, nil
	}
	ok, err := s.rdb.SetNX(ctx, userEngagementBackfillMarkerKey(botName, day), "1", 90*24*time.Hour).Result()
	if err != nil {
		return false, fmt.Errorf("setnx marker: %w", err)
	}
	if !ok {
		return false, nil
	}
	dayStart, _ := time.Parse("2006-01-02", day)
	dayStartRFC := dayStart.UTC().Format(time.RFC3339)

	pipe := s.rdb.Pipeline()
	for userID, count := range byUser {
		if userID == "" || count <= 0 {
			continue
		}
		k := userEngagementKey(userID)
		dayKey := userEngagementDailyKey(userID, day)
		n := int64(count)

		pipe.HIncrBy(ctx, k, "total_messages", n)
		pipe.HIncrBy(ctx, k, botName+"_messages", n)
		pipe.HSetNX(ctx, k, "first_seen_at", dayStartRFC)
		pipe.HIncrBy(ctx, dayKey, "messages", n)
		pipe.HIncrBy(ctx, dayKey, botName+"_messages", n)
		pipe.Expire(ctx, dayKey, userEngagementDailyTTL)
		pipe.ZIncrBy(ctx, userEngagementSortedSetKey, float64(n), userID)
	}
	if _, err := pipe.Exec(ctx); err != nil {
		return false, fmt.Errorf("backfill pipeline: %w", err)
	}
	// Maybe-update last_seen_at only when this day is more recent than
	// what's there. Done outside the pipeline because we need to compare.
	for userID := range byUser {
		if userID == "" {
			continue
		}
		k := userEngagementKey(userID)
		existing, err := s.rdb.HGet(ctx, k, "last_seen_at").Result()
		if err != nil && !errors.Is(err, redis.Nil) {
			continue
		}
		if existing == "" || existing < dayStartRFC {
			_ = s.rdb.HSet(ctx, k, "last_seen_at", dayStartRFC).Err()
		}
	}
	return true, nil
}

const userEngagementBackfillMarkerKeyPrefix = keyPrefix + ":user_engagement_backfill:"

func userEngagementBackfillMarkerKey(botName, day string) string {
	return userEngagementBackfillMarkerKeyPrefix + botName + ":" + day
}

func parseInt64(s string) int64 {
	if s == "" {
		return 0
	}
	n, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return 0
	}
	return n
}
