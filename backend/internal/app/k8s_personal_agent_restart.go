package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
)

// PatchAgentSystemPrompt updates only the PERSONAL_AGENT_SYSTEM_PROMPT key
// on the per-agent runtime Secret. Empty string clears the key (the wrapper
// then falls back to the blank-slate persona). Used by the "edit agent"
// flow so we don't have to re-mint the bot token to rotate the prompt.
func (w *PersonalAgentWriter) PatchAgentSystemPrompt(ctx context.Context, slackUserID, prompt string) error {
	if w.Disabled() {
		return ErrPersonalAgentWriterDisabled
	}
	if strings.TrimSpace(slackUserID) == "" {
		return errors.New("PatchAgentSystemPrompt: slack user id empty")
	}
	name := personalAgentSecretName(slackUserID)
	patchObj := map[string]any{
		"stringData": map[string]any{
			"PERSONAL_AGENT_SYSTEM_PROMPT": prompt,
		},
	}
	patchBytes, err := json.Marshal(patchObj)
	if err != nil {
		return err
	}
	_, err = w.cs.CoreV1().Secrets(w.agentNamespace).Patch(ctx, name, types.StrategicMergePatchType, patchBytes, metav1.PatchOptions{})
	if err != nil {
		if apierrors.IsNotFound(err) {
			return errors.New("agent runtime secret not found")
		}
		return fmt.Errorf("patch system prompt: %w", err)
	}
	return nil
}

// RestartAgentDeployment forces a rolling restart of the per-agent
// Deployment by bumping a template annotation. The dispatcher pod stops,
// envFrom re-reads the Secret, and the next inbound Slack message sees the
// new PERSONAL_AGENT_SYSTEM_PROMPT.
//
// Idempotent: re-running while a rollout is in flight just sets the same
// annotation again. NotFound is tolerated (caller can race the delete flow).
func (w *PersonalAgentWriter) RestartAgentDeployment(ctx context.Context, slackUserID string) error {
	if w.Disabled() {
		return ErrPersonalAgentWriterDisabled
	}
	if strings.TrimSpace(slackUserID) == "" {
		return errors.New("RestartAgentDeployment: slack user id empty")
	}
	name := personalAgentResourceName(slackUserID)
	now := time.Now().UTC().Format(time.RFC3339)
	patchObj := map[string]any{
		"spec": map[string]any{
			"template": map[string]any{
				"metadata": map[string]any{
					"annotations": map[string]any{
						"bimross.com/restarted-at": now,
					},
				},
			},
		},
	}
	patchBytes, err := json.Marshal(patchObj)
	if err != nil {
		return err
	}
	_, err = w.cs.AppsV1().Deployments(w.agentNamespace).Patch(ctx, name, types.StrategicMergePatchType, patchBytes, metav1.PatchOptions{})
	if err != nil {
		if apierrors.IsNotFound(err) {
			return errors.New("agent deployment not found")
		}
		return fmt.Errorf("patch deployment for restart: %w", err)
	}
	return nil
}
