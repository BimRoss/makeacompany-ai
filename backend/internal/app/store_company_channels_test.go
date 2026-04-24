package app

import (
	"context"
	"encoding/json"
	"fmt"
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

func TestUpsertDiscoveredCompanyChannels_MergesDefaults(t *testing.T) {
	srv, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()

	rdb := redis.NewClient(&redis.Options{Addr: srv.Addr()})
	defer rdb.Close()

	ctx := context.Background()
	hashKey := ""
	existingID := "C0EXIST1"
	seed := `{"company_slug":"acme","channel_id":"C0EXIST1","threads_enabled":true,"general_auto_reaction_enabled":false,"out_of_office_enabled":false}`
	if err := rdb.HSet(ctx, companyChannelsHashKey(hashKey), existingID, seed).Err(); err != nil {
		t.Fatal(err)
	}

	store := &Store{rdb: rdb}
	touched, err := store.UpsertDiscoveredCompanyChannels(ctx, hashKey, []DiscoveredChannelInput{
		{ChannelID: existingID, Name: "ignored", OwnerIDs: []string{"U1", "U2"}},
		{ChannelID: "C0NEW12345", Name: "#newco", OwnerIDs: []string{"U9"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(touched) != 2 {
		t.Fatalf("touched: got %#v", touched)
	}

	rawNew, err := rdb.HGet(ctx, companyChannelsHashKey(hashKey), "C0NEW12345").Result()
	if err != nil {
		t.Fatal(err)
	}
	var decodedNew CompanyChannel
	if err := json.Unmarshal([]byte(rawNew), &decodedNew); err != nil {
		t.Fatal(err)
	}
	decodedNew = normalizeCompanyChannel(decodedNew, "C0NEW12345")
	if decodedNew.ChannelID != "C0NEW12345" {
		t.Fatal("channel_id")
	}
	if decodedNew.CompanySlug != "newco" {
		t.Fatalf("company_slug: got %q", decodedNew.CompanySlug)
	}
	if !decodedNew.GeneralAutoReactionEnabled {
		t.Fatal("expected general_auto_reaction_enabled true for new row")
	}
	if len(decodedNew.OwnerIDs) != 1 || decodedNew.OwnerIDs[0] != "U9" {
		t.Fatalf("owner_ids new: got %#v", decodedNew.OwnerIDs)
	}

	rawExist, err := rdb.HGet(ctx, companyChannelsHashKey(hashKey), existingID).Result()
	if err != nil {
		t.Fatal(err)
	}
	var decodedExist CompanyChannel
	if err := json.Unmarshal([]byte(rawExist), &decodedExist); err != nil {
		t.Fatal(err)
	}
	decodedExist = normalizeCompanyChannel(decodedExist, existingID)
	if decodedExist.GeneralAutoReactionEnabled {
		t.Fatal("expected upsert to preserve general_auto_reaction_enabled for existing row")
	}
	if len(decodedExist.OwnerIDs) != 2 {
		t.Fatalf("owner_ids existing: got %#v", decodedExist.OwnerIDs)
	}
}

func TestPruneCompanyChannelsRegistry_RemovesStaleAndAuxKeys(t *testing.T) {
	srv, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()

	rdb := redis.NewClient(&redis.Options{Addr: srv.Addr()})
	defer rdb.Close()

	ctx := context.Background()
	hashKey := ""
	k := companyChannelsHashKey(hashKey)
	keep := "C0KEEP01"
	stale := "C0STALE1"
	seedKeep := `{"company_slug":"keepco","channel_id":"C0KEEP01","threads_enabled":true,"general_auto_reaction_enabled":false,"out_of_office_enabled":false}`
	seedStale := `{"company_slug":"gone","channel_id":"C0STALE1","threads_enabled":true,"general_auto_reaction_enabled":false,"out_of_office_enabled":false}`
	if err := rdb.HSet(ctx, k, keep, seedKeep, stale, seedStale).Err(); err != nil {
		t.Fatal(err)
	}
	digestKey := channelKnowledgeMarkdownRedisKey(stale)
	if err := rdb.Set(ctx, digestKey, "old digest", 0).Err(); err != nil {
		t.Fatal(err)
	}
	toKey := fmt.Sprintf("employee-factory:thread_owner:%s:123.456", stale)
	if err := rdb.Set(ctx, toKey, "emp:alice", 0).Err(); err != nil {
		t.Fatal(err)
	}

	store := &Store{rdb: rdb}
	removed, err := store.PruneCompanyChannelsRegistry(ctx, hashKey, []string{keep})
	if err != nil {
		t.Fatal(err)
	}
	if len(removed) != 1 || removed[0] != stale {
		t.Fatalf("removed: %#v", removed)
	}
	n, err := rdb.HLen(ctx, k).Result()
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("hash len: got %d want 1", n)
	}
	if _, err := rdb.HGet(ctx, k, stale).Result(); err != redis.Nil {
		t.Fatalf("expected stale field gone: %v", err)
	}
	if _, err := rdb.Get(ctx, digestKey).Result(); err != redis.Nil {
		t.Fatal("expected channel knowledge key deleted")
	}
	if _, err := rdb.Get(ctx, toKey).Result(); err != redis.Nil {
		t.Fatal("expected thread_owner key deleted")
	}
}
