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
	// The reflected shared OAuth pool must be envFrom'd AFTER the per-agent
	// Secret (so its CLAUDE_CODE_OAUTH_TOKEN[_2] win on collision) and be
	// optional (so a missing mirror never crashes the pod).
	if len(c.EnvFrom) < 2 || c.EnvFrom[1].SecretRef == nil ||
		c.EnvFrom[1].SecretRef.Name != personalAgentOAuthPoolSecretName {
		t.Fatalf("expected pool envFrom %q at index 1, got %+v", personalAgentOAuthPoolSecretName, c.EnvFrom)
	}
	if c.EnvFrom[1].SecretRef.Optional == nil || !*c.EnvFrom[1].SecretRef.Optional {
		t.Errorf("pool envFrom must be optional=true")
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
	// Model/effort defaults must be stamped so PA pods don't fall back to a
	// stale baked-in constant. Non-1M opus-4-8: the [1m] variants fail without
	// usage credits on the shared pool (see personalAgentDefaultModel).
	if gotEnv["PERSONAL_AGENT_DEFAULT_MODEL"] != "claude-opus-4-8" {
		t.Errorf("PERSONAL_AGENT_DEFAULT_MODEL = %q, want claude-opus-4-8", gotEnv["PERSONAL_AGENT_DEFAULT_MODEL"])
	}
	if gotEnv["PERSONAL_AGENT_DEFAULT_EFFORT"] != "high" {
		t.Errorf("PERSONAL_AGENT_DEFAULT_EFFORT = %q, want high", gotEnv["PERSONAL_AGENT_DEFAULT_EFFORT"])
	}
	// Background-tier (TIER 2) default for unattended loop/watch ticks: non-1M
	// Sonnet, which runs free on the pool (sonnet-4-6[1m] 429s). Model-only —
	// effort stays empty so ticks keep their per-loop / inherited effort.
	if gotEnv["PERSONAL_AGENT_LOOP_MODEL"] != "claude-sonnet-4-6" {
		t.Errorf("PERSONAL_AGENT_LOOP_MODEL = %q, want claude-sonnet-4-6", gotEnv["PERSONAL_AGENT_LOOP_MODEL"])
	}
	if gotEnv["PERSONAL_AGENT_LOOP_EFFORT"] != "" {
		t.Errorf("PERSONAL_AGENT_LOOP_EFFORT = %q, want empty (per-loop effort preserved)", gotEnv["PERSONAL_AGENT_LOOP_EFFORT"])
	}
	if _, present := gotEnv["ROSS_WORKSPACE"]; present {
		t.Errorf("ROSS_WORKSPACE should be inherited from the image, not overridden in the pod spec (got %q)", gotEnv["ROSS_WORKSPACE"])
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

func TestWriteAgentDeployment_GoogleSidecarOptIn(t *testing.T) {
	ctx := context.Background()
	uid := "U0APBT3364D"

	// Not connected: no sidecar, no per-owner SA, no Google env on the main
	// container — zero cost for owners who haven't connected Google.
	t.Run("disconnected has no sidecar", func(t *testing.T) {
		cs := fake.NewSimpleClientset()
		w := newPersonalAgentWriterWithClient(cs, "personal-agents", "", "")
		if err := w.WriteAgentDeployment(ctx, PersonalAgentDeploymentRequest{
			SlackUserID: uid, OwnerSlackUserID: uid, Image: "img:1",
		}); err != nil {
			t.Fatalf("WriteAgentDeployment: %v", err)
		}
		dep, err := cs.AppsV1().Deployments("personal-agents").Get(ctx, personalAgentResourceName(uid), metav1.GetOptions{})
		if err != nil {
			t.Fatalf("get deployment: %v", err)
		}
		spec := dep.Spec.Template.Spec
		if len(spec.Containers) != 1 {
			t.Fatalf("containers = %d, want 1 (no sidecar)", len(spec.Containers))
		}
		if spec.ServiceAccountName != "" {
			t.Errorf("ServiceAccountName = %q, want empty when disconnected", spec.ServiceAccountName)
		}
		for _, e := range spec.Containers[0].Env {
			if e.Name == "PERSONAL_AGENT_GOOGLE_MCP_URL" || e.Name == "PERSONAL_AGENT_GOOGLE_OAUTH21" {
				t.Errorf("unexpected Google env %q when disconnected", e.Name)
			}
		}
	})

	// Connected: sidecar container + per-owner SA + bootstrap Secret volume +
	// Google MCP env on the main container, all scoped to this owner's hashes.
	t.Run("connected attaches per-owner sidecar", func(t *testing.T) {
		cs := fake.NewSimpleClientset()
		w := newPersonalAgentWriterWithClient(cs, "personal-agents", "", "")
		if err := w.WriteAgentDeployment(ctx, PersonalAgentDeploymentRequest{
			SlackUserID: uid, OwnerSlackUserID: uid, Image: "img:1",
			GoogleWorkspaceConnected: true,
		}); err != nil {
			t.Fatalf("WriteAgentDeployment: %v", err)
		}
		dep, err := cs.AppsV1().Deployments("personal-agents").Get(ctx, personalAgentResourceName(uid), metav1.GetOptions{})
		if err != nil {
			t.Fatalf("get deployment: %v", err)
		}
		spec := dep.Spec.Template.Spec

		if spec.ServiceAccountName != personalAgentGwsSidecarSAName(uid) {
			t.Errorf("ServiceAccountName = %q, want %q", spec.ServiceAccountName, personalAgentGwsSidecarSAName(uid))
		}

		var sidecarFound bool
		var secretEnv string
		for i := range spec.Containers {
			if spec.Containers[i].Name == personalAgentGwsSidecarContainerName {
				sidecarFound = true
				for _, e := range spec.Containers[i].Env {
					if e.Name == "SECRET_NAME" {
						secretEnv = e.Value
					}
				}
				// The personal-agents LimitRange enforces maxLimitRequestRatio
				// cpu=40 and injects a default cpu limit of 1 when none is set,
				// which forbids the pod. The sidecar MUST carry an explicit cpu
				// request + limit whose ratio is <= 40.
				res := spec.Containers[i].Resources
				cpuReq := res.Requests.Cpu().MilliValue()
				cpuLim := res.Limits.Cpu().MilliValue()
				if cpuReq == 0 || cpuLim == 0 {
					t.Errorf("sidecar must set explicit cpu request+limit, got req=%dm lim=%dm", cpuReq, cpuLim)
				} else if ratio := float64(cpuLim) / float64(cpuReq); ratio > 40 {
					t.Errorf("sidecar cpu limit/request ratio %.0f exceeds LimitRange max 40 (req=%dm lim=%dm)", ratio, cpuReq, cpuLim)
				}
			}
		}
		if !sidecarFound {
			t.Fatalf("sidecar container %q not attached", personalAgentGwsSidecarContainerName)
		}
		if secretEnv != personalAgentGoogleSecretName(uid) {
			t.Errorf("sidecar SECRET_NAME = %q, want %q", secretEnv, personalAgentGoogleSecretName(uid))
		}

		// Main container points at the in-pod sidecar.
		gotEnv := map[string]string{}
		for _, e := range spec.Containers[0].Env {
			gotEnv[e.Name] = e.Value
		}
		if gotEnv["PERSONAL_AGENT_GOOGLE_MCP_URL"] != "http://localhost:8081/mcp" {
			t.Errorf("PERSONAL_AGENT_GOOGLE_MCP_URL = %q", gotEnv["PERSONAL_AGENT_GOOGLE_MCP_URL"])
		}
		if gotEnv["PERSONAL_AGENT_GOOGLE_OAUTH21"] != "true" {
			t.Errorf("PERSONAL_AGENT_GOOGLE_OAUTH21 = %q", gotEnv["PERSONAL_AGENT_GOOGLE_OAUTH21"])
		}

		// Bootstrap Secret volume references this owner's Secret.
		var found bool
		for _, v := range spec.Volumes {
			if v.Name == "oauth-bootstrap" && v.Secret != nil && v.Secret.SecretName == personalAgentGoogleSecretName(uid) {
				found = true
			}
		}
		if !found {
			t.Errorf("oauth-bootstrap volume missing or wrong secret; volumes=%+v", spec.Volumes)
		}
	})
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
	if mount.MountPath != "/data/workspaces" {
		t.Errorf("mount path = %q, want %q (matches the image's pre-chowned workspace base — see fix/personal-agent-workspace-mount-perms)", mount.MountPath, "/data/workspaces")
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

func TestWriteAgentDeployment_AddsChownInitContainer(t *testing.T) {
	cs := fake.NewSimpleClientset()
	w := newPersonalAgentWriterWithClient(cs, "personal-agents", "", "")
	ctx := context.Background()
	req := PersonalAgentDeploymentRequest{
		SlackUserID:      "U0BB3LCKF4L",
		OwnerSlackUserID: "U0BB3LCKF4L",
		DisplayName:      "Gino",
		AgentID:          "agent-gino",
		Image:            "img:gino",
	}
	if err := w.WriteAgentDeployment(ctx, req); err != nil {
		t.Fatalf("WriteAgentDeployment: %v", err)
	}
	name := personalAgentResourceName(req.SlackUserID)
	dep, err := cs.AppsV1().Deployments("personal-agents").Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	initContainers := dep.Spec.Template.Spec.InitContainers
	if len(initContainers) != 1 {
		t.Fatalf("expected 1 init container, got %d", len(initContainers))
	}
	ic := initContainers[0]
	if ic.Name != personalAgentInitContainerName {
		t.Errorf("init container name = %q, want %q", ic.Name, personalAgentInitContainerName)
	}
	if ic.SecurityContext == nil || ic.SecurityContext.RunAsUser == nil || *ic.SecurityContext.RunAsUser != 0 {
		t.Errorf("init container must runAsUser 0 to chown, got %+v", ic.SecurityContext)
	}
	if len(ic.VolumeMounts) != 1 {
		t.Fatalf("init container needs the data mount, got %d", len(ic.VolumeMounts))
	}
	if ic.VolumeMounts[0].SubPath != name {
		t.Errorf("init container subPath = %q, must match main container subPath %q so the same host dir is chowned",
			ic.VolumeMounts[0].SubPath, name)
	}
	if ic.VolumeMounts[0].MountPath != "/data/workspaces" {
		t.Errorf("init container mountPath = %q, want %q", ic.VolumeMounts[0].MountPath, "/data/workspaces")
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
