package app

import (
	"context"
	"errors"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func newPersonalAgentTestStore(t *testing.T) (*Store, func()) {
	t.Helper()
	srv, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}
	rdb := redis.NewClient(&redis.Options{Addr: srv.Addr()})
	st := &Store{rdb: rdb}
	return st, func() { _ = rdb.Close(); srv.Close() }
}

func TestPersonalAgent_CreateAndGet(t *testing.T) {
	st, cleanup := newPersonalAgentTestStore(t)
	defer cleanup()
	ctx := context.Background()

	rec := PersonalAgentRecord{
		ID:               "agent-1",
		OwnerEmail:       "grant@bimross.com",
		OwnerSlackUserID: "U0APBT3364D",
		DisplayName:      "Garth",
		SlackAppID:       "A0GARTH",
		SlackClientID:    "111.222",
		SlackSigningSecret: "sig",
	}
	if err := st.CreatePersonalAgent(ctx, rec); err != nil {
		t.Fatalf("CreatePersonalAgent: %v", err)
	}
	got, err := st.GetPersonalAgent(ctx, "agent-1")
	if err != nil {
		t.Fatalf("GetPersonalAgent: %v", err)
	}
	if got.OwnerEmail != "grant@bimross.com" {
		t.Errorf("OwnerEmail = %q", got.OwnerEmail)
	}
	if got.DisplayName != "Garth" {
		t.Errorf("DisplayName = %q", got.DisplayName)
	}
	if got.Status != PersonalAgentStatusPendingInstall {
		t.Errorf("Status = %q, want %q", got.Status, PersonalAgentStatusPendingInstall)
	}
	if got.CreatedAt == "" || got.UpdatedAt == "" {
		t.Errorf("timestamps not stamped: created=%q updated=%q", got.CreatedAt, got.UpdatedAt)
	}
}

// TestPersonalAgent_InstallIdentityAndDistribution covers the #802 foundation:
// the install-captured (team_id, owner_user_id) pair and the operator-flipped
// distribution flag round-trip through recordToHash/hashToRecord, the setters
// persist and no-op correctly, and a missing record surfaces redis.Nil.
func TestPersonalAgent_InstallIdentityAndDistribution(t *testing.T) {
	st, cleanup := newPersonalAgentTestStore(t)
	defer cleanup()
	ctx := context.Background()

	rec := PersonalAgentRecord{
		ID:               "agent-802",
		OwnerEmail:       "outsider@example.com",
		OwnerSlackUserID: "U_HOME", // create-time, our-workspace id
		DisplayName:      "Scout",
		SlackAppID:       "A0SCOUT",
	}
	if err := st.CreatePersonalAgent(ctx, rec); err != nil {
		t.Fatalf("CreatePersonalAgent: %v", err)
	}

	// Fresh record: install identity empty, distribution not public.
	got, err := st.GetPersonalAgent(ctx, "agent-802")
	if err != nil {
		t.Fatalf("GetPersonalAgent: %v", err)
	}
	if got.InstalledTeamID != "" || got.InstalledOwnerUserID != "" {
		t.Errorf("expected empty install identity, got team=%q owner=%q", got.InstalledTeamID, got.InstalledOwnerUserID)
	}
	if got.AppDistributionPublic {
		t.Errorf("expected AppDistributionPublic=false on fresh record")
	}

	// Capture the install identity (foreign workspace + owner id there).
	if err := st.SetPersonalAgentInstallIdentity(ctx, "agent-802", "T_FOREIGN", "U_FOREIGN"); err != nil {
		t.Fatalf("SetPersonalAgentInstallIdentity: %v", err)
	}
	// Flip distribution public (the manual dashboard action, recorded our side).
	if err := st.SetPersonalAgentDistributionPublic(ctx, "agent-802", true); err != nil {
		t.Fatalf("SetPersonalAgentDistributionPublic: %v", err)
	}

	got, err = st.GetPersonalAgent(ctx, "agent-802")
	if err != nil {
		t.Fatalf("GetPersonalAgent after updates: %v", err)
	}
	if got.InstalledTeamID != "T_FOREIGN" || got.InstalledOwnerUserID != "U_FOREIGN" {
		t.Errorf("install identity = (%q,%q), want (T_FOREIGN,U_FOREIGN)", got.InstalledTeamID, got.InstalledOwnerUserID)
	}
	if !got.AppDistributionPublic {
		t.Errorf("AppDistributionPublic = false, want true")
	}
	// The create-time owner id must be untouched — the two are distinct keys.
	if got.OwnerSlackUserID != "U_HOME" {
		t.Errorf("OwnerSlackUserID mutated to %q, want U_HOME", got.OwnerSlackUserID)
	}

	// Empty values are a protective no-op: a partial oauth response must not
	// clobber a prior good install identity.
	if err := st.SetPersonalAgentInstallIdentity(ctx, "agent-802", "", ""); err != nil {
		t.Fatalf("SetPersonalAgentInstallIdentity no-op: %v", err)
	}
	got, _ = st.GetPersonalAgent(ctx, "agent-802")
	if got.InstalledTeamID != "T_FOREIGN" || got.InstalledOwnerUserID != "U_FOREIGN" {
		t.Errorf("no-op clobbered install identity: (%q,%q)", got.InstalledTeamID, got.InstalledOwnerUserID)
	}

	// Missing record surfaces redis.Nil through the setter.
	if err := st.SetPersonalAgentDistributionPublic(ctx, "does-not-exist", true); !errors.Is(err, redis.Nil) {
		t.Errorf("SetPersonalAgentDistributionPublic on missing record = %v, want redis.Nil", err)
	}
}

// TestPersonalAgent_SetOAuthAuthorizeURL covers the #653 persistence path: a
// fresh install/reinstall URL (carrying the manifest's current scopes) replaces
// the create-time frozen one, an empty value is a protective no-op, and a missing
// record surfaces redis.Nil.
func TestPersonalAgent_SetOAuthAuthorizeURL(t *testing.T) {
	st, cleanup := newPersonalAgentTestStore(t)
	defer cleanup()
	ctx := context.Background()

	const oldURL = "https://slack.com/oauth/v2/authorize?client_id=111.222&scope=chat%3Awrite"
	rec := PersonalAgentRecord{
		ID:                "agent-url",
		OwnerSlackUserID:  "U0APBT3364D",
		DisplayName:       "Garth",
		SlackAppID:        "A0GARTH",
		SlackClientID:     "111.222",
		OAuthAuthorizeURL: oldURL,
	}
	if err := st.CreatePersonalAgent(ctx, rec); err != nil {
		t.Fatalf("CreatePersonalAgent: %v", err)
	}

	const newURL = "https://slack.com/oauth/v2/authorize?client_id=111.222&scope=groups%3Aread%2Cchat%3Awrite"
	if err := st.SetPersonalAgentOAuthAuthorizeURL(ctx, "agent-url", newURL); err != nil {
		t.Fatalf("SetPersonalAgentOAuthAuthorizeURL: %v", err)
	}
	got, err := st.GetPersonalAgent(ctx, "agent-url")
	if err != nil {
		t.Fatalf("GetPersonalAgent: %v", err)
	}
	if got.OAuthAuthorizeURL != newURL {
		t.Errorf("OAuthAuthorizeURL = %q, want refreshed %q", got.OAuthAuthorizeURL, newURL)
	}

	// Empty value is a no-op — never clobber a good stored URL.
	if err := st.SetPersonalAgentOAuthAuthorizeURL(ctx, "agent-url", "  "); err != nil {
		t.Fatalf("empty SetPersonalAgentOAuthAuthorizeURL should be nil no-op: %v", err)
	}
	got, _ = st.GetPersonalAgent(ctx, "agent-url")
	if got.OAuthAuthorizeURL != newURL {
		t.Errorf("empty set clobbered URL: %q", got.OAuthAuthorizeURL)
	}

	// Missing record → redis.Nil (mirrors the other updatePersonalAgentFields callers).
	if err := st.SetPersonalAgentOAuthAuthorizeURL(ctx, "no-such-agent", newURL); !errors.Is(err, redis.Nil) {
		t.Errorf("missing record err = %v, want redis.Nil", err)
	}
}

func TestPersonalAgent_ByOwnerAndByAppID(t *testing.T) {
	st, cleanup := newPersonalAgentTestStore(t)
	defer cleanup()
	ctx := context.Background()

	rec := PersonalAgentRecord{
		ID: "agent-1", OwnerSlackUserID: "U1", SlackAppID: "A_APP1",
	}
	if err := st.CreatePersonalAgent(ctx, rec); err != nil {
		t.Fatalf("create: %v", err)
	}

	owned, err := st.ListPersonalAgentsByOwner(ctx, "U1")
	if err != nil {
		t.Fatalf("ListPersonalAgentsByOwner: %v", err)
	}
	if len(owned) != 1 || owned[0].ID != "agent-1" {
		t.Errorf("owner list = %+v, want one agent-1", owned)
	}

	byApp, err := st.GetPersonalAgentByAppID(ctx, "A_APP1")
	if err != nil {
		t.Fatalf("GetPersonalAgentByAppID: %v", err)
	}
	if byApp.ID != "agent-1" {
		t.Errorf("by-app id = %q", byApp.ID)
	}

	missing, err := st.ListPersonalAgentsByOwner(ctx, "UNOPE")
	if err != nil {
		t.Fatalf("ListPersonalAgentsByOwner(missing): %v", err)
	}
	if len(missing) != 0 {
		t.Errorf("expected empty list for unknown owner, got %+v", missing)
	}
}

// installed builds a record already marked installed so the prior-installed
// create gate is satisfied for the NEXT create.
func installedAgent(id, owner, app string) PersonalAgentRecord {
	return PersonalAgentRecord{ID: id, OwnerSlackUserID: owner, SlackAppID: app, Status: PersonalAgentStatusInstalled}
}

func TestPersonalAgent_MaxThreePerOwner(t *testing.T) {
	st, cleanup := newPersonalAgentTestStore(t)
	defer cleanup()
	ctx := context.Background()

	// Three installed agents are fine; the prior-installed gate is satisfied
	// each time because each prior is already installed.
	for i, id := range []string{"a1", "a2", "a3"} {
		if err := st.CreatePersonalAgent(ctx, installedAgent(id, "U1", "A"+id)); err != nil {
			t.Fatalf("create #%d (%s): %v", i+1, id, err)
		}
	}
	owned, err := st.ListPersonalAgentsByOwner(ctx, "U1")
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(owned) != 3 {
		t.Fatalf("want 3 agents, got %d", len(owned))
	}
	// Creation order preserved (oldest first).
	if owned[0].ID != "a1" || owned[1].ID != "a2" || owned[2].ID != "a3" {
		t.Errorf("creation order wrong: %s,%s,%s", owned[0].ID, owned[1].ID, owned[2].ID)
	}

	// 4th is rejected at the cap.
	err = st.CreatePersonalAgent(ctx, installedAgent("a4", "U1", "Aa4"))
	if !errors.Is(err, ErrPersonalAgentMaxReached) {
		t.Fatalf("expected ErrPersonalAgentMaxReached, got %v", err)
	}
}

func TestPersonalAgent_BlockedWhenPriorPending(t *testing.T) {
	st, cleanup := newPersonalAgentTestStore(t)
	defer cleanup()
	ctx := context.Background()

	// First create lands as pending_install (default status).
	if err := st.CreatePersonalAgent(ctx, PersonalAgentRecord{ID: "a1", OwnerSlackUserID: "U1", SlackAppID: "A1"}); err != nil {
		t.Fatalf("first create: %v", err)
	}
	// Second create is blocked while the first is still pending.
	err := st.CreatePersonalAgent(ctx, PersonalAgentRecord{ID: "a2", OwnerSlackUserID: "U1", SlackAppID: "A2"})
	if !errors.Is(err, ErrPersonalAgentPriorNotInstalled) {
		t.Fatalf("expected ErrPersonalAgentPriorNotInstalled, got %v", err)
	}
	// Once the first is installed, the second is allowed.
	if err := st.MarkPersonalAgentInstalled(ctx, "a1"); err != nil {
		t.Fatalf("mark installed: %v", err)
	}
	if err := st.CreatePersonalAgent(ctx, PersonalAgentRecord{ID: "a2", OwnerSlackUserID: "U1", SlackAppID: "A2"}); err != nil {
		t.Fatalf("second create after install: %v", err)
	}
}

func TestPersonalAgent_LegacyOwnerKeyMigratesOnRead(t *testing.T) {
	st, cleanup := newPersonalAgentTestStore(t)
	defer cleanup()
	ctx := context.Background()

	// Seed a record + the LEGACY single-value owner key (pre-#651 shape). We
	// write the record hash directly so we don't go through CreatePersonalAgent
	// (which would build the new list index).
	rec := PersonalAgentRecord{
		ID: "legacy-1", OwnerSlackUserID: "U1", SlackAppID: "A1",
		Status: PersonalAgentStatusInstalled, CreatedAt: "2026-01-01T00:00:00Z", UpdatedAt: "2026-01-01T00:00:00Z",
	}
	if err := st.rdb.HSet(ctx, personalAgentRedisKey(rec.ID), recordToHash(rec)).Err(); err != nil {
		t.Fatalf("seed record: %v", err)
	}
	legacyKey := personalAgentByOwnerRedisKey("U1")
	if err := st.rdb.Set(ctx, legacyKey, rec.ID, 0).Err(); err != nil {
		t.Fatalf("seed legacy key: %v", err)
	}

	owned, err := st.ListPersonalAgentsByOwner(ctx, "U1")
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(owned) != 1 || owned[0].ID != "legacy-1" {
		t.Fatalf("migration list = %+v, want [legacy-1]", owned)
	}
	// New list key exists, old key is gone.
	if n, _ := st.rdb.Exists(ctx, personalAgentIDsByOwnerRedisKey("U1")).Result(); n != 1 {
		t.Errorf("new list key should exist after migration")
	}
	if n, _ := st.rdb.Exists(ctx, legacyKey).Result(); n != 0 {
		t.Errorf("legacy key should be deleted after migration")
	}

	// Second call is a no-op: same single record, list key still length 1.
	owned2, err := st.ListPersonalAgentsByOwner(ctx, "U1")
	if err != nil {
		t.Fatalf("second list: %v", err)
	}
	if len(owned2) != 1 || owned2[0].ID != "legacy-1" {
		t.Errorf("second list = %+v, want [legacy-1] (no double-push)", owned2)
	}
	if n, _ := st.rdb.LLen(ctx, personalAgentIDsByOwnerRedisKey("U1")).Result(); n != 1 {
		t.Errorf("list length = %d after 2nd read, want 1 (idempotent)", n)
	}
}

func TestPersonalAgent_MarkInstalledAndSetService(t *testing.T) {
	st, cleanup := newPersonalAgentTestStore(t)
	defer cleanup()
	ctx := context.Background()

	if err := st.CreatePersonalAgent(ctx, PersonalAgentRecord{ID: "a1", OwnerSlackUserID: "U1", SlackAppID: "A1"}); err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := st.MarkPersonalAgentInstalled(ctx, "a1"); err != nil {
		t.Fatalf("MarkInstalled: %v", err)
	}
	if err := st.SetPersonalAgentService(ctx, "a1", "personal-agents", "personal-agent-garth", 8080); err != nil {
		t.Fatalf("SetService: %v", err)
	}

	got, _ := st.GetPersonalAgent(ctx, "a1")
	if got.Status != PersonalAgentStatusInstalled {
		t.Errorf("Status = %q", got.Status)
	}
	if got.ServiceNamespace != "personal-agents" || got.ServiceName != "personal-agent-garth" || got.ServicePort != 8080 {
		t.Errorf("service fields wrong: %+v", got)
	}
}

func TestPersonalAgent_SetServiceRejectsBadInput(t *testing.T) {
	st, cleanup := newPersonalAgentTestStore(t)
	defer cleanup()
	ctx := context.Background()
	_ = st.CreatePersonalAgent(ctx, PersonalAgentRecord{ID: "a1", OwnerSlackUserID: "U1", SlackAppID: "A1"})

	if err := st.SetPersonalAgentService(ctx, "a1", "", "x", 8080); err == nil {
		t.Fatal("expected error on empty namespace")
	}
	if err := st.SetPersonalAgentService(ctx, "a1", "ns", "x", 0); err == nil {
		t.Fatal("expected error on zero port")
	}
}

func TestPersonalAgent_UpdateOnNonexistentReturnsNil(t *testing.T) {
	st, cleanup := newPersonalAgentTestStore(t)
	defer cleanup()
	ctx := context.Background()

	if err := st.UpdatePersonalAgentStatus(ctx, "doesnotexist", "failed"); !errors.Is(err, redis.Nil) {
		t.Errorf("expected redis.Nil for missing record, got %v", err)
	}
}
