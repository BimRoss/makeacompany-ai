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
func (w *PersonalAgentWriter) PatchAgentSystemPrompt(ctx context.Context, agentID, prompt string) error {
	if w.Disabled() {
		return ErrPersonalAgentWriterDisabled
	}
	if strings.TrimSpace(agentID) == "" {
		return errors.New("PatchAgentSystemPrompt: agent id empty")
	}
	name := personalAgentSecretName(agentID)
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

// PatchAgentKnowledgeEnv writes the three knowledge-related env vars
// (PERSONAL_AGENT_ID, PERSONAL_AGENT_KNOWLEDGE_TOKEN, MAKEACOMPANY_API_BASE)
// onto an existing per-agent runtime Secret without disturbing the bot token
// or signing secret. Used to backfill agents minted before #607.
func (w *PersonalAgentWriter) PatchAgentKnowledgeEnv(ctx context.Context, agentID, token, backendBaseURL string) error {
	if w.Disabled() {
		return ErrPersonalAgentWriterDisabled
	}
	if strings.TrimSpace(agentID) == "" || strings.TrimSpace(token) == "" {
		return errors.New("PatchAgentKnowledgeEnv: agent id + token required")
	}
	name := personalAgentSecretName(agentID)
	stringData := map[string]any{
		"PERSONAL_AGENT_ID":              agentID,
		"PERSONAL_AGENT_KNOWLEDGE_TOKEN": token,
	}
	if v := strings.TrimSpace(backendBaseURL); v != "" {
		stringData["MAKEACOMPANY_API_BASE"] = v
	}
	patchObj := map[string]any{"stringData": stringData}
	patchBytes, err := json.Marshal(patchObj)
	if err != nil {
		return err
	}
	_, err = w.cs.CoreV1().Secrets(w.agentNamespace).Patch(ctx, name, types.StrategicMergePatchType, patchBytes, metav1.PatchOptions{})
	if err != nil {
		if apierrors.IsNotFound(err) {
			return errors.New("agent runtime secret not found")
		}
		return fmt.Errorf("patch knowledge env: %w", err)
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
func (w *PersonalAgentWriter) RestartAgentDeployment(ctx context.Context, agentID string) error {
	if w.Disabled() {
		return ErrPersonalAgentWriterDisabled
	}
	if strings.TrimSpace(agentID) == "" {
		return errors.New("RestartAgentDeployment: agent id empty")
	}
	name := personalAgentResourceName(agentID)
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
