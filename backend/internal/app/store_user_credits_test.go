package app

import (
	"context"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func newCreditsTestStore(t *testing.T) (*Store, func()) {
	t.Helper()
	srv, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	rdb := redis.NewClient(&redis.Options{Addr: srv.Addr()})
	return &Store{rdb: rdb}, func() {
		rdb.Close()
		srv.Close()
	}
}

func TestSeedCredits_OnceOnly(t *testing.T) {
	st, done := newCreditsTestStore(t)
	defer done()
	ctx := context.Background()

	seeded, err := st.SeedCreditsIfUnset(ctx, "A@Example.com", 100)
	if err != nil {
		t.Fatal(err)
	}
	if !seeded {
		t.Fatal("expected first seed to report true")
	}
	// A second seed with a different amount must be a no-op.
	seeded, err = st.SeedCreditsIfUnset(ctx, "a@example.com", 500)
	if err != nil {
		t.Fatal(err)
	}
	if seeded {
		t.Fatal("expected second seed to be a no-op")
	}
	bal, err := st.GetCredits(ctx, "a@example.com", 100)
	if err != nil {
		t.Fatal(err)
	}
	if bal.Balance != 100 {
		t.Fatalf("balance: got %d want 100", bal.Balance)
	}
}

func TestGetCredits_SeedsOnFirstSight(t *testing.T) {
	st, done := newCreditsTestStore(t)
	defer done()
	ctx := context.Background()

	// No prior profile: GetCredits should self-heal by seeding the grant.
	bal, err := st.GetCredits(ctx, "new@example.com", 100)
	if err != nil {
		t.Fatal(err)
	}
	if bal.Balance != 100 {
		t.Fatalf("balance: got %d want 100", bal.Balance)
	}
	if bal.Seeded {
		t.Fatal("expected Seeded=false the turn the grant was created")
	}
	row, err := st.UserProfileRowByEmail(ctx, "new@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if row.CreditsBalance != 100 || row.CreditsGrantedTotal != 100 {
		t.Fatalf("row: balance=%d granted=%d", row.CreditsBalance, row.CreditsGrantedTotal)
	}
}

func TestConsumeCredits_ChargesAndBlocksAtZero(t *testing.T) {
	st, done := newCreditsTestStore(t)
	defer done()
	ctx := context.Background()

	if _, err := st.SeedCreditsIfUnset(ctx, "u@example.com", 2); err != nil {
		t.Fatal(err)
	}
	for i, wantBal := range []int64{1, 0} {
		outcome, bal, err := st.ConsumeCredits(ctx, "u@example.com", 1, "", 2)
		if err != nil {
			t.Fatal(err)
		}
		if outcome != ConsumeCharged {
			t.Fatalf("consume %d: outcome %q want charged", i, outcome)
		}
		if bal != wantBal {
			t.Fatalf("consume %d: balance %d want %d", i, bal, wantBal)
		}
	}
	// Third consume: balance is 0, must not charge.
	outcome, bal, err := st.ConsumeCredits(ctx, "u@example.com", 1, "", 2)
	if err != nil {
		t.Fatal(err)
	}
	if outcome != ConsumeInsufficient {
		t.Fatalf("outcome %q want insufficient", outcome)
	}
	if bal != 0 {
		t.Fatalf("balance %d want 0", bal)
	}
	row, err := st.UserProfileRowByEmail(ctx, "u@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if row.CreditsConsumedTotal != 2 {
		t.Fatalf("consumed total: got %d want 2", row.CreditsConsumedTotal)
	}
}

func TestConsumeCredits_IdempotencyKeyDedupes(t *testing.T) {
	st, done := newCreditsTestStore(t)
	defer done()
	ctx := context.Background()

	if _, err := st.SeedCreditsIfUnset(ctx, "u@example.com", 10); err != nil {
		t.Fatal(err)
	}
	outcome, bal, err := st.ConsumeCredits(ctx, "u@example.com", 1, "spawn-abc", 10)
	if err != nil {
		t.Fatal(err)
	}
	if outcome != ConsumeCharged || bal != 9 {
		t.Fatalf("first: outcome=%q bal=%d", outcome, bal)
	}
	// Same key again: no double charge.
	outcome, bal, err = st.ConsumeCredits(ctx, "u@example.com", 1, "spawn-abc", 10)
	if err != nil {
		t.Fatal(err)
	}
	if outcome != ConsumeDuplicate {
		t.Fatalf("second: outcome %q want duplicate", outcome)
	}
	if bal != 9 {
		t.Fatalf("second: balance %d want 9 (unchanged)", bal)
	}
}

func TestConsumeCredits_UnlimitedNeverCharges(t *testing.T) {
	st, done := newCreditsTestStore(t)
	defer done()
	ctx := context.Background()

	if _, err := st.SeedCreditsIfUnset(ctx, "vip@example.com", 5); err != nil {
		t.Fatal(err)
	}
	if err := st.SetCreditsUnlimited(ctx, "vip@example.com", true); err != nil {
		t.Fatal(err)
	}
	outcome, _, err := st.ConsumeCredits(ctx, "vip@example.com", 1, "", 5)
	if err != nil {
		t.Fatal(err)
	}
	if outcome != ConsumeUnlimited {
		t.Fatalf("outcome %q want unlimited", outcome)
	}
	// Balance untouched.
	bal, err := st.GetCredits(ctx, "vip@example.com", 5)
	if err != nil {
		t.Fatal(err)
	}
	if !bal.Unlimited {
		t.Fatal("expected unlimited flag")
	}
	if bal.Balance != 5 {
		t.Fatalf("balance %d want 5 (untouched)", bal.Balance)
	}
}

func TestGrantCredits_AddsAndStamps(t *testing.T) {
	st, done := newCreditsTestStore(t)
	defer done()
	ctx := context.Background()

	if _, err := st.SeedCreditsIfUnset(ctx, "u@example.com", 100); err != nil {
		t.Fatal(err)
	}
	newBal, err := st.GrantCredits(ctx, "u@example.com", 250)
	if err != nil {
		t.Fatal(err)
	}
	if newBal != 350 {
		t.Fatalf("balance after grant: got %d want 350", newBal)
	}
	row, err := st.UserProfileRowByEmail(ctx, "u@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if row.CreditsGrantedTotal != 350 {
		t.Fatalf("granted total: got %d want 350", row.CreditsGrantedTotal)
	}
	if row.CreditsLastGrantAt == "" {
		t.Fatal("expected credits_last_grant_at stamped")
	}
	if _, err := st.GrantCredits(ctx, "u@example.com", 0); err == nil {
		t.Fatal("expected error granting non-positive")
	}
}

func TestSetSlackTeamID_WriteOnce(t *testing.T) {
	st, done := newCreditsTestStore(t)
	defer done()
	ctx := context.Background()

	if err := st.SetSlackTeamID(ctx, "u@example.com", "T111"); err != nil {
		t.Fatal(err)
	}
	// A later spawn from a different team must not overwrite provenance.
	if err := st.SetSlackTeamID(ctx, "u@example.com", "T999"); err != nil {
		t.Fatal(err)
	}
	row, err := st.UserProfileRowByEmail(ctx, "u@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if row.SlackTeamID != "T111" {
		t.Fatalf("slack team: got %q want T111", row.SlackTeamID)
	}
}
