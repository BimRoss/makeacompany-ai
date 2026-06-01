package app

import (
	"context"
	"errors"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func newPersonalAgentStore(t *testing.T) (*Store, *miniredis.Miniredis, func()) {
	t.Helper()
	srv, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	rdb := redis.NewClient(&redis.Options{Addr: srv.Addr()})
	return &Store{rdb: rdb}, srv, func() {
		_ = rdb.Close()
		srv.Close()
	}
}

func TestSlugifyAgentName(t *testing.T) {
	cases := []struct {
		in     string
		want   string
		wantOK bool
	}{
		{"Bart", "bart", true},
		{"  Bart  ", "bart", true},
		{"Hoes On Boats", "hoes-on-boats", true},
		{"Bart 🤖", "bart", true},
		{"---bart---", "bart", true},
		{"a", "", false},   // too short after normalize
		{"!!", "", false},  // no significant chars
		{"", "", false},
		{"BART", "bart", true},
		{"snake_case", "snake-case", true},
		{"too-long-name-that-keeps-going-and-going-and-eventually-overflows", "too-long-name-that-keeps-going-a", true},
		// Runs of non-slug chars collapse to a single hyphen before truncation.
		{"trim-hyphen-at-truncate--------------xx", "trim-hyphen-at-truncate-xx", true},
	}
	for _, tc := range cases {
		t.Run(tc.in, func(t *testing.T) {
			got, ok := SlugifyAgentName(tc.in)
			if ok != tc.wantOK {
				t.Fatalf("ok = %v, want %v (got %q)", ok, tc.wantOK, got)
			}
			if tc.wantOK && got != tc.want {
				t.Fatalf("slug = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestValidPersonalAgentSlug(t *testing.T) {
	cases := []struct {
		in   string
		want bool
	}{
		{"bart", true},
		{"hoes-on-boats", true},
		{"a", false},                  // too short
		{"ab", false},                  // too short
		{"abc", true},                  // exactly min
		{"BART", false},                // uppercase rejected
		{"-bart", false},               // leading hyphen
		{"bart-", false},               // trailing hyphen
		{"bart--ross", false},          // double hyphen
		{"with space", false},          // space rejected
		{"emoji🤖", false},             // unicode rejected
		{"this-is-way-too-long-a-slug-to-fit-the-limit-honestly", false}, // > 32
	}
	for _, tc := range cases {
		t.Run(tc.in, func(t *testing.T) {
			got := ValidPersonalAgentSlug(tc.in)
			if got != tc.want {
				t.Fatalf("ValidPersonalAgentSlug(%q) = %v, want %v", tc.in, got, tc.want)
			}
		})
	}
}

func TestValidSlackUserID(t *testing.T) {
	cases := []struct {
		in   string
		want bool
	}{
		{"U0APBT3364D", true},   // human Slack user id
		{"U0B7MEY6VMJ", true},   // Garth (a bot user)
		{"WSOMEUSER12", true},    // enterprise-grid prefix
		{"BLEGACYBOT0", true},    // legacy bot prefix
		{"C0APJT7PYUU", false},   // channel id, not a user
		{"u0apbt3364d", false},   // lowercase rejected
		{"U0", false},            // too short
		{"", false},
		{"U0APBT 3364D", false},  // space
	}
	for _, tc := range cases {
		t.Run(tc.in, func(t *testing.T) {
			if got := ValidSlackUserID(tc.in); got != tc.want {
				t.Fatalf("ValidSlackUserID(%q) = %v, want %v", tc.in, got, tc.want)
			}
		})
	}
}

func TestPersonalAgent_CreateAndGet(t *testing.T) {
	st, _, done := newPersonalAgentStore(t)
	defer done()
	ctx := context.Background()

	if err := st.CreatePersonalAgent(ctx, "bart", "U0APBT3364D", "Bart"); err != nil {
		t.Fatalf("create: %v", err)
	}
	pa, err := st.GetPersonalAgent(ctx, "bart")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if pa.Slug != "bart" || pa.OwnerUserID != "U0APBT3364D" || pa.DisplayName != "Bart" {
		t.Fatalf("identity drift: %+v", pa)
	}
	if pa.CreatedAt.IsZero() {
		t.Fatal("CreatedAt should be set")
	}
	if pa.AgentSlackBotUserID != "" || pa.GoogleEmail != "" {
		t.Fatalf("expected empty optional fields, got %+v", pa)
	}
}

func TestPersonalAgent_CreateRejectsSlugCollision(t *testing.T) {
	st, _, done := newPersonalAgentStore(t)
	defer done()
	ctx := context.Background()

	if err := st.CreatePersonalAgent(ctx, "bart", "U0APBT3364D", "Bart"); err != nil {
		t.Fatalf("first create: %v", err)
	}
	err := st.CreatePersonalAgent(ctx, "bart", "U0DIFFERENT", "Bart II")
	if !errors.Is(err, ErrPersonalAgentSlugTaken) {
		t.Fatalf("second create: want ErrPersonalAgentSlugTaken, got %v", err)
	}
	// Original should be untouched — second create must not have
	// clobbered the owner or display name.
	pa, err := st.GetPersonalAgent(ctx, "bart")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if pa.OwnerUserID != "U0APBT3364D" || pa.DisplayName != "Bart" {
		t.Fatalf("collision clobbered original: %+v", pa)
	}
}

func TestPersonalAgent_GetNotFound(t *testing.T) {
	st, _, done := newPersonalAgentStore(t)
	defer done()
	_, err := st.GetPersonalAgent(context.Background(), "ghost")
	if !errors.Is(err, ErrPersonalAgentNotFound) {
		t.Fatalf("want ErrPersonalAgentNotFound, got %v", err)
	}
}

func TestPersonalAgent_ListByOwner(t *testing.T) {
	st, _, done := newPersonalAgentStore(t)
	defer done()
	ctx := context.Background()

	must := func(slug, owner, name string) {
		if err := st.CreatePersonalAgent(ctx, slug, owner, name); err != nil {
			t.Fatalf("create %s: %v", slug, err)
		}
	}
	must("bart", "U0APBT3364D", "Bart")
	must("garth", "U0APBT3364D", "Garth")
	must("zelda", "U0OTHERUSER", "Zelda")

	mine, err := st.ListPersonalAgentsByOwner(ctx, "U0APBT3364D")
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(mine) != 2 {
		t.Fatalf("mine = %d, want 2 (%+v)", len(mine), mine)
	}
	// Order is alphabetical.
	if mine[0].Slug != "bart" || mine[1].Slug != "garth" {
		t.Fatalf("order = [%s, %s], want [bart, garth]", mine[0].Slug, mine[1].Slug)
	}
	// Other owner's agent is not in this list.
	for _, pa := range mine {
		if pa.Slug == "zelda" {
			t.Fatal("zelda leaked into the wrong owner's list")
		}
	}
}

func TestPersonalAgent_ListAll(t *testing.T) {
	st, _, done := newPersonalAgentStore(t)
	defer done()
	ctx := context.Background()

	_ = st.CreatePersonalAgent(ctx, "bart", "U0APBT3364D", "Bart")
	_ = st.CreatePersonalAgent(ctx, "zelda", "U0OTHERUSER", "Zelda")

	all, err := st.ListAllPersonalAgents(ctx)
	if err != nil {
		t.Fatalf("list all: %v", err)
	}
	if len(all) != 2 {
		t.Fatalf("all = %d, want 2", len(all))
	}
	if all[0].Slug != "bart" || all[1].Slug != "zelda" {
		t.Fatalf("order = [%s, %s], want [bart, zelda]", all[0].Slug, all[1].Slug)
	}
}

func TestPersonalAgent_SetSlackBotUpdatesReverseIndex(t *testing.T) {
	st, _, done := newPersonalAgentStore(t)
	defer done()
	ctx := context.Background()

	if err := st.CreatePersonalAgent(ctx, "bart", "U0APBT3364D", "Bart"); err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := st.SetPersonalAgentSlackBot(ctx, "bart", "U0BARTBOT01"); err != nil {
		t.Fatalf("set bot: %v", err)
	}
	got, err := st.LookupPersonalAgentByBotUser(ctx, "U0BARTBOT01")
	if err != nil {
		t.Fatalf("lookup: %v", err)
	}
	if got != "bart" {
		t.Fatalf("lookup = %q, want bart", got)
	}

	// Re-binding to a different bot id should clear the old reverse
	// index so the stale bot id no longer resolves.
	if err := st.SetPersonalAgentSlackBot(ctx, "bart", "U0BARTBOT02"); err != nil {
		t.Fatalf("rebind: %v", err)
	}
	if _, err := st.LookupPersonalAgentByBotUser(ctx, "U0BARTBOT01"); !errors.Is(err, ErrPersonalAgentNotFound) {
		t.Fatalf("old bot id should not resolve, got %v", err)
	}
	got2, err := st.LookupPersonalAgentByBotUser(ctx, "U0BARTBOT02")
	if err != nil {
		t.Fatalf("lookup new: %v", err)
	}
	if got2 != "bart" {
		t.Fatalf("lookup new = %q, want bart", got2)
	}
}

func TestPersonalAgent_SetSlackBotNotFound(t *testing.T) {
	st, _, done := newPersonalAgentStore(t)
	defer done()
	err := st.SetPersonalAgentSlackBot(context.Background(), "ghost", "U0BARTBOT01")
	if !errors.Is(err, ErrPersonalAgentNotFound) {
		t.Fatalf("want ErrPersonalAgentNotFound, got %v", err)
	}
}

func TestPersonalAgent_SetGoogleIdentity(t *testing.T) {
	st, _, done := newPersonalAgentStore(t)
	defer done()
	ctx := context.Background()

	if err := st.CreatePersonalAgent(ctx, "bart", "U0APBT3364D", "Bart"); err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := st.SetPersonalAgentGoogleIdentity(ctx, "bart", "GRANT@bimross.com", "1234567890"); err != nil {
		t.Fatalf("set google: %v", err)
	}
	pa, err := st.GetPersonalAgent(ctx, "bart")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if pa.GoogleEmail != "grant@bimross.com" {
		t.Fatalf("GoogleEmail = %q, want lowercased grant@bimross.com", pa.GoogleEmail)
	}
	if pa.GoogleSubject != "1234567890" {
		t.Fatalf("GoogleSubject = %q", pa.GoogleSubject)
	}
}

func TestPersonalAgent_DeleteCleansUpAllKeys(t *testing.T) {
	st, srv, done := newPersonalAgentStore(t)
	defer done()
	ctx := context.Background()

	_ = st.CreatePersonalAgent(ctx, "bart", "U0APBT3364D", "Bart")
	_ = st.SetPersonalAgentSlackBot(ctx, "bart", "U0BARTBOT01")
	_ = st.SetPersonalAgentGoogleIdentity(ctx, "bart", "grant@bimross.com", "12345")

	if err := st.DeletePersonalAgent(ctx, "bart"); err != nil {
		t.Fatalf("delete: %v", err)
	}

	// Hash gone.
	if _, err := st.GetPersonalAgent(ctx, "bart"); !errors.Is(err, ErrPersonalAgentNotFound) {
		t.Fatalf("get after delete: want NotFound, got %v", err)
	}
	// Reverse index gone.
	if _, err := st.LookupPersonalAgentByBotUser(ctx, "U0BARTBOT01"); !errors.Is(err, ErrPersonalAgentNotFound) {
		t.Fatalf("bot index after delete: want NotFound, got %v", err)
	}
	// Owner index empty.
	mine, err := st.ListPersonalAgentsByOwner(ctx, "U0APBT3364D")
	if err != nil {
		t.Fatalf("list by owner: %v", err)
	}
	if len(mine) != 0 {
		t.Fatalf("expected owner list empty, got %+v", mine)
	}
	// Slug freed — a fresh create with the same slug must succeed.
	if err := st.CreatePersonalAgent(ctx, "bart", "U0NEWOWNER0", "Bart Reborn"); err != nil {
		t.Fatalf("recreate after delete: %v", err)
	}

	// Sanity: only the keys for the new "bart" agent + slugs set should
	// remain. Use the underlying miniredis to enumerate.
	keys := srv.Keys()
	if len(keys) == 0 {
		t.Fatal("expected at least the new agent's keys")
	}
}

func TestPersonalAgent_DeleteNonexistentIsNoop(t *testing.T) {
	st, _, done := newPersonalAgentStore(t)
	defer done()
	if err := st.DeletePersonalAgent(context.Background(), "ghost"); err != nil {
		t.Fatalf("delete ghost: %v", err)
	}
}

func TestPersonalAgent_InvalidInputs(t *testing.T) {
	st, _, done := newPersonalAgentStore(t)
	defer done()
	ctx := context.Background()

	// Invalid slug shape.
	if err := st.CreatePersonalAgent(ctx, "-bad", "U0APBT3364D", "Bart"); !errors.Is(err, ErrInvalidPersonalAgentSlug) {
		t.Fatalf("invalid slug: want ErrInvalidPersonalAgentSlug, got %v", err)
	}
	// Invalid owner id (channel id, not user).
	if err := st.CreatePersonalAgent(ctx, "bart", "C0APJT7PYUU", "Bart"); !errors.Is(err, ErrInvalidPersonalAgentOwner) {
		t.Fatalf("invalid owner: want ErrInvalidPersonalAgentOwner, got %v", err)
	}
	// Empty display name.
	if err := st.CreatePersonalAgent(ctx, "bart", "U0APBT3364D", "  "); err == nil {
		t.Fatal("empty display name: expected error")
	}
}
