package app

import (
	"context"
	"errors"
	"fmt"
	"strings"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// DeleteAgentResources removes the per-agent Deployment, Service, and
// runtime Secret from the personal-agents namespace. Used by the "delete
// agent" flow. Each resource is deleted independently; per-resource
// NotFound is tolerated (idempotent), other errors are surfaced.
func (w *PersonalAgentWriter) DeleteAgentResources(ctx context.Context, slackUserID string) error {
	if w.Disabled() {
		return ErrPersonalAgentWriterDisabled
	}
	if strings.TrimSpace(slackUserID) == "" {
		return errors.New("DeleteAgentResources: slack user id required")
	}
	name := personalAgentResourceName(slackUserID)
	secretName := personalAgentSecretName(slackUserID)

	var problems []string

	// Deployment first so the pod stops before its Service goes away.
	if err := w.cs.AppsV1().Deployments(w.agentNamespace).Delete(ctx, name, metav1.DeleteOptions{}); err != nil && !apierrors.IsNotFound(err) {
		problems = append(problems, fmt.Sprintf("delete deployment: %v", err))
	}
	if err := w.cs.CoreV1().Services(w.agentNamespace).Delete(ctx, name, metav1.DeleteOptions{}); err != nil && !apierrors.IsNotFound(err) {
		problems = append(problems, fmt.Sprintf("delete service: %v", err))
	}
	if err := w.cs.CoreV1().Secrets(w.agentNamespace).Delete(ctx, secretName, metav1.DeleteOptions{}); err != nil && !apierrors.IsNotFound(err) {
		problems = append(problems, fmt.Sprintf("delete secret: %v", err))
	}

	if len(problems) > 0 {
		return errors.New(strings.Join(problems, "; "))
	}
	return nil
}
