package app

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"strings"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"
	"k8s.io/utils/ptr"
)

// personalAgentOAuthPoolSecretName is the reflected shared Claude OAuth token
// pool Secret (source of truth: cluster-bootstrap/claude-oauth-pool, mirrored
// into the personal-agents namespace). Per-agent pods envFrom it so a pool
// rotation reaches every agent without rewriting per-agent Secrets.
const personalAgentOAuthPoolSecretName = "claude-oauth-pool"

// personalAgentDefaultEffort is stamped onto every generated PA pod. The
// interactive default MODEL is deliberately NOT stamped: claude-code-core/
// spawnsettings owns the curated default (claude-opus-4-8, non-1M), so there is
// one source of truth and no second place to drift or silently re-pin the old
// opus-4-7[1m] that hung the fleet on 2026-06-23. Leaving PERSONAL_AGENT_DEFAULT_MODEL
// unset lets the harness fall through to that core default. Effort is still
// stamped (a valid, non-model knob); override fleet-wide via the backend env
// without an image rebuild.
func personalAgentDefaultEffort() string {
	if v := strings.TrimSpace(os.Getenv("PERSONAL_AGENT_DEFAULT_EFFORT")); v != "" {
		return v
	}
	return "high"
}

// personalAgentLoopModel / personalAgentLoopEffort are the TIER 2 background
// defaults stamped onto every PA pod. The harness (resolveSpawnSettings) reads
// them only on loop/watch ticks — unattended recurring spawns — and they sit
// below a channel pin but above PERSONAL_AGENT_DEFAULT_*. Ticks tier down to
// non-1M Sonnet: plain claude-sonnet-4-6 runs free on the shared OAuth pool
// while sonnet-4-6[1m] 429s ("usage credits required for 1M context"), and a
// bounded tick never needs 1M context. Model-only by default — effort is left
// empty so ticks keep their per-loop / inherited effort instead of silently
// dropping exploratory loops below `high`. Override fleet-wide via backend env.
func personalAgentLoopModel() string {
	if v := strings.TrimSpace(os.Getenv("PERSONAL_AGENT_LOOP_MODEL")); v != "" {
		return v
	}
	return "claude-sonnet-4-6"
}

func personalAgentLoopEffort() string {
	return strings.TrimSpace(os.Getenv("PERSONAL_AGENT_LOOP_EFFORT"))
}

// personalAgentMacBackendURL is the in-cluster mac-ai backend base URL the PA
// engagement recorder POSTs observed messages to (mac-ai#498). Overridable via
// env for non-prod; defaults to the prod Service DNS — the same value
// MAC_BACKEND_URL carries on the Ross/Joanne pods. Paired with the converged
// PA_ENGAGEMENT_TOKEN — a scoped credential (NOT the master internal token)
// that authorizes only the engagement ingest endpoint, so a PA owner who reads
// their pod's env can't reach the rest of the /v1/internal/* surface.
func personalAgentMacBackendURL() string {
	if v := strings.TrimSpace(os.Getenv("PERSONAL_AGENT_MAC_BACKEND_URL")); v != "" {
		return v
	}
	return "http://makeacompany-ai-backend.makeacompany-ai.svc.cluster.local:8080"
}

// personalAgentResources sizes every generated PA pod. Defaults come from the
// 2026-06-20 cluster CPU audit: idle agents sit at ~1m CPU / ~9Mi and even an
// active Claude session bursts to only ~50m / well under 1Gi, yet each pod was
// reserving 250m / 512Mi — a ~250x CPU over-reservation that, multiplied across
// the fleet, ate roughly half the worker CPU the scheduler could hand out.
//
// Requests now track the realistic active floor (the scheduler packs by these,
// so low requests = tighter bin-packing without touching burst headroom); the
// limits stay as the burst ceiling. CPU is compressible, so its request is the
// big lever — over-requesting only strands schedulable capacity. Memory is
// incompressible, so its request stays generous enough that an active agent is
// not first in line for eviction, and the limit is the real OOM guard.
//
// Every value is overridable fleet-wide via backend env without an image
// rebuild, mirroring personalAgentDefaultEffort et al. A typo'd override falls
// back to the baked default (logged) rather than panicking the provisioner.
func personalAgentResources() corev1.ResourceRequirements {
	return corev1.ResourceRequirements{
		Requests: corev1.ResourceList{
			corev1.ResourceCPU:    personalAgentQuantity("PERSONAL_AGENT_CPU_REQUEST", "50m"),
			corev1.ResourceMemory: personalAgentQuantity("PERSONAL_AGENT_MEM_REQUEST", "384Mi"),
		},
		Limits: corev1.ResourceList{
			corev1.ResourceCPU:    personalAgentQuantity("PERSONAL_AGENT_CPU_LIMIT", "1"),
			corev1.ResourceMemory: personalAgentQuantity("PERSONAL_AGENT_MEM_LIMIT", "1Gi"),
		},
	}
}

// personalAgentQuantity reads a resource.Quantity from env, falling back to def
// on empty or unparseable input so a bad override can never crash provisioning.
func personalAgentQuantity(env, def string) resource.Quantity {
	if v := strings.TrimSpace(os.Getenv(env)); v != "" {
		if q, err := resource.ParseQuantity(v); err == nil {
			return q
		}
		log.Printf("personal-agent: invalid %s=%q, using default %q", env, v, def)
	}
	return resource.MustParse(def)
}

// PersonalAgentDeploymentRequest carries everything WriteAgentDeployment
// needs from the provisioner. Image is configurable so the K8s writer
// doesn't have to read mac-ai Config.
type PersonalAgentDeploymentRequest struct {
	SlackUserID      string
	OwnerSlackUserID string // injected as AGENT_OWNER_USER_ID into the pod
	DisplayName      string // AGENT_DISPLAY_NAME
	AgentID          string // for labelling / audit only; pods don't read it
	Image            string // e.g. docker.io/geeemoney/claude-code-personal-agent:v0.1.2
	// GoogleWorkspaceConnected, when true, attaches the per-owner
	// gws-mcp-token-sidecar (+ its bootstrap Secret volume + per-owner SA) and
	// points the PA runtime at it. Set by the provisioner from
	// PersonalAgentWriter.HasGoogleCredentials. False (the default) ships the
	// pod with no sidecar — zero cost for owners who haven't connected Google.
	GoogleWorkspaceConnected bool
	// GoogleEmail is the owner's connected Google account, stamped as
	// AGENT_GOOGLE_EMAIL when connected. Cosmetic in OAuth21 mode (identity is
	// bound server-side at the gateway) but makes the agent's instructions.md
	// read "you act as <email>". Ignored when GoogleWorkspaceConnected is false.
	GoogleEmail string
}

// WriteAgentDeployment creates (or updates) the per-agent Deployment in the
// personal-agents namespace. The Deployment's pod template references the
// per-agent Secret written by WriteAgentRuntimeSecret via envFrom; the pod's
// HTTP Events server picks up PERSONAL_SLACK_BOT_TOKEN + PERSONAL_SLACK_SIGNING_SECRET
// from there.
func (w *PersonalAgentWriter) WriteAgentDeployment(ctx context.Context, req PersonalAgentDeploymentRequest) error {
	if w.Disabled() {
		return ErrPersonalAgentWriterDisabled
	}
	if strings.TrimSpace(req.SlackUserID) == "" || strings.TrimSpace(req.Image) == "" {
		return errors.New("WriteAgentDeployment: slack user id + image required")
	}
	name := personalAgentResourceName(req.SlackUserID)
	secretName := personalAgentSecretName(req.SlackUserID)
	labels := map[string]string{
		"app.kubernetes.io/managed-by": personalAgentManagedByLabelValue,
		"app.kubernetes.io/name":       name,
		"bimross.com/integration":      personalAgentIntegrationLabel,
		"bimross.com/agent-id":         strings.TrimSpace(req.AgentID),
	}
	replicas := int32(1)
	dep := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: w.agentNamespace,
			Labels:    labels,
			Annotations: map[string]string{
				personalAgentAnnoSlackUserID: req.SlackUserID,
			},
		},
		Spec: appsv1.DeploymentSpec{
			Replicas: &replicas,
			Selector: &metav1.LabelSelector{
				MatchLabels: map[string]string{
					"app.kubernetes.io/name": name,
				},
			},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: labels},
				Spec: corev1.PodSpec{
					ImagePullSecrets: []corev1.LocalObjectReference{{Name: "dockerhub-pull"}},
					// Pin to the makeacompany worker node so the hostPath data
					// volume below resolves to the same disk every pod restart.
					// If the pool grows we'll need a real PV/PVC or RWX storage.
					NodeSelector: map[string]string{"kubernetes.io/hostname": personalAgentHostNode},
					// fsGroup grants the container's primary group write access
					// to the mounted hostPath. The PA image runs as the `node`
					// user (UID/GID 1000) baked into Node Alpine; without this
					// the mount is owned by root and the workspace writes 403.
					// fsGroup alone is not enough for hostPath subPath mounts
					// (kubelet does not reliably chgrp them), so the init
					// container below runs as root and chowns the mount before
					// the app container starts. See #455 followup.
					SecurityContext: &corev1.PodSecurityContext{
						FSGroup: int64Ptr(personalAgentRuntimeGID),
					},
					InitContainers: personalAgentInitContainers(name),
					Containers: []corev1.Container{{
						Name:  "personal-agent",
						Image: req.Image,
						Ports: []corev1.ContainerPort{
							{
								Name:          "http",
								ContainerPort: int32(PersonalAgentServicePort),
								Protocol:      corev1.ProtocolTCP,
							},
							{
								Name:          "admin",
								ContainerPort: int32(PersonalAgentAdminPort),
								Protocol:      corev1.ProtocolTCP,
							},
						},
						EnvFrom: []corev1.EnvFromSource{
							{
								SecretRef: &corev1.SecretEnvSource{
									LocalObjectReference: corev1.LocalObjectReference{Name: secretName},
								},
							},
							// Shared Claude OAuth token pool, reflected into the
							// personal-agents namespace from cluster-bootstrap
							// (see rancher-admin admin/apps/cluster-bootstrap).
							// This is the SINGLE SOURCE OF TRUTH for the OAuth
							// tokens — WriteAgentRuntimeSecret deliberately does
							// not write per-agent copies, so a pool rotation
							// reaches every agent without rewriting per-agent
							// Secrets. Optional so a pod still boots if the mirror
							// is briefly absent (it would then have no token until
							// the mirror reconciles — acceptable, transient).
							{
								SecretRef: &corev1.SecretEnvSource{
									LocalObjectReference: corev1.LocalObjectReference{Name: personalAgentOAuthPoolSecretName},
									Optional:             ptr.To(true),
								},
							},
						},
						Env: []corev1.EnvVar{
							{Name: "AGENT_OWNER_USER_ID", Value: strings.TrimSpace(req.OwnerSlackUserID)},
							{Name: "AGENT_DISPLAY_NAME", Value: strings.TrimSpace(req.DisplayName)},
							// Stamp the interactive default EFFORT onto every PA pod
							// so it holds regardless of which PA image is running and
							// survives re-provisioning. The default MODEL is NOT
							// stamped — claude-code-core/spawnsettings owns the curated
							// default (claude-opus-4-8, non-1M); leaving the env unset
							// lets the harness fall through to it, keeping one source
							// of truth and avoiding any chance of re-pinning the
							// opus-4-7[1m] that hung the fleet on 2026-06-23. Override
							// effort fleet-wide from the backend env without a rebuild.
							{Name: "PERSONAL_AGENT_DEFAULT_EFFORT", Value: personalAgentDefaultEffort()},
							// Background-tier (TIER 2) defaults for unattended
							// loop/watch ticks — tier down to non-1M Sonnet so
							// recurring spawns stop draining the rolling window at
							// the interactive Opus default. Model-only by default
							// (effort empty → ticks keep per-loop/inherited effort).
							// See claude-code-personal-agent#35.
							{Name: "PERSONAL_AGENT_LOOP_MODEL", Value: personalAgentLoopModel()},
							{Name: "PERSONAL_AGENT_LOOP_EFFORT", Value: personalAgentLoopEffort()},
							// ROSS_WORKSPACE is intentionally inherited from the
							// image (Dockerfile: /data/workspaces) so it stays in
							// lockstep with the pre-baked chown of that exact
							// path. The hostPath mount below targets the same
							// directory so the per-agent subPath bind shows up
							// already group-writable by the `node` user.
						},
						LivenessProbe:  httpProbeOnHealthz(),
						ReadinessProbe: httpProbeOnHealthz(),
						Resources:      personalAgentResources(),
						VolumeMounts: []corev1.VolumeMount{{
							Name: "data",
							// Mount directly at the workspace base the image
							// pre-creates and chowns to node:node. Mounting at
							// /data instead would shadow that chown with a
							// fresh root-owned subPath dir, and fsGroup on a
							// hostPath subPath does not reliably re-chgrp it
							// — which is how we hit "mkdir /data/workspace:
							// permission denied" on the first channel spawn.
							MountPath: "/data/workspaces",
							SubPath:   name,
						}},
					}},
					Volumes: []corev1.Volume{{
						Name: "data",
						VolumeSource: corev1.VolumeSource{
							HostPath: &corev1.HostPathVolumeSource{
								Path: personalAgentHostPathBase,
								Type: hostPathTypePtr(corev1.HostPathDirectoryOrCreate),
							},
						},
					}},
				},
			},
		},
	}

	// Attach the per-owner Google Workspace MCP sidecar when the owner has
	// connected Google. Done as a post-literal mutation to keep the base pod
	// spec (and its comments) untouched for the common no-Google case.
	if req.GoogleWorkspaceConnected {
		tmpl := &dep.Spec.Template.Spec
		// The sidecar PATCHes its bootstrap Secret on every token rotation;
		// run the pod under the per-owner SA whose Role is scoped to exactly
		// that Secret (provisioned alongside the Secret by the credential
		// writer). The SA token is mounted in the main container too, but it
		// can only get+patch this owner's own OAuth Secret.
		tmpl.ServiceAccountName = personalAgentGwsSidecarSAName(req.SlackUserID)
		tmpl.Containers[0].Env = append(tmpl.Containers[0].Env, personalAgentGoogleEnv()...)
		if email := strings.TrimSpace(req.GoogleEmail); email != "" {
			tmpl.Containers[0].Env = append(tmpl.Containers[0].Env, corev1.EnvVar{Name: "AGENT_GOOGLE_EMAIL", Value: email})
		}
		tmpl.Containers = append(tmpl.Containers, personalAgentGwsSidecar(req.SlackUserID))
		tmpl.Volumes = append(tmpl.Volumes, personalAgentGwsVolumes(req.SlackUserID)...)
	}

	// Attach the per-owner slack-mcp sidecar (makeacompany-ai#665 WS2). Every
	// PA holds its own xoxb (PERSONAL_SLACK_BOT_TOKEN, required by
	// WriteAgentRuntimeSecret), so the sidecar reads that one key and the
	// runtime points at it on localhost — the agent's Slack MCP reach is its
	// own token only, never the shared slack-mcp bundle. Gated behind a
	// default-off env kill-switch so this merges inert; we enable it
	// fleet-wide after a dev soak. Until then PA Slack MCP behavior is
	// unchanged. Post-literal mutation, same shape as the Google block above.
	if personalAgentSlackMcpEnabled(req.SlackUserID) {
		tmpl := &dep.Spec.Template.Spec
		tmpl.Containers[0].Env = append(tmpl.Containers[0].Env, personalAgentSlackEnv()...)
		tmpl.Containers = append(tmpl.Containers, personalAgentSlackMcpSidecar(req.SlackUserID))
	}

	_, err := w.cs.AppsV1().Deployments(w.agentNamespace).Create(ctx, dep, metav1.CreateOptions{})
	if err == nil {
		return nil
	}
	if !apierrors.IsAlreadyExists(err) {
		return fmt.Errorf("create deployment %s/%s: %w", w.agentNamespace, name, err)
	}
	// Update path: replace the spec. We don't preserve operator hand-edits on
	// the spec — the provisioner is authoritative.
	_, err = w.cs.AppsV1().Deployments(w.agentNamespace).Update(ctx, dep, metav1.UpdateOptions{})
	if err != nil {
		return fmt.Errorf("update deployment %s/%s: %w", w.agentNamespace, name, err)
	}
	return nil
}

// WriteAgentService creates (or updates) the per-agent ClusterIP Service the
// events gateway forwards to.
func (w *PersonalAgentWriter) WriteAgentService(ctx context.Context, slackUserID string) error {
	if w.Disabled() {
		return ErrPersonalAgentWriterDisabled
	}
	if strings.TrimSpace(slackUserID) == "" {
		return errors.New("WriteAgentService: slack user id required")
	}
	name := personalAgentResourceName(slackUserID)
	svc := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: w.agentNamespace,
			Labels: map[string]string{
				"app.kubernetes.io/managed-by": personalAgentManagedByLabelValue,
				"app.kubernetes.io/name":       name,
				"bimross.com/integration":      personalAgentIntegrationLabel,
			},
		},
		Spec: corev1.ServiceSpec{
			Type: corev1.ServiceTypeClusterIP,
			Selector: map[string]string{
				"app.kubernetes.io/name": name,
			},
			Ports: []corev1.ServicePort{{
				Name:       "http",
				Port:       int32(PersonalAgentServicePort),
				TargetPort: intstr.FromString("http"),
				Protocol:   corev1.ProtocolTCP,
			}},
		},
	}
	_, err := w.cs.CoreV1().Services(w.agentNamespace).Create(ctx, svc, metav1.CreateOptions{})
	if err == nil {
		return nil
	}
	if !apierrors.IsAlreadyExists(err) {
		return fmt.Errorf("create service %s/%s: %w", w.agentNamespace, name, err)
	}
	// Update path. Preserve the ClusterIP (immutable post-create) by fetching
	// the existing one and copying it.
	existing, err := w.cs.CoreV1().Services(w.agentNamespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return fmt.Errorf("get existing service %s/%s: %w", w.agentNamespace, name, err)
	}
	svc.Spec.ClusterIP = existing.Spec.ClusterIP
	svc.ResourceVersion = existing.ResourceVersion
	_, err = w.cs.CoreV1().Services(w.agentNamespace).Update(ctx, svc, metav1.UpdateOptions{})
	if err != nil {
		return fmt.Errorf("update service %s/%s: %w", w.agentNamespace, name, err)
	}
	return nil
}

const (
	// personalAgentHostNode pins every personal-agent pod to one specific
	// worker. Local hostPath data only resolves on the same disk; until we
	// move to RWX storage, all per-agent pods share this node.
	personalAgentHostNode = "makeacompany"
	// personalAgentHostPathBase is where per-agent workspace data lives on
	// the host. Each agent's subPath under here is the resource name.
	personalAgentHostPathBase = "/var/lib/personal-agents"
	// personalAgentRuntimeGID matches the `node` group baked into the PA
	// image's Node Alpine base. Used as fsGroup so the container can write
	// the hostPath mount.
	personalAgentRuntimeGID int64 = 1000
)

func int64Ptr(v int64) *int64                                    { return &v }
func hostPathTypePtr(t corev1.HostPathType) *corev1.HostPathType { return &t }

// personalAgentInitContainerName is the name of the init container that
// chowns the hostPath workspace mount to node:node (UID/GID 1000) before
// the app container starts. Exported as a constant so the reconciler can
// detect deployments that predate this fix and patch them in place.
const personalAgentInitContainerName = "chown-workspace"

// personalAgentInitContainerImage is intentionally pinned to a small,
// static-ABI image with a real coreutils-style chown. busybox is sufficient
// and already cached on the makeacompany node from other workloads.
const personalAgentInitContainerImage = "busybox:1.36"

// personalAgentInitContainers returns the init-container list every
// personal-agent Deployment ships with. It chowns the per-agent hostPath
// subPath mount to node:node so the app container (running as UID 1000)
// can write the workspace. fsGroup alone is not reliable on hostPath
// subPath mounts — kubelet does not consistently recursively chgrp the
// host directory, and a fresh subPath dir is created root-owned.
//
// subPath must match the main container's VolumeMount.SubPath so the same
// host directory is targeted by the chown.
func personalAgentInitContainers(subPath string) []corev1.Container {
	return []corev1.Container{{
		Name:  personalAgentInitContainerName,
		Image: personalAgentInitContainerImage,
		// Runs as root inside the init container; the main container still
		// runs as the image's node user.
		SecurityContext: &corev1.SecurityContext{
			RunAsUser:  int64Ptr(0),
			RunAsGroup: int64Ptr(0),
		},
		Command: []string{"sh", "-c"},
		// Idempotent. chown is cheap on already-correct trees, and
		// chmod 0775 keeps the dir group-writable in case future
		// changes drop fsGroup.
		Args: []string{
			"set -e; chown -R 1000:1000 /data/workspaces; chmod 0775 /data/workspaces",
		},
		VolumeMounts: []corev1.VolumeMount{{
			Name:      "data",
			MountPath: "/data/workspaces",
			SubPath:   subPath,
		}},
	}}
}

func httpProbeOnHealthz() *corev1.Probe {
	return &corev1.Probe{
		ProbeHandler: corev1.ProbeHandler{
			HTTPGet: &corev1.HTTPGetAction{
				Path: "/healthz",
				Port: intstr.FromString("http"),
			},
		},
		InitialDelaySeconds: 5,
		PeriodSeconds:       10,
		TimeoutSeconds:      3,
		FailureThreshold:    3,
	}
}

// --- Google Workspace MCP sidecar (per-owner, OAuth 2.1) --------------------
//
// Mirrors the Ross/Joanne gws-mcp-token-sidecar (rancher-admin
// admin/apps/claude-code-*-prod/deployment.yaml) but per-owner: SECRET_NAME +
// the bootstrap Secret volume are scoped to one PA owner so the sidecar's
// rotation PATCH (Google revokes the old refresh token on every mint) writes
// back to that owner's Secret only. The PA runtime reaches it at
// localhost:8081/mcp via PERSONAL_AGENT_GOOGLE_MCP_URL.

const (
	personalAgentGwsSidecarImage         = "geeemoney/gws-mcp-token-sidecar:0.2.1"
	personalAgentGwsSidecarPort          = 8081
	personalAgentGwsSidecarContainerName = "gws-mcp-token-sidecar"
)

// personalAgentGwsGatewayBase is the in-cluster ClusterIP of the personal-agent
// OAuth 2.1 gateway (rancher-admin admin/apps/google-workspace-mcp-gateway-pa).
// Sidecars mint/refresh tokens against this; the public host
// google-mcp-pa.makeacompany.ai is only for the browser consent dance.
// Overridable fleet-wide via env without an image rebuild.
func personalAgentGwsGatewayBase() string {
	if v := strings.TrimSpace(os.Getenv("PERSONAL_AGENT_GWS_GATEWAY_BASE")); v != "" {
		return v
	}
	return "http://google-workspace-mcp-gateway-pa.google-workspace-mcp-gateway-pa.svc.cluster.local:8000"
}

// personalAgentGoogleEnv points the PA runtime at the in-pod sidecar. Only
// stamped when the owner has connected Google; the runtime's resolveGoogleMCPURL
// reads PERSONAL_AGENT_GOOGLE_MCP_URL + PERSONAL_AGENT_GOOGLE_OAUTH21.
func personalAgentGoogleEnv() []corev1.EnvVar {
	return []corev1.EnvVar{
		{Name: "PERSONAL_AGENT_GOOGLE_MCP_URL", Value: fmt.Sprintf("http://localhost:%d/mcp", personalAgentGwsSidecarPort)},
		{Name: "PERSONAL_AGENT_GOOGLE_OAUTH21", Value: "true"},
	}
}

// personalAgentGwsSidecar builds the per-owner gws-mcp-token-sidecar container.
func personalAgentGwsSidecar(slackUserID string) corev1.Container {
	return corev1.Container{
		Name:            personalAgentGwsSidecarContainerName,
		Image:           personalAgentGwsSidecarImage,
		ImagePullPolicy: corev1.PullIfNotPresent,
		Env: []corev1.EnvVar{
			{Name: "GATEWAY_BASE", Value: personalAgentGwsGatewayBase()},
			{Name: "CLIENT_ID_FILE", Value: "/etc/oauth/client_id"},
			{Name: "CLIENT_SECRET_FILE", Value: "/etc/oauth/client_secret"},
			{Name: "REFRESH_TOKEN_BOOTSTRAP_FILE", Value: "/etc/oauth/refresh_token"},
			{Name: "REFRESH_TOKEN_CURRENT_FILE", Value: "/var/oauth/refresh_token"},
			{Name: "SECRET_NAME", Value: personalAgentGoogleSecretName(slackUserID)},
		},
		Ports: []corev1.ContainerPort{{
			Name:          "mint",
			ContainerPort: int32(personalAgentGwsSidecarPort),
			Protocol:      corev1.ProtocolTCP,
		}},
		VolumeMounts: []corev1.VolumeMount{
			{Name: "oauth-bootstrap", MountPath: "/etc/oauth", ReadOnly: true},
			{Name: "oauth-current", MountPath: "/var/oauth"},
		},
		LivenessProbe:  httpProbeOnPort(personalAgentGwsSidecarPort, 15, 30),
		ReadinessProbe: httpProbeOnPort(personalAgentGwsSidecarPort, 5, 15),
		Resources: corev1.ResourceRequirements{
			// Memory: idles ~85Mi, spikes on rotate+revoke; 128Mi OOMKilled the
			// Ross sidecar, so 256Mi limit / 64Mi request (ratio 4, under the
			// personal-agents LimitRange max of 8).
			//
			// CPU: an EXPLICIT limit is required. The personal-agents namespace
			// LimitRange enforces maxLimitRequestRatio cpu=40 and injects a
			// default cpu limit of "1" when a container omits one — a 5m request
			// with the injected 1000m limit is ratio 200 and the kubelet rejects
			// the pod ("cpu max limit to request ratio per Container is 40").
			// 10m request / 100m limit = ratio 10; the sidecar's CPU is near-idle
			// except brief token-rotation spikes, so 100m is ample headroom.
			Requests: corev1.ResourceList{
				corev1.ResourceCPU:    resource.MustParse("10m"),
				corev1.ResourceMemory: resource.MustParse("64Mi"),
			},
			Limits: corev1.ResourceList{
				corev1.ResourceCPU:    resource.MustParse("100m"),
				corev1.ResourceMemory: resource.MustParse("256Mi"),
			},
		},
	}
}

// personalAgentGwsVolumes returns the sidecar's two volumes: the per-owner
// bootstrap Secret (RO) and a small writable scratch for the rotated token
// (preferred over bootstrap on boot; the sidecar also PATCHes the Secret as
// cold-start backup).
func personalAgentGwsVolumes(slackUserID string) []corev1.Volume {
	scratchLimit := resource.MustParse("1Mi")
	return []corev1.Volume{
		{
			Name: "oauth-bootstrap",
			VolumeSource: corev1.VolumeSource{
				Secret: &corev1.SecretVolumeSource{
					SecretName: personalAgentGoogleSecretName(slackUserID),
				},
			},
		},
		{
			Name: "oauth-current",
			VolumeSource: corev1.VolumeSource{
				EmptyDir: &corev1.EmptyDirVolumeSource{SizeLimit: &scratchLimit},
			},
		},
	}
}

// httpProbeOnPort is an httpGet /healthz probe on a numeric port (the sidecar
// listens on 8081, not the main container's named "http" port).
func httpProbeOnPort(port, initialDelay, period int) *corev1.Probe {
	return &corev1.Probe{
		ProbeHandler: corev1.ProbeHandler{
			HTTPGet: &corev1.HTTPGetAction{
				Path: "/healthz",
				Port: intstr.FromInt(port),
			},
		},
		InitialDelaySeconds: int32(initialDelay),
		PeriodSeconds:       int32(period),
		FailureThreshold:    3,
	}
}

// tcpProbeOnPort is a tcpSocket probe on a numeric port. The slack-mcp
// (korotovsky) SSE server has no /healthz endpoint, so we liveness/readiness
// check the TCP listener — the same shape the Ross/Joanne slack-mcp
// Deployments use (rancher-admin admin/apps/slack-mcp-*).
func tcpProbeOnPort(port, initialDelay, period int) *corev1.Probe {
	return &corev1.Probe{
		ProbeHandler: corev1.ProbeHandler{
			TCPSocket: &corev1.TCPSocketAction{Port: intstr.FromInt(port)},
		},
		InitialDelaySeconds: int32(initialDelay),
		PeriodSeconds:       int32(period),
		FailureThreshold:    3,
	}
}

// --- Slack MCP sidecar (per-owner) ------------------------------------------
//
// makeacompany-ai#665 WS2. Mirrors the Ross/Joanne slack-mcp Deployments
// (rancher-admin admin/apps/slack-mcp-*) but as a sidecar in the PA's own pod:
// it reads only this agent's xoxb (PERSONAL_SLACK_BOT_TOKEN from the per-agent
// runtime Secret, surfaced as SLACK_MCP_XOXB_TOKEN) and binds localhost:13080.
// The PA runtime reaches it via ROSS_SLACK_MCP_URL. Isolation is automatic:
// the sidecar shares the pod's network namespace and only ever holds its own
// token, so there is nothing to scope and no shared bundle to reach.

const (
	personalAgentSlackMcpImage         = "geeemoney/slack-mcp:0.1.2"
	personalAgentSlackMcpPort          = 13080
	personalAgentSlackMcpContainerName = "slack-mcp"
)

// personalAgentSlackMcpEnabled decides whether to attach the sidecar to this
// owner's pod. Default OFF so the feature merges inert. Two enable levers
// (#665 WS2 rollout — there is no dev env, so the canary lever matters):
//
//   - PERSONAL_AGENT_SLACK_MCP_SIDECAR=true — global, every PA pod.
//   - PERSONAL_AGENT_SLACK_MCP_SIDECAR_USERS="U123,U456" — per-owner canary
//     allowlist of Slack user IDs. Lets us enable one real agent in prod,
//     watch it, then widen to the global flag.
//
// When neither matches, PA Slack MCP behavior is unchanged.
func personalAgentSlackMcpEnabled(slackUserID string) bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv("PERSONAL_AGENT_SLACK_MCP_SIDECAR")))
	if v == "1" || v == "true" || v == "yes" || v == "on" {
		return true
	}
	allow := strings.TrimSpace(os.Getenv("PERSONAL_AGENT_SLACK_MCP_SIDECAR_USERS"))
	if allow == "" || strings.TrimSpace(slackUserID) == "" {
		return false
	}
	for _, id := range strings.FieldsFunc(allow, func(r rune) bool { return r == ',' || r == ' ' || r == '\n' || r == '\t' }) {
		if strings.TrimSpace(id) == strings.TrimSpace(slackUserID) {
			return true
		}
	}
	return false
}

// personalAgentSlackEnv points the PA runtime at the in-pod slack-mcp sidecar.
// The harness's resolveSlackMCPURL reads ROSS_SLACK_MCP_URL; setting it here
// overrides the shared-bundle default so a connected agent talks only to its
// own sidecar.
func personalAgentSlackEnv() []corev1.EnvVar {
	return []corev1.EnvVar{
		{Name: "ROSS_SLACK_MCP_URL", Value: fmt.Sprintf("http://localhost:%d/sse", personalAgentSlackMcpPort)},
	}
}

// personalAgentSlackMcpSidecar builds the per-owner slack-mcp sidecar container.
func personalAgentSlackMcpSidecar(slackUserID string) corev1.Container {
	return corev1.Container{
		Name:            personalAgentSlackMcpContainerName,
		Image:           personalAgentSlackMcpImage,
		ImagePullPolicy: corev1.PullIfNotPresent,
		Env: []corev1.EnvVar{
			{Name: "SLACK_MCP_HOST", Value: "0.0.0.0"},
			{Name: "SLACK_MCP_PORT", Value: fmt.Sprintf("%d", personalAgentSlackMcpPort)},
			// The agent's own bot token, mapped from the one runtime-Secret key
			// (not envFrom — the sidecar gets exactly this token, nothing else).
			{Name: "SLACK_MCP_XOXB_TOKEN", ValueFrom: &corev1.EnvVarSource{
				SecretKeyRef: &corev1.SecretKeySelector{
					LocalObjectReference: corev1.LocalObjectReference{Name: personalAgentSecretName(slackUserID)},
					Key:                  "PERSONAL_SLACK_BOT_TOKEN",
				},
			}},
			{Name: "SLACK_MCP_ADD_MESSAGE_TOOL", Value: "true"},
			{Name: "SLACK_MCP_UPDATE_MESSAGE_TOOL", Value: "true"},
			{Name: "SLACK_MCP_REACTION_TOOL", Value: "true"},
			{Name: "SLACK_MCP_MARK_TOOL", Value: "true"},
			{Name: "SLACK_MCP_ATTACHMENT_TOOL", Value: "true"},
			{Name: "SLACK_MCP_CANVAS_TOOL", Value: "true"},
		},
		Ports: []corev1.ContainerPort{{
			Name:          "sse",
			ContainerPort: int32(personalAgentSlackMcpPort),
			Protocol:      corev1.ProtocolTCP,
		}},
		LivenessProbe:  tcpProbeOnPort(personalAgentSlackMcpPort, 15, 30),
		ReadinessProbe: tcpProbeOnPort(personalAgentSlackMcpPort, 5, 15),
		Resources: corev1.ResourceRequirements{
			// Matches the Ross/Joanne slack-mcp footprint (25m/64Mi req,
			// 256Mi limit). An EXPLICIT cpu limit is required: the
			// personal-agents LimitRange injects a default cpu limit of "1"
			// when omitted and enforces maxLimitRequestRatio cpu=40 — a 25m
			// request with the injected 1000m limit is ratio 40 (at the
			// boundary). 100m limit / 25m request is ratio 4, safe headroom;
			// the server's CPU is near-idle outside brief bursts.
			Requests: corev1.ResourceList{
				corev1.ResourceCPU:    resource.MustParse("25m"),
				corev1.ResourceMemory: resource.MustParse("64Mi"),
			},
			Limits: corev1.ResourceList{
				corev1.ResourceCPU:    resource.MustParse("100m"),
				corev1.ResourceMemory: resource.MustParse("256Mi"),
			},
		},
	}
}
