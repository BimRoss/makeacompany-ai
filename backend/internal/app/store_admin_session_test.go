package app

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func TestCreateAdminSession_SetsTTL(t *testing.T) {
	srv, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()

	rdb := redis.NewClient(&redis.Options{Addr: srv.Addr()})
	defer rdb.Close()

	store := &Store{rdb: rdb}
	ctx := context.Background()
	token := "tok_create_ttl"
	expiresAt := time.Now().UTC().Add(2 * time.Hour)
	if err := store.CreateAdminSession(ctx, token, "a@example.com", expiresAt); err != nil {
		t.Fatal(err)
	}

	key := adminSessionKey(token)
	ttl, err := rdb.TTL(ctx, key).Result()
	if err != nil {
		t.Fatal(err)
	}
	if ttl <= 0 || ttl == time.Duration(-1) || ttl == time.Duration(-2) {
		t.Fatalf("expected positive TTL, got %v", ttl)
	}

	sess, err := store.GetAdminSession(ctx, token)
	if err != nil {
		t.Fatal(err)
	}
	if sess.Email != "a@example.com" || sess.Token != token {
		t.Fatalf("session: %+v", sess)
	}
}

func TestGetAdminSession_RepairsMissingTTL(t *testing.T) {
	srv, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()

	rdb := redis.NewClient(&redis.Options{Addr: srv.Addr()})
	defer rdb.Close()

	ctx := context.Background()
	token := "tok_repair"
	key := adminSessionKey(token)
	expiresAt := time.Now().UTC().Add(1 * time.Hour)
	_ = rdb.HSet(ctx, key, map[string]any{
		"email":     "b@example.com",
		"createdAt": time.Now().UTC().Format(time.RFC3339),
		"expiresAt": expiresAt.Format(time.RFC3339),
	}).Err()
	// Deliberately no EXPIRE — legacy shape.
	ttlBefore, _ := rdb.TTL(ctx, key).Result()
	if ttlBefore != time.Duration(-1) {
		t.Fatalf("expected no TTL before repair, got %v", ttlBefore)
	}

	store := &Store{rdb: rdb}
	sess, err := store.GetAdminSession(ctx, token)
	if err != nil {
		t.Fatal(err)
	}
	if sess.Email != "b@example.com" {
		t.Fatalf("session: %+v", sess)
	}
	ttlAfter, err := rdb.TTL(ctx, key).Result()
	if err != nil {
		t.Fatal(err)
	}
	if ttlAfter <= 0 || ttlAfter == time.Duration(-1) {
		t.Fatalf("expected positive TTL after repair, got %v", ttlAfter)
	}
}

func TestGetAdminSession_RepairDeletesExpiredNoTTL(t *testing.T) {
	srv, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()

	rdb := redis.NewClient(&redis.Options{Addr: srv.Addr()})
	defer rdb.Close()

	ctx := context.Background()
	token := "tok_expired"
	key := adminSessionKey(token)
	past := time.Now().UTC().Add(-1 * time.Hour)
	_ = rdb.HSet(ctx, key, map[string]any{
		"email":     "c@example.com",
		"createdAt": past.Format(time.RFC3339),
		"expiresAt": past.Format(time.RFC3339),
	}).Err()

	store := &Store{rdb: rdb}
	_, err = store.GetAdminSession(ctx, token)
	if err != redis.Nil {
		t.Fatalf("expected redis.Nil, got %v", err)
	}
	n, err := rdb.Exists(ctx, key).Result()
	if err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatal("expected key deleted")
	}
}
