package app

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

// TestPatchCompanyChannel_GeneralAutoReaction_PublishesInvalidation verifies toggling reactions
// persists to the shared HASH and publishes the same invalidation message employee-factory bots use.
func TestPatchCompanyChannel_GeneralAutoReaction_PublishesInvalidation(t *testing.T) {
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
	seed := `{"company_slug":"acme","channel_id":"C0TESTCH","threads_enabled":true,"general_auto_reaction_enabled":false,"out_of_office_enabled":false,"owner_ids":["U1"]}`
	if err := rdb.HSet(ctx, companyChannelsHashKey(hashKey), channelID, seed).Err(); err != nil {
		t.Fatal(err)
	}

	store := &Store{rdb: rdb}

	pubsub := rdb.Subscribe(ctx, companyChannelsInvalidatePubSubChannel)
	defer func() { _ = pubsub.Close() }()
	msgCh := pubsub.Channel()

	on := true
	got, err := store.PatchCompanyChannel(ctx, hashKey, channelID, CompanyChannelPatch{
		GeneralAutoReactionEnabled: &on,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !got.GeneralAutoReactionEnabled {
		t.Fatal("expected general_auto_reaction_enabled true")
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
	if !decoded.GeneralAutoReactionEnabled {
		t.Fatal("stored: expected general_auto_reaction_enabled true")
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
