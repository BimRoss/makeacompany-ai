// strip-yt-intel-fence is a one-shot maintenance utility that scans every
// personal-agent Redis record and strips any legacy <!-- yt-intel-start -->
// fenced block from the stored SystemPrompt field. Bullets continue to live
// in the structured YouTubeSources field; this just makes the storage shape
// canonical so subsequent reads don't ship the fence anywhere (#609).
//
// Idempotent: a second run does nothing once all records are clean.
//
// Usage (in-cluster):
//
//	kubectl run strip-yt-intel-fence --rm -it --restart=Never \
//	  --image=geeemoney/makeacompany-ai-backend:vX.Y.Z \
//	  --env=REDIS_ADDR=$REDIS_ADDR --env=REDIS_PASSWORD=$REDIS_PASSWORD \
//	  --command -- /strip-yt-intel-fence
package main

import (
	"context"
	"log"
	"os"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	personalAgentKeyPrefix = "makeacompany:personal_agent:"
	youtubeIntelFenceStart = "<!-- yt-intel-start -->"
	youtubeIntelFenceEnd   = "<!-- yt-intel-end -->"
)

// stripYouTubeIntelFence mirrors the package helper in
// backend/internal/app/personal_agent_youtube_handlers.go. Duplicated here so
// the one-shot binary doesn't pull the full app package (heavy K8s deps).
func stripYouTubeIntelFence(prompt string) string {
	start := strings.Index(prompt, youtubeIntelFenceStart)
	end := strings.Index(prompt, youtubeIntelFenceEnd)
	if start < 0 || end < 0 || end < start {
		return prompt
	}
	before := strings.TrimRight(prompt[:start], " \t\r\n")
	after := strings.TrimLeft(prompt[end+len(youtubeIntelFenceEnd):], " \t\r\n")
	if before == "" {
		return after
	}
	if after == "" {
		return before
	}
	return before + "\n\n" + after
}

func main() {
	addr := strings.TrimSpace(os.Getenv("REDIS_ADDR"))
	if addr == "" {
		log.Fatal("REDIS_ADDR required")
	}
	rdb := redis.NewClient(&redis.Options{
		Addr:     addr,
		Password: os.Getenv("REDIS_PASSWORD"),
	})
	defer func() { _ = rdb.Close() }()

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	pattern := personalAgentKeyPrefix + "*"
	var cursor uint64
	var scanned, cleaned int
	now := time.Now().UTC().Format(time.RFC3339)
	for {
		keys, next, err := rdb.Scan(ctx, cursor, pattern, 200).Result()
		if err != nil {
			log.Fatalf("scan: %v", err)
		}
		for _, key := range keys {
			scanned++
			prompt, err := rdb.HGet(ctx, key, "system_prompt").Result()
			if err == redis.Nil || strings.TrimSpace(prompt) == "" {
				continue
			}
			if err != nil {
				log.Printf("hget %s: %v", key, err)
				continue
			}
			cleaned_ := stripYouTubeIntelFence(prompt)
			if cleaned_ == prompt {
				continue
			}
			if err := rdb.HSet(ctx, key, map[string]any{
				"system_prompt": cleaned_,
				"updated_at":    now,
			}).Err(); err != nil {
				log.Printf("hset %s: %v", key, err)
				continue
			}
			cleaned++
			log.Printf("cleaned %s (%d → %d chars)", key, len(prompt), len(cleaned_))
		}
		if next == 0 {
			break
		}
		cursor = next
	}
	log.Printf("done — scanned=%d cleaned=%d", scanned, cleaned)
}
