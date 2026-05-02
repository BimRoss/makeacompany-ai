package app

import (
	"os"
	"strconv"
	"strings"
)

type Config struct {
	Port                    int
	RedisURL                string
	CompanyChannelsRedisURL string
	CompanyChannelsRedisKey string
	// CapabilityRoutingEventsRedisKey is the Redis LIST key employee-factory LPUSHes routing observability into (admin debug panel).
	CapabilityRoutingEventsRedisKey string
	AppBaseURL                      string
	AdminCatalogToken               string
	CapabilityCatalogReadToken      string
	// RequireCapabilityCatalogReadToken enforces a non-empty runtime catalog bearer token at /v1/runtime/capability-catalog.
	// Defaults true in production (APP_ENV=production), false otherwise. Can be overridden via REQUIRE_CAPABILITY_CATALOG_READ_TOKEN.
	RequireCapabilityCatalogReadToken bool
	// SlackOrchestratorCapabilityCatalogURL, when set: GET /v1/runtime/capability-catalog prefers live JSON from
	// slack-orchestrator (e.g. .../v1/public/capability-catalog); missing Redis catalog key seeds from it; GET /v1/admin/catalog
	// merges in new skills from a cached orchestrator fetch so older Redis snapshots stay aligned.
	SlackOrchestratorCapabilityCatalogURL string
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
	// SlackBotToken is the same env as slack-orchestrator: SLACK_BOT_TOKEN (users:read + users:read.email for admin users.list).
	SlackBotToken string
	// JoanneHumansWelcomeTriggerURL is the employee-factory Joanne HTTP root (e.g. http://127.0.0.1:8080) for POST /internal/joanne/humans-welcome/trigger.
	JoanneHumansWelcomeTriggerURL string
	// JoanneHumansWelcomeTriggerToken must match JOANNE_HUMANS_WELCOME_TRIGGER_TOKEN on the Joanne pod (Authorization: Bearer).
	JoanneHumansWelcomeTriggerToken string
	// OrchestratorDebugBaseURL is slack-orchestrator HTTP root (same as Next ORCHESTRATOR_DEBUG_BASE_URL)
	// for member-channel and channel-member sync reads.
	OrchestratorDebugBaseURL string
	OrchestratorDebugToken   string
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
}

// stripePriceIDBasePlan returns STRIPE_PRICE_ID_BASE_PLAN, else legacy STRIPE_PRICE_ID_WAITLIST.
func stripePriceIDBasePlan() string {
	v := strings.TrimSpace(os.Getenv("STRIPE_PRICE_ID_BASE_PLAN"))
	if v != "" {
		return v
	}
	return strings.TrimSpace(os.Getenv("STRIPE_PRICE_ID_WAITLIST"))
}

func LoadConfig() Config {
	requireCatalogReadTokenDefault := strings.EqualFold(strings.TrimSpace(os.Getenv("APP_ENV")), "production")
	return Config{
		Port:                                  envInt("PORT", 8080),
		RedisURL:                              envString("REDIS_URL", "redis://localhost:6379/0"),
		CompanyChannelsRedisURL:               strings.TrimSpace(os.Getenv("COMPANY_CHANNELS_REDIS_URL")),
		CompanyChannelsRedisKey:               envString("COMPANY_CHANNELS_REDIS_KEY", "employee-factory:company_channels"),
		CapabilityRoutingEventsRedisKey:       envString("CAPABILITY_ROUTING_EVENTS_REDIS_KEY", "employee-factory:capability_routing_events"),
		AppBaseURL:                            strings.TrimRight(envString("APP_BASE_URL", "http://localhost:3000"), "/"),
		AdminCatalogToken:                     strings.TrimSpace(os.Getenv("ADMIN_CATALOG_TOKEN")),
		CapabilityCatalogReadToken:            strings.TrimSpace(os.Getenv("CAPABILITY_CATALOG_READ_TOKEN")),
		RequireCapabilityCatalogReadToken:     envBool("REQUIRE_CAPABILITY_CATALOG_READ_TOKEN", requireCatalogReadTokenDefault),
		SlackOrchestratorCapabilityCatalogURL: strings.TrimSpace(os.Getenv("SLACK_ORCHESTRATOR_CAPABILITY_CATALOG_URL")),
		BackendInternalServiceToken:           strings.TrimSpace(os.Getenv("BACKEND_INTERNAL_SERVICE_TOKEN")),
		AdminSignInAllowlist:                  envCSV("ADMIN_SIGN_IN_ALLOWLIST"),
		AdminSessionTTLSec:                    envInt("ADMIN_SESSION_TTL_SEC", 259200),
		StripeSecretKey:                       strings.TrimSpace(os.Getenv("STRIPE_SECRET_KEY")),
		StripeWebhookSecret:                   strings.TrimSpace(os.Getenv("STRIPE_WEBHOOK_SECRET")),
		StripePriceBasePlan:                   stripePriceIDBasePlan(),
		SlackBotToken:                         strings.TrimSpace(os.Getenv("SLACK_BOT_TOKEN")),
		JoanneHumansWelcomeTriggerURL:         strings.TrimSuffix(strings.TrimSpace(os.Getenv("JOANNE_HUMANS_WELCOME_TRIGGER_URL")), "/"),
		JoanneHumansWelcomeTriggerToken:       strings.TrimSpace(os.Getenv("JOANNE_HUMANS_WELCOME_TRIGGER_TOKEN")),
		OrchestratorDebugBaseURL:              strings.TrimSpace(os.Getenv("ORCHESTRATOR_DEBUG_BASE_URL")),
		OrchestratorDebugToken:                strings.TrimSpace(os.Getenv("ORCHESTRATOR_DEBUG_TOKEN")),
		GoogleOAuthClientID:                   strings.TrimSpace(os.Getenv("GOOGLE_OAUTH_CLIENT_ID")),
		ResendAPIKey:                          strings.TrimSpace(os.Getenv("RESEND_API_KEY")),
		PortalAuthEmailFrom:                   strings.TrimSpace(os.Getenv("PORTAL_AUTH_EMAIL_FROM")),
		ResendMagicLinkTemplateID:             strings.TrimSpace(os.Getenv("RESEND_MAGIC_LINK_TEMPLATE_ID")),
		ResendMagicLinkTemplateLinkVar:        strings.TrimSpace(os.Getenv("RESEND_MAGIC_LINK_TEMPLATE_LINK_VAR")),
		ResendMagicLinkTemplateFirstNameVar:   strings.TrimSpace(os.Getenv("RESEND_MAGIC_LINK_TEMPLATE_FIRST_NAME_VAR")),
		ResendCheckoutWelcomeTemplateID:       strings.TrimSpace(os.Getenv("RESEND_CHECKOUT_WELCOME_TEMPLATE_ID")),
	}
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
