package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
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
// in `rancher-admin/admin/apps/bimross-website/rbac-agent-toggle.yaml`.
type agentTarget struct {
	Namespace  string
	Deployment string
}

var agentTargets = map[string]agentTarget{
	"ross":   {Namespace: "claude-code-ross-prod", Deployment: "claude-code-ross"},
	"joanne": {Namespace: "claude-code-joanne-prod", Deployment: "claude-code-joanne"},
}

// AgentToggleClient scales the ross/joanne prod Deployments between 0 and 1
// to provide a from-anywhere kill switch on `/admin`. See makeacompany-ai#215.
type AgentToggleClient struct {
	cs       *kubernetes.Clientset
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
	Name       string `json:"name"`
	State      string `json:"state"`              // "live" | "down" | "starting" | "unhealthy"
	Replicas   int32  `json:"replicas"`           // .spec.replicas
	Ready      int32  `json:"ready"`              // .status.readyReplicas
	Reason     string `json:"reason,omitempty"`   // human-readable hint when state != "live"
	UpdatedAt  string `json:"updatedAt"`
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
	return &AgentStatus{
		Name:      name,
		State:     state,
		Replicas:  spec,
		Ready:     ready,
		Reason:    reason,
		UpdatedAt: time.Now().UTC().Format(time.RFC3339),
	}, nil
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
