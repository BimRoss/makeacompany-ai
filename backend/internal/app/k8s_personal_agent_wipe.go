package app

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// WipeAgentWorkspace spawns a one-shot Job that rm -rfs the per-agent hostPath
// subdirectory on the node where personal-agents run. Used by the "Delete
// agent + wipe workspace" flow so a re-created agent doesn't inherit the
// previous one's ~/.claude transcripts.
//
// The Job:
//   - mounts the same hostPath base (read-write) used by personal-agent pods
//   - runs as root so it can rm files written by the previous fsGroup=1000
//     container regardless of who owned them
//   - is pinned via nodeSelector to the same node so hostPath actually
//     resolves to the data we want to delete
//   - auto-cleans 300s after completion via ttlSecondsAfterFinished
//
// Returns nil on success or on a NotFound deployment (idempotent — nothing to
// wipe). Job-creation errors surface to the caller.
func (w *PersonalAgentWriter) WipeAgentWorkspace(ctx context.Context, agentID string) error {
	if w.Disabled() {
		return ErrPersonalAgentWriterDisabled
	}
	if strings.TrimSpace(agentID) == "" {
		return errors.New("WipeAgentWorkspace: agent id required")
	}
	name := personalAgentResourceName(agentID)
	jobName := fmt.Sprintf("wipe-%s-%d", name, time.Now().Unix())

	job := &batchv1.Job{
		ObjectMeta: metav1.ObjectMeta{
			Name:      jobName,
			Namespace: w.agentNamespace,
			Labels: map[string]string{
				"app.kubernetes.io/managed-by": personalAgentManagedByLabelValue,
				"bimross.com/integration":      personalAgentIntegrationLabel,
				"bimross.com/role":             "workspace-wipe",
			},
			Annotations: map[string]string{
				personalAgentAnnoAgentID: strings.TrimSpace(agentID),
			},
		},
		Spec: batchv1.JobSpec{
			BackoffLimit:            int32Ptr(1),
			TTLSecondsAfterFinished: int32Ptr(300),
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{
					Labels: map[string]string{
						"app.kubernetes.io/managed-by": personalAgentManagedByLabelValue,
						"bimross.com/role":             "workspace-wipe",
					},
				},
				Spec: corev1.PodSpec{
					RestartPolicy: corev1.RestartPolicyNever,
					NodeSelector:  map[string]string{"kubernetes.io/hostname": personalAgentHostNode},
					SecurityContext: &corev1.PodSecurityContext{
						RunAsUser:  int64Ptr(0),
						RunAsGroup: int64Ptr(0),
					},
					Containers: []corev1.Container{
						{
							Name:    "wipe",
							Image:   "busybox:1.37",
							Command: []string{"sh", "-c"},
							// `rm -rf` of a missing subdir succeeds — safe even if the
							// agent's deployment never actually persisted anything yet.
							Args: []string{fmt.Sprintf("set -eux; rm -rf /data/%s", name)},
							VolumeMounts: []corev1.VolumeMount{
								{Name: "data", MountPath: "/data"},
							},
						},
					},
					Volumes: []corev1.Volume{
						{
							Name: "data",
							VolumeSource: corev1.VolumeSource{
								HostPath: &corev1.HostPathVolumeSource{
									Path: personalAgentHostPathBase,
									Type: hostPathTypePtr(corev1.HostPathDirectoryOrCreate),
								},
							},
						},
					},
				},
			},
		},
	}

	_, err := w.cs.BatchV1().Jobs(w.agentNamespace).Create(ctx, job, metav1.CreateOptions{})
	if err != nil && !apierrors.IsAlreadyExists(err) {
		return fmt.Errorf("create wipe job: %w", err)
	}
	return nil
}

func int32Ptr(v int32) *int32 { return &v }
