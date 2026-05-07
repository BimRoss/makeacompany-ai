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
	// ChannelKnowledgeRedisKeyFmt is a fmt string with one %s for Slack channel id (GET digest in admin; prune cleanup).
	// Must match agent-factory / worker channel-knowledge writers (see AGENT_FACTORY_CHANNEL_KNOWLEDGE_REDIS_KEY_FMT).
	ChannelKnowledgeRedisKeyFmt string
	// CompanyChannelsInvalidateChannel is the Redis PUB/SUB channel for registry reloads; must match workers.
	CompanyChannelsInvalidateChannel string
	// ThreadOwnerRedisKeyScanPattern is a fmt string with one %s for channel id, ending in * for SCAN (prune auxiliary keys).
	ThreadOwnerRedisKeyScanPattern string
	// CapabilityRoutingEventsRedisKey is the Redis LIST key Slack workers LPUSH routing observability into (admin debug panel).
	CapabilityRoutingEventsRedisKey string
	AppBaseURL                      string
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
	// SlackBotToken is the orchestrator/admin Slack token used for users.list (users:read + users:read.email).
	// Primary env: ORCHESTRATOR_SLACK_BOT_TOKEN (matches agents-mcp-server / slack-orchestrator multi-bot .env).
	// Legacy fallback: SLACK_BOT_TOKEN (kept until rancher-admin runtime secret is rotated).
	SlackBotToken string
	// OrchestratorDebugBaseURL is slack-orchestrator HTTP root (same as Next ORCHESTRATOR_DEBUG_BASE_URL)
	// for member-channel and channel-member sync reads.
	OrchestratorDebugBaseURL string
	OrchestratorDebugToken   string
	// AgentFactoryAdminBaseURL proxies runtime authority endpoints for admin channel/registry data against employee-factory.
	AgentFactoryAdminBaseURL string
	AgentFactoryAdminToken   string
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
	// SkillsMCPBaseURL is the REST root of skills-mcp-server (e.g. http://skills-mcp-server:8081). When set, the
	// public read-only `/v1/public/agent-skills` endpoint proxies GET /api/skills. Empty disables that route.
	SkillsMCPBaseURL string
	// AgentsMCPBaseURL is the HTTP root of agents-mcp-server (e.g. http://agents-mcp-server:8090). When set,
	// `/v1/public/agents-roster` proxies GET /api/roster for canonical squad listings.
	AgentsMCPBaseURL string
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
// Lets the backend pick up the multi-bot key already set in agents-mcp-server / slack-orchestrator
// .env files while existing rancher-admin runtime secrets still using SLACK_BOT_TOKEN keep working.
func orchestratorSlackBotToken() string {
	if v := strings.TrimSpace(os.Getenv("ORCHESTRATOR_SLACK_BOT_TOKEN")); v != "" {
		return v
	}
	return strings.TrimSpace(os.Getenv("SLACK_BOT_TOKEN"))
}

func LoadConfig() Config {
	backendInternal := strings.TrimSpace(os.Getenv("BACKEND_INTERNAL_SERVICE_TOKEN"))
	agentFactoryAdminTok := strings.TrimSpace(os.Getenv("AGENT_FACTORY_ADMIN_TOKEN"))
	// agent-factory-admin requireInternal expects the same bearer as BACKEND_INTERNAL_SERVICE_TOKEN on agent-factory-runtime.
	// Operators often set only BACKEND_INTERNAL_SERVICE_TOKEN on makeacompany-ai-runtime-secrets; proxy would send no
	// Authorization without this fallback (401 on registry-prune paths, etc.).
	if agentFactoryAdminTok == "" && backendInternal != "" {
		agentFactoryAdminTok = backendInternal
	}
	return Config{
		Port:                                envInt("PORT", 8080),
		RedisURL:                            envString("REDIS_URL", "redis://localhost:6379/0"),
		CompanyChannelsRedisURL:             strings.TrimSpace(os.Getenv("COMPANY_CHANNELS_REDIS_URL")),
		CompanyChannelsRedisKey:             envString("COMPANY_CHANNELS_REDIS_KEY", "agent-factory:company_channels"),
		ChannelKnowledgeRedisKeyFmt:         envString("CHANNEL_KNOWLEDGE_REDIS_KEY_FMT", "agent-factory:channel_knowledge:%s:markdown"),
		CompanyChannelsInvalidateChannel:    envString("COMPANY_CHANNELS_INVALIDATE_CHANNEL", "agent-factory:company_channels:invalidate"),
		ThreadOwnerRedisKeyScanPattern:      envString("THREAD_OWNER_REDIS_KEY_SCAN_PATTERN", "agent-factory:thread_owner:%s:*"),
		CapabilityRoutingEventsRedisKey:     envString("CAPABILITY_ROUTING_EVENTS_REDIS_KEY", "agent-factory:capability_routing_events"),
		AppBaseURL:                          strings.TrimRight(envString("APP_BASE_URL", "http://localhost:3000"), "/"),
		BackendInternalServiceToken:         backendInternal,
		AdminSignInAllowlist:                envCSV("ADMIN_SIGN_IN_ALLOWLIST"),
		AdminSessionTTLSec:                  envInt("ADMIN_SESSION_TTL_SEC", 259200),
		StripeSecretKey:                     strings.TrimSpace(os.Getenv("STRIPE_SECRET_KEY")),
		StripeWebhookSecret:                 strings.TrimSpace(os.Getenv("STRIPE_WEBHOOK_SECRET")),
		StripePriceBasePlan:                 stripePriceIDBasePlan(),
		StripePriceWaitlistDeposit:          strings.TrimSpace(os.Getenv("STRIPE_PRICE_ID_WAITLIST_DEPOSIT")),
		SlackBotToken:                       orchestratorSlackBotToken(),
		OrchestratorDebugBaseURL:            strings.TrimSpace(os.Getenv("ORCHESTRATOR_DEBUG_BASE_URL")),
		OrchestratorDebugToken:              strings.TrimSpace(os.Getenv("ORCHESTRATOR_DEBUG_TOKEN")),
		AgentFactoryAdminBaseURL:            strings.TrimSuffix(strings.TrimSpace(os.Getenv("AGENT_FACTORY_ADMIN_BASE_URL")), "/"),
		AgentFactoryAdminToken:              agentFactoryAdminTok,
		GoogleOAuthClientID:                 strings.TrimSpace(os.Getenv("GOOGLE_OAUTH_CLIENT_ID")),
		ResendAPIKey:                        strings.TrimSpace(os.Getenv("RESEND_API_KEY")),
		PortalAuthEmailFrom:                 strings.TrimSpace(os.Getenv("PORTAL_AUTH_EMAIL_FROM")),
		ResendMagicLinkTemplateID:           strings.TrimSpace(os.Getenv("RESEND_MAGIC_LINK_TEMPLATE_ID")),
		ResendMagicLinkTemplateLinkVar:      strings.TrimSpace(os.Getenv("RESEND_MAGIC_LINK_TEMPLATE_LINK_VAR")),
		ResendMagicLinkTemplateFirstNameVar: strings.TrimSpace(os.Getenv("RESEND_MAGIC_LINK_TEMPLATE_FIRST_NAME_VAR")),
		ResendCheckoutWelcomeTemplateID:     strings.TrimSpace(os.Getenv("RESEND_CHECKOUT_WELCOME_TEMPLATE_ID")),
		SkillsMCPBaseURL:                    strings.TrimRight(strings.TrimSpace(os.Getenv("SKILLS_MCP_BASE_URL")), "/"),
		AgentsMCPBaseURL:                    strings.TrimRight(strings.TrimSpace(os.Getenv("AGENTS_MCP_BASE_URL")), "/"),
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
