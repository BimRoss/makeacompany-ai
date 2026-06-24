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

// seedLegacyPersonalAgent creates a personal-agent's Deployment + Service +
// runtime Secret under the LEGACY slack-user-id-hashed names (pre-#651), with
// both the agent-id label/annotation and the slack-user-id annotation present —
// exactly the shape a live pre-migration deployment carries.
func seedLegacyPersonalAgent(slackUserID, agentID, image string) []interface{} {
	oldName := personalAgentResourceName(slackUserID)
	oldSecret := personalAgentSecretName(slackUserID)
	labels := map[string]string{
		"app.kubernetes.io/managed-by": personalAgentManagedByLabelValue,
		"app.kubernetes.io/name":       oldName,
		"bimross.com/integration":      personalAgentIntegrationLabel,
		personalAgentLabelAgentID:      agentID,
	}
	annos := map[string]string{
		personalAgentAnnoAgentID:     agentID,
		personalAgentAnnoSlackUserID: slackUserID,
	}
	dep := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Name: oldName, Namespace: "personal-agents", Labels: labels, Annotations: annos},
		Spec: appsv1.DeploymentSpec{Template: corev1.PodTemplateSpec{Spec: corev1.PodSpec{
			Containers: []corev1.Container{{
				Name:  "personal-agent",
				Image: image,
				Env: []corev1.EnvVar{
					{Name: "AGENT_OWNER_USER_ID", Value: slackUserID},
					{Name: "AGENT_DISPLAY_NAME", Value: "Legacy " + agentID},
				},
			}},
		}}},
	}
	svc := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{Name: oldName, Namespace: "personal-agents", Labels: labels},
	}
	secret := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{Name: oldSecret, Namespace: "personal-agents", Labels: labels, Annotations: annos},
		Type:       corev1.SecretTypeOpaque,
		Data: map[string][]byte{
			"PERSONAL_SLACK_BOT_TOKEN":      []byte("xoxb-legacy"),
			"PERSONAL_SLACK_SIGNING_SECRET": []byte("sig-legacy"),
		},
	}
	return []interface{}{dep, svc, secret}
}

func TestMigratePersonalAgentResourceNames_RenamesAndCarriesSecret(t *testing.T) {
	t.Setenv("PERSONAL_AGENT_SLACK_MCP_SIDECAR", "off")
	const slackUserID = "U0LEGACY"
	const agentID = "agent-legacy-1"

	objs := seedLegacyPersonalAgent(slackUserID, agentID, "img:legacy")
	cs := fake.NewSimpleClientset(objs[0].(*appsv1.Deployment), objs[1].(*corev1.Service), objs[2].(*corev1.Secret))
	w := newPersonalAgentWriterWithClient(cs, "personal-agents", "", "")
	srv := &Server{log: log.Default(), personalAgent: w, cfg: Config{PersonalAgentImage: "img:new"}}
	ctx := context.Background()

	oldName := personalAgentResourceName(slackUserID)
	newName := personalAgentResourceName(agentID)
	oldSecret := personalAgentSecretName(slackUserID)
	newSecret := personalAgentSecretName(agentID)
	if oldName == newName {
		t.Fatal("test setup bug: old and new names collide")
	}

	res := srv.migratePersonalAgentResourceNames(ctx)
	if res.Migrated != 1 {
		t.Fatalf("Migrated = %d, want 1 (res=%+v)", res.Migrated, res)
	}

	// New-named Deployment exists.
	if _, err := cs.AppsV1().Deployments("personal-agents").Get(ctx, newName, metav1.GetOptions{}); err != nil {
		t.Fatalf("new deployment %s missing after migration: %v", newName, err)
	}
	// New-named Service exists.
	if _, err := cs.CoreV1().Services("personal-agents").Get(ctx, newName, metav1.GetOptions{}); err != nil {
		t.Fatalf("new service %s missing after migration: %v", newName, err)
	}
	// New-named runtime Secret exists AND carries the original bot token data.
	newSec, err := cs.CoreV1().Secrets("personal-agents").Get(ctx, newSecret, metav1.GetOptions{})
	if err != nil {
		t.Fatalf("new secret %s missing after migration: %v", newSecret, err)
	}
	if string(newSec.Data["PERSONAL_SLACK_BOT_TOKEN"]) != "xoxb-legacy" {
		t.Errorf("bot token not carried over: %q", string(newSec.Data["PERSONAL_SLACK_BOT_TOKEN"]))
	}
	if newSec.Annotations[personalAgentAnnoAgentID] != agentID {
		t.Errorf("new secret missing agent-id annotation: %q", newSec.Annotations[personalAgentAnnoAgentID])
	}

	// Old-named resources are gone.
	if _, err := cs.AppsV1().Deployments("personal-agents").Get(ctx, oldName, metav1.GetOptions{}); err == nil {
		t.Errorf("old deployment %s still present after migration", oldName)
	}
	if _, err := cs.CoreV1().Services("personal-agents").Get(ctx, oldName, metav1.GetOptions{}); err == nil {
		t.Errorf("old service %s still present after migration", oldName)
	}
	if _, err := cs.CoreV1().Secrets("personal-agents").Get(ctx, oldSecret, metav1.GetOptions{}); err == nil {
		t.Errorf("old secret %s still present after migration", oldSecret)
	}

	// Idempotent: a second pass is a no-op.
	res2 := srv.migratePersonalAgentResourceNames(ctx)
	if res2.Migrated != 0 {
		t.Errorf("second pass Migrated = %d, want 0 (idempotent)", res2.Migrated)
	}
	if len(res2.Errors) != 0 {
		t.Errorf("second pass errors = %v, want none", res2.Errors)
	}
}

// An already-migrated agent (resources named under the agent-id hash) must be
// left untouched — the migration only acts on the legacy slack-hash name.
func TestMigratePersonalAgentResourceNames_SkipsAlreadyMigrated(t *testing.T) {
	t.Setenv("PERSONAL_AGENT_SLACK_MCP_SIDECAR", "off")
	const slackUserID = "U0NEW"
	const agentID = "agent-new-1"
	newName := personalAgentResourceName(agentID)

	dep := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name: newName, Namespace: "personal-agents",
			Labels: map[string]string{
				"app.kubernetes.io/managed-by": personalAgentManagedByLabelValue,
				personalAgentLabelAgentID:      agentID,
			},
			Annotations: map[string]string{
				personalAgentAnnoAgentID:     agentID,
				personalAgentAnnoSlackUserID: slackUserID,
			},
		},
		Spec: appsv1.DeploymentSpec{Template: corev1.PodTemplateSpec{Spec: corev1.PodSpec{
			Containers: []corev1.Container{{Name: "personal-agent", Image: "img:new"}},
		}}},
	}
	cs := fake.NewSimpleClientset(dep)
	w := newPersonalAgentWriterWithClient(cs, "personal-agents", "", "")
	srv := &Server{log: log.Default(), personalAgent: w, cfg: Config{PersonalAgentImage: "img:new"}}

	res := srv.migratePersonalAgentResourceNames(context.Background())
	if res.Migrated != 0 {
		t.Errorf("Migrated = %d, want 0 (already keyed on agent id)", res.Migrated)
	}
	if len(res.Errors) != 0 {
		t.Errorf("errors = %v, want none", res.Errors)
	}
}

// A legacy agent that had Google connected must have its Google OAuth Secret
// (incl. the refresh_token) carried over to the new agent-id-hashed name, plus
// new-named RBAC, with the old Google Secret + RBAC removed.
func TestMigratePersonalAgentResourceNames_CarriesGoogleCreds(t *testing.T) {
	t.Setenv("PERSONAL_AGENT_SLACK_MCP_SIDECAR", "off")
	const slackUserID = "U0GOOG"
	const agentID = "agent-goog-1"

	objs := seedLegacyPersonalAgent(slackUserID, agentID, "img:legacy")
	oldGoogle := personalAgentGoogleSecretName(slackUserID)
	newGoogle := personalAgentGoogleSecretName(agentID)
	oldRBAC := personalAgentGwsSidecarSAName(slackUserID)
	newRBAC := personalAgentGwsSidecarSAName(agentID)

	googleSecret := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name: oldGoogle, Namespace: "personal-agents",
			Annotations: map[string]string{
				personalAgentAnnoSlackUserID: slackUserID,
				personalAgentGoogleAnnoEmail: "owner@example.com",
			},
		},
		Type: corev1.SecretTypeOpaque,
		Data: map[string][]byte{
			personalAgentGoogleSecretKeyClientID:     []byte("cid"),
			personalAgentGoogleSecretKeyClientSecret: []byte("csec"),
			personalAgentGoogleSecretKeyRefreshToken: []byte("rtok-legacy"),
		},
	}
	cs := fake.NewSimpleClientset(
		objs[0].(*appsv1.Deployment), objs[1].(*corev1.Service), objs[2].(*corev1.Secret), googleSecret,
	)
	w := newPersonalAgentWriterWithClient(cs, "personal-agents", "", "")
	srv := &Server{log: log.Default(), personalAgent: w, cfg: Config{PersonalAgentImage: "img:new"}}
	ctx := context.Background()

	if res := srv.migratePersonalAgentResourceNames(ctx); res.Migrated != 1 {
		t.Fatalf("Migrated = %d, want 1 (res=%+v)", res.Migrated, res)
	}

	// New Google Secret carries the refresh token.
	newSec, err := cs.CoreV1().Secrets("personal-agents").Get(ctx, newGoogle, metav1.GetOptions{})
	if err != nil {
		t.Fatalf("new google secret %s missing: %v", newGoogle, err)
	}
	if string(newSec.Data[personalAgentGoogleSecretKeyRefreshToken]) != "rtok-legacy" {
		t.Errorf("refresh token not carried over: %q", string(newSec.Data[personalAgentGoogleSecretKeyRefreshToken]))
	}
	// New RBAC exists, scoped to the new Google Secret.
	role, err := cs.RbacV1().Roles("personal-agents").Get(ctx, newRBAC, metav1.GetOptions{})
	if err != nil {
		t.Fatalf("new role %s missing: %v", newRBAC, err)
	}
	if len(role.Rules) != 1 || len(role.Rules[0].ResourceNames) != 1 || role.Rules[0].ResourceNames[0] != newGoogle {
		t.Errorf("new role not scoped to %q: %+v", newGoogle, role.Rules)
	}
	// The rebuilt Deployment runs under the new SA (Google connected carried over).
	dep, err := cs.AppsV1().Deployments("personal-agents").Get(ctx, personalAgentResourceName(agentID), metav1.GetOptions{})
	if err != nil {
		t.Fatalf("new deployment missing: %v", err)
	}
	if dep.Spec.Template.Spec.ServiceAccountName != newRBAC {
		t.Errorf("rebuilt deployment SA = %q, want %q (Google connected must carry over)", dep.Spec.Template.Spec.ServiceAccountName, newRBAC)
	}

	// Old Google Secret + RBAC are gone.
	if _, err := cs.CoreV1().Secrets("personal-agents").Get(ctx, oldGoogle, metav1.GetOptions{}); err == nil {
		t.Errorf("old google secret %s still present", oldGoogle)
	}
	if _, err := cs.CoreV1().ServiceAccounts("personal-agents").Get(ctx, oldRBAC, metav1.GetOptions{}); err == nil {
		t.Errorf("old gws SA %s still present", oldRBAC)
	}

	// Idempotent.
	if res2 := srv.migratePersonalAgentResourceNames(ctx); res2.Migrated != 0 || len(res2.Errors) != 0 {
		t.Errorf("second pass not a no-op: migrated=%d errors=%v", res2.Migrated, res2.Errors)
	}
}
