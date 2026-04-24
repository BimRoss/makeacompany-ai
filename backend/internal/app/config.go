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
	// SlackOrchestratorCapabilityCatalogURL, when set: GET /v1/runtime/capability-catalog prefers live JSON from
	// slack-orchestrator (e.g. .../debug/capability-catalog); missing Redis catalog key seeds from it; GET /v1/admin/catalog
	// merges in new skills from a cached orchestrator fetch so older Redis snapshots stay aligned.
	SlackOrchestratorCapabilityCatalogURL string
	// BackendInternalServiceToken gates /v1/internal/* maintenance endpoints only.
	BackendInternalServiceToken string
	AdminSessionTTLSec          int
	StripeSecretKey             string
	StripeWebhookSecret         string
	// StripePriceWaitlist is the waitlist checkout price for this deployment (test or live); see STRIPE_PRICE_ID_WAITLIST.
	StripePriceWaitlist string
	// SlackBotToken is the same env as slack-orchestrator: SLACK_BOT_TOKEN (users:read + users:read.email for admin users.list).
	SlackBotToken string
	// OrchestratorDebugBaseURL is slack-orchestrator HTTP root (same as Next ORCHESTRATOR_DEBUG_BASE_URL) for GET /debug/member-channels snapshots.
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
}

func LoadConfig() Config {
	return Config{
		Port:                                  envInt("PORT", 8080),
		RedisURL:                              envString("REDIS_URL", "redis://localhost:6379/0"),
		CompanyChannelsRedisURL:               strings.TrimSpace(os.Getenv("COMPANY_CHANNELS_REDIS_URL")),
		CompanyChannelsRedisKey:               envString("COMPANY_CHANNELS_REDIS_KEY", "employee-factory:company_channels"),
		CapabilityRoutingEventsRedisKey:       envString("CAPABILITY_ROUTING_EVENTS_REDIS_KEY", "employee-factory:capability_routing_events"),
		AppBaseURL:                            strings.TrimRight(envString("APP_BASE_URL", "http://localhost:3000"), "/"),
		AdminCatalogToken:                     strings.TrimSpace(os.Getenv("ADMIN_CATALOG_TOKEN")),
		CapabilityCatalogReadToken:            strings.TrimSpace(os.Getenv("CAPABILITY_CATALOG_READ_TOKEN")),
		SlackOrchestratorCapabilityCatalogURL: strings.TrimSpace(os.Getenv("SLACK_ORCHESTRATOR_CAPABILITY_CATALOG_URL")),
		BackendInternalServiceToken:           strings.TrimSpace(os.Getenv("BACKEND_INTERNAL_SERVICE_TOKEN")),
		AdminSessionTTLSec:                    envInt("ADMIN_SESSION_TTL_SEC", 259200),
		StripeSecretKey:                       strings.TrimSpace(os.Getenv("STRIPE_SECRET_KEY")),
		StripeWebhookSecret:                   strings.TrimSpace(os.Getenv("STRIPE_WEBHOOK_SECRET")),
		StripePriceWaitlist:                   strings.TrimSpace(os.Getenv("STRIPE_PRICE_ID_WAITLIST")),
		SlackBotToken:                         strings.TrimSpace(os.Getenv("SLACK_BOT_TOKEN")),
		OrchestratorDebugBaseURL:              strings.TrimSpace(os.Getenv("ORCHESTRATOR_DEBUG_BASE_URL")),
		OrchestratorDebugToken:                strings.TrimSpace(os.Getenv("ORCHESTRATOR_DEBUG_TOKEN")),
		GoogleOAuthClientID:                   strings.TrimSpace(os.Getenv("GOOGLE_OAUTH_CLIENT_ID")),
		ResendAPIKey:                          strings.TrimSpace(os.Getenv("RESEND_API_KEY")),
		PortalAuthEmailFrom:                   strings.TrimSpace(os.Getenv("PORTAL_AUTH_EMAIL_FROM")),
		ResendMagicLinkTemplateID:             strings.TrimSpace(os.Getenv("RESEND_MAGIC_LINK_TEMPLATE_ID")),
		ResendMagicLinkTemplateLinkVar:        strings.TrimSpace(os.Getenv("RESEND_MAGIC_LINK_TEMPLATE_LINK_VAR")),
		ResendMagicLinkTemplateFirstNameVar:   strings.TrimSpace(os.Getenv("RESEND_MAGIC_LINK_TEMPLATE_FIRST_NAME_VAR")),
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
