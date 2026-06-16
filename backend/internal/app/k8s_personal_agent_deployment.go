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
					Containers: []corev1.Container{{
						Name:  "personal-agent",
						Image: req.Image,
						Ports: []corev1.ContainerPort{{
							Name:          "http",
							ContainerPort: int32(PersonalAgentServicePort),
							Protocol:      corev1.ProtocolTCP,
						}},
						EnvFrom: []corev1.EnvFromSource{{
							SecretRef: &corev1.SecretEnvSource{
								LocalObjectReference: corev1.LocalObjectReference{Name: secretName},
							},
						}},
						Env: []corev1.EnvVar{
							{Name: "AGENT_OWNER_USER_ID", Value: strings.TrimSpace(req.OwnerSlackUserID)},
							{Name: "AGENT_DISPLAY_NAME", Value: strings.TrimSpace(req.DisplayName)},
							{Name: "ROSS_WORKSPACE", Value: "/data/workspace"},
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
