package app

import (
	"context"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

// Audit log for the Workspace integration. Backed by a Redis Stream
// (XADD) since the rest of the makeacompany-ai store is Redis-only.
// Stream is capped at ~1M events via XADD MAXLEN ~ (approximate trim);
// CASA-required ≥1-year retention is met by a downstream shipper job
// snapshotting to Drive (out of scope for v1).
//
// Event vocabulary (extend as new flows ship):
//
//   workspace.consent.completed   - operator finished /connect/callback successfully
//   workspace.secret.written      - per-operator Secret created/updated in K8s
//   workspace.restart.triggered   - Deployment patched to roll the pod
//   workspace.connect.failed      - any failure step in the connect flow
//   workspace.disconnect.success  - operator revoked via /disconnect
//   workspace.disconnect.failed   - revoke flow failed at some step

const (
	workspaceAuditStreamKey = keyPrefix + ":workspace_audit_events"
	workspaceAuditMaxLen    = 1_000_000
)

type WorkspaceAuditEvent struct {
	Event     string
	TenantID  string // Slack channel ID
	Operator  string // operator email (or "system")
	Slot      int    // 0 when not applicable
	Namespace string // K8s namespace touched (empty if N/A)
	Scope     string // OAuth scope string from token response (connect only)
	Outcome   string // ok | failed | denied
	Detail    string // free-form: error message, etc.
}

// AppendWorkspaceAuditEvent persists one event in the Redis stream.
// Failures are logged but do not fail the request — audit is best-effort.
func (s *Store) AppendWorkspaceAuditEvent(ctx context.Context, ev WorkspaceAuditEvent) error {
	fields := map[string]any{
		"event":     strings.TrimSpace(ev.Event),
		"tenant":    strings.TrimSpace(ev.TenantID),
		"operator":  strings.ToLower(strings.TrimSpace(ev.Operator)),
		"slot":      ev.Slot,
		"namespace": strings.TrimSpace(ev.Namespace),
		"scope":     strings.TrimSpace(ev.Scope),
		"outcome":   strings.TrimSpace(ev.Outcome),
		"detail":    strings.TrimSpace(ev.Detail),
		"ts":        time.Now().UTC().Format(time.RFC3339Nano),
	}
	return s.rdb.XAdd(ctx, &redis.XAddArgs{
		Stream: workspaceAuditStreamKey,
		MaxLen: workspaceAuditMaxLen,
		Approx: true,
		Values: fields,
	}).Err()
}
