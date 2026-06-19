// backfill-user-engagement seeds the deduped per-user message counters
// (#498 follow-up) by replaying the last N days of channel history *and*
// thread replies via FetchSlackUserMessagesDay. Idempotent per (day) via a
// Redis marker key; re-running is safe.
//
// Usage:
//
//	backfill-user-engagement \
//	    --redis-url=$REDIS_URL \
//	    --slack-token=$ORCHESTRATOR_SLACK_BOT_TOKEN \
//	    --days=60
//
// Bot attribution is no longer required — the dedup store keys off
// (channel_id, message_ts), not the observing bot. Run with whichever bot
// token has the broadest channel membership.
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"makeacompany-ai/backend/internal/app"
)

func main() {
	var (
		redisURL   = flag.String("redis-url", os.Getenv("MAKEACOMPANY_REDIS_URL"), "Redis URL (also reads MAKEACOMPANY_REDIS_URL)")
		slackToken = flag.String("slack-token", os.Getenv("ORCHESTRATOR_SLACK_BOT_TOKEN"), "Slack bot token (also reads ORCHESTRATOR_SLACK_BOT_TOKEN)")
		days       = flag.Int("days", 60, "How many days back to backfill, ending yesterday UTC")
	)
	flag.Parse()

	if strings.TrimSpace(*redisURL) == "" {
		log.Fatal("missing --redis-url / MAKEACOMPANY_REDIS_URL")
	}
	if strings.TrimSpace(*slackToken) == "" {
		log.Fatal("missing --slack-token / ORCHESTRATOR_SLACK_BOT_TOKEN")
	}
	if *days <= 0 || *days > 90 {
		log.Fatalf("--days must be 1..90, got %d", *days)
	}

	store, err := app.NewStore(*redisURL)
	if err != nil {
		log.Fatalf("redis: %v", err)
	}
	defer store.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Minute)
	defer cancel()

	end := time.Now().UTC().AddDate(0, 0, -1)
	start := end.AddDate(0, 0, -(*days - 1))
	fmt.Printf("backfilling deduped messages from %s through %s (%d days)\n", start.Format("2006-01-02"), end.Format("2006-01-02"), *days)

	totalApplied := 0
	totalSkipped := 0
	totalEvents := 0
	for d := start; !d.After(end); d = d.AddDate(0, 0, 1) {
		day := d.Format("2006-01-02")
		events, err := app.FetchSlackUserMessagesDay(ctx, *slackToken, day)
		if err != nil {
			log.Printf("fetch %s: %v (skipped)", day, err)
			continue
		}
		applied, err := store.BackfillUserMessagesDay(ctx, day, events)
		if err != nil {
			log.Printf("apply %s: %v (skipped)", day, err)
			continue
		}
		if applied {
			totalApplied++
			totalEvents += len(events)
			fmt.Printf("  %s: %d fingerprints — applied\n", day, len(events))
		} else {
			totalSkipped++
			fmt.Printf("  %s: already backfilled — skipped\n", day)
		}
	}
	fmt.Printf("done: %d days applied, %d skipped, %d fingerprints written\n", totalApplied, totalSkipped, totalEvents)
}
