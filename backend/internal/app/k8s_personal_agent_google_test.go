package app

import (
	"context"
	"testing"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
)

func TestGoogleCredentials_ConnectLifecycle(t *testing.T) {
	ctx := context.Background()
	agentID := "agent-abc"
	cs := fake.NewSimpleClientset()
	w := newPersonalAgentWriterWithClient(cs, "personal-agents", "", "")
	ns := "personal-agents"
	secretName := personalAgentGoogleSecretName(agentID)
	rbacName := personalAgentGwsSidecarSAName(agentID)

	// Initially disconnected.
	if ok, err := w.HasGoogleCredentials(ctx, agentID); err != nil || ok {
		t.Fatalf("HasGoogleCredentials before connect = (%v,%v), want (false,nil)", ok, err)
	}

	// Connect: writes Secret + RBAC.
	if err := w.WriteGoogleCredentials(ctx, agentID, "Grant@BimRoss.com", "cid", "csecret", "rtok"); err != nil {
		t.Fatalf("WriteGoogleCredentials: %v", err)
	}

	if ok, err := w.HasGoogleCredentials(ctx, agentID); err != nil || !ok {
		t.Fatalf("HasGoogleCredentials after connect = (%v,%v), want (true,nil)", ok, err)
	}

	sec, err := cs.CoreV1().Secrets(ns).Get(ctx, secretName, metav1.GetOptions{})
	if err != nil {
		t.Fatalf("get secret: %v", err)
	}
	for _, k := range []string{personalAgentGoogleSecretKeyClientID, personalAgentGoogleSecretKeyClientSecret, personalAgentGoogleSecretKeyRefreshToken} {
		if sec.StringData[k] == "" {
			t.Errorf("secret missing key %q", k)
		}
	}
	// Email is normalized to lowercase.
	if got, err := w.ReadGoogleEmail(ctx, agentID); err != nil || got != "grant@bimross.com" {
		t.Errorf("ReadGoogleEmail = (%q,%v), want (grant@bimross.com,nil)", got, err)
	}

	// RBAC is scoped to exactly this owner's Secret.
	role, err := cs.RbacV1().Roles(ns).Get(ctx, rbacName, metav1.GetOptions{})
	if err != nil {
		t.Fatalf("get role: %v", err)
	}
	if len(role.Rules) != 1 || len(role.Rules[0].ResourceNames) != 1 || role.Rules[0].ResourceNames[0] != secretName {
		t.Errorf("role not scoped to %q: %+v", secretName, role.Rules)
	}
	if _, err := cs.CoreV1().ServiceAccounts(ns).Get(ctx, rbacName, metav1.GetOptions{}); err != nil {
		t.Errorf("serviceaccount not created: %v", err)
	}
	if _, err := cs.RbacV1().RoleBindings(ns).Get(ctx, rbacName, metav1.GetOptions{}); err != nil {
		t.Errorf("rolebinding not created: %v", err)
	}

	// Disconnect: returns the refresh token, removes Secret + RBAC.
	rtok, err := w.DeleteGoogleCredentials(ctx, agentID)
	if err != nil {
		t.Fatalf("DeleteGoogleCredentials: %v", err)
	}
	if rtok != "rtok" {
		t.Errorf("returned refresh_token = %q, want rtok (for revoke)", rtok)
	}
	if ok, _ := w.HasGoogleCredentials(ctx, agentID); ok {
		t.Errorf("HasGoogleCredentials after disconnect = true, want false")
	}
	if _, err := cs.RbacV1().Roles(ns).Get(ctx, rbacName, metav1.GetOptions{}); !apierrors.IsNotFound(err) {
		t.Errorf("role still present after disconnect: %v", err)
	}

	// Disconnect is idempotent.
	if _, err := w.DeleteGoogleCredentials(ctx, agentID); err != nil {
		t.Errorf("second DeleteGoogleCredentials should be idempotent, got %v", err)
	}
}
