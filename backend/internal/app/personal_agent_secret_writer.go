package app

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
)

// Personal-agent k8s Secret writer (#186 PR3 of 6). Lives next to the
// company-channel `WorkspaceWriter` but owns its own clientset + scope:
//
//   - Namespace fixed to `personal-agents` (PR4 lands the matching
//     RBAC; this binary's ServiceAccount can only create/update/get
//     `secrets` in that namespace, and the writer self-rejects any
//     other namespace as escape protection).
//   - Secret name fixed to `personal-agent-<slug>-secrets`. Mismatched
//     names are rejected for the same reason — the RBAC role's
//     `resourceNames` is constrained to this pattern.
//
// The Secret holds the three Slack credentials the per-agent harness
// pod mounts at boot: `slack_bot_token` (xoxb-…), `slack_app_token`
// (xapp-…), and `agent_slack_bot_user_id` (U…). Format is validated at
// write-time so the runtime pod doesn't have to defend against
// malformed paste input.

const (
	// PersonalAgentNamespace is the single Kubernetes namespace that
	// holds every personal-agent's per-pod Secret. Hard-coded so it
	// matches the RBAC role's namespace binding (#186 PR4) — runtime
	// changes here without a matching RBAC change would 403.
	PersonalAgentNamespace = "personal-agents"

	// personalAgentSecretNameTmpl is the only Secret name shape the
	// writer is allowed to produce. Matches the RBAC role's
	// `resourceNames` constraint.
	personalAgentSecretNameTmpl = "personal-agent-%s-secrets"
)

// ErrPersonalAgentSecretWriterDisabled mirrors ErrWorkspaceWriterDisabled
// for the personal-agent surface — returned when the backend isn't
// running in-cluster (local dev). All write methods return this in
// disabled state so handlers can 503 cleanly.
var ErrPersonalAgentSecretWriterDisabled = errors.New("personal-agent secret writer disabled (no in-cluster config)")

// PersonalAgentSlackTokens is the validated input the handler hands
// the writer. Each field is checked before any cluster call; an
// invalid struct returns an error without touching k8s.
type PersonalAgentSlackTokens struct {
	BotToken      string // xoxb-…
	AppToken      string // xapp-…
	BotUserID     string // U… / W… / B…
}

// PersonalAgentSecretWriter is the k8s Secret writer for personal
// agents. Constructed once at startup; nil-safe Disabled() check lets
// handlers branch on availability without panicking.
type PersonalAgentSecretWriter struct {
	cs       kubernetes.Interface
	disabled bool
}

// NewPersonalAgentSecretWriter builds the in-cluster client. Outside a
// cluster (local dev), returns a disabled writer whose methods all
// return ErrPersonalAgentSecretWriterDisabled. Mirrors NewWorkspaceWriter.
func NewPersonalAgentSecretWriter() (*PersonalAgentSecretWriter, error) {
	cfg, err := rest.InClusterConfig()
	if err != nil {
		// Same convention as WorkspaceWriter: out-of-cluster builds
		// produce a disabled writer rather than failing startup.
		return &PersonalAgentSecretWriter{disabled: true}, nil
	}
	cs, err := kubernetes.NewForConfig(cfg)
	if err != nil {
		return nil, fmt.Errorf("personal-agent secret writer clientset: %w", err)
	}
	return &PersonalAgentSecretWriter{cs: cs}, nil
}

// newPersonalAgentSecretWriterFromClient is a test seam — lets tests
// inject a fake kubernetes.Interface without going through
// in-cluster discovery.
func newPersonalAgentSecretWriterFromClient(cs kubernetes.Interface) *PersonalAgentSecretWriter {
	return &PersonalAgentSecretWriter{cs: cs}
}

func (w *PersonalAgentSecretWriter) Disabled() bool {
	return w == nil || w.disabled || w.cs == nil
}

// PersonalAgentSecretName returns the k8s Secret name the writer would
// produce for the given slug, without touching the cluster. Useful for
// observability + the runtime template (PR5 of #186) which mounts the
// same name.
func PersonalAgentSecretName(slug string) string {
	return fmt.Sprintf(personalAgentSecretNameTmpl, slug)
}

var (
	botTokenRe = regexp.MustCompile(`^xoxb-[A-Za-z0-9-]{10,200}$`)
	appTokenRe = regexp.MustCompile(`^xapp-[A-Za-z0-9-]{10,200}$`)
)

// ValidatePersonalAgentSlackTokens enforces the wire-shape contract
// for the paste-token endpoint. Each field has a distinct, narrow
// regex so a swapped paste (bot token in the app-token field) is
// caught at the boundary — see the troubleshooting table in
// docs/personal-agents/slack-app-manifest.md.
func ValidatePersonalAgentSlackTokens(t PersonalAgentSlackTokens) error {
	bot := strings.TrimSpace(t.BotToken)
	app := strings.TrimSpace(t.AppToken)
	uid := strings.TrimSpace(t.BotUserID)

	switch {
	case bot == "" || app == "" || uid == "":
		return errors.New("all three of bot_token, app_token, and bot_user_id are required")
	case !botTokenRe.MatchString(bot):
		return errors.New("bot_token must start with xoxb- and look like a Slack bot token")
	case !appTokenRe.MatchString(app):
		return errors.New("app_token must start with xapp- and look like a Slack app-level token")
	case !ValidSlackUserID(uid):
		return errors.New("bot_user_id must be a Slack user/bot id (U…, W…, B…)")
	}
	return nil
}

// WriteSlackSecret upserts the per-agent Secret in PersonalAgentNamespace.
// Idempotent: same inputs on a second call refresh the
// `consented-at` annotation but leave the data unchanged. Returns
// ErrPersonalAgentSecretWriterDisabled on local dev so handlers can
// 503 cleanly without a partial write.
func (w *PersonalAgentSecretWriter) WriteSlackSecret(ctx context.Context, slug string, tokens PersonalAgentSlackTokens) error {
	if w.Disabled() {
		return ErrPersonalAgentSecretWriterDisabled
	}
	if !ValidPersonalAgentSlug(slug) {
		return ErrInvalidPersonalAgentSlug
	}
	if err := ValidatePersonalAgentSlackTokens(tokens); err != nil {
		return err
	}

	name := PersonalAgentSecretName(slug)
	secret := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: PersonalAgentNamespace,
			Labels: map[string]string{
				"app.kubernetes.io/managed-by": "makeacompany-ai",
				"bimross.com/personal-agent":   slug,
			},
			Annotations: map[string]string{
				"bimross.com/written-at": time.Now().UTC().Format(time.RFC3339),
			},
		},
		Type: corev1.SecretTypeOpaque,
		Data: map[string][]byte{
			"slack_bot_token":         []byte(strings.TrimSpace(tokens.BotToken)),
			"slack_app_token":         []byte(strings.TrimSpace(tokens.AppToken)),
			"agent_slack_bot_user_id": []byte(strings.TrimSpace(tokens.BotUserID)),
		},
	}

	_, err := w.cs.CoreV1().Secrets(PersonalAgentNamespace).Create(ctx, secret, metav1.CreateOptions{})
	if apierrors.IsAlreadyExists(err) {
		_, err = w.cs.CoreV1().Secrets(PersonalAgentNamespace).Update(ctx, secret, metav1.UpdateOptions{})
	}
	if err != nil {
		return fmt.Errorf("write personal-agent secret %s/%s: %w", PersonalAgentNamespace, name, err)
	}
	return nil
}

// DeleteSlackSecret removes the per-agent Secret when an agent is
// deleted from the portal. Idempotent: missing Secret is not an error
// (the agent was created but never had a token pasted yet). Caller is
// responsible for tearing down the matching deployment + workspace
// PVC; those land in PR4/PR5 of #186.
func (w *PersonalAgentSecretWriter) DeleteSlackSecret(ctx context.Context, slug string) error {
	if w.Disabled() {
		return ErrPersonalAgentSecretWriterDisabled
	}
	if !ValidPersonalAgentSlug(slug) {
		return ErrInvalidPersonalAgentSlug
	}
	name := PersonalAgentSecretName(slug)
	err := w.cs.CoreV1().Secrets(PersonalAgentNamespace).Delete(ctx, name, metav1.DeleteOptions{})
	if apierrors.IsNotFound(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("delete personal-agent secret %s/%s: %w", PersonalAgentNamespace, name, err)
	}
	return nil
}
