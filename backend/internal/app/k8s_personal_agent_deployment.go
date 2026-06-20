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

// personalAgentDefaultModel / personalAgentDefaultEffort are stamped onto every
// generated PA pod. Default to opus-4-7[1m] (what the shared OAuth pool accounts
// support free on the 5h rolling limit; sonnet-4-6[1m] 429s without usage
// credits). Override fleet-wide via the backend env without an image rebuild.
func personalAgentDefaultModel() string {
	if v := strings.TrimSpace(os.Getenv("PERSONAL_AGENT_DEFAULT_MODEL")); v != "" {
		return v
	}
	return "claude-opus-4-7[1m]"
}

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
// rebuild, mirroring personalAgentDefaultModel et al. A typo'd override falls
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
							// Stamp the spawn model/effort defaults onto every PA
							// pod so they hold regardless of which PA image is
							// running (the baked-in handlers.go constant could be
							// stale) and survive re-provisioning. opus-4-7[1m] is
							// what the shared OAuth pool accounts support free on
							// the 5h rolling limit; sonnet-4-6[1m] 429s ("usage
							// credits required for 1M context"). Override fleet-wide
							// from the backend env without an image rebuild.
							{Name: "PERSONAL_AGENT_DEFAULT_MODEL", Value: personalAgentDefaultModel()},
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
