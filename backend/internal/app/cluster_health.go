package app

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
)

// ClusterHealthClient returns a sanitized, read-only summary of the cluster
// for the sales-pod health bar (makeacompany-ai#290). Lists pods/nodes/events
// cluster-wide via list-only RBAC — no exec, no secrets, no logs. The
// returned shape is intentionally a small JSON blob, not raw kube state, so
// callers don't need cluster-admin to render the row.
type ClusterHealthClient struct {
	cs       *kubernetes.Clientset
	disabled bool
}

var ErrClusterHealthDisabled = errors.New("cluster-health disabled (no in-cluster config)")

func NewClusterHealthClient() (*ClusterHealthClient, error) {
	cfg, err := rest.InClusterConfig()
	if err != nil {
		// Out-of-cluster (local dev): nil-safe disabled stub. Handler returns 503.
		return &ClusterHealthClient{disabled: true}, nil
	}
	cs, err := kubernetes.NewForConfig(cfg)
	if err != nil {
		return nil, fmt.Errorf("k8s clientset: %w", err)
	}
	return &ClusterHealthClient{cs: cs}, nil
}

func (c *ClusterHealthClient) Disabled() bool { return c == nil || c.disabled }

// ClusterHealthSummary matches the JSON contract documented in
// makeacompany-ai#290. Field names are wire-stable.
type ClusterHealthSummary struct {
	Pods           PodCounts       `json:"pods"`
	Nodes          NodeCounts      `json:"nodes"`
	RecentDeploys  []RecentDeploy  `json:"recent_deploys"`
	LastFailedEvent *FailedEvent   `json:"last_failed_event"`
	PolledAt       string          `json:"polled_at"`
}

type PodCounts struct {
	Running    int `json:"running"`
	Pending    int `json:"pending"`
	Failed     int `json:"failed"`
	CrashLoop  int `json:"crashloop"`
}

type NodeCounts struct {
	Ready    int `json:"ready"`
	NotReady int `json:"not_ready"`
}

type RecentDeploy struct {
	App          string `json:"app"`
	Namespace    string `json:"namespace"`
	Version      string `json:"version"`
	RolledOutAt  string `json:"rolled_out_at"`
}

type FailedEvent struct {
	Namespace string `json:"namespace"`
	Object    string `json:"object"`
	Reason    string `json:"reason"`
	Message   string `json:"message"`
	OccurredAt string `json:"occurred_at"`
}

// Summary collects the four sub-readings concurrently is overkill for this
// size; serial is fine and keeps the failure modes obvious.
func (c *ClusterHealthClient) Summary(ctx context.Context) (*ClusterHealthSummary, error) {
	if c.Disabled() {
		return nil, ErrClusterHealthDisabled
	}

	pods, err := c.cs.CoreV1().Pods("").List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("list pods: %w", err)
	}
	nodes, err := c.cs.CoreV1().Nodes().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("list nodes: %w", err)
	}
	deps, err := c.cs.AppsV1().Deployments("").List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("list deployments: %w", err)
	}
	events, err := c.cs.CoreV1().Events("").List(ctx, metav1.ListOptions{
		FieldSelector: "type=Warning",
	})
	if err != nil {
		return nil, fmt.Errorf("list events: %w", err)
	}

	out := &ClusterHealthSummary{
		Pods:          classifyPods(pods.Items),
		Nodes:         classifyNodes(nodes.Items),
		RecentDeploys: recentDeploys(deps.Items, 5),
		LastFailedEvent: lastFailedEvent(events.Items),
		PolledAt:      time.Now().UTC().Format(time.RFC3339),
	}
	return out, nil
}

// classifyPods buckets pods into running/pending/failed/crashloop.
// CrashLoop is detected via container statuses (a pod can be Phase=Running
// while one of its containers is in CrashLoopBackOff — counts as crashloop).
func classifyPods(items []corev1.Pod) PodCounts {
	var out PodCounts
	for _, p := range items {
		if isCrashLoop(p) {
			out.CrashLoop++
			continue
		}
		switch p.Status.Phase {
		case corev1.PodRunning:
			out.Running++
		case corev1.PodPending:
			out.Pending++
		case corev1.PodFailed:
			out.Failed++
		}
		// Succeeded (one-shot Jobs that completed cleanly) is intentionally
		// uncounted — it's not a health signal.
	}
	return out
}

func isCrashLoop(p corev1.Pod) bool {
	for _, cs := range p.Status.ContainerStatuses {
		if cs.State.Waiting != nil && cs.State.Waiting.Reason == "CrashLoopBackOff" {
			return true
		}
	}
	return false
}

func classifyNodes(items []corev1.Node) NodeCounts {
	var out NodeCounts
	for _, n := range items {
		ready := false
		for _, c := range n.Status.Conditions {
			if c.Type == corev1.NodeReady && c.Status == corev1.ConditionTrue {
				ready = true
				break
			}
		}
		if ready {
			out.Ready++
		} else {
			out.NotReady++
		}
	}
	return out
}

// recentDeploys returns the N most-recently-rolled-out Deployments, derived
// from the conditions[type=Progressing,reason=NewReplicaSetAvailable]
// LastUpdateTime. Version comes from the first container's image tag
// (after the last colon) — matches how rancher-admin manifests are written.
func recentDeploys(items []appsv1.Deployment, limit int) []RecentDeploy {
	out := make([]RecentDeploy, 0, len(items))
	for _, d := range items {
		var rolledOut time.Time
		for _, c := range d.Status.Conditions {
			if c.Type == "Progressing" && c.Reason == "NewReplicaSetAvailable" {
				rolledOut = c.LastUpdateTime.Time
				break
			}
		}
		if rolledOut.IsZero() {
			continue
		}
		version := ""
		if len(d.Spec.Template.Spec.Containers) > 0 {
			img := d.Spec.Template.Spec.Containers[0].Image
			if i := strings.LastIndex(img, ":"); i >= 0 && i < len(img)-1 {
				version = img[i+1:]
			}
		}
		out = append(out, RecentDeploy{
			App:         d.Name,
			Namespace:   d.Namespace,
			Version:     version,
			RolledOutAt: rolledOut.UTC().Format(time.RFC3339),
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].RolledOutAt > out[j].RolledOutAt })
	if len(out) > limit {
		out = out[:limit]
	}
	return out
}

// lastFailedEvent returns the most recent Warning-type event, or nil if none.
// "Failed" in the ticket vocabulary means anything the kubelet/controller
// surfaced as Warning (FailedMount, ImagePullBackOff, FailedScheduling, etc).
func lastFailedEvent(items []corev1.Event) *FailedEvent {
	var latest *corev1.Event
	for i := range items {
		e := &items[i]
		ts := eventTimestamp(e)
		if latest == nil || ts.After(eventTimestamp(latest)) {
			latest = e
		}
	}
	if latest == nil {
		return nil
	}
	return &FailedEvent{
		Namespace:  latest.Namespace,
		Object:     fmt.Sprintf("%s/%s", latest.InvolvedObject.Kind, latest.InvolvedObject.Name),
		Reason:     latest.Reason,
		Message:    latest.Message,
		OccurredAt: eventTimestamp(latest).UTC().Format(time.RFC3339),
	}
}

func eventTimestamp(e *corev1.Event) time.Time {
	// LastTimestamp is preferred (counter-aware); EventTime is the newer
	// events.k8s.io API field — fall back if older API objects show up.
	if !e.LastTimestamp.IsZero() {
		return e.LastTimestamp.Time
	}
	if !e.EventTime.IsZero() {
		return e.EventTime.Time
	}
	return e.FirstTimestamp.Time
}
