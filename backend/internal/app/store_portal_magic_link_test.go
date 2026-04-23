package app

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func TestPortalMagicLinkRoundTrip(t *testing.T) {
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
	if err := st.SetPortalMagicLink(ctx, tok, "C0CHANNEL", "Owner@Example.com", 10*time.Minute); err != nil {
		t.Fatal(err)
	}
	ch, em, err := st.ConsumePortalMagicLink(ctx, tok)
	if err != nil {
		t.Fatal(err)
	}
	if ch != "C0CHANNEL" || em != "owner@example.com" {
		t.Fatalf("got %q %q", ch, em)
	}
	_, _, err = st.ConsumePortalMagicLink(ctx, tok)
	if err != redis.Nil {
		t.Fatalf("expected redis.Nil second consume, got %v", err)
	}
}
