package app

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func TestUserMagicLinkRoundTrip(t *testing.T) {
	srv, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()
	rdb := redis.NewClient(&redis.Options{Addr: srv.Addr()})
	defer rdb.Close()
	ctx := context.Background()
	st := &Store{rdb: rdb}

	tok := "deadbeefdeadbeefdeadbeefdeadbeef"
	if err := st.SetUserMagicLink(ctx, tok, "User@Example.com", 10*time.Minute); err != nil {
		t.Fatal(err)
	}
	em, err := st.ConsumeUserMagicLink(ctx, tok)
	if err != nil {
		t.Fatal(err)
	}
	if em != "user@example.com" {
		t.Fatalf("got %q", em)
	}
	_, err = st.ConsumeUserMagicLink(ctx, tok)
	if err != redis.Nil {
		t.Fatalf("expected redis.Nil second consume, got %v", err)
	}
}

func TestUserMagicLinkRequiresEmail(t *testing.T) {
	srv, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()
	rdb := redis.NewClient(&redis.Options{Addr: srv.Addr()})
	defer rdb.Close()
	ctx := context.Background()
	st := &Store{rdb: rdb}

	if err := st.SetUserMagicLink(ctx, "tok", "", 10*time.Minute); err == nil {
		t.Fatal("expected error for empty email")
	}
}
