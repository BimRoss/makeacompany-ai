package app

import (
	"context"
	"log"
	"testing"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
)

// seedDeployments creates two managed personal-agent Deployments + one
// unmanaged decoy in the same namespace so we can verify the label selector.
func seedDeployments(t *testing.T) (*fake.Clientset, *Server) {
	t.Helper()
	managedLabels := map[string]string{
		"app.kubernetes.io/managed-by": personalAgentManagedByLabelValue,
	}
	mk := func(name, image string, labels map[string]string) *appsv1.Deployment {
		return &appsv1.Deployment{
			ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: "personal-agents", Labels: labels},
			Spec: appsv1.DeploymentSpec{
				Template: corev1.PodTemplateSpec{
					Spec: corev1.PodSpec{
						Containers: []corev1.Container{{Name: "personal-agent", Image: image}},
					},
				},
			},
		}
	}
	cs := fake.NewSimpleClientset(
		mk("personal-agent-A", "img:old", managedLabels),
		mk("personal-agent-B", "img:new", managedLabels),
		mk("unmanaged-decoy", "img:other", nil),
	)
	w := newPersonalAgentWriterWithClient(cs, "personal-agents", "", "")
	srv := &Server{
		log:           log.Default(),
		personalAgent: w,
		cfg:           Config{PersonalAgentImage: "img:new"},
	}
	return cs, srv
}

func TestReconcilePersonalAgentImages_BumpsDriftedImages(t *testing.T) {
	cs, srv := seedDeployments(t)
	result := srv.reconcilePersonalAgentImages(context.Background(), false)
	if result.Inspected != 2 {
		t.Errorf("Inspected = %d, want 2 (label selector should ignore decoy)", result.Inspected)
	}
	if result.ImageBumped != 1 {
		t.Errorf("ImageBumped = %d, want 1 (only A had drifted)", result.ImageBumped)
	}
	if result.Restarted != 0 {
		t.Errorf("Restarted = %d, want 0 (force=false)", result.Restarted)
	}
	got, _ := cs.AppsV1().Deployments("personal-agents").Get(context.Background(), "personal-agent-A", metav1.GetOptions{})
	if got.Spec.Template.Spec.Containers[0].Image != "img:new" {
		t.Errorf("A image after reconcile = %q, want img:new", got.Spec.Template.Spec.Containers[0].Image)
	}
	if got.Spec.Template.Annotations["bimross.com/last-reconciled-at"] == "" {
		t.Errorf("expected last-reconciled-at annotation on patched pod template")
	}
}

func TestReconcilePersonalAgentImages_ForceRestartsEvenWhenImageMatches(t *testing.T) {
	cs, srv := seedDeployments(t)
	result := srv.reconcilePersonalAgentImages(context.Background(), true)
	if result.Restarted != 2 {
		t.Errorf("Restarted = %d, want 2 (force=true on both managed)", result.Restarted)
	}
	// B's image hasn't changed; force-restart annotation should still bump.
	got, _ := cs.AppsV1().Deployments("personal-agents").Get(context.Background(), "personal-agent-B", metav1.GetOptions{})
	if got.Spec.Template.Annotations["bimross.com/last-reconciled-at"] == "" {
		t.Errorf("expected last-reconciled-at annotation on B even though image didn't change")
	}
}

func TestReconcilePersonalAgentImages_NoopOnDisabledWriter(t *testing.T) {
	srv := &Server{log: log.Default(), personalAgent: nil, cfg: Config{PersonalAgentImage: "img:new"}}
	r := srv.reconcilePersonalAgentImages(context.Background(), true)
	if r.Inspected != 0 || r.ImageBumped != 0 || r.Restarted != 0 {
		t.Errorf("expected zero work when writer is disabled, got %+v", r)
	}
}
