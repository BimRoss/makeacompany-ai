package app

import (
	"context"
	"testing"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
)

func TestWriteAgentDeployment_CreatesDeployment(t *testing.T) {
	cs := fake.NewSimpleClientset()
	w := newPersonalAgentWriterWithClient(cs, "personal-agents", "", "")
	ctx := context.Background()
	req := PersonalAgentDeploymentRequest{
		SlackUserID:      "U0APBT3364D",
		OwnerSlackUserID: "U0APBT3364D",
		DisplayName:      "Garth",
		AgentID:          "agent-abc",
		Image:            "docker.io/geeemoney/claude-code-personal-agent:v0.1.2",
	}
	if err := w.WriteAgentDeployment(ctx, req); err != nil {
		t.Fatalf("WriteAgentDeployment: %v", err)
	}
	name := personalAgentResourceName(req.SlackUserID)
	dep, err := cs.AppsV1().Deployments("personal-agents").Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		t.Fatalf("get deployment: %v", err)
	}
	c := dep.Spec.Template.Spec.Containers[0]
	if c.Image != req.Image {
		t.Errorf("image = %q, want %q", c.Image, req.Image)
	}
	if c.EnvFrom[0].SecretRef.Name != personalAgentSecretName(req.SlackUserID) {
		t.Errorf("envFrom secret = %q", c.EnvFrom[0].SecretRef.Name)
	}
	gotEnv := map[string]string{}
	for _, e := range c.Env {
		gotEnv[e.Name] = e.Value
	}
	if gotEnv["AGENT_OWNER_USER_ID"] != "U0APBT3364D" {
		t.Errorf("AGENT_OWNER_USER_ID = %q", gotEnv["AGENT_OWNER_USER_ID"])
	}
	if gotEnv["AGENT_DISPLAY_NAME"] != "Garth" {
		t.Errorf("AGENT_DISPLAY_NAME = %q", gotEnv["AGENT_DISPLAY_NAME"])
	}
	if dep.Labels["bimross.com/agent-id"] != "agent-abc" {
		t.Errorf("agent-id label = %q", dep.Labels["bimross.com/agent-id"])
	}
	if len(dep.Spec.Template.Spec.ImagePullSecrets) == 0 || dep.Spec.Template.Spec.ImagePullSecrets[0].Name != "dockerhub-pull" {
		t.Errorf("expected dockerhub-pull imagePullSecret, got %+v", dep.Spec.Template.Spec.ImagePullSecrets)
	}
	if c.LivenessProbe == nil || c.LivenessProbe.HTTPGet.Path != "/healthz" {
		t.Errorf("liveness probe wrong: %+v", c.LivenessProbe)
	}
	if *dep.Spec.Replicas != 1 {
		t.Errorf("replicas = %d, want 1", *dep.Spec.Replicas)
	}
}

func TestWriteAgentDeployment_PersistsWorkspaceViaHostPath(t *testing.T) {
	cs := fake.NewSimpleClientset()
	w := newPersonalAgentWriterWithClient(cs, "personal-agents", "", "")
	ctx := context.Background()
	req := PersonalAgentDeploymentRequest{
		SlackUserID:      "U0APBT3364D",
		OwnerSlackUserID: "U0APBT3364D",
		DisplayName:      "Garth",
		AgentID:          "agent-x",
		Image:            "img:1",
	}
	if err := w.WriteAgentDeployment(ctx, req); err != nil {
		t.Fatalf("WriteAgentDeployment: %v", err)
	}
	name := personalAgentResourceName(req.SlackUserID)
	dep, err := cs.AppsV1().Deployments("personal-agents").Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if dep.Spec.Template.Spec.NodeSelector["kubernetes.io/hostname"] != personalAgentHostNode {
		t.Errorf("nodeSelector = %v", dep.Spec.Template.Spec.NodeSelector)
	}
	if dep.Spec.Template.Spec.SecurityContext == nil || dep.Spec.Template.Spec.SecurityContext.FSGroup == nil || *dep.Spec.Template.Spec.SecurityContext.FSGroup != personalAgentRuntimeGID {
		t.Errorf("fsGroup not set to %d: %+v", personalAgentRuntimeGID, dep.Spec.Template.Spec.SecurityContext)
	}
	if len(dep.Spec.Template.Spec.Volumes) != 1 {
		t.Fatalf("expected 1 volume, got %d", len(dep.Spec.Template.Spec.Volumes))
	}
	vol := dep.Spec.Template.Spec.Volumes[0]
	if vol.HostPath == nil || vol.HostPath.Path != personalAgentHostPathBase {
		t.Errorf("hostPath wrong: %+v", vol.HostPath)
	}
	c := dep.Spec.Template.Spec.Containers[0]
	if len(c.VolumeMounts) != 1 {
		t.Fatalf("expected 1 volumeMount, got %d", len(c.VolumeMounts))
	}
	mount := c.VolumeMounts[0]
	if mount.MountPath != "/data" {
		t.Errorf("mount path = %q", mount.MountPath)
	}
	if mount.SubPath != name {
		t.Errorf("subPath = %q, want %q (matches Deployment name)", mount.SubPath, name)
	}
}

func TestWriteAgentDeployment_UpdatesExisting(t *testing.T) {
	cs := fake.NewSimpleClientset()
	w := newPersonalAgentWriterWithClient(cs, "personal-agents", "", "")
	ctx := context.Background()
	req := PersonalAgentDeploymentRequest{
		SlackUserID:      "U1",
		OwnerSlackUserID: "U1",
		DisplayName:      "v1",
		AgentID:          "a1",
		Image:            "img:v1",
	}
	if err := w.WriteAgentDeployment(ctx, req); err != nil {
		t.Fatalf("first write: %v", err)
	}
	req.Image = "img:v2"
	req.DisplayName = "v2"
	if err := w.WriteAgentDeployment(ctx, req); err != nil {
		t.Fatalf("second write: %v", err)
	}
	name := personalAgentResourceName(req.SlackUserID)
	dep, err := cs.AppsV1().Deployments("personal-agents").Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if dep.Spec.Template.Spec.Containers[0].Image != "img:v2" {
		t.Errorf("image after update = %q", dep.Spec.Template.Spec.Containers[0].Image)
	}
}

func TestWriteAgentDeployment_RejectsEmpty(t *testing.T) {
	cs := fake.NewSimpleClientset()
	w := newPersonalAgentWriterWithClient(cs, "personal-agents", "", "")
	if err := w.WriteAgentDeployment(context.Background(), PersonalAgentDeploymentRequest{Image: "x"}); err == nil {
		t.Fatal("expected error on missing slack user id")
	}
	if err := w.WriteAgentDeployment(context.Background(), PersonalAgentDeploymentRequest{SlackUserID: "U1"}); err == nil {
		t.Fatal("expected error on missing image")
	}
}

func TestWriteAgentService_CreatesService(t *testing.T) {
	cs := fake.NewSimpleClientset()
	w := newPersonalAgentWriterWithClient(cs, "personal-agents", "", "")
	ctx := context.Background()
	if err := w.WriteAgentService(ctx, "U0APBT3364D"); err != nil {
		t.Fatalf("WriteAgentService: %v", err)
	}
	name := personalAgentResourceName("U0APBT3364D")
	svc, err := cs.CoreV1().Services("personal-agents").Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		t.Fatalf("get service: %v", err)
	}
	if svc.Spec.Ports[0].Port != int32(PersonalAgentServicePort) {
		t.Errorf("port = %d, want %d", svc.Spec.Ports[0].Port, PersonalAgentServicePort)
	}
	if svc.Spec.Selector["app.kubernetes.io/name"] != name {
		t.Errorf("selector = %v", svc.Spec.Selector)
	}
}

func TestPersonalAgentResourceName_MatchesSecretPrefix(t *testing.T) {
	// Sanity: secret name = resource name + suffix. If anyone changes one
	// without the other, the Deployment's envFrom would point at the wrong key.
	name := personalAgentResourceName("U0APBT3364D")
	secret := personalAgentSecretName("U0APBT3364D")
	if secret != name+"-runtime-secrets" {
		t.Errorf("name shape drift: name=%q secret=%q", name, secret)
	}
}
