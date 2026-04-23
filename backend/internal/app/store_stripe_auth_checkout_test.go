package app

import (
	"context"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func TestStripeAuthCheckoutWebhookMarker(t *testing.T) {
	srv, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()
	rdb := redis.NewClient(&redis.Options{Addr: srv.Addr()})
	defer rdb.Close()
	ctx := context.Background()
	st := &Store{rdb: rdb}

	sid := "cs_test_abc123"
	seen, err := st.StripeAuthCheckoutWebhookSeen(ctx, sid)
	if err != nil {
		t.Fatal(err)
	}
	if seen {
		t.Fatal("expected not seen")
	}
	if err := st.SetStripeAuthCheckoutWebhookSeen(ctx, sid); err != nil {
		t.Fatal(err)
	}
	seen, err = st.StripeAuthCheckoutWebhookSeen(ctx, sid)
	if err != nil {
		t.Fatal(err)
	}
	if !seen {
		t.Fatal("expected seen")
	}
	if err := st.ClearStripeAuthCheckoutWebhookSeen(ctx, sid); err != nil {
		t.Fatal(err)
	}
	seen, err = st.StripeAuthCheckoutWebhookSeen(ctx, sid)
	if err != nil {
		t.Fatal(err)
	}
	if seen {
		t.Fatal("expected cleared")
	}
}
