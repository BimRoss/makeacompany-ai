package app

import (
	"context"
	"strings"
	"testing"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
)

// seedAgentGoogleFixtures creates the ross gws-mcp-oauth Secret (empty) and the
// ross Deployment so WriteAgentGoogleCredentials can patch them.
func seedAgentGoogleFixtures() *fake.Clientset {
	target := agentTargets["ross"]
	replicas := int32(1)
	return fake.NewSimpleClientset(
		&corev1.Secret{
			ObjectMeta: metav1.ObjectMeta{Name: target.GoogleSecret, Namespace: target.Namespace},
			Type:       corev1.SecretTypeOpaque,
		},
		&appsv1.Deployment{
			ObjectMeta: metav1.ObjectMeta{Name: target.Deployment, Namespace: target.Namespace},
			Spec:       appsv1.DeploymentSpec{Replicas: &replicas},
		},
	)
}

func TestAgentGoogleConnectedReflectsSecret(t *testing.T) {
	ctx := context.Background()
	cs := seedAgentGoogleFixtures()
	c := &AgentToggleClient{cs: cs}
	target := agentTargets["ross"]

	// Empty secret → not connected.
	if ok, err := c.googleConnected(ctx, target); err != nil || ok {
		t.Fatalf("googleConnected empty = (%v,%v), want (false,nil)", ok, err)
	}

	// A valid refresh token + client id.
	const refresh = "1//0abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 token"
	if err := c.WriteAgentGoogleCredentials(ctx, "ross", "client-id-1234567890", "client-secret-1234567890", refresh); err != nil {
		t.Fatalf("WriteAgentGoogleCredentials: %v", err)
	}

	// Secret now carries the credentials → connected.
	if ok, err := c.googleConnected(ctx, target); err != nil || !ok {
		t.Fatalf("googleConnected after write = (%v,%v), want (true,nil)", ok, err)
	}

	// The restart annotation must be stamped on the pod template.
	d, err := cs.AppsV1().Deployments(target.Namespace).Get(ctx, target.Deployment, metav1.GetOptions{})
	if err != nil {
		t.Fatalf("get deployment: %v", err)
	}
	if d.Spec.Template.Annotations["kubectl.kubernetes.io/restartedAt"] == "" {
		t.Errorf("restartedAt annotation not set on pod template")
	}

	// Status must surface googleEmail + googleConnected.
	st, err := c.Status(ctx, "ross")
	if err != nil {
		t.Fatalf("Status: %v", err)
	}
	if !st.GoogleConnected {
		t.Errorf("Status.GoogleConnected = false, want true")
	}
	if st.GoogleEmail != target.GoogleEmail {
		t.Errorf("Status.GoogleEmail = %q, want %q", st.GoogleEmail, target.GoogleEmail)
	}
}

func TestAgentGoogleWriteValidation(t *testing.T) {
	ctx := context.Background()
	c := &AgentToggleClient{cs: seedAgentGoogleFixtures()}

	// Unknown agent.
	if err := c.WriteAgentGoogleCredentials(ctx, "nobody", "a", "b", "c"); err == nil {
		t.Errorf("WriteAgentGoogleCredentials(unknown) = nil, want error")
	}

	// Blank credentials.
	if err := c.WriteAgentGoogleCredentials(ctx, "ross", "", "", ""); err == nil ||
		!strings.Contains(err.Error(), "required") {
		t.Errorf("WriteAgentGoogleCredentials(blank) = %v, want required error", err)
	}
}
