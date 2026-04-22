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
	AdminAllowedEmail                     string
	// BackendInternalServiceToken matches Next.js BACKEND_INTERNAL_SERVICE_TOKEN (server-to-server admin reads).
	BackendInternalServiceToken string
	AdminSessionTTLSec          int
	StripeSecretKey             string
	StripeWebhookSecret         string
	// StripePriceWaitlist is the waitlist checkout price for this deployment (test or live); see STRIPE_PRICE_ID_WAITLIST.
	StripePriceWaitlist string
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
		AdminAllowedEmail:                     strings.ToLower(strings.TrimSpace(os.Getenv("ADMIN_ALLOWED_EMAIL"))),
		BackendInternalServiceToken:           strings.TrimSpace(os.Getenv("BACKEND_INTERNAL_SERVICE_TOKEN")),
		AdminSessionTTLSec:                    envInt("ADMIN_SESSION_TTL_SEC", 259200),
		StripeSecretKey:                       strings.TrimSpace(os.Getenv("STRIPE_SECRET_KEY")),
		StripeWebhookSecret:                   strings.TrimSpace(os.Getenv("STRIPE_WEBHOOK_SECRET")),
		StripePriceWaitlist:                   strings.TrimSpace(os.Getenv("STRIPE_PRICE_ID_WAITLIST")),
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
