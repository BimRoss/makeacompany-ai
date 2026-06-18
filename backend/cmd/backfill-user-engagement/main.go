// backfill-user-engagement seeds the per-user engagement counters surfaced
// on /admin (issue #498) by replaying the last N days of channel history
// via FetchSlackActivityDay. Idempotent per (bot, day) via a Redis marker;
// re-running is safe.
//
// Usage:
//
//	backfill-user-engagement \
//	    --redis-url=$REDIS_URL \
//	    --slack-token=$ORCHESTRATOR_SLACK_BOT_TOKEN \
//	    --bot=ross \
//	    --days=30
//
// Run inside the cluster (the backend pod has redis + slack token in env)
// or locally with `make backfill-user-engagement`. Slack rate limits are
// the only meaningful pressure: tier-3 history is paced by FetchSlackActivityDay's
// internal sleep, so a 30-day backfill across our current channel count is
// a few minutes of work, well under the per-method ceilings.
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
		botName    = flag.String("bot", "ross", "Bot label to attribute backfilled counts to (ross|joanne)")
		days       = flag.Int("days", 30, "How many days back to backfill, ending yesterday UTC")
	)
	flag.Parse()

	if strings.TrimSpace(*redisURL) == "" {
		log.Fatal("missing --redis-url / MAKEACOMPANY_REDIS_URL")
	}
	if strings.TrimSpace(*slackToken) == "" {
		log.Fatal("missing --slack-token / ORCHESTRATOR_SLACK_BOT_TOKEN")
	}
	if *botName != "ross" && *botName != "joanne" {
		log.Fatalf("bad --bot %q (want ross or joanne)", *botName)
	}
	if *days <= 0 || *days > 90 {
		log.Fatalf("--days must be 1..90, got %d", *days)
	}

	store, err := app.NewStore(*redisURL)
	if err != nil {
		log.Fatalf("redis: %v", err)
	}
	defer store.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()

	end := time.Now().UTC().AddDate(0, 0, -1)
	start := end.AddDate(0, 0, -(*days - 1))
	fmt.Printf("backfilling %s from %s through %s (%d days)\n", *botName, start.Format("2006-01-02"), end.Format("2006-01-02"), *days)

	totalApplied := 0
	totalSkipped := 0
	totalMessages := 0
	for d := start; !d.After(end); d = d.AddDate(0, 0, 1) {
		day := d.Format("2006-01-02")
		activity, err := app.FetchSlackActivityDay(ctx, *slackToken, day)
		if err != nil {
			log.Printf("fetch %s: %v (skipped)", day, err)
			continue
		}
		applied, err := store.BackfillUserEngagementDay(ctx, *botName, day, activity.ByUser)
		if err != nil {
			log.Printf("apply %s: %v (skipped)", day, err)
			continue
		}
		dayMsgs := 0
		for _, n := range activity.ByUser {
			dayMsgs += n
		}
		if applied {
			totalApplied++
			totalMessages += dayMsgs
			fmt.Printf("  %s: %d users, %d messages — applied\n", day, len(activity.ByUser), dayMsgs)
		} else {
			totalSkipped++
			fmt.Printf("  %s: already backfilled — skipped\n", day)
		}
	}
	fmt.Printf("done: %d days applied, %d skipped, %d messages attributed to %s\n", totalApplied, totalSkipped, totalMessages, *botName)
}
