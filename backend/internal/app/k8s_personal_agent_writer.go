package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
)

// PersonalAgentWriter owns two K8s Secret writes for the personal-agents
// product surface:
//
//  1. WriteAgentRuntimeSecret — per-agent Secret in `personal-agents` namespace
//     keyed by hashed Slack user id. Holds the bot token + signing secret the
//     personal-agent pod consumes via envFrom. One Secret per agent.
//  2. PersistConfigTokens — strategic merge patch onto the makeacompany-ai
//     runtime Secret (where SLACK_CONFIG_ACCESS_TOKEN / *_REFRESH_TOKEN live)
//     so a token rotation survives a pod restart. Wired in as the
//     SlackManifestClient persist callback.
//
// Mirror of ShopifyWriter: in-cluster config detection, Disabled() fallback
// for local dev, fail-loud on real cluster errors.
type PersonalAgentWriter struct {
	cs                       kubernetes.Interface
	agentNamespace           string // where per-agent runtime Secrets land
	configTokensNamespace    string // where makeacompany-ai-runtime-secrets lives
	configTokensSecretName   string // typically "makeacompany-ai-runtime-secrets"
	disabled                 bool
}

const (
	personalAgentSecretNamePrefix    = "personal-agent-"
	personalAgentSecretNameSuffix    = "-runtime-secrets"
	personalAgentManagedByLabelValue = "makeacompany-ai"
	personalAgentIntegrationLabel    = "personal-agent"

	personalAgentAnnoSlackUserID = "bimross.com/slack-user-id"
	personalAgentAnnoAppID       = "bimross.com/slack-app-id"
	personalAgentAnnoInstalledAt = "bimross.com/installed-at"

	defaultPersonalAgentNamespace        = "personal-agents"
	defaultConfigTokensNamespace         = "makeacompany-ai"
	defaultConfigTokensSecretName        = "makeacompany-ai-runtime-secrets"
	configTokensAccessTokenSecretKey     = "SLACK_CONFIG_ACCESS_TOKEN"
	configTokensRefreshTokenSecretKey    = "SLACK_CONFIG_REFRESH_TOKEN"
)

// ErrPersonalAgentWriterDisabled is returned when the backend runs outside
// a cluster (local dev) and has no K8s client.
var ErrPersonalAgentWriterDisabled = errors.New("personal agent writer disabled (no in-cluster config)")

// NewPersonalAgentWriter builds an in-cluster K8s client. Pass "" for the
// optional args to accept the defaults: agent Secrets in `personal-agents`;
// config tokens in `makeacompany-ai/makeacompany-ai-runtime-secrets`.
func NewPersonalAgentWriter(agentNamespace, configTokensNamespace, configTokensSecretName string) (*PersonalAgentWriter, error) {
	w := &PersonalAgentWriter{
		agentNamespace:         firstNonEmpty(agentNamespace, defaultPersonalAgentNamespace),
		configTokensNamespace:  firstNonEmpty(configTokensNamespace, defaultConfigTokensNamespace),
		configTokensSecretName: firstNonEmpty(configTokensSecretName, defaultConfigTokensSecretName),
	}
	cfg, err := rest.InClusterConfig()
	if err != nil {
		w.disabled = true
		return w, nil
	}
	cs, err := kubernetes.NewForConfig(cfg)
	if err != nil {
		return nil, fmt.Errorf("k8s clientset: %w", err)
	}
	w.cs = cs
	return w, nil
}

// newPersonalAgentWriterWithClient is a test-only constructor that accepts a
// fake clientset so the writer can be exercised without a real cluster.
func newPersonalAgentWriterWithClient(cs kubernetes.Interface, agentNamespace, configTokensNamespace, configTokensSecretName string) *PersonalAgentWriter {
	return &PersonalAgentWriter{
		cs:                     cs,
		agentNamespace:         firstNonEmpty(agentNamespace, defaultPersonalAgentNamespace),
		configTokensNamespace:  firstNonEmpty(configTokensNamespace, defaultConfigTokensNamespace),
		configTokensSecretName: firstNonEmpty(configTokensSecretName, defaultConfigTokensSecretName),
	}
}

func (w *PersonalAgentWriter) Disabled() bool {
	return w == nil || w.disabled
}

func (w *PersonalAgentWriter) AgentNamespace() string {
	if w == nil {
		return ""
	}
	return w.agentNamespace
}

// personalAgentResourceName is the shared base name for a personal-agent's
// K8s resources (Deployment, Service, and the Secret which appends a suffix).
// sha256(slack_user_id) truncated to 12 hex chars — matches the shopify-conn shape.
func personalAgentResourceName(slackUserID string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(slackUserID)))
	return personalAgentSecretNamePrefix + hex.EncodeToString(sum[:6])
}

// personalAgentSecretName derives the deterministic Secret name for a Slack
// user id.
func personalAgentSecretName(slackUserID string) string {
	return personalAgentResourceName(slackUserID) + personalAgentSecretNameSuffix
}

// PersonalAgentServicePort is the well-known port the per-agent HTTP Events
// server listens on (matches claude-code-personal-agent's PERSONAL_HTTP_EVENTS_ADDR
// default of :8080).
const PersonalAgentServicePort = 8080

// personalAgentSecretData returns the stringData payload for a per-agent
// runtime Secret. Single source of truth so the create + patch paths can't
// drift on which keys are written.
func personalAgentSecretData(req PersonalAgentRuntimeSecretRequest) map[string]string {
	data := map[string]string{
		"PERSONAL_SLACK_BOT_TOKEN":      req.BotToken,
		"PERSONAL_SLACK_SIGNING_SECRET": req.SigningSecret,
	}
	if v := strings.TrimSpace(req.ClaudeCodeOAuthToken); v != "" {
		data["CLAUDE_CODE_OAUTH_TOKEN"] = v
	}
	if v := strings.TrimSpace(req.ClaudeCodeOAuthToken2); v != "" {
		data["CLAUDE_CODE_OAUTH_TOKEN_2"] = v
	}
	return data
}

// ReadAgentBotToken returns the bot token (xoxb-) stored in the per-agent
// runtime Secret. Used by the icon-current endpoint to call Slack on the
// agent's behalf without round-tripping through a different storage layer.
func (w *PersonalAgentWriter) ReadAgentBotToken(ctx context.Context, slackUserID string) (string, error) {
	if w.Disabled() {
		return "", ErrPersonalAgentWriterDisabled
	}
	if strings.TrimSpace(slackUserID) == "" {
		return "", errors.New("ReadAgentBotToken: slack user id empty")
	}
	name := personalAgentSecretName(slackUserID)
	sec, err := w.cs.CoreV1().Secrets(w.agentNamespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		if apierrors.IsNotFound(err) {
			return "", errors.New("agent runtime secret not found")
		}
		return "", fmt.Errorf("get runtime secret: %w", err)
	}
	if raw, ok := sec.Data["PERSONAL_SLACK_BOT_TOKEN"]; ok {
		token := strings.TrimSpace(string(raw))
		if token != "" {
			return token, nil
		}
	}
	if raw, ok := sec.StringData["PERSONAL_SLACK_BOT_TOKEN"]; ok {
		token := strings.TrimSpace(raw)
		if token != "" {
			return token, nil
		}
	}
	return "", errors.New("runtime secret missing PERSONAL_SLACK_BOT_TOKEN")
}

// PersonalAgentRuntimeSecretRequest is what the provisioner hands the writer
// once the agent's Slack app has been installed and we have bot + signing
// credentials in hand.
//
// ClaudeCodeOAuthToken / ClaudeCodeOAuthToken2 are the shared Claude-Code
// OAuth-token pool used by Ross + Joanne + every personal agent. The pool is
// centralized in makeacompany-ai-runtime-secrets and propagated into each
// per-agent runtime Secret here so the spawned `claude` CLI authenticates
// out of the box. Per-user OAuth (so each personal agent has its own pool +
// rate budget) is a follow-up.
type PersonalAgentRuntimeSecretRequest struct {
	SlackUserID            string
	SlackAppID             string
	BotToken               string // xoxb-
	SigningSecret          string // from apps.manifest.create credentials
	ClaudeCodeOAuthToken   string // from runtime-secrets, optional but recommended
	ClaudeCodeOAuthToken2  string // second token in the shared pool
}

// WriteAgentRuntimeSecret upserts the per-agent runtime Secret. The personal
// agent pod's envFrom points at this Secret name, so writing it (and rolling
// the pod) is what makes Garth-equivalents "alive."
func (w *PersonalAgentWriter) WriteAgentRuntimeSecret(ctx context.Context, req PersonalAgentRuntimeSecretRequest) error {
	if w.Disabled() {
		return ErrPersonalAgentWriterDisabled
	}
	slackUserID := strings.TrimSpace(req.SlackUserID)
	if slackUserID == "" {
		return errors.New("WriteAgentRuntimeSecret: slack user id empty")
	}
	if strings.TrimSpace(req.BotToken) == "" || strings.TrimSpace(req.SigningSecret) == "" {
		return errors.New("WriteAgentRuntimeSecret: bot token + signing secret required")
	}
	name := personalAgentSecretName(slackUserID)
	secret := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: w.agentNamespace,
			Labels: map[string]string{
				"app.kubernetes.io/managed-by": personalAgentManagedByLabelValue,
				"bimross.com/integration":      personalAgentIntegrationLabel,
			},
			Annotations: map[string]string{
				personalAgentAnnoSlackUserID: slackUserID,
				personalAgentAnnoAppID:       strings.TrimSpace(req.SlackAppID),
				personalAgentAnnoInstalledAt: time.Now().UTC().Format(time.RFC3339),
			},
		},
		Type: corev1.SecretTypeOpaque,
		StringData: personalAgentSecretData(req),
	}

	_, err := w.cs.CoreV1().Secrets(w.agentNamespace).Create(ctx, secret, metav1.CreateOptions{})
	if err == nil {
		return nil
	}
	if !apierrors.IsAlreadyExists(err) {
		return fmt.Errorf("create per-agent secret %s/%s: %w", w.agentNamespace, name, err)
	}
	// Already exists — update in place. Preserves anything an operator may
	// have added by hand (e.g. AGENT_GOOGLE_EMAIL) by only patching the keys
	// we own.
	stringDataJSON, err := json.Marshal(personalAgentSecretData(req))
	if err != nil {
		return fmt.Errorf("marshal patch stringData: %w", err)
	}
	patch := []byte(fmt.Sprintf(
		`{"stringData":%s,"metadata":{"annotations":{%q:%q}}}`,
		string(stringDataJSON),
		personalAgentAnnoInstalledAt, time.Now().UTC().Format(time.RFC3339),
	))
	_, err = w.cs.CoreV1().Secrets(w.agentNamespace).Patch(ctx, name, types.StrategicMergePatchType, patch, metav1.PatchOptions{})
	if err != nil {
		return fmt.Errorf("patch per-agent secret %s/%s: %w", w.agentNamespace, name, err)
	}
	return nil
}

// PersistConfigTokens patches the makeacompany-ai runtime Secret with the
// rotated config tokens. Returns nil on Disabled() so the in-memory cache
// stays the only source of truth in local dev.
func (w *PersonalAgentWriter) PersistConfigTokens(ctx context.Context, access, refresh string) error {
	if w.Disabled() {
		return nil
	}
	if strings.TrimSpace(access) == "" || strings.TrimSpace(refresh) == "" {
		return errors.New("PersistConfigTokens: empty token in pair")
	}
	patch := []byte(fmt.Sprintf(
		`{"stringData":{%q:%q,%q:%q}}`,
		configTokensAccessTokenSecretKey, access,
		configTokensRefreshTokenSecretKey, refresh,
	))
	_, err := w.cs.CoreV1().Secrets(w.configTokensNamespace).Patch(ctx, w.configTokensSecretName, types.StrategicMergePatchType, patch, metav1.PatchOptions{})
	if err != nil {
		return fmt.Errorf("patch config tokens %s/%s: %w", w.configTokensNamespace, w.configTokensSecretName, err)
	}
	return nil
}

// firstNonEmpty returns the first non-whitespace value. Mirrors the helper
// in cmd/personal-agent — kept local here so this file has no external deps
// beyond the k8s client.
func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if trimmed := strings.TrimSpace(v); trimmed != "" {
			return trimmed
		}
	}
	return ""
}
