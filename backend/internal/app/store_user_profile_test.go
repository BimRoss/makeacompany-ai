package app

import (
	"context"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func TestUserProfile_LinkedAndList(t *testing.T) {
	srv, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()
	rdb := redis.NewClient(&redis.Options{Addr: srv.Addr()})
	defer rdb.Close()
	ctx := context.Background()
	st := &Store{rdb: rdb}

	if err := st.UpsertUserProfileAfterWaitlist(ctx, "A@Example.com", "cus_1", "cs_x", "paid"); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertUserProfileSlackID(ctx, "a@example.com", "U123"); err != nil {
		t.Fatal(err)
	}
	rows, err := st.ListUserProfiles(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 {
		t.Fatalf("rows: %d", len(rows))
	}
	if !rows[0].Linked {
		t.Fatal("expected linked")
	}
	if rows[0].Email != "a@example.com" {
		t.Fatalf("email: %q", rows[0].Email)
	}
	em, tier, err := st.UserProfileTierBySlackUser(ctx, "U123")
	if err != nil {
		t.Fatal(err)
	}
	if em != "a@example.com" || tier != "" {
		t.Fatalf("lookup email=%q tier=%q", em, tier)
	}
}
