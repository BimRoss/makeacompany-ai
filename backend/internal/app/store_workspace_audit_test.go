package app

import (
	"context"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func TestAppendWorkspaceAuditEvent_writesStreamEntry(t *testing.T) {
	srv, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}
	t.Cleanup(srv.Close)

	rdb := redis.NewClient(&redis.Options{Addr: srv.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	store := &Store{rdb: rdb}

	ev := WorkspaceAuditEvent{
		Event:     "workspace.consent.completed",
		TenantID:  "C0XXXXXXXXX",
		Operator:  "grant@bimross.com",
		Slot:      1,
		Namespace: "claude-code-ross-customer-grant",
		Scope:     "openid email gmail.modify",
		Outcome:   "ok",
		Detail:    "",
	}
	if err := store.AppendWorkspaceAuditEvent(context.Background(), ev); err != nil {
		t.Fatalf("append: %v", err)
	}

	entries, err := rdb.XRange(context.Background(), workspaceAuditStreamKey, "-", "+").Result()
	if err != nil {
		t.Fatalf("xrange: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("want 1 stream entry, got %d", len(entries))
	}
	got := entries[0].Values
	if got["event"] != "workspace.consent.completed" {
		t.Errorf("event = %v, want workspace.consent.completed", got["event"])
	}
	if got["tenant"] != "C0XXXXXXXXX" {
		t.Errorf("tenant = %v, want C0XXXXXXXXX", got["tenant"])
	}
	// Operator is lowercased on the way in — emails are case-insensitive in
	// practice and the audit log is keyed off them.
	if got["operator"] != "grant@bimross.com" {
		t.Errorf("operator = %v, want grant@bimross.com", got["operator"])
	}
	if _, ok := got["ts"]; !ok {
		t.Errorf("ts field missing")
	}
}
