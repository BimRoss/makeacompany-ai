package app

import (
	"context"
	"errors"
	"fmt"
	"strings"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"
)

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
					SecurityContext: &corev1.PodSecurityContext{
						FSGroup: int64Ptr(personalAgentRuntimeGID),
					},
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
						EnvFrom: []corev1.EnvFromSource{{
							SecretRef: &corev1.SecretEnvSource{
								LocalObjectReference: corev1.LocalObjectReference{Name: secretName},
							},
						}},
						Env: []corev1.EnvVar{
							{Name: "AGENT_OWNER_USER_ID", Value: strings.TrimSpace(req.OwnerSlackUserID)},
							{Name: "AGENT_DISPLAY_NAME", Value: strings.TrimSpace(req.DisplayName)},
							// ROSS_WORKSPACE is intentionally inherited from the
							// image (Dockerfile: /data/workspaces) so it stays in
							// lockstep with the pre-baked chown of that exact
							// path. The hostPath mount below targets the same
							// directory so the per-agent subPath bind shows up
							// already group-writable by the `node` user.
						},
						LivenessProbe:  httpProbeOnHealthz(),
						ReadinessProbe: httpProbeOnHealthz(),
						Resources: corev1.ResourceRequirements{
							Requests: corev1.ResourceList{
								corev1.ResourceCPU:    resource.MustParse("250m"),
								corev1.ResourceMemory: resource.MustParse("512Mi"),
							},
							Limits: corev1.ResourceList{
								corev1.ResourceCPU:    resource.MustParse("1"),
								corev1.ResourceMemory: resource.MustParse("1Gi"),
							},
							// Per-agent workspace survives pod restarts. SubPath
							// keys on the deterministic resource name so the data
							// follows the agent even if the pod template changes.
						},
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

func int64Ptr(v int64) *int64                              { return &v }
func hostPathTypePtr(t corev1.HostPathType) *corev1.HostPathType { return &t }

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
