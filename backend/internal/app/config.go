package app

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	Port       int
	RedisURL   string
	AppBaseURL string
	// AppEnv is the deployment environment label (e.g. "production", "development").
	// Used to gate prod-only behavior such as strict CORS and startup secret validation.
	AppEnv string
	// BackendInternalServiceToken gates /v1/internal/* maintenance endpoints only.
	BackendInternalServiceToken string
	// AdminSignInAllowlist contains normalized emails that may complete /admin sign-in flows.
	AdminSignInAllowlist []string
	AdminSessionTTLSec   int
	StripeSecretKey      string
	StripeWebhookSecret  string
	// StripePriceBasePlan is the Stripe Dashboard "Base Plan" price_* used for homepage checkout (test or live).
	// Env: STRIPE_PRICE_ID_BASE_PLAN; legacy STRIPE_PRICE_ID_WAITLIST is still read if BASE_PLAN is unset.
	StripePriceBasePlan string
	// StripePriceWaitlistDeposit is an optional second price_* (one-time waitlist / deposit) whose completed
	// Checkouts are merged into the same admin Stripe table as Base Plan. Env: STRIPE_PRICE_ID_WAITLIST_DEPOSIT.
	StripePriceWaitlistDeposit string
	// SlackBotToken is the workspace Slack bot token used for users.list, users.conversations, and conversations.members.
	// Primary env: ORCHESTRATOR_SLACK_BOT_TOKEN (historical name; matches the token Joanne/Ross use).
	// Legacy fallback: SLACK_BOT_TOKEN (kept until rancher-admin runtime secret is rotated).
	SlackBotToken string
	// GoogleOAuthClientID is the Google OAuth Web client id (used as id_token audience for /v1/portal/auth/google/finish).
	GoogleOAuthClientID string
	// ResendAPIKey enables portal magic-link email (optional).
	ResendAPIKey string
	// PortalAuthEmailFrom is the Resend "from" address for magic links, e.g. "MakeACompany <auth@yourdomain.com>".
	PortalAuthEmailFrom string
	// ResendMagicLinkTemplateID, when set (e.g. "account-login"), sends magic links via Resend Templates API instead of inline HTML.
	ResendMagicLinkTemplateID string
	// ResendMagicLinkTemplateLinkVar is the template variable key for the magic-link URL (must match the published template; default login_url).
	ResendMagicLinkTemplateLinkVar string
	// ResendMagicLinkTemplateFirstNameVar is the key for a first-name greeting (default recipient_first_name). Reserves FIRST_NAME on Resend; use this custom key in the template instead.
	ResendMagicLinkTemplateFirstNameVar string
	// ResendCheckoutWelcomeTemplateID, when set (e.g. welcome-email), sends post-checkout welcome mail via Resend Templates API.
	// Uses the same variable keys as RESEND_MAGIC_LINK_TEMPLATE_* (defaults: login_url → Slack invite, recipient_first_name).
	ResendCheckoutWelcomeTemplateID string
	// GA4PropertyID is the numeric Google Analytics 4 property id (e.g. "527260023") for the admin GA4 panel.
	// When unset, /v1/admin/ga4-summary returns 503. Reads via Google Application Default Credentials
	// (GOOGLE_APPLICATION_CREDENTIALS pointing to a service-account key with Viewer on the property).
	GA4PropertyID string
	// FreeTierGateEnabled activates the deploy gate: free users are blocked from shipping until they subscribe.
	// Env: STRIPE_FREE_TIER_GATE_ENABLED=true. Defaults off so the code can ship to prod before the gate is turned on.
	FreeTierGateEnabled bool
	// WorkspaceTenantConfig is a JSON map: channelId -> { namespace, deployment, slots: { email: slotN } }.
	// Powers /v1/portal/workspace/connect/finish (BimRoss/google-workspace-mcp#15). Empty disables the
	// endpoint with 503. v1 is static (hand-roll claude-code-ross-customer-grant per rancher-admin#465);
	// dynamic per-tenant config arrives with rancher-admin#354's template extraction.
	WorkspaceTenantConfig string
	// PersonalAgentsEnabled gates the personal-agent tenancy surface (issue #183):
	// /me/agents portal pages, POST /v1/portal/agents, /admin/personal-agents admin
	// view, the per-agent OAuth fork, and the dispatcher's owner-only guard at the
	// pod-boot level. Default false — backend ships dormant; flag-flip in rancher-
	// admin's makeacompany-ai configmap activates the surface. Off must be a hard
	// shutdown of personal-agent pods (not a no-op of the guard), per #183 audit
	// point 11; runtime template enforces that in PR4 of #186.
	PersonalAgentsEnabled bool
}

// stripePriceIDBasePlan returns STRIPE_PRICE_ID_BASE_PLAN, else legacy STRIPE_PRICE_ID_WAITLIST.
func stripePriceIDBasePlan() string {
	v := strings.TrimSpace(os.Getenv("STRIPE_PRICE_ID_BASE_PLAN"))
	if v != "" {
		return v
	}
	return strings.TrimSpace(os.Getenv("STRIPE_PRICE_ID_WAITLIST"))
}

// orchestratorSlackBotToken returns ORCHESTRATOR_SLACK_BOT_TOKEN, else legacy SLACK_BOT_TOKEN.
// The env name is historical (slack-orchestrator service is gone); the token itself is Joanne/Ross's.
func orchestratorSlackBotToken() string {
	if v := strings.TrimSpace(os.Getenv("ORCHESTRATOR_SLACK_BOT_TOKEN")); v != "" {
		return v
	}
	return strings.TrimSpace(os.Getenv("SLACK_BOT_TOKEN"))
}

func LoadConfig() Config {
	return Config{
		Port:                                envInt("PORT", 8080),
		RedisURL:                            envString("REDIS_URL", "redis://localhost:6379/0"),
		AppBaseURL:                          strings.TrimRight(envString("APP_BASE_URL", "http://localhost:3000"), "/"),
		AppEnv:                              strings.ToLower(strings.TrimSpace(envString("APP_ENV", "development"))),
		BackendInternalServiceToken:         strings.TrimSpace(os.Getenv("BACKEND_INTERNAL_SERVICE_TOKEN")),
		AdminSignInAllowlist:                envCSV("ADMIN_SIGN_IN_ALLOWLIST"),
		AdminSessionTTLSec:                  envInt("ADMIN_SESSION_TTL_SEC", 259200),
		StripeSecretKey:                     strings.TrimSpace(os.Getenv("STRIPE_SECRET_KEY")),
		StripeWebhookSecret:                 strings.TrimSpace(os.Getenv("STRIPE_WEBHOOK_SECRET")),
		StripePriceBasePlan:                 stripePriceIDBasePlan(),
		StripePriceWaitlistDeposit:          strings.TrimSpace(os.Getenv("STRIPE_PRICE_ID_WAITLIST_DEPOSIT")),
		SlackBotToken:                       orchestratorSlackBotToken(),
		GoogleOAuthClientID:                 strings.TrimSpace(os.Getenv("GOOGLE_OAUTH_CLIENT_ID")),
		ResendAPIKey:                        strings.TrimSpace(os.Getenv("RESEND_API_KEY")),
		PortalAuthEmailFrom:                 strings.TrimSpace(os.Getenv("PORTAL_AUTH_EMAIL_FROM")),
		ResendMagicLinkTemplateID:           strings.TrimSpace(os.Getenv("RESEND_MAGIC_LINK_TEMPLATE_ID")),
		ResendMagicLinkTemplateLinkVar:      strings.TrimSpace(os.Getenv("RESEND_MAGIC_LINK_TEMPLATE_LINK_VAR")),
		ResendMagicLinkTemplateFirstNameVar: strings.TrimSpace(os.Getenv("RESEND_MAGIC_LINK_TEMPLATE_FIRST_NAME_VAR")),
		ResendCheckoutWelcomeTemplateID:     strings.TrimSpace(os.Getenv("RESEND_CHECKOUT_WELCOME_TEMPLATE_ID")),
		GA4PropertyID:                       strings.TrimSpace(os.Getenv("GA4_PROPERTY_ID")),
		FreeTierGateEnabled:                 envBool("STRIPE_FREE_TIER_GATE_ENABLED", false),
		WorkspaceTenantConfig:               strings.TrimSpace(os.Getenv("WORKSPACE_TENANT_CONFIG")),
		PersonalAgentsEnabled:               envBool("PERSONAL_AGENTS_ENABLED", false),
	}
}

// ValidateForProd returns an error listing every required-but-missing/malformed prod secret.
// Only runs strict checks when AppEnv == "production"; in dev it's a no-op.
func (c Config) ValidateForProd() error {
	if c.AppEnv != "production" {
		return nil
	}
	var problems []string
	if !strings.HasPrefix(c.StripeSecretKey, "sk_live_") {
		problems = append(problems, "STRIPE_SECRET_KEY must be a live key (sk_live_...)")
	}
	if c.StripeWebhookSecret == "" || !strings.HasPrefix(c.StripeWebhookSecret, "whsec_") {
		problems = append(problems, "STRIPE_WEBHOOK_SECRET must be set (whsec_...)")
	}
	if !strings.HasPrefix(c.StripePriceBasePlan, "price_") {
		problems = append(problems, "STRIPE_PRICE_ID_BASE_PLAN must be set (price_...)")
	}
	if c.RedisURL == "" {
		problems = append(problems, "REDIS_URL must be set")
	}
	if c.BackendInternalServiceToken == "" {
		problems = append(problems, "BACKEND_INTERNAL_SERVICE_TOKEN must be set")
	}
	if !strings.HasPrefix(c.AppBaseURL, "https://") {
		problems = append(problems, "APP_BASE_URL must use https in production")
	}
	if len(problems) == 0 {
		return nil
	}
	return fmt.Errorf("prod config invalid:\n  - %s", strings.Join(problems, "\n  - "))
}

func envString(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envInt(key string, fallback int) int {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return fallback
	}
	return n
}

func envBool(key string, fallback bool) bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv(key)))
	if v == "" {
		return fallback
	}
	switch v {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return fallback
	}
}

func envCSV(key string) []string {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	seen := map[string]struct{}{}
	for _, p := range parts {
		v := strings.ToLower(strings.TrimSpace(p))
		if v == "" {
			continue
		}
		if _, ok := seen[v]; ok {
			continue
		}
		seen[v] = struct{}{}
		out = append(out, v)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}
