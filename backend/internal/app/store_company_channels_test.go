package app

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

// TestPatchCompanyChannel_PassiveBanterInterval_PublishesInvalidation verifies admin timing changes
// persist to the shared HASH, normalize to allowed seconds (10/30/60/300/600), and publish the
// same invalidation message bots use so passive banter picks up the new interval without waiting
// for the 45s poll (bots still read config on their 10s tickPassiveBanter loop).
func TestPatchCompanyChannel_PassiveBanterInterval_PublishesInvalidation(t *testing.T) {
	srv, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()

	rdb := redis.NewClient(&redis.Options{Addr: srv.Addr()})
	defer rdb.Close()

	ctx := context.Background()
	hashKey := ""
	channelID := "C0TESTCH"
	seed := `{"company_slug":"acme","channel_id":"C0TESTCH","threads_enabled":true,"general_auto_reaction_enabled":false,"out_of_office_enabled":false,"passive_banter_enabled":true,"passive_banter_interval_seconds":60,"owner_ids":["U1"]}`
	if err := rdb.HSet(ctx, companyChannelsHashKey(hashKey), channelID, seed).Err(); err != nil {
		t.Fatal(err)
	}

	store := &Store{rdb: rdb}

	pubsub := rdb.Subscribe(ctx, companyChannelsInvalidatePubSubChannel)
	defer func() { _ = pubsub.Close() }()
	msgCh := pubsub.Channel()

	ten := 10
	got, err := store.PatchCompanyChannel(ctx, hashKey, channelID, CompanyChannelPatch{
		PassiveBanterIntervalSeconds: &ten,
	})
	if err != nil {
		t.Fatal(err)
	}
	if got.PassiveBanterIntervalSeconds != 10 {
		t.Fatalf("returned interval: got %d want 10", got.PassiveBanterIntervalSeconds)
	}

	raw, err := rdb.HGet(ctx, companyChannelsHashKey(hashKey), channelID).Result()
	if err != nil {
		t.Fatal(err)
	}
	var decoded CompanyChannel
	if err := json.Unmarshal([]byte(raw), &decoded); err != nil {
		t.Fatal(err)
	}
	decoded = normalizeCompanyChannel(decoded, channelID)
	if decoded.PassiveBanterIntervalSeconds != 10 {
		t.Fatalf("stored interval: got %d want 10", decoded.PassiveBanterIntervalSeconds)
	}

	select {
	case msg := <-msgCh:
		if msg.Payload != channelID {
			t.Fatalf("pubsub payload: got %q want %q", msg.Payload, channelID)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timeout waiting for invalidation publish")
	}
}
