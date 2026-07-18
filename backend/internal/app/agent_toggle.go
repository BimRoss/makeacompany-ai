package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
)

// agentTarget pins one toggleable agent to a specific Deployment.
// Hard-coded so it matches the RBAC `resourceNames` whitelist —
// adding a new agent here also requires adding a Role/RoleBinding
// in `rancher-admin/admin/apps/makeacompany-ai/agent-toggle-rbac.yaml`.
//
// GoogleSecret/GoogleEmail wire the admin-gated Google Workspace re-auth
// flow (mirror of the /me PA connect). GoogleSecret is the pre-existing
// gws-mcp-oauth Secret the pod's token sidecar reads; empty means the
// agent has no browser Google connect. GoogleEmail is the consent identity
// the admin is expected to authorize (cosmetic hint for the UI).
type agentTarget struct {
	Namespace    string
	Deployment   string
	GoogleSecret string
	GoogleEmail  string
}

var agentTargets = map[string]agentTarget{
	"ross": {
		Namespace:    "claude-code-ross-prod",
		Deployment:   "claude-code-ross",
		GoogleSecret: "gws-mcp-oauth-ross",
		GoogleEmail:  "ross@bimross.com",
	},
	"joanne": {
		Namespace:    "claude-code-joanne-prod",
		Deployment:   "claude-code-joanne",
		GoogleSecret: "gws-mcp-oauth-joanne",
		GoogleEmail:  "joanne@bimross.com",
	},
}

// Keys the gws-mcp-token-sidecar reads out of the per-agent Google OAuth
// Secret (matches the sidecar's *_FILE env contract + the PA flow's
// personalAgentGoogleSecretKey* constants). Lowercase, opaque Secret.
const (
	agentGoogleSecretKeyClientID     = "client_id"
	agentGoogleSecretKeyClientSecret = "client_secret"
	agentGoogleSecretKeyRefreshToken = "refresh_token"

	// Annotation stamped on the Secret each time an admin re-connects, so a
	// human can see when the token was last refreshed.
	agentGoogleAnnoConnectedAt = "makeacompany.ai/google-connected-at"
)

// AgentToggleClient scales the ross/joanne prod Deployments between 0 and 1
// to provide a from-anywhere kill switch on `/admin`. See makeacompany-ai#215.
type AgentToggleClient struct {
	// kubernetes.Interface (not the concrete *Clientset) so tests can inject a
	// fake clientset — matches PersonalAgentWriter.cs.
	cs       kubernetes.Interface
	disabled bool
}

var ErrAgentToggleDisabled = errors.New("agent toggle disabled (no in-cluster config)")
var ErrUnknownAgent = errors.New("unknown agent name")

func NewAgentToggleClient() (*AgentToggleClient, error) {
	cfg, err := rest.InClusterConfig()
	if err != nil {
		return &AgentToggleClient{disabled: true}, nil
	}
	cs, err := kubernetes.NewForConfig(cfg)
	if err != nil {
		return nil, fmt.Errorf("k8s clientset: %w", err)
	}
	return &AgentToggleClient{cs: cs}, nil
}

func (c *AgentToggleClient) Disabled() bool { return c == nil || c.disabled }

// AgentStatus is the wire shape returned to /admin. State derives from
// spec replicas + readyReplicas so the UI can show "killed" distinct
// from "down for some other reason" (image pull, crashloop, etc).
type AgentStatus struct {
	Name      string `json:"name"`
	State     string `json:"state"`            // "live" | "down" | "starting" | "unhealthy"
	Replicas  int32  `json:"replicas"`         // .spec.replicas
	Ready     int32  `json:"ready"`            // .status.readyReplicas
	Reason    string `json:"reason,omitempty"` // human-readable hint when state != "live"
	UpdatedAt string `json:"updatedAt"`
	// Google Workspace connect state (admin re-auth flow). GoogleEmail is the
	// expected consent identity; empty means the agent has no Google connect
	// and the UI should hide the Connect button. GoogleConnected reflects
	// whether the gws-mcp-oauth Secret currently holds usable credentials.
	GoogleEmail     string `json:"googleEmail,omitempty"`
	GoogleConnected bool   `json:"googleConnected"`
}

func (c *AgentToggleClient) Status(ctx context.Context, name string) (*AgentStatus, error) {
	if c.Disabled() {
		return nil, ErrAgentToggleDisabled
	}
	target, ok := agentTargets[name]
	if !ok {
		return nil, ErrUnknownAgent
	}
	d, err := c.cs.AppsV1().Deployments(target.Namespace).Get(ctx, target.Deployment, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("get deployment %s/%s: %w", target.Namespace, target.Deployment, err)
	}
	spec := int32(0)
	if d.Spec.Replicas != nil {
		spec = *d.Spec.Replicas
	}
	ready := d.Status.ReadyReplicas
	state, reason := classifyAgentState(spec, ready, d.Status.UnavailableReplicas)
	st := &AgentStatus{
		Name:      name,
		State:     state,
		Replicas:  spec,
		Ready:     ready,
		Reason:    reason,
		UpdatedAt: time.Now().UTC().Format(time.RFC3339),
	}
	// Google connect state is best-effort: a read failure on the Secret must
	// not fail the whole status call (the kill switch must still render).
	if target.GoogleSecret != "" {
		st.GoogleEmail = target.GoogleEmail
		connected, err := c.googleConnected(ctx, target)
		if err != nil {
			c.log("agent %q google status read: %v", name, err)
		}
		st.GoogleConnected = connected
	}
	return st, nil
}

// log is a nil-safe internal logger. AgentToggleClient has no *log.Logger of
// its own; Google-status read errors are non-fatal, so we route them to stderr
// via the standard log package rather than plumb the Server logger down here.
func (c *AgentToggleClient) log(format string, args ...any) {
	log.Printf(format, args...)
}

// googleConnected reports whether the agent's gws-mcp-oauth Secret currently
// holds usable credentials (client_id + refresh_token present and non-empty).
// A missing Secret or any get error yields (false, err) — the caller treats
// false as "not connected" and swallows the error into a log line.
func (c *AgentToggleClient) googleConnected(ctx context.Context, target agentTarget) (bool, error) {
	if target.GoogleSecret == "" {
		return false, nil
	}
	sec, err := c.cs.CoreV1().Secrets(target.Namespace).Get(ctx, target.GoogleSecret, metav1.GetOptions{})
	if err != nil {
		if apierrors.IsNotFound(err) {
			return false, nil
		}
		return false, fmt.Errorf("get google secret %s/%s: %w", target.Namespace, target.GoogleSecret, err)
	}
	// Real API server moves StringData→Data; the fake clientset keeps
	// StringData. Check both so unit tests and prod agree.
	val := func(key string) string {
		if v, ok := sec.Data[key]; ok {
			return strings.TrimSpace(string(v))
		}
		if v, ok := sec.StringData[key]; ok {
			return strings.TrimSpace(v)
		}
		return ""
	}
	return val(agentGoogleSecretKeyClientID) != "" && val(agentGoogleSecretKeyRefreshToken) != "", nil
}

// WriteAgentGoogleCredentials re-writes the EXISTING gws-mcp-oauth Secret for
// the named system agent with the DCR client + refresh token captured by the
// admin consent dance, then rolls the agent Deployment so the token sidecar
// remounts and re-reads them.
//
// It PATCHes (strategic-merge) the named Secret rather than creating it — the
// backend SA's RBAC is resourceName-scoped to that one Secret with verbs
// get/update/patch, so a create (which needs list/create on the collection)
// would be forbidden. The Secret is provisioned via GitOps
// (rancher-admin oauth-sidecar.yaml); this flow only ever refreshes it.
func (c *AgentToggleClient) WriteAgentGoogleCredentials(ctx context.Context, name, clientID, clientSecret, refreshToken string) error {
	if c.Disabled() {
		return ErrAgentToggleDisabled
	}
	target, ok := agentTargets[name]
	if !ok {
		return ErrUnknownAgent
	}
	if target.GoogleSecret == "" {
		return fmt.Errorf("%w: %q has no Google connect", ErrUnknownAgent, name)
	}
	clientID = strings.TrimSpace(clientID)
	clientSecret = strings.TrimSpace(clientSecret)
	refreshToken = strings.TrimSpace(refreshToken)
	if clientID == "" || clientSecret == "" || refreshToken == "" {
		return errors.New("WriteAgentGoogleCredentials: client_id + client_secret + refresh_token required")
	}

	now := time.Now().UTC().Format(time.RFC3339)
	// Strategic-merge patch on the named Secret: stringData overwrites the
	// three credential keys, plus a connected-at annotation. Works under
	// name-scoped RBAC (verb patch on that resourceName).
	secretPatch, err := json.Marshal(map[string]any{
		"metadata": map[string]any{
			"annotations": map[string]any{agentGoogleAnnoConnectedAt: now},
		},
		"stringData": map[string]any{
			agentGoogleSecretKeyClientID:     clientID,
			agentGoogleSecretKeyClientSecret: clientSecret,
			agentGoogleSecretKeyRefreshToken: refreshToken,
		},
	})
	if err != nil {
		return fmt.Errorf("marshal secret patch: %w", err)
	}
	if _, err := c.cs.CoreV1().Secrets(target.Namespace).Patch(
		ctx, target.GoogleSecret, types.StrategicMergePatchType, secretPatch, metav1.PatchOptions{},
	); err != nil {
		if apierrors.IsForbidden(err) {
			return fmt.Errorf("forbidden — check RBAC for backend SA on secret %s/%s: %w", target.Namespace, target.GoogleSecret, err)
		}
		return fmt.Errorf("patch google secret %s/%s: %w", target.Namespace, target.GoogleSecret, err)
	}

	// Roll the Deployment so the sidecar remounts + re-reads the Secret.
	// Strategic-merge patch on spec.template.metadata.annotations — same
	// restartedAt convention `kubectl rollout restart` uses.
	deployPatch, err := json.Marshal(map[string]any{
		"spec": map[string]any{
			"template": map[string]any{
				"metadata": map[string]any{
					"annotations": map[string]any{"kubectl.kubernetes.io/restartedAt": now},
				},
			},
		},
	})
	if err != nil {
		return fmt.Errorf("marshal restart patch: %w", err)
	}
	if _, err := c.cs.AppsV1().Deployments(target.Namespace).Patch(
		ctx, target.Deployment, types.StrategicMergePatchType, deployPatch, metav1.PatchOptions{},
	); err != nil {
		if apierrors.IsForbidden(err) {
			return fmt.Errorf("forbidden — check RBAC for backend SA on deployment %s/%s: %w", target.Namespace, target.Deployment, err)
		}
		return fmt.Errorf("patch deployment restart %s/%s: %w", target.Namespace, target.Deployment, err)
	}
	return nil
}

func classifyAgentState(spec, ready, unavailable int32) (string, string) {
	if spec == 0 {
		return "down", "killed via toggle"
	}
	if ready >= spec {
		return "live", ""
	}
	if unavailable > 0 {
		return "unhealthy", "pod not ready (check crashloop / image pull)"
	}
	return "starting", "pod coming up"
}

// Toggle flips .spec.replicas between 0 and 1 via a strategic-merge patch
// on the deployments/scale subresource. Returns the post-toggle status.
// Idempotent within the bounds the UI expects: calling twice returns to
// the original state.
func (c *AgentToggleClient) Toggle(ctx context.Context, name string) (*AgentStatus, error) {
	if c.Disabled() {
		return nil, ErrAgentToggleDisabled
	}
	target, ok := agentTargets[name]
	if !ok {
		return nil, ErrUnknownAgent
	}
	current, err := c.cs.AppsV1().Deployments(target.Namespace).Get(ctx, target.Deployment, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("get deployment %s/%s: %w", target.Namespace, target.Deployment, err)
	}
	currentSpec := int32(0)
	if current.Spec.Replicas != nil {
		currentSpec = *current.Spec.Replicas
	}
	next := int32(1)
	if currentSpec > 0 {
		next = 0
	}
	patch, err := json.Marshal(map[string]any{"spec": map[string]any{"replicas": next}})
	if err != nil {
		return nil, fmt.Errorf("marshal scale patch: %w", err)
	}
	if _, err := c.cs.AppsV1().Deployments(target.Namespace).Patch(
		ctx, target.Deployment, types.StrategicMergePatchType, patch, metav1.PatchOptions{}, "scale",
	); err != nil {
		if apierrors.IsForbidden(err) {
			return nil, fmt.Errorf("forbidden — check RBAC for SA agent-toggle on %s/%s: %w", target.Namespace, target.Deployment, err)
		}
		return nil, fmt.Errorf("patch scale %s/%s: %w", target.Namespace, target.Deployment, err)
	}
	return c.Status(ctx, name)
}

// AgentTargetNames returns the sorted list of known agent names.
func AgentTargetNames() []string {
	out := make([]string, 0, len(agentTargets))
	for k := range agentTargets {
		out = append(out, k)
	}
	// Deterministic order so /status always returns ross before joanne.
	for i := range out {
		for j := i + 1; j < len(out); j++ {
			if strings.Compare(out[i], out[j]) > 0 {
				out[i], out[j] = out[j], out[i]
			}
		}
	}
	return out
}
