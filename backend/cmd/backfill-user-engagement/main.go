// backfill-user-engagement seeds the deduped per-user message counters
// (#498 follow-up, #540 multi-bot extension) by replaying the last N days
// of channel history *and* thread replies via FetchSlackUserMessagesDay.
// Idempotent per (bot, day) via a Redis marker key, so each bot's walk
// runs independently while fingerprint dedup at the store level collapses
// messages both bots saw.
//
// Usage:
//
//	backfill-user-engagement \
//	    --bot=ross \
//	    --redis-url=$MAKEACOMPANY_REDIS_URL \
//	    --slack-token=$SLACK_BOT_TOKEN \
//	    --days=2
//
// Run once per bot (ross + joanne) to capture DMs visible only to that
// bot's user. The (channel_id, message_ts) fingerprint store ensures
// channels both bots are in count once, not twice.
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

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func main() {
	var (
		bot        = flag.String("bot", os.Getenv("BACKFILL_BOT"), "Observing bot, ross or joanne (also reads BACKFILL_BOT)")
		redisURL   = flag.String("redis-url", os.Getenv("MAKEACOMPANY_REDIS_URL"), "Redis URL (also reads MAKEACOMPANY_REDIS_URL)")
		slackToken = flag.String("slack-token", firstNonEmpty(os.Getenv("SLACK_BOT_TOKEN"), os.Getenv("ORCHESTRATOR_SLACK_BOT_TOKEN")), "Slack bot token for the bot named in --bot (also reads SLACK_BOT_TOKEN or ORCHESTRATOR_SLACK_BOT_TOKEN)")
		days       = flag.Int("days", 2, "How many days back to backfill, ending yesterday UTC (1..90)")
	)
	flag.Parse()

	*bot = strings.ToLower(strings.TrimSpace(*bot))
	if *bot != "ross" && *bot != "joanne" {
		log.Fatalf("--bot must be ross or joanne, got %q", *bot)
	}
	if strings.TrimSpace(*redisURL) == "" {
		log.Fatal("missing --redis-url / MAKEACOMPANY_REDIS_URL")
	}
	if strings.TrimSpace(*slackToken) == "" {
		log.Fatal("missing --slack-token / SLACK_BOT_TOKEN")
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
	fmt.Printf("backfilling deduped messages for bot=%s from %s through %s (%d days)\n", *bot, start.Format("2006-01-02"), end.Format("2006-01-02"), *days)

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
		applied, err := store.BackfillUserMessagesDay(ctx, *bot, day, events)
		if err != nil {
			log.Printf("apply %s: %v (skipped)", day, err)
			continue
		}
		if applied {
			totalApplied++
			totalEvents += len(events)
			fmt.Printf("  %s: %d fingerprints applied\n", day, len(events))
		} else {
			totalSkipped++
			fmt.Printf("  %s: already backfilled for bot=%s, skipped\n", day, *bot)
		}
	}
	fmt.Printf("done: bot=%s, %d days applied, %d skipped, %d fingerprints written\n", *bot, totalApplied, totalSkipped, totalEvents)
}
