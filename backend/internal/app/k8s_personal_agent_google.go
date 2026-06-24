package app

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// Per-owner Google Workspace OAuth credentials + RBAC for the in-pod
// gws-mcp-token-sidecar. The sidecar reads client_id/client_secret/refresh_token
// from the per-owner Secret and PATCHes the refresh_token back on every
// rotation (Google revokes the old one on each mint), so it needs get+patch on
// exactly that one Secret — granted via a per-owner ServiceAccount + Role so a
// compromised PA pod can't read any other owner's Secrets in the shared
// personal-agents namespace.
//
// Adapts the multi-operator slot model in k8s_workspace_writer.go (one Secret
// per channel slot) to one Secret per PA owner.

const (
	// Secret keys consumed by the sidecar (mounted as files, see
	// personalAgentGwsSidecar / the Ross oauth-sidecar recipe). Lowercase to
	// match the gws-mcp-token-sidecar's *_FILE env contract.
	personalAgentGoogleSecretKeyClientID     = "client_id"
	personalAgentGoogleSecretKeyClientSecret = "client_secret"
	personalAgentGoogleSecretKeyRefreshToken = "refresh_token"

	// Annotations on the per-owner Secret. Email is the Google account the
	// owner consented; used for the /me status panel + the (cosmetic in
	// OAuth21 mode) AGENT_GOOGLE_EMAIL instructions line.
	personalAgentGoogleAnnoEmail       = "bimross.com/google-email"
	personalAgentGoogleAnnoConnectedAt = "bimross.com/google-connected-at"
)

// EnsureGoogleSidecarRBAC idempotently creates the per-owner ServiceAccount +
// Role (get,patch scoped to exactly this owner's gws-oauth Secret) +
// RoleBinding the sidecar runs under. MUST be called before a Deployment
// references the SA — the ServiceAccount admission controller rejects a pod
// that names a non-existent ServiceAccount, so connect ordering is:
// EnsureGoogleSidecarRBAC → WriteGoogleCredentials → WriteAgentDeployment(connected).
func (w *PersonalAgentWriter) EnsureGoogleSidecarRBAC(ctx context.Context, agentID string) error {
	if w.Disabled() {
		return ErrPersonalAgentWriterDisabled
	}
	if strings.TrimSpace(agentID) == "" {
		return errors.New("EnsureGoogleSidecarRBAC: agent id empty")
	}
	name := personalAgentGwsSidecarSAName(agentID)
	secretName := personalAgentGoogleSecretName(agentID)
	ns := w.agentNamespace
	labels := map[string]string{
		"app.kubernetes.io/managed-by": personalAgentManagedByLabelValue,
		"bimross.com/integration":      personalAgentIntegrationLabel,
		personalAgentLabelAgentID:      strings.TrimSpace(agentID),
	}
	anno := map[string]string{personalAgentAnnoAgentID: strings.TrimSpace(agentID)}

	sa := &corev1.ServiceAccount{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: ns, Labels: labels, Annotations: anno},
	}
	if _, err := w.cs.CoreV1().ServiceAccounts(ns).Create(ctx, sa, metav1.CreateOptions{}); err != nil && !apierrors.IsAlreadyExists(err) {
		return fmt.Errorf("create serviceaccount %s/%s: %w", ns, name, err)
	}

	role := &rbacv1.Role{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: ns, Labels: labels},
		Rules: []rbacv1.PolicyRule{{
			APIGroups:     []string{""},
			Resources:     []string{"secrets"},
			ResourceNames: []string{secretName},
			Verbs:         []string{"get", "patch"},
		}},
	}
	// Update on conflict so a code change to the rule (e.g. the scoped Secret
	// name) converges rather than silently keeping a stale grant.
	if _, err := w.cs.RbacV1().Roles(ns).Create(ctx, role, metav1.CreateOptions{}); err != nil {
		if !apierrors.IsAlreadyExists(err) {
			return fmt.Errorf("create role %s/%s: %w", ns, name, err)
		}
		if _, err := w.cs.RbacV1().Roles(ns).Update(ctx, role, metav1.UpdateOptions{}); err != nil {
			return fmt.Errorf("update role %s/%s: %w", ns, name, err)
		}
	}

	rb := &rbacv1.RoleBinding{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: ns, Labels: labels},
		Subjects:   []rbacv1.Subject{{Kind: "ServiceAccount", Name: name, Namespace: ns}},
		RoleRef:    rbacv1.RoleRef{APIGroup: "rbac.authorization.k8s.io", Kind: "Role", Name: name},
	}
	if _, err := w.cs.RbacV1().RoleBindings(ns).Create(ctx, rb, metav1.CreateOptions{}); err != nil && !apierrors.IsAlreadyExists(err) {
		return fmt.Errorf("create rolebinding %s/%s: %w", ns, name, err)
	}
	return nil
}

// WriteGoogleCredentials upserts the per-owner gws-oauth Secret with the DCR'd
// client_id/client_secret + refresh_token captured from the owner's consent,
// after ensuring the sidecar RBAC exists. googleEmail is recorded as an
// annotation. The caller flips the Deployment to GoogleWorkspaceConnected
// afterwards (a pod restart mounts the Secret into the sidecar).
func (w *PersonalAgentWriter) WriteGoogleCredentials(ctx context.Context, agentID, googleEmail, clientID, clientSecret, refreshToken string) error {
	if w.Disabled() {
		return ErrPersonalAgentWriterDisabled
	}
	agentID = strings.TrimSpace(agentID)
	if agentID == "" {
		return errors.New("WriteGoogleCredentials: agent id empty")
	}
	if strings.TrimSpace(clientID) == "" || strings.TrimSpace(clientSecret) == "" || strings.TrimSpace(refreshToken) == "" {
		return errors.New("WriteGoogleCredentials: client_id + client_secret + refresh_token required")
	}
	if err := w.EnsureGoogleSidecarRBAC(ctx, agentID); err != nil {
		return err
	}

	name := personalAgentGoogleSecretName(agentID)
	ns := w.agentNamespace
	secret := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: ns,
			Labels: map[string]string{
				"app.kubernetes.io/managed-by": personalAgentManagedByLabelValue,
				"bimross.com/integration":      personalAgentIntegrationLabel,
				personalAgentLabelAgentID:      agentID,
			},
			Annotations: map[string]string{
				personalAgentAnnoAgentID:           agentID,
				personalAgentGoogleAnnoEmail:       strings.ToLower(strings.TrimSpace(googleEmail)),
				personalAgentGoogleAnnoConnectedAt: time.Now().UTC().Format(time.RFC3339),
			},
		},
		Type: corev1.SecretTypeOpaque,
		StringData: map[string]string{
			personalAgentGoogleSecretKeyClientID:     strings.TrimSpace(clientID),
			personalAgentGoogleSecretKeyClientSecret: strings.TrimSpace(clientSecret),
			personalAgentGoogleSecretKeyRefreshToken: strings.TrimSpace(refreshToken),
		},
	}

	_, err := w.cs.CoreV1().Secrets(ns).Create(ctx, secret, metav1.CreateOptions{})
	if err == nil {
		return nil
	}
	if !apierrors.IsAlreadyExists(err) {
		return fmt.Errorf("create google secret %s/%s: %w", ns, name, err)
	}
	// Reconnect / re-consent: replace the credential data. Update (not patch)
	// so a rotated refresh_token fully overwrites the prior value.
	if _, err := w.cs.CoreV1().Secrets(ns).Update(ctx, secret, metav1.UpdateOptions{}); err != nil {
		return fmt.Errorf("update google secret %s/%s: %w", ns, name, err)
	}
	return nil
}

// ReadGoogleEmail returns the Google account recorded on the per-owner Secret,
// or "" if the owner hasn't connected. Used by the /me status panel and to
// stamp AGENT_GOOGLE_EMAIL onto the pod.
func (w *PersonalAgentWriter) ReadGoogleEmail(ctx context.Context, agentID string) (string, error) {
	if w.Disabled() {
		return "", nil
	}
	if strings.TrimSpace(agentID) == "" {
		return "", errors.New("ReadGoogleEmail: agent id empty")
	}
	name := personalAgentGoogleSecretName(agentID)
	sec, err := w.cs.CoreV1().Secrets(w.agentNamespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		if apierrors.IsNotFound(err) {
			return "", nil
		}
		return "", fmt.Errorf("get google secret %s/%s: %w", w.agentNamespace, name, err)
	}
	return strings.TrimSpace(sec.Annotations[personalAgentGoogleAnnoEmail]), nil
}

// DeleteGoogleCredentials wipes the per-owner Secret + sidecar RBAC. Returns
// the refresh_token that was on the Secret (empty if absent) so the caller can
// best-effort revoke it before the only copy is gone. Idempotent — NotFound on
// any object is fine. The caller flips the Deployment to disconnected
// afterwards (a pod restart drops the sidecar).
func (w *PersonalAgentWriter) DeleteGoogleCredentials(ctx context.Context, agentID string) (refreshToken string, err error) {
	if w.Disabled() {
		return "", ErrPersonalAgentWriterDisabled
	}
	if strings.TrimSpace(agentID) == "" {
		return "", errors.New("DeleteGoogleCredentials: agent id empty")
	}
	ns := w.agentNamespace
	secretName := personalAgentGoogleSecretName(agentID)
	rbacName := personalAgentGwsSidecarSAName(agentID)

	// Read the refresh_token first so the caller can revoke it at the gateway/
	// Google before we drop our only copy.
	existing, getErr := w.cs.CoreV1().Secrets(ns).Get(ctx, secretName, metav1.GetOptions{})
	if getErr == nil {
		// Real API server moves StringData→Data on write; the fake clientset
		// leaves it in StringData. Check both (mirrors ReadAgentBotToken).
		if v, ok := existing.Data[personalAgentGoogleSecretKeyRefreshToken]; ok {
			refreshToken = strings.TrimSpace(string(v))
		} else if v, ok := existing.StringData[personalAgentGoogleSecretKeyRefreshToken]; ok {
			refreshToken = strings.TrimSpace(v)
		}
	} else if !apierrors.IsNotFound(getErr) {
		return "", fmt.Errorf("read google secret %s/%s: %w", ns, secretName, getErr)
	}

	if delErr := w.cs.CoreV1().Secrets(ns).Delete(ctx, secretName, metav1.DeleteOptions{}); delErr != nil && !apierrors.IsNotFound(delErr) {
		return refreshToken, fmt.Errorf("delete google secret %s/%s: %w", ns, secretName, delErr)
	}
	if delErr := w.cs.RbacV1().RoleBindings(ns).Delete(ctx, rbacName, metav1.DeleteOptions{}); delErr != nil && !apierrors.IsNotFound(delErr) {
		return refreshToken, fmt.Errorf("delete rolebinding %s/%s: %w", ns, rbacName, delErr)
	}
	if delErr := w.cs.RbacV1().Roles(ns).Delete(ctx, rbacName, metav1.DeleteOptions{}); delErr != nil && !apierrors.IsNotFound(delErr) {
		return refreshToken, fmt.Errorf("delete role %s/%s: %w", ns, rbacName, delErr)
	}
	if delErr := w.cs.CoreV1().ServiceAccounts(ns).Delete(ctx, rbacName, metav1.DeleteOptions{}); delErr != nil && !apierrors.IsNotFound(delErr) {
		return refreshToken, fmt.Errorf("delete serviceaccount %s/%s: %w", ns, rbacName, delErr)
	}
	return refreshToken, nil
}
