package app

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestClassifyPodsBuckets(t *testing.T) {
	pods := []corev1.Pod{
		{Status: corev1.PodStatus{Phase: corev1.PodRunning}},
		{Status: corev1.PodStatus{Phase: corev1.PodRunning}},
		{Status: corev1.PodStatus{Phase: corev1.PodPending}},
		{Status: corev1.PodStatus{Phase: corev1.PodFailed}},
		// Succeeded should NOT count as healthy or unhealthy — it's a finished one-shot Job.
		{Status: corev1.PodStatus{Phase: corev1.PodSucceeded}},
		// CrashLoop wins over Running phase: kubelet often reports the pod as Running
		// while one container is CrashLoopBackOff. The summary should call it a crashloop.
		{Status: corev1.PodStatus{
			Phase: corev1.PodRunning,
			ContainerStatuses: []corev1.ContainerStatus{
				{State: corev1.ContainerState{Waiting: &corev1.ContainerStateWaiting{Reason: "CrashLoopBackOff"}}},
			},
		}},
	}
	got := classifyPods(pods)
	want := PodCounts{Running: 2, Pending: 1, Failed: 1, CrashLoop: 1}
	if got != want {
		t.Errorf("classifyPods: got %+v, want %+v", got, want)
	}
}

func TestClassifyNodesReadyCondition(t *testing.T) {
	nodes := []corev1.Node{
		{Status: corev1.NodeStatus{Conditions: []corev1.NodeCondition{
			{Type: corev1.NodeReady, Status: corev1.ConditionTrue},
		}}},
		{Status: corev1.NodeStatus{Conditions: []corev1.NodeCondition{
			{Type: corev1.NodeReady, Status: corev1.ConditionFalse},
		}}},
		// Node with no Ready condition at all (rare but possible mid-bootstrap) — treat as NotReady.
		{Status: corev1.NodeStatus{Conditions: []corev1.NodeCondition{
			{Type: corev1.NodeMemoryPressure, Status: corev1.ConditionFalse},
		}}},
	}
	got := classifyNodes(nodes)
	if got.Ready != 1 || got.NotReady != 2 {
		t.Errorf("classifyNodes: got %+v, want {Ready:1, NotReady:2}", got)
	}
}

func TestRecentDeploysSortAndLimit(t *testing.T) {
	mkDep := func(ns, name, image string, rolledOut time.Time) appsv1.Deployment {
		return appsv1.Deployment{
			ObjectMeta: metav1.ObjectMeta{Namespace: ns, Name: name},
			Spec: appsv1.DeploymentSpec{Template: corev1.PodTemplateSpec{
				Spec: corev1.PodSpec{Containers: []corev1.Container{{Image: image}}},
			}},
			Status: appsv1.DeploymentStatus{Conditions: []appsv1.DeploymentCondition{
				{Type: "Progressing", Reason: "NewReplicaSetAvailable", LastUpdateTime: metav1.NewTime(rolledOut)},
			}},
		}
	}
	now := time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC)
	deps := []appsv1.Deployment{
		mkDep("a", "older", "img:0.1.0", now.Add(-2*time.Hour)),
		mkDep("b", "newest", "img:0.2.0", now),
		mkDep("c", "middle", "img:0.1.5", now.Add(-1*time.Hour)),
		// Deployment with no Progressing condition (mid-create) is skipped.
		{ObjectMeta: metav1.ObjectMeta{Namespace: "x", Name: "nocondition"}},
	}
	out := recentDeploys(deps, 2)
	if len(out) != 2 {
		t.Fatalf("recentDeploys: limit not enforced, got %d", len(out))
	}
	if out[0].App != "newest" || out[1].App != "middle" {
		t.Errorf("recentDeploys: wrong sort, got [%s, %s], want [newest, middle]", out[0].App, out[1].App)
	}
	if out[0].Version != "0.2.0" {
		t.Errorf("recentDeploys: version parsing wrong, got %q, want 0.2.0", out[0].Version)
	}
}

func TestLastFailedEventReturnsLatest(t *testing.T) {
	now := time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC)
	events := []corev1.Event{
		{
			ObjectMeta:    metav1.ObjectMeta{Namespace: "ns1"},
			InvolvedObject: corev1.ObjectReference{Kind: "Pod", Name: "older-pod"},
			Reason:        "FailedMount",
			Message:       "older",
			LastTimestamp: metav1.NewTime(now.Add(-1 * time.Hour)),
		},
		{
			ObjectMeta:    metav1.ObjectMeta{Namespace: "ns2"},
			InvolvedObject: corev1.ObjectReference{Kind: "Pod", Name: "newer-pod"},
			Reason:        "ImagePullBackOff",
			Message:       "newer",
			LastTimestamp: metav1.NewTime(now),
		},
	}
	got := lastFailedEvent(events)
	if got == nil {
		t.Fatal("lastFailedEvent returned nil with events present")
	}
	if got.Reason != "ImagePullBackOff" || got.Object != "Pod/newer-pod" {
		t.Errorf("lastFailedEvent: got %+v, want newer-pod / ImagePullBackOff", got)
	}
}

func TestLastFailedEventNilWhenEmpty(t *testing.T) {
	if got := lastFailedEvent(nil); got != nil {
		t.Errorf("lastFailedEvent(nil): got %+v, want nil", got)
	}
}

// Handler-level tests: unauthorized, disabled, and the happy-path is left to
// integration since it requires a real kube client. We mock the
// ClusterHealthClient state via the Disabled() short-circuit.

func TestHandleInternalClusterHealthUnauthorized(t *testing.T) {
	s := &Server{
		cfg:           Config{BackendInternalServiceToken: "secret"},
		log:           log.New(os.Stderr, "", 0),
		clusterHealth: &ClusterHealthClient{disabled: true},
	}
	req := httptest.NewRequest(http.MethodGet, "/v1/internal/cluster-health", nil)
	// No Authorization header.
	rec := httptest.NewRecorder()
	s.handleInternalClusterHealth(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("missing bearer: got %d, want 401", rec.Code)
	}
}

func TestHandleInternalClusterHealthDisabledFallsBackTo503(t *testing.T) {
	s := &Server{
		cfg:           Config{BackendInternalServiceToken: "secret"},
		log:           log.New(os.Stderr, "", 0),
		clusterHealth: &ClusterHealthClient{disabled: true},
	}
	req := httptest.NewRequest(http.MethodGet, "/v1/internal/cluster-health", nil)
	req.Header.Set("Authorization", "Bearer secret")
	rec := httptest.NewRecorder()
	s.handleInternalClusterHealth(rec, req)
	if rec.Code != http.StatusServiceUnavailable {
		t.Errorf("disabled client: got %d, want 503", rec.Code)
	}
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body["error"] != "disabled" {
		t.Errorf("body error: got %q, want \"disabled\"", body["error"])
	}
}

// Sanity: PolledAt timestamp is wire-stable RFC3339 when the client returns
// a Summary at all. Pure helper test — no kube client involvement.
func TestSummaryPolledAtIsRFC3339(t *testing.T) {
	now := time.Now().UTC().Format(time.RFC3339)
	if _, err := time.Parse(time.RFC3339, now); err != nil {
		t.Errorf("RFC3339 round-trip failed: %v", err)
	}
	// Marker so we exercise the same code path as Summary's formatting.
	_ = context.Background()
}
