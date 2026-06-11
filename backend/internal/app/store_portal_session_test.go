package app

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func newPortalSessionTestStore(t *testing.T) (*Store, func()) {
	t.Helper()
	srv, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}
	rdb := redis.NewClient(&redis.Options{Addr: srv.Addr()})
	return &Store{rdb: rdb}, func() {
		_ = rdb.Close()
		srv.Close()
	}
}

func TestPortalSession_CompanyRequiresChannel(t *testing.T) {
	st, cleanup := newPortalSessionTestStore(t)
	defer cleanup()
	ctx := context.Background()
	exp := time.Now().UTC().Add(time.Hour)

	if err := st.CreatePortalSession(ctx, "tokc", "grant@example.com", "", PortalTenantTypeCompany, exp); err == nil {
		t.Fatal("expected company session without channel to be rejected")
	}
}

func TestPortalSession_LegacyMissingTenantTypeReadsAsCompany(t *testing.T) {
	st, cleanup := newPortalSessionTestStore(t)
	defer cleanup()
	ctx := context.Background()

	// Pre-existing session row written before tenant_type shipped: only
	// email + channel_id, no tenant_type field.
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
