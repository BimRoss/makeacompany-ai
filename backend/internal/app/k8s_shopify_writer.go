package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
)

// ShopifyWriter stores per-user Shopify OAuth credentials as Kubernetes
// Secrets in a single namespace, keyed by hashed Slack user id. Mirrors
// the per-operator pattern in k8s_workspace_writer.go (gws-mcp#15) — same
// rationale (RBAC isolation, audit via the API server, no new infra), but
// flat: one namespace, one secret per user, since Shopify connections are
// per-user-account rather than per-channel-per-operator.
//
// Storage layout (one Secret per connection):
//
//	namespace: shopifyNamespace (typically "makeacompany-ai")
//	name:      "shopify-conn-<sha256(slackUserID)[:12]>"
//	labels:    app.kubernetes.io/managed-by=makeacompany-ai
//	           bimross.com/integration=shopify
//	annotations:
//	           bimross.com/slack-user-id=<plaintext slackUserID, for shop->user reverse lookup>
//	           bimross.com/shop-domain=<plaintext shop, indexed for webhook routing>
//	           bimross.com/installed-at=<RFC3339>
//	data:
//	           shop_domain=<bytes>
//	           access_token=<bytes>
//	           scopes=<comma-joined scope csv>

const (
	shopifySecretNamePrefix    = "shopify-conn-"
	shopifyManagedByLabelValue = "makeacompany-ai"
	shopifyIntegrationLabel    = "shopify"

	shopifyAnnoSlackUserID = "bimross.com/slack-user-id"
	shopifyAnnoShopDomain  = "bimross.com/shop-domain"
	shopifyAnnoInstalledAt = "bimross.com/installed-at"
)

// ShopifyConnection is the in-memory shape of one stored connection.
type ShopifyConnection struct {
	SlackUserID string
	ShopDomain  string
	AccessToken string
	Scopes      []string
	InstalledAt time.Time
}

// ShopifyWriter owns the K8s clientset + target namespace for Shopify
// connection Secrets.
type ShopifyWriter struct {
	cs        *kubernetes.Clientset
	namespace string
	disabled  bool
}

// ErrShopifyWriterDisabled is returned when the backend is running outside
// a cluster (local dev) and the Shopify writer has no K8s client.
var ErrShopifyWriterDisabled = errors.New("shopify writer disabled (no in-cluster config)")

// ErrShopifyNotConnected — no Secret exists for the given Slack user id.
// Caller surfaces 404 to the harness so the skill can prompt the user to
// run the OAuth flow.
var ErrShopifyNotConnected = errors.New("shopify connection not found for user")

// NewShopifyWriter builds an in-cluster K8s client targeting `namespace`.
// Local dev (no in-cluster config) returns a disabled writer; all R/W
// methods then return ErrShopifyWriterDisabled.
func NewShopifyWriter(namespace string) (*ShopifyWriter, error) {
	namespace = strings.TrimSpace(namespace)
	if namespace == "" {
		namespace = "makeacompany-ai"
	}
	cfg, err := rest.InClusterConfig()
	if err != nil {
		return &ShopifyWriter{namespace: namespace, disabled: true}, nil
	}
	cs, err := kubernetes.NewForConfig(cfg)
	if err != nil {
		return nil, fmt.Errorf("k8s clientset: %w", err)
	}
	return &ShopifyWriter{cs: cs, namespace: namespace}, nil
}

func (w *ShopifyWriter) Disabled() bool {
	return w == nil || w.disabled
}

// shopifySecretName derives the deterministic Secret name for a Slack
// user id. SHA-256 + first 12 hex chars = 48 bits — collision-resistant
// for our scale (way under 2^24 users) and stays under K8s name length.
// We do not include the Slack user id verbatim in the Secret name so an
// operator listing Secrets in the namespace can't enumerate connected
// users by name alone; the annotation has it for legitimate lookups.
func shopifySecretName(slackUserID string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(slackUserID)))
	return shopifySecretNamePrefix + hex.EncodeToString(sum[:6])
}

// WriteShopifyConnection creates or updates the per-user Secret.
// Safe to call on re-connect — Update replaces the access_token in place.
func (w *ShopifyWriter) WriteShopifyConnection(ctx context.Context, conn ShopifyConnection) error {
	if w.Disabled() {
		return ErrShopifyWriterDisabled
	}
	slackUserID := strings.TrimSpace(conn.SlackUserID)
	shop := strings.ToLower(strings.TrimSpace(conn.ShopDomain))
	token := strings.TrimSpace(conn.AccessToken)
	if slackUserID == "" || shop == "" || token == "" {
		return fmt.Errorf("shopify connection requires slack_user_id, shop_domain, access_token")
	}
	if !ValidShopifyShopDomain(shop) {
		return fmt.Errorf("invalid shop domain %q", shop)
	}
	installedAt := conn.InstalledAt
	if installedAt.IsZero() {
		installedAt = time.Now().UTC()
	}
	name := shopifySecretName(slackUserID)
	secret := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: w.namespace,
			Labels: map[string]string{
				"app.kubernetes.io/managed-by": shopifyManagedByLabelValue,
				"bimross.com/integration":      shopifyIntegrationLabel,
			},
			Annotations: map[string]string{
				shopifyAnnoSlackUserID: slackUserID,
				shopifyAnnoShopDomain:  shop,
				shopifyAnnoInstalledAt: installedAt.Format(time.RFC3339),
			},
		},
		Type: corev1.SecretTypeOpaque,
		Data: map[string][]byte{
			"shop_domain":  []byte(shop),
			"access_token": []byte(token),
			"scopes":       []byte(strings.Join(normalizeShopifyScopes(conn.Scopes), ",")),
		},
	}
	_, err := w.cs.CoreV1().Secrets(w.namespace).Create(ctx, secret, metav1.CreateOptions{})
	if apierrors.IsAlreadyExists(err) {
		_, err = w.cs.CoreV1().Secrets(w.namespace).Update(ctx, secret, metav1.UpdateOptions{})
	}
	if err != nil {
		return fmt.Errorf("write shopify secret %s/%s: %w", w.namespace, name, err)
	}
	return nil
}

// GetShopifyConnection reads the Secret for a Slack user id. Returns
// ErrShopifyNotConnected on miss.
func (w *ShopifyWriter) GetShopifyConnection(ctx context.Context, slackUserID string) (ShopifyConnection, error) {
	if w.Disabled() {
		return ShopifyConnection{}, ErrShopifyWriterDisabled
	}
	slackUserID = strings.TrimSpace(slackUserID)
	if slackUserID == "" {
		return ShopifyConnection{}, fmt.Errorf("slack_user_id required")
	}
	name := shopifySecretName(slackUserID)
	secret, err := w.cs.CoreV1().Secrets(w.namespace).Get(ctx, name, metav1.GetOptions{})
	if apierrors.IsNotFound(err) {
		return ShopifyConnection{}, ErrShopifyNotConnected
	}
	if err != nil {
		return ShopifyConnection{}, fmt.Errorf("read shopify secret %s/%s: %w", w.namespace, name, err)
	}
	return shopifyConnectionFromSecret(secret), nil
}

// GetShopifyConnectionByShop returns the connection for a given shop
// domain. Used by the webhook receiver to route an incoming webhook back
// to the user's channel. Implemented as a label-scoped list — for our N
// (≤1000 shops) this is acceptable; at scale we'd reach for a Redis
// shop→user index alongside the Secret store.
func (w *ShopifyWriter) GetShopifyConnectionByShop(ctx context.Context, shopDomain string) (ShopifyConnection, error) {
	if w.Disabled() {
		return ShopifyConnection{}, ErrShopifyWriterDisabled
	}
	shop := strings.ToLower(strings.TrimSpace(shopDomain))
	if shop == "" {
		return ShopifyConnection{}, fmt.Errorf("shop_domain required")
	}
	list, err := w.cs.CoreV1().Secrets(w.namespace).List(ctx, metav1.ListOptions{
		LabelSelector: "app.kubernetes.io/managed-by=" + shopifyManagedByLabelValue + ",bimross.com/integration=" + shopifyIntegrationLabel,
	})
	if err != nil {
		return ShopifyConnection{}, fmt.Errorf("list shopify secrets: %w", err)
	}
	for i := range list.Items {
		if strings.EqualFold(list.Items[i].Annotations[shopifyAnnoShopDomain], shop) {
			return shopifyConnectionFromSecret(&list.Items[i]), nil
		}
	}
	return ShopifyConnection{}, ErrShopifyNotConnected
}

// DeleteShopifyConnection removes the Secret. Returns the prior shop +
// access_token so callers can best-effort revoke at Shopify before the
// Secret is gone. Idempotent on missing.
func (w *ShopifyWriter) DeleteShopifyConnection(ctx context.Context, slackUserID string) (shopDomain, accessToken string, err error) {
	if w.Disabled() {
		return "", "", ErrShopifyWriterDisabled
	}
	conn, err := w.GetShopifyConnection(ctx, slackUserID)
	if errors.Is(err, ErrShopifyNotConnected) {
		return "", "", nil
	}
	if err != nil {
		return "", "", err
	}
	name := shopifySecretName(slackUserID)
	if err := w.cs.CoreV1().Secrets(w.namespace).Delete(ctx, name, metav1.DeleteOptions{}); err != nil && !apierrors.IsNotFound(err) {
		return conn.ShopDomain, conn.AccessToken, fmt.Errorf("delete shopify secret %s/%s: %w", w.namespace, name, err)
	}
	return conn.ShopDomain, conn.AccessToken, nil
}

func shopifyConnectionFromSecret(s *corev1.Secret) ShopifyConnection {
	conn := ShopifyConnection{
		SlackUserID: strings.TrimSpace(s.Annotations[shopifyAnnoSlackUserID]),
		ShopDomain:  strings.TrimSpace(string(s.Data["shop_domain"])),
		AccessToken: strings.TrimSpace(string(s.Data["access_token"])),
	}
	if raw := strings.TrimSpace(string(s.Data["scopes"])); raw != "" {
		for _, sc := range strings.Split(raw, ",") {
			sc = strings.TrimSpace(sc)
			if sc != "" {
				conn.Scopes = append(conn.Scopes, sc)
			}
		}
	}
	if ts := strings.TrimSpace(s.Annotations[shopifyAnnoInstalledAt]); ts != "" {
		if t, err := time.Parse(time.RFC3339, ts); err == nil {
			conn.InstalledAt = t
		}
	}
	return conn
}

func normalizeShopifyScopes(in []string) []string {
	out := make([]string, 0, len(in))
	seen := make(map[string]bool, len(in))
	for _, s := range in {
		s = strings.TrimSpace(strings.ToLower(s))
		if s == "" || seen[s] {
			continue
		}
		seen[s] = true
		out = append(out, s)
	}
	return out
}
