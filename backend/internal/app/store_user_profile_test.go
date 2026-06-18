package app

import (
	"context"
	"strings"
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
		// #341 — post-cliff cancel must silence, not fall through to free_lifetime.
		{"stripe canceled post-cliff silences", UserProfileRow{StripeSubscriptionStatus: "canceled"}, LifecycleExpired},
		{"stripe canceled but free_lifetime preserved (pre-cliff path)", UserProfileRow{StripeSubscriptionStatus: "canceled", FreeLifetime: true}, LifecycleFreeLifetime},
		{"stripe incomplete_expired silences", UserProfileRow{StripeSubscriptionStatus: "incomplete_expired"}, LifecycleExpired},
		{"stripe unpaid silences", UserProfileRow{StripeSubscriptionStatus: "unpaid"}, LifecycleExpired},
		{"stripe canceled with uppercase variant still silences", UserProfileRow{StripeSubscriptionStatus: "CANCELED"}, LifecycleExpired},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := EffectiveStatus(tc.row, now, ""); got != tc.want {
				t.Fatalf("EffectiveStatus = %q, want %q", got, tc.want)
			}
		})
	}
}

// #485 — Stripe state on a row whose product id doesn't match the configured MaC base-plan product
// must not count as active/expired/trialing. Empty basePlanProductID (boot race or unconfigured
// local dev) and empty row.StripeProductID (legacy rows pre-dating the field) both preserve the
// prior behavior so the filter never silences someone who used to count.
func TestEffectiveStatus_BasePlanProductFilter(t *testing.T) {
	const mac = "prod_mac_base"
	const other = "prod_other"
	now := time.Unix(1_700_000_000, 0)
	cases := []struct {
		name           string
		row            UserProfileRow
		basePlanProdID string
		want           LifecycleStatus
	}{
		{
			// #485 stops the foreign-product sub from counting as active/paying; the free-for-life
			// over-count fix then keeps it out of the free_lifetime default too (no Slack identity →
			// not a MaC member). Excluded from the cohorts entirely (not a churned MaC user either).
			name:           "non-MaC active sub with no slack id is excluded (foreign-product orphan)",
			row:            UserProfileRow{StripeSubscriptionStatus: "active", StripeProductID: other},
			basePlanProdID: mac,
			want:           LifecycleExcluded,
		},
		{
			// A workspace member who also bought another BimRoss product is still a member: the
			// foreign-orphan branch requires an empty SlackUserID, so this keeps the conservative default.
			name:           "non-MaC active sub WITH slack id stays free_lifetime (workspace member preserved)",
			row:            UserProfileRow{StripeSubscriptionStatus: "active", StripeProductID: other, SlackUserID: "U123"},
			basePlanProdID: mac,
			want:           LifecycleFreeLifetime,
		},
		{
			// The dominant over-count bucket: a profile minted from a foreign-product checkout with no
			// subscription status and no Slack identity.
			name:           "foreign product id, no sub status, no slack id is excluded",
			row:            UserProfileRow{StripeProductID: other},
			basePlanProdID: mac,
			want:           LifecycleExcluded,
		},
		{
			name:           "MaC active sub still counts as active",
			row:            UserProfileRow{StripeSubscriptionStatus: "active", StripeProductID: mac},
			basePlanProdID: mac,
			want:           LifecycleActive,
		},
		{
			name:           "non-MaC canceled with no slack id is excluded (foreign-product orphan)",
			row:            UserProfileRow{StripeSubscriptionStatus: "canceled", StripeProductID: other},
			basePlanProdID: mac,
			want:           LifecycleExcluded,
		},
		{
			name:           "non-MaC trialing with no slack id is excluded (foreign-product orphan)",
			row:            UserProfileRow{StripeSubscriptionStatus: "trialing", StripeProductID: other},
			basePlanProdID: mac,
			want:           LifecycleExcluded,
		},
		{
			// The handleInternalUserStatus empty-row probe for unrecognized Slack users must never be
			// silenced: no product id → stripeStateMatchesBasePlan true → foreign-orphan branch skipped.
			name:           "empty row (unrecognized-user gate probe) stays free_lifetime",
			row:            UserProfileRow{},
			basePlanProdID: mac,
			want:           LifecycleFreeLifetime,
		},
		{
			name:           "empty basePlanProductID disables filter (backward compat)",
			row:            UserProfileRow{StripeSubscriptionStatus: "active", StripeProductID: other},
			basePlanProdID: "",
			want:           LifecycleActive,
		},
		{
			name:           "empty row.StripeProductID legacy row still honored",
			row:            UserProfileRow{StripeSubscriptionStatus: "active", StripeProductID: ""},
			basePlanProdID: mac,
			want:           LifecycleActive,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := EffectiveStatus(tc.row, now, tc.basePlanProdID); got != tc.want {
				t.Fatalf("EffectiveStatus = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestCheckDeployGate_BasePlanProductFilter(t *testing.T) {
	const mac = "prod_mac_base"
	const other = "prod_other"
	if got := CheckDeployGate(UserProfileRow{StripeSubscriptionStatus: "active", StripeProductID: other, FreeTierConsumed: true}, true, mac); got.Allowed {
		t.Fatalf("non-MaC active sub should not bypass deploy gate: %+v", got)
	}
	if got := CheckDeployGate(UserProfileRow{StripeSubscriptionStatus: "active", StripeProductID: mac}, true, mac); !got.Allowed || got.Reason != "paid" {
		t.Fatalf("MaC active sub should be allowed as paid: %+v", got)
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
	if got := EffectiveStatus(row, time.Unix(1_900_000_000, 0), ""); got != LifecycleActive {
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

func TestEnqueueWinbackDMJob(t *testing.T) {
	srv, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()
	rdb := redis.NewClient(&redis.Options{Addr: srv.Addr()})
	defer rdb.Close()
	ctx := context.Background()
	st := &Store{rdb: rdb}

	email := "cancel@example.com"
	job := ExpiryDMJob{
		SlackUserID:       "U_CANCEL_USER",
		Email:             email,
		StripeCheckoutURL: "https://buy.stripe.com/test?client_reference_id=U_CANCEL_USER",
	}
	if err := st.EnqueueWinbackDMJob(ctx, email, job); err != nil {
		t.Fatalf("enqueue: %v", err)
	}

	// Reason defaults to subscription_canceled when caller didn't set it.
	got, err := rdb.LRange(ctx, JoanneExpiryDMQueueKey, 0, -1).Result()
	if err != nil || len(got) != 1 {
		t.Fatalf("queue len = %d (want 1), err=%v", len(got), err)
	}
	if !strings.Contains(got[0], `"reason":"subscription_canceled"`) {
		t.Fatalf("reason not set on payload: %q", got[0])
	}

	// winback_dm_enqueued_at stamped — idempotency guard.
	stamp, _ := rdb.HGet(ctx, userProfileRedisKey(email), "winback_dm_enqueued_at").Result()
	if strings.TrimSpace(stamp) == "" {
		t.Fatalf("winback_dm_enqueued_at not stamped")
	}

	// Round-trip the row and confirm WinbackDMEnqueuedAt is exposed.
	row, err := st.UserProfileRowByEmail(ctx, email)
	if err != nil {
		t.Fatalf("load row: %v", err)
	}
	if row.WinbackDMEnqueuedAt == "" {
		t.Fatalf("WinbackDMEnqueuedAt not populated on UserProfileRow")
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
	st.EnrichSlackWorkspaceUsersWithProfileTerms(ctx, users, "")

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
