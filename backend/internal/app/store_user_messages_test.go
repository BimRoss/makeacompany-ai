package app

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func newMessagesStore(t *testing.T) (*Store, *miniredis.Miniredis) {
	t.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	return &Store{rdb: rdb}, mr
}

// TestIngestUserMessages_DedupAcrossBots verifies the headline fix: two
// bots observing the same (channel, ts) produce one count, not two.
func TestIngestUserMessages_DedupAcrossBots(t *testing.T) {
	s, _ := newMessagesStore(t)
	ctx := context.Background()
	now := time.Now().UTC()
	ev := []IngestEvent{{
		WorkspaceID: "T1",
		SlackUserID: "U1",
		ChannelID:   "C1",
		MessageTS:   "1234.5678",
		OccurredAt:  now,
	}}
	// Bot 1 sees it.
	if err := s.IngestUserMessagesBatch(ctx, ev); err != nil {
		t.Fatal(err)
	}
	// Bot 2 sees the exact same message.
	if err := s.IngestUserMessagesBatch(ctx, ev); err != nil {
		t.Fatal(err)
	}
	summary, err := s.LoadUserMessages(ctx, "U1")
	if err != nil {
		t.Fatal(err)
	}
	if summary.TotalMessages != 1 {
		t.Errorf("total=%d want 1 (dedup failed)", summary.TotalMessages)
	}
	top, err := s.TopUsersByMessages(ctx, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(top) != 1 || top[0].TotalMessages != 1 {
		t.Errorf("top=%+v want one row with total=1", top)
	}
}

// TestIngestUserMessages_DistinctMessagesCountSeparately makes sure dedup
// only collapses true duplicates, not different messages from the same user.
func TestIngestUserMessages_DistinctMessagesCountSeparately(t *testing.T) {
	s, _ := newMessagesStore(t)
	ctx := context.Background()
	now := time.Now().UTC()
	ev := []IngestEvent{
		{SlackUserID: "U1", ChannelID: "C1", MessageTS: "1.1", OccurredAt: now},
		{SlackUserID: "U1", ChannelID: "C1", MessageTS: "1.2", OccurredAt: now},
		{SlackUserID: "U1", ChannelID: "C2", MessageTS: "1.1", OccurredAt: now}, // different channel, same ts → distinct
	}
	if err := s.IngestUserMessagesBatch(ctx, ev); err != nil {
		t.Fatal(err)
	}
	summary, _ := s.LoadUserMessages(ctx, "U1")
	if summary.TotalMessages != 3 {
		t.Errorf("total=%d want 3", summary.TotalMessages)
	}
}

func TestIngestUserMessages_DropsEventsMissingFingerprint(t *testing.T) {
	s, _ := newMessagesStore(t)
	ctx := context.Background()
	now := time.Now().UTC()
	ev := []IngestEvent{
		{SlackUserID: "U1", ChannelID: "C1", MessageTS: "", OccurredAt: now},
		{SlackUserID: "U1", ChannelID: "", MessageTS: "1.1", OccurredAt: now},
		{SlackUserID: "U1", ChannelID: "C1", MessageTS: "1.1", OccurredAt: now},
	}
	if err := s.IngestUserMessagesBatch(ctx, ev); err != nil {
		t.Fatal(err)
	}
	summary, _ := s.LoadUserMessages(ctx, "U1")
	if summary.TotalMessages != 1 {
		t.Errorf("total=%d want 1 (missing-fingerprint events should drop)", summary.TotalMessages)
	}
}

func TestBackfillUserMessagesDay_Idempotent(t *testing.T) {
	s, _ := newMessagesStore(t)
	ctx := context.Background()
	day := "2026-06-10"
	events := []BackfillUserMessagesEvent{
		{SlackUserID: "U1", ChannelID: "C1", MessageTS: "1.1"},
		{SlackUserID: "U1", ChannelID: "C1", MessageTS: "1.2"},
		{SlackUserID: "U2", ChannelID: "C1", MessageTS: "1.3"},
	}
	applied, err := s.BackfillUserMessagesDay(ctx, "ross", day, events)
	if err != nil || !applied {
		t.Fatalf("first apply: applied=%v err=%v", applied, err)
	}
	// Re-running for the same bot with different events must not double-count.
	applied2, err := s.BackfillUserMessagesDay(ctx, "ross", day, []BackfillUserMessagesEvent{
		{SlackUserID: "U1", ChannelID: "C1", MessageTS: "9.9"},
	})
	if err != nil || applied2 {
		t.Fatalf("second apply (same bot): applied=%v err=%v want skipped", applied2, err)
	}
	u1, _ := s.LoadUserMessages(ctx, "U1")
	if u1.TotalMessages != 2 {
		t.Errorf("U1 total=%d want 2 (second backfill must be no-op)", u1.TotalMessages)
	}
}

// TestBackfillUserMessagesDay_PerBotMarker verifies the per-bot marker fix
// (issue #540): running backfill with a second bot token on the same day
// must NOT silently skip — fingerprint dedup handles overlap, but the
// other bot's DM walk needs to actually run.
func TestBackfillUserMessagesDay_PerBotMarker(t *testing.T) {
	s, _ := newMessagesStore(t)
	ctx := context.Background()
	day := "2026-06-10"
	rossEvents := []BackfillUserMessagesEvent{
		{SlackUserID: "U1", ChannelID: "CROSSDM", MessageTS: "1.1"}, // Ross-only DM
		{SlackUserID: "U1", ChannelID: "CSHARED", MessageTS: "1.2"}, // shared channel
	}
	joanneEvents := []BackfillUserMessagesEvent{
		{SlackUserID: "U1", ChannelID: "CSHARED", MessageTS: "1.2"}, // dup of shared
		{SlackUserID: "U1", ChannelID: "CJOANNEDM", MessageTS: "2.1"}, // Joanne-only DM
	}
	applied1, err := s.BackfillUserMessagesDay(ctx, "ross", day, rossEvents)
	if err != nil || !applied1 {
		t.Fatalf("ross apply: applied=%v err=%v", applied1, err)
	}
	applied2, err := s.BackfillUserMessagesDay(ctx, "joanne", day, joanneEvents)
	if err != nil || !applied2 {
		t.Fatalf("joanne apply must run (per-bot marker): applied=%v err=%v", applied2, err)
	}
	u1, _ := s.LoadUserMessages(ctx, "U1")
	// Ross DM (1) + shared channel (1, deduped) + Joanne DM (1) = 3
	if u1.TotalMessages != 3 {
		t.Errorf("U1 total=%d want 3 (ross-dm + shared + joanne-dm, with dedup on shared)", u1.TotalMessages)
	}
}

func TestBackfillUserMessagesDay_RejectsUnknownBot(t *testing.T) {
	s, _ := newMessagesStore(t)
	ctx := context.Background()
	_, err := s.BackfillUserMessagesDay(ctx, "garth", "2026-06-10", nil)
	if err == nil {
		t.Fatal("expected error for unknown bot, got nil")
	}
}

// TestBackfillUserMessagesDay_FirstSeenRollsBack guards against the
// HSETNX-loses-to-live-ingest race: if live ingest already stamped
// first_seen_at to today and backfill then runs against a much earlier
// historical day, first_seen_at must roll *backward* to the earlier day.
func TestBackfillUserMessagesDay_FirstSeenRollsBack(t *testing.T) {
	s, _ := newMessagesStore(t)
	ctx := context.Background()
	// Simulate live ingest having stamped first_seen_at to today.
	today := time.Now().UTC()
	_ = s.IngestUserMessagesBatch(ctx, []IngestEvent{{
		SlackUserID: "U1",
		ChannelID:   "C1",
		MessageTS:   "now.1",
		OccurredAt:  today,
	}})
	historical := today.AddDate(0, 0, -45).Format("2006-01-02")
	_, err := s.BackfillUserMessagesDay(ctx, "ross", historical, []BackfillUserMessagesEvent{
		{SlackUserID: "U1", ChannelID: "C1", MessageTS: "0.5"},
	})
	if err != nil {
		t.Fatal(err)
	}
	summary, _ := s.LoadUserMessages(ctx, "U1")
	historicalRFC, _ := time.Parse("2006-01-02", historical)
	want := historicalRFC.UTC().Format(time.RFC3339)
	if summary.FirstSeenAt != want {
		t.Errorf("first_seen_at=%q want %q (must roll back to backfill day)", summary.FirstSeenAt, want)
	}
	// last_seen_at must stay on today; backfill must NOT roll it back.
	if summary.LastSeenAt == want {
		t.Errorf("last_seen_at=%q rolled back to historical day (should stay on live)", summary.LastSeenAt)
	}
}

func TestBackfillUserMessagesDay_SparklineRollup(t *testing.T) {
	s, _ := newMessagesStore(t)
	ctx := context.Background()
	today := time.Now().UTC().Format("2006-01-02")
	yesterday := time.Now().UTC().AddDate(0, 0, -1).Format("2006-01-02")
	_, _ = s.BackfillUserMessagesDay(ctx, "ross", today, []BackfillUserMessagesEvent{
		{SlackUserID: "U1", ChannelID: "C1", MessageTS: "1.1"},
		{SlackUserID: "U1", ChannelID: "C1", MessageTS: "1.2"},
	})
	_, _ = s.BackfillUserMessagesDay(ctx, "ross", yesterday, []BackfillUserMessagesEvent{
		{SlackUserID: "U1", ChannelID: "C1", MessageTS: "0.9"},
	})
	summary, _ := s.LoadUserMessages(ctx, "U1")
	if summary.TotalMessages != 3 {
		t.Fatalf("total=%d want 3", summary.TotalMessages)
	}
	var todayCount, yesterdayCount int64
	for _, b := range summary.Sparkline {
		if b.Day == today {
			todayCount = b.Messages
		}
		if b.Day == yesterday {
			yesterdayCount = b.Messages
		}
	}
	if todayCount != 2 || yesterdayCount != 1 {
		t.Errorf("sparkline today=%d yesterday=%d want 2/1", todayCount, yesterdayCount)
	}
}
