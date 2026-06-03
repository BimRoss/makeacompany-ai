package app

import (
	"context"
	"testing"
	"time"

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

	if err := st.UpsertUserProfileAfterWaitlist(ctx, "A@Example.com", "cus_1", "cs_x", "paid", "prod_waitlist", ""); err != nil {
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

func TestUpsertUserProfilesFromStripeWaitlistPurchasers_basePlanWinsSameEmail(t *testing.T) {
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
		{
			Email: "same@example.com", StripeCustomer: "cus_w", StripeSessionID: "cs_w",
			PaymentStatus: "paid", StripeProductID: "prod_waitlist", CheckoutCreated: "2026-01-01T00:00:00Z",
			PriceRole: StripeCheckoutPriceRoleWaitlistDeposit,
		},
		{
			Email: "same@example.com", StripeCustomer: "cus_m", StripeSessionID: "cs_m",
			PaymentStatus: "paid", StripeProductID: "prod_monthly", CheckoutCreated: "2026-02-01T00:00:00Z",
			PriceRole: StripeCheckoutPriceRoleBasePlan,
		},
	}
	n, err := st.UpsertUserProfilesFromStripeWaitlistPurchasers(ctx, purchasers)
	if err != nil {
		t.Fatal(err)
	}
	if n != 2 {
		t.Fatalf("upserts: %d", n)
	}
	rows, err := st.ListUserProfiles(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].StripeProductID != "prod_monthly" {
		t.Fatalf("rows: %+v", rows)
	}
}

func TestUpsertUserProfileAfterWaitlist_setsAttributedTo(t *testing.T) {
	srv, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()
	rdb := redis.NewClient(&redis.Options{Addr: srv.Addr()})
	defer rdb.Close()
	ctx := context.Background()
	st := &Store{rdb: rdb}

	if err := st.UpsertUserProfileAfterWaitlist(ctx, "ref@example.com", "cus_1", "cs_1", "paid", "prod_waitlist", "john"); err != nil {
		t.Fatal(err)
	}
	v, err := rdb.HGet(ctx, userProfileRedisKey("ref@example.com"), "attributed_to").Result()
	if err != nil {
		t.Fatal(err)
	}
	if v != "john" {
		t.Fatalf("attributed_to: %q, want %q", v, "john")
	}

	// Empty attributedTo must not overwrite an existing value.
	if err := st.UpsertUserProfileAfterWaitlist(ctx, "ref@example.com", "cus_1", "cs_1", "paid", "prod_waitlist", ""); err != nil {
		t.Fatal(err)
	}
	v, err = rdb.HGet(ctx, userProfileRedisKey("ref@example.com"), "attributed_to").Result()
	if err != nil {
		t.Fatal(err)
	}
	if v != "john" {
		t.Fatalf("attributed_to after empty upsert: %q, want %q", v, "john")
	}
}

func TestUpsertUserProfileFreeTrialInvite(t *testing.T) {
	srv, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()
	rdb := redis.NewClient(&redis.Options{Addr: srv.Addr()})
	defer rdb.Close()
	ctx := context.Background()
	st := &Store{rdb: rdb}

	if err := st.UpsertUserProfileFreeTrialInvite(ctx, "Free@Example.com", "john", 0); err != nil {
		t.Fatal(err)
	}
	key := userProfileRedisKey("free@example.com")
	if v, _ := rdb.HGet(ctx, key, "attributed_to").Result(); v != "john" {
		t.Fatalf("attributed_to: %q, want %q", v, "john")
	}
	if v, _ := rdb.HGet(ctx, key, "free_trial_invite_sent_at").Result(); v == "" {
		t.Fatal("free_trial_invite_sent_at not set")
	}

	// Must not clobber prior paid Stripe fields when re-submitted from the same browser.
	if err := st.UpsertUserProfileAfterWaitlist(ctx, "paid@example.com", "cus_1", "cs_1", "paid", "prod_waitlist", "grant"); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertUserProfileFreeTrialInvite(ctx, "paid@example.com", "", 0); err != nil {
		t.Fatal(err)
	}
	paidKey := userProfileRedisKey("paid@example.com")
	if v, _ := rdb.HGet(ctx, paidKey, "stripe_customer_id").Result(); v != "cus_1" {
		t.Fatalf("stripe_customer_id clobbered: %q", v)
	}
	if v, _ := rdb.HGet(ctx, paidKey, "attributed_to").Result(); v != "grant" {
		t.Fatalf("attributed_to clobbered: %q", v)
	}
}

func TestUpsertUserProfileFreeTrialInvite_postCliffMarksTrialing(t *testing.T) {
	srv, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()
	rdb := redis.NewClient(&redis.Options{Addr: srv.Addr()})
	defer rdb.Close()
	ctx := context.Background()
	st := &Store{rdb: rdb}

	expiry := int64(2000000000)
	if err := st.UpsertUserProfileFreeTrialInvite(ctx, "new@example.com", "", expiry); err != nil {
		t.Fatal(err)
	}
	key := userProfileRedisKey("new@example.com")
	if v, _ := rdb.HGet(ctx, key, "stripe_subscription_status").Result(); v != "trialing" {
		t.Fatalf("status: %q, want trialing", v)
	}
	if v, _ := rdb.HGet(ctx, key, "trial_expires_at").Result(); v != "2000000000" {
		t.Fatalf("trial_expires_at: %q, want 2000000000", v)
	}
}

func TestMarkProfileFreeLifetime(t *testing.T) {
	srv, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()
	rdb := redis.NewClient(&redis.Options{Addr: srv.Addr()})
	defer rdb.Close()
	ctx := context.Background()
	st := &Store{rdb: rdb}

	if err := st.MarkProfileFreeLifetime(ctx, "Cliff@Example.com"); err != nil {
		t.Fatal(err)
	}
	row, err := st.UserProfileRowByEmail(ctx, "cliff@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if !row.FreeLifetime {
		t.Fatal("expected FreeLifetime=true")
	}
}

func TestEffectiveStatus(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	cases := []struct {
		name string
		row  UserProfileRow
		want LifecycleStatus
	}{
		{"stripe active beats everything", UserProfileRow{StripeSubscriptionStatus: "active", FreeLifetime: true, TrialExpiresAt: 1}, LifecycleActive},
		{"free lifetime when no stripe", UserProfileRow{FreeLifetime: true}, LifecycleFreeLifetime},
		{"trialing within window", UserProfileRow{TrialExpiresAt: now.Unix() + 3600}, LifecycleTrialing},
		{"expired past window", UserProfileRow{TrialExpiresAt: now.Unix() - 1}, LifecycleExpired},
		{"stripe trialing without local expiry", UserProfileRow{StripeSubscriptionStatus: "trialing"}, LifecycleTrialing},
		{"unknown defaults to free_lifetime (conservative)", UserProfileRow{}, LifecycleFreeLifetime},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := EffectiveStatus(tc.row, now); got != tc.want {
				t.Fatalf("EffectiveStatus = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestUpsertUserProfileStripeSubscription_clearsTrialOnActive(t *testing.T) {
	srv, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()
	rdb := redis.NewClient(&redis.Options{Addr: srv.Addr()})
	defer rdb.Close()
	ctx := context.Background()
	st := &Store{rdb: rdb}

	expiry := int64(2000000000)
	if err := st.UpsertUserProfileFreeTrialInvite(ctx, "convert@example.com", "", expiry); err != nil {
		t.Fatal(err)
	}
	key := userProfileRedisKey("convert@example.com")
	if v, _ := rdb.HGet(ctx, key, "trial_expires_at").Result(); v != "2000000000" {
		t.Fatalf("precondition: trial_expires_at: %q", v)
	}

	// User pays mid-trial: subscription.updated arrives with status=active.
	if err := st.UpsertUserProfileStripeSubscription(ctx, "convert@example.com", "cus_1", "sub_99", "active", "subscriber", "price_monthly", "prod_monthly", false, 1735689600); err != nil {
		t.Fatal(err)
	}
	if v, err := rdb.HGet(ctx, key, "trial_expires_at").Result(); err != redis.Nil {
		t.Fatalf("trial_expires_at not cleared: %q (err=%v)", v, err)
	}

	row, err := st.UserProfileRowByEmail(ctx, "convert@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if got := EffectiveStatus(row, time.Unix(1_900_000_000, 0)); got != LifecycleActive {
		t.Fatalf("EffectiveStatus = %q, want active", got)
	}
}

func TestUpsertUserProfileStripeSubscription_preservesTrialOnNonActive(t *testing.T) {
	srv, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()
	rdb := redis.NewClient(&redis.Options{Addr: srv.Addr()})
	defer rdb.Close()
	ctx := context.Background()
	st := &Store{rdb: rdb}

	expiry := int64(2000000000)
	if err := st.UpsertUserProfileFreeTrialInvite(ctx, "lapsed@example.com", "", expiry); err != nil {
		t.Fatal(err)
	}
	// Failed-payment / past_due shouldn't drop trial state — the user can still pay before the
	// deadline; only an explicit `active` arrival means the trial deadline is moot.
	if err := st.UpsertUserProfileStripeSubscription(ctx, "lapsed@example.com", "cus_2", "sub_2", "past_due", "none", "price_monthly", "prod_monthly", false, 0); err != nil {
		t.Fatal(err)
	}
	key := userProfileRedisKey("lapsed@example.com")
	if v, _ := rdb.HGet(ctx, key, "trial_expires_at").Result(); v != "2000000000" {
		t.Fatalf("trial_expires_at clobbered on past_due: %q", v)
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

	if err := st.UpsertUserProfileAfterWaitlist(ctx, "tier@example.com", "cus_1", "cs_1", "paid", "prod_waitlist", ""); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertUserProfileStripeSubscription(ctx, "tier@example.com", "cus_1", "sub_99", "active", "subscriber", "price_monthly", "prod_monthly", false, 1735689600); err != nil {
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

func TestEnrichSlackWorkspaceUsersWithProfileTerms_Status(t *testing.T) {
	srv, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()
	rdb := redis.NewClient(&redis.Options{Addr: srv.Addr()})
	defer rdb.Close()
	ctx := context.Background()
	st := &Store{rdb: rdb}

	future := time.Now().Add(72 * time.Hour).Unix()
	past := time.Now().Add(-1 * time.Hour).Unix()

	// trialing user
	if err := st.UpsertUserProfileSlackID(ctx, "trial@example.com", "UTRIAL"); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertUserProfileFreeTrialInvite(ctx, "trial@example.com", "", future); err != nil {
		t.Fatal(err)
	}
	// active user (paid)
	if err := st.UpsertUserProfileSlackID(ctx, "paid@example.com", "UPAID"); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertUserProfileStripeSubscription(ctx, "paid@example.com", "cus_paid", "sub_1", "active", "subscriber", "price_m", "prod_m", false, future); err != nil {
		t.Fatal(err)
	}
	// expired trial
	if err := st.UpsertUserProfileSlackID(ctx, "exp@example.com", "UEXP"); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertUserProfileFreeTrialInvite(ctx, "exp@example.com", "", past); err != nil {
		t.Fatal(err)
	}
	// free_lifetime
	if err := st.UpsertUserProfileSlackID(ctx, "free@example.com", "UFREE"); err != nil {
		t.Fatal(err)
	}
	if err := st.MarkProfileFreeLifetime(ctx, "free@example.com"); err != nil {
		t.Fatal(err)
	}

	users := []SlackWorkspaceUser{
		{SlackUserID: "UTRIAL", Email: "trial@example.com"},
		{SlackUserID: "UPAID", Email: "paid@example.com"},
		{SlackUserID: "UEXP", Email: "exp@example.com"},
		{SlackUserID: "UFREE", Email: "free@example.com"},
		{SlackUserID: "UUNKNOWN", Email: "unknown@example.com"},
		{SlackUserID: "UBOT", IsBot: true},
	}
	st.EnrichSlackWorkspaceUsersWithProfileTerms(ctx, users)

	want := map[string]string{
		"UTRIAL": "trialing",
		"UPAID":  "active",
		"UEXP":   "expired",
		"UFREE":  "free_lifetime",
	}
	got := map[string]string{}
	for _, u := range users {
		got[u.SlackUserID] = u.Status
	}
	for sid, w := range want {
		if got[sid] != w {
			t.Fatalf("%s: status got %q want %q", sid, got[sid], w)
		}
	}
	if got["UUNKNOWN"] != "" {
		t.Fatalf("UUNKNOWN: expected empty status, got %q", got["UUNKNOWN"])
	}

	// Trial expiry mirrored only on trialing rows.
	for _, u := range users {
		switch u.SlackUserID {
		case "UTRIAL":
			if u.TrialExpiresAt != future {
				t.Fatalf("UTRIAL trial expires: got %d want %d", u.TrialExpiresAt, future)
			}
		case "UPAID":
			if u.StripeCustomerID != "cus_paid" {
				t.Fatalf("UPAID stripe customer: got %q", u.StripeCustomerID)
			}
			if u.TrialExpiresAt != 0 {
				t.Fatalf("UPAID trial expires non-zero: %d", u.TrialExpiresAt)
			}
		case "UEXP":
			if u.TrialExpiresAt != 0 {
				t.Fatalf("UEXP trial expires non-zero (only trialing): %d", u.TrialExpiresAt)
			}
		}
	}
}
