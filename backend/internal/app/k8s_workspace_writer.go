package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
)

// WorkspaceTenantConfig is the per-channel mapping loaded from the
// WORKSPACE_TENANT_CONFIG env var. v1 is static (hand-roll); rancher-
// admin#354's template extraction replaces this with dynamic resolution.
type WorkspaceTenantConfig struct {
	Namespace  string         `json:"namespace"`
	Deployment string         `json:"deployment"`
	Slots      map[string]int `json:"slots"` // operator-email -> slot-number
}

type WorkspaceWriter struct {
	cs       *kubernetes.Clientset
	tenants  map[string]WorkspaceTenantConfig // channelId -> config
	disabled bool
}

// NewWorkspaceWriter builds an in-cluster K8s client and parses the
// tenant config. If running outside a cluster (local dev), the writer is
// returned in disabled state and all writes return ErrWorkspaceWriterDisabled.
// Operators see 503 from /v1/portal/workspace/connect/finish until env is wired.
func NewWorkspaceWriter(tenantConfigJSON string) (*WorkspaceWriter, error) {
	tenants := make(map[string]WorkspaceTenantConfig)
	if t := strings.TrimSpace(tenantConfigJSON); t != "" {
		if err := json.Unmarshal([]byte(t), &tenants); err != nil {
			return nil, fmt.Errorf("WORKSPACE_TENANT_CONFIG parse: %w", err)
		}
	}

	cfg, err := rest.InClusterConfig()
	if err != nil {
		// rest.ErrNotInCluster — local dev. Return disabled writer.
		return &WorkspaceWriter{tenants: tenants, disabled: true}, nil
	}
	cs, err := kubernetes.NewForConfig(cfg)
	if err != nil {
		return nil, fmt.Errorf("k8s clientset: %w", err)
	}
	return &WorkspaceWriter{cs: cs, tenants: tenants}, nil
}

// ErrWorkspaceWriterDisabled is returned when the backend is running
// outside a cluster (local dev) or the tenant config is missing.
var ErrWorkspaceWriterDisabled = errors.New("workspace writer disabled (no in-cluster config or tenant map)")

// ErrUnknownTenant — channelId not in the tenant config. Caller should
// 404 the operator; this is a config issue, not a permission issue.
var ErrUnknownTenant = errors.New("channel not registered as a workspace tenant")

// ErrUnknownOperator — operator email not in this tenant's slot map.
// For v1 hand-roll the slot map is static; #354 adds dynamic allocation.
var ErrUnknownOperator = errors.New("operator not allocated a workspace slot in this tenant")

func (w *WorkspaceWriter) Disabled() bool {
	return w == nil || w.disabled
}

func (w *WorkspaceWriter) resolveTenant(channelID, operatorEmail string) (string, string, int, error) {
	t, ok := w.tenants[strings.TrimSpace(channelID)]
	if !ok {
		return "", "", 0, ErrUnknownTenant
	}
	slot, ok := t.Slots[strings.ToLower(strings.TrimSpace(operatorEmail))]
	if !ok || slot <= 0 {
		return "", "", 0, ErrUnknownOperator
	}
	return t.Namespace, t.Deployment, slot, nil
}

// WriteWorkspaceCredentials writes the per-operator Secret in the
// customer pod's namespace + bumps the Deployment's restart annotation
// so the sidecar picks up the new bootstrap files. The sidecar (v0.2.0+)
// also supports SIGHUP, but rollout-restart is simpler from this side
// and the once-per-consent latency cost is acceptable. Returns the
// resolved namespace + slot so callers can audit.
func (w *WorkspaceWriter) WriteWorkspaceCredentials(
	ctx context.Context,
	channelID, operatorEmail, clientID, clientSecret, refreshToken string,
) (namespace string, slot int, err error) {
	if w.Disabled() {
		return "", 0, ErrWorkspaceWriterDisabled
	}
	ns, deploy, slot, err := w.resolveTenant(channelID, operatorEmail)
	if err != nil {
		return "", 0, err
	}

	name := fmt.Sprintf("gws-mcp-oauth-slot-%d", slot)
	secret := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: ns,
			Labels: map[string]string{
				"app.kubernetes.io/managed-by": "makeacompany-ai",
				"bimross.com/workspace-slot":   fmt.Sprintf("%d", slot),
			},
			Annotations: map[string]string{
				"bimross.com/operator-email": strings.ToLower(strings.TrimSpace(operatorEmail)),
				"bimross.com/consented-at":   time.Now().UTC().Format(time.RFC3339),
			},
		},
		Type: corev1.SecretTypeOpaque,
		Data: map[string][]byte{
			"client_id":     []byte(clientID),
			"client_secret": []byte(clientSecret),
			"refresh_token": []byte(refreshToken),
		},
	}

	_, err = w.cs.CoreV1().Secrets(ns).Create(ctx, secret, metav1.CreateOptions{})
	if apierrors.IsAlreadyExists(err) {
		_, err = w.cs.CoreV1().Secrets(ns).Update(ctx, secret, metav1.UpdateOptions{})
	}
	if err != nil {
		return ns, slot, fmt.Errorf("write secret %s/%s: %w", ns, name, err)
	}

	// Trigger pod restart so the sidecar's bootstrap volume picks up the
	// new Secret. The sidecar itself supports SIGHUP for hot reloads
	// (v0.2.0+, gws-mcp#16), but that requires pods/exec which is broader
	// RBAC than just secrets+deployments. Rollout-restart costs ~80s of
	// downtime under the Recreate strategy + RWO PVC, but consent events
	// are rare. Worth revisiting if multi-operator pods see frequent joins.
	patch := fmt.Sprintf(
		`{"spec":{"template":{"metadata":{"annotations":{"bimross.com/restartedAt":%q}}}}}`,
		time.Now().UTC().Format(time.RFC3339),
	)
	_, err = w.cs.AppsV1().Deployments(ns).Patch(
		ctx, deploy, types.StrategicMergePatchType, []byte(patch), metav1.PatchOptions{},
	)
	if err != nil {
		// Secret was written; restart failed. Sidecar will pick up the
		// new Secret on its next pod restart (eventually), so this is a
		// soft failure. Surface to audit log.
		return ns, slot, fmt.Errorf("patch deployment %s/%s: %w", ns, deploy, err)
	}

	return ns, slot, nil
}

// WorkspaceCredentialSummary is one connected-operator entry returned by
// ListWorkspaceCredentials. Email comes from the Secret annotation written
// by WriteWorkspaceCredentials, not the static tenant slot map — so an
// operator with a Secret but no slot in the map (stale entry from a
// removed-then-re-added operator, say) still surfaces. Slot is from the
// Secret label so a re-numbered tenant doesn't drop entries.
type WorkspaceCredentialSummary struct {
	Email string `json:"email"`
	Slot  int    `json:"slot"`
}

// ListWorkspaceCredentials returns one entry per existing slot Secret in
// the tenant's namespace. Used by /v1/portal/workspace/status to render
// the connect panel's "connected operators" list. Returns ErrUnknownTenant
// if the channelId is not in the tenant config — the status endpoint
// surfaces this as 404 so the panel falls back to the connect button.
func (w *WorkspaceWriter) ListWorkspaceCredentials(
	ctx context.Context,
	channelID string,
) (namespace string, operators []WorkspaceCredentialSummary, err error) {
	if w.Disabled() {
		return "", nil, ErrWorkspaceWriterDisabled
	}
	t, ok := w.tenants[strings.TrimSpace(channelID)]
	if !ok {
		return "", nil, ErrUnknownTenant
	}
	list, err := w.cs.CoreV1().Secrets(t.Namespace).List(ctx, metav1.ListOptions{
		LabelSelector: "app.kubernetes.io/managed-by=makeacompany-ai",
	})
	if err != nil {
		return t.Namespace, nil, fmt.Errorf("list secrets %s: %w", t.Namespace, err)
	}
	out := make([]WorkspaceCredentialSummary, 0, len(list.Items))
	for _, s := range list.Items {
		if !strings.HasPrefix(s.Name, "gws-mcp-oauth-slot-") {
			continue
		}
		email := strings.TrimSpace(s.Annotations["bimross.com/operator-email"])
		slot := 0
		if v := strings.TrimSpace(s.Labels["bimross.com/workspace-slot"]); v != "" {
			// Best-effort parse; an unparseable slot is still listed as 0
			// so callers see *something* rather than dropping the row.
			fmt.Sscanf(v, "%d", &slot)
		}
		if email == "" {
			continue
		}
		out = append(out, WorkspaceCredentialSummary{Email: email, Slot: slot})
	}
	return t.Namespace, out, nil
}

// DeleteWorkspaceCredentials wipes the per-operator Secret + triggers a
// pod restart. Used by /v1/portal/workspace/disconnect.
func (w *WorkspaceWriter) DeleteWorkspaceCredentials(
	ctx context.Context,
	channelID, operatorEmail string,
) (namespace string, slot int, err error) {
	if w.Disabled() {
		return "", 0, ErrWorkspaceWriterDisabled
	}
	ns, deploy, slot, err := w.resolveTenant(channelID, operatorEmail)
	if err != nil {
		return "", 0, err
	}
	name := fmt.Sprintf("gws-mcp-oauth-slot-%d", slot)
	err = w.cs.CoreV1().Secrets(ns).Delete(ctx, name, metav1.DeleteOptions{})
	if err != nil && !apierrors.IsNotFound(err) {
		return ns, slot, fmt.Errorf("delete secret %s/%s: %w", ns, name, err)
	}
	patch := fmt.Sprintf(
		`{"spec":{"template":{"metadata":{"annotations":{"bimross.com/restartedAt":%q}}}}}`,
		time.Now().UTC().Format(time.RFC3339),
	)
	_, err = w.cs.AppsV1().Deployments(ns).Patch(
		ctx, deploy, types.StrategicMergePatchType, []byte(patch), metav1.PatchOptions{},
	)
	if err != nil {
		return ns, slot, fmt.Errorf("patch deployment %s/%s: %w", ns, deploy, err)
	}
	return ns, slot, nil
}
