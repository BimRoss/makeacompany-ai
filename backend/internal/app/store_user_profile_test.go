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

	if err := st.UpsertUserProfileAfterWaitlist(ctx, "A@Example.com", "cus_1", "cs_x", "paid", "prod_waitlist"); err != nil {
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
	if rows[0].StripeProductID != "prod_waitlist" {
		t.Fatalf("stripeProductId: %q", rows[0].StripeProductID)
	}
	em, tier, err := st.UserProfileTierBySlackUser(ctx, "U123")
	if err != nil {
		t.Fatal(err)
	}
	if em != "a@example.com" || tier != "" {
		t.Fatalf("lookup email=%q tier=%q", em, tier)
	}
}

func TestSyncSlackUserIndexFromWorkspaceUsers(t *testing.T) {
	srv, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()
	rdb := redis.NewClient(&redis.Options{Addr: srv.Addr()})
	defer rdb.Close()
	ctx := context.Background()
	st := &Store{rdb: rdb}

	users := []SlackWorkspaceUser{
		{SlackUserID: "UBOT", TeamID: "T1", Username: "bot", Email: "bot@x.com", IsBot: true},
		{SlackUserID: "UDEL", TeamID: "T1", Username: "gone", Email: "gone@x.com", IsDeleted: true},
		{SlackUserID: "UNOEM", TeamID: "T1", Username: "noem", Email: ""},
		{SlackUserID: "UHUMAN", TeamID: "T1", Username: "pat", Email: "Pat@Example.com", IsBot: false},
	}
	n, err := st.SyncSlackUserIndexFromWorkspaceUsers(ctx, users)
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("synced: %d", n)
	}
	em, _, err := st.UserProfileTierBySlackUser(ctx, "UHUMAN")
	if err != nil {
		t.Fatal(err)
	}
	if em != "pat@example.com" {
		t.Fatalf("email: %q", em)
	}
}

func TestUpsertUserProfilesFromStripeWaitlistPurchasers(t *testing.T) {
	srv, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()
	rdb := redis.NewClient(&redis.Options{Addr: srv.Addr()})
	defer rdb.Close()
	ctx := context.Background()
	st := &Store{rdb: rdb}

	purchasers := []StripeWaitlistPurchaser{
		{Email: "  Buyer@Example.com ", StripeCustomer: "cus_x", StripeSessionID: "cs_y", PaymentStatus: "paid", StripeProductID: "prod_abc"},
		{Email: "", PaymentStatus: "paid"},
	}
	n, err := st.UpsertUserProfilesFromStripeWaitlistPurchasers(ctx, purchasers)
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("upserts: %d", n)
	}
	rows, err := st.ListUserProfiles(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].Email != "buyer@example.com" {
		t.Fatalf("rows: %+v", rows)
	}
	if rows[0].StripeProductID != "prod_abc" {
		t.Fatalf("stripeProductId: %q", rows[0].StripeProductID)
	}
}

func TestUpsertUserProfileStripeSubscription_setsStripeProductID(t *testing.T) {
	srv, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()
	rdb := redis.NewClient(&redis.Options{Addr: srv.Addr()})
	defer rdb.Close()
	ctx := context.Background()
	st := &Store{rdb: rdb}

	if err := st.UpsertUserProfileAfterWaitlist(ctx, "tier@example.com", "cus_1", "cs_1", "paid", "prod_waitlist"); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertUserProfileStripeSubscription(ctx, "tier@example.com", "cus_1", "sub_99", "active", "subscriber", "price_monthly", "prod_monthly"); err != nil {
		t.Fatal(err)
	}
	pid, err := rdb.HGet(ctx, userProfileRedisKey("tier@example.com"), "stripe_product_id").Result()
	if err != nil {
		t.Fatal(err)
	}
	if pid != "prod_monthly" {
		t.Fatalf("stripe_product_id after subscription upsert: %q", pid)
	}
}
