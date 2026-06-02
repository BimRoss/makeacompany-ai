package app

import (
	"context"
	"testing"
	"time"
)

func TestPortalSession_PersonalTenant(t *testing.T) {
	st, _, cleanup := newPersonalAgentStore(t)
	defer cleanup()
	ctx := context.Background()
	exp := time.Now().UTC().Add(time.Hour)

	// Personal session must succeed with empty channel id.
	if err := st.CreatePortalSession(ctx, "tokp", "grant@example.com", "", PortalTenantTypePersonal, exp); err != nil {
		t.Fatalf("create personal: %v", err)
	}
	got, err := st.GetPortalSession(ctx, "tokp")
	if err != nil {
		t.Fatalf("get personal: %v", err)
	}
	if got.TenantType != PortalTenantTypePersonal {
		t.Errorf("TenantType = %q, want %q", got.TenantType, PortalTenantTypePersonal)
	}
	if got.ChannelID != "" {
		t.Errorf("personal session should have empty ChannelID, got %q", got.ChannelID)
	}
	if got.Email != "grant@example.com" {
		t.Errorf("Email = %q", got.Email)
	}
}

func TestPortalSession_CompanyRequiresChannel(t *testing.T) {
	st, _, cleanup := newPersonalAgentStore(t)
	defer cleanup()
	ctx := context.Background()
	exp := time.Now().UTC().Add(time.Hour)

	// Company session without channel must be rejected at write time.
	if err := st.CreatePortalSession(ctx, "tokc", "grant@example.com", "", PortalTenantTypeCompany, exp); err == nil {
		t.Fatal("expected company session without channel to be rejected")
	}
}

func TestPortalSession_PersonalRejectsChannel(t *testing.T) {
	st, _, cleanup := newPersonalAgentStore(t)
	defer cleanup()
	ctx := context.Background()
	exp := time.Now().UTC().Add(time.Hour)

	// Personal session must NOT carry a channel id (guards against scope confusion).
	if err := st.CreatePortalSession(ctx, "tokpx", "grant@example.com", "C0FAKE", PortalTenantTypePersonal, exp); err == nil {
		t.Fatal("expected personal session with channel id to be rejected")
	}
}

func TestPortalSession_LegacyMissingTenantTypeReadsAsCompany(t *testing.T) {
	st, _, cleanup := newPersonalAgentStore(t)
	defer cleanup()
	ctx := context.Background()

	// Simulate a pre-existing session row written before tenant_type
	// shipped: only email + channel_id, no tenant_type field.
	key := portalSessionKey("toklegacy")
	if err := st.rdb.HSet(ctx, key, map[string]any{
		"email":      "grant@example.com",
		"channel_id": "C0LEGACYCH",
		"createdAt":  time.Now().UTC().Format(time.RFC3339),
		"expiresAt":  time.Now().UTC().Add(time.Hour).Format(time.RFC3339),
	}).Err(); err != nil {
		t.Fatalf("seed legacy: %v", err)
	}
	if err := st.rdb.Expire(ctx, key, time.Hour).Err(); err != nil {
		t.Fatalf("expire: %v", err)
	}
	got, err := st.GetPortalSession(ctx, "toklegacy")
	if err != nil {
		t.Fatalf("get legacy: %v", err)
	}
	if got.TenantType != PortalTenantTypeCompany {
		t.Errorf("legacy row TenantType = %q, want %q", got.TenantType, PortalTenantTypeCompany)
	}
}
