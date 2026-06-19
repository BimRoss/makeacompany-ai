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
	applied, err := s.BackfillUserMessagesDay(ctx, day, events)
	if err != nil || !applied {
		t.Fatalf("first apply: applied=%v err=%v", applied, err)
	}
	// Re-running with different events must not double-count.
	applied2, err := s.BackfillUserMessagesDay(ctx, day, []BackfillUserMessagesEvent{
		{SlackUserID: "U1", ChannelID: "C1", MessageTS: "9.9"},
	})
	if err != nil || applied2 {
		t.Fatalf("second apply: applied=%v err=%v want skipped", applied2, err)
	}
	u1, _ := s.LoadUserMessages(ctx, "U1")
	if u1.TotalMessages != 2 {
		t.Errorf("U1 total=%d want 2 (second backfill must be no-op)", u1.TotalMessages)
	}
}

func TestBackfillUserMessagesDay_SparklineRollup(t *testing.T) {
	s, _ := newMessagesStore(t)
	ctx := context.Background()
	today := time.Now().UTC().Format("2006-01-02")
	yesterday := time.Now().UTC().AddDate(0, 0, -1).Format("2006-01-02")
	_, _ = s.BackfillUserMessagesDay(ctx, today, []BackfillUserMessagesEvent{
		{SlackUserID: "U1", ChannelID: "C1", MessageTS: "1.1"},
		{SlackUserID: "U1", ChannelID: "C1", MessageTS: "1.2"},
	})
	_, _ = s.BackfillUserMessagesDay(ctx, yesterday, []BackfillUserMessagesEvent{
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
