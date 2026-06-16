package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/stripe/stripe-go/v82"
	checkoutsession "github.com/stripe/stripe-go/v82/checkout/session"
	stripewebhook "github.com/stripe/stripe-go/v82/webhook"

	"makeacompany-ai/backend/internal/upstream"
)

var (
	httpRequestsTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "makeacompany_http_requests_total",
			Help: "Total HTTP requests handled by the makeacompany backend.",
		},
		[]string{"method", "route", "status_class"},
	)
	// latencyBuckets extends past prometheus.DefBuckets' 10s ceiling so
	// histogram_quantile can resolve real tail latency on slow paths (e.g.
	// internal Slack/Stripe snapshot scrapers) instead of clamping every long
	// request to exactly 10s.
	latencyBuckets = []float64{.005, .01, .025, .05, .1, .25, .5, 1, 2.5, 5, 10, 30, 60, 120, 300}

	httpRequestDuration = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "makeacompany_http_request_duration_seconds",
			Help:    "HTTP request latency in seconds for the makeacompany backend.",
			Buckets: latencyBuckets,
		},
		[]string{"method", "route"},
	)
	slackRefreshRunsTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "makeacompany_slack_refresh_runs_total",
			Help: "Total Slack snapshot refresh runs by snapshot and result.",
		},
		[]string{"snapshot", "result"},
	)
	slackRefreshUpstreamHTTPStatusTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "makeacompany_slack_refresh_upstream_http_status_total",
			Help: "Upstream HTTP statuses seen during Slack snapshot refreshes.",
		},
		[]string{"snapshot", "status_code"},
	)
	slackUpstreamHTTPStatusTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "makeacompany_slack_upstream_http_status_total",
			Help: "Upstream HTTP statuses seen on Slack API calls, by source endpoint. Covers all Slack callers, not just snapshot refreshes.",
		},
		[]string{"source", "status_code"},
	)
	// cronjobDurationSeconds covers any internal cronjob handler (slack/stripe snapshot refreshes today,
	// future jobs by adding new "job" label values). The histogram's _count series doubles as a per-result
	// run counter — query rate(..._count{result="error"}) instead of adding a parallel counter.
	cronjobDurationSeconds = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "makeacompany_cronjob_duration_seconds",
			Help:    "Wall-clock duration of internal cronjob handlers, by job and result (success|error).",
			Buckets: latencyBuckets,
		},
		[]string{"job", "result"},
	)
	trialExpiryReaperScannedTotal = prometheus.NewCounter(
		prometheus.CounterOpts{
			Name: "makeacompany_trial_expiry_reaper_scanned_total",
			Help: "Profiles inspected by the trial-expiry reaper (cumulative; sum across runs).",
		},
	)
	trialExpiryReaperEnqueuedTotal = prometheus.NewCounter(
		prometheus.CounterOpts{
			Name: "makeacompany_trial_expiry_reaper_enqueued_total",
			Help: "Expiry-DM jobs enqueued onto the joanne expiry-dm queue by the reaper.",
		},
	)
)

func init() {
	prometheus.MustRegister(
		httpRequestsTotal,
		httpRequestDuration,
		slackRefreshRunsTotal,
		slackRefreshUpstreamHTTPStatusTotal,
		slackUpstreamHTTPStatusTotal,
		cronjobDurationSeconds,
		trialExpiryReaperScannedTotal,
		trialExpiryReaperEnqueuedTotal,
	)
}

func errStringOrNil(err error) any {
	if err == nil {
		return nil
	}
	return err.Error()
}

type Server struct {
	cfg                    Config
	log                    *log.Logger
	store                  *Store
	mux                    *http.ServeMux
	cors                   string
	health                 *healthChecker
	freeTrialInviteLimiter *ipRateLimiter
	workspace              *WorkspaceWriter
	// shopify owns per-user Shopify OAuth connections as K8s Secrets in
	// the makeacompany-ai namespace (makeacompany-ai#352 Layer 1). nil-safe
	// Disabled() for local dev / when the Partner app creds aren't wired.
	shopify *ShopifyWriter
	// shopifyTestClient lets shopify_oauth_test.go inject a mock HTTP
	// round-tripper for the token-exchange + revoke flows. nil in prod.
	shopifyTestClient *http.Client
	// agentToggle scales the ross/joanne prod Deployments between 0 and 1
	// for the /admin kill switch (#215). nil-safe Disabled() for local dev.
	agentToggle *AgentToggleClient
	// clusterHealth returns a sanitized, read-only summary of the cluster
	// for the sales-pod health bar (#290). nil-safe Disabled() for local dev.
	clusterHealth *ClusterHealthClient
	// slackManifest mints per-personal-agent Slack apps via the App Manifest
	// API (#418). Disabled() short-circuits when the config-token pair isn't
	// configured.
	slackManifest *SlackManifestClient
	// personalAgent owns per-agent K8s Secret writes + the persist callback
	// the Manifest client uses to durable-write rotated config tokens.
	personalAgent *PersonalAgentWriter
	// imagen generates app icons for personal agents on creation (Imagen-4-fast).
	// Disabled() short-circuits when GEMINI_API_KEY isn't set.
	imagen *GeminiImagen
}

func NewServer(cfg Config, logger *log.Logger, store *Store) (*Server, error) {
	stripe.Key = cfg.StripeSecretKey
	// Route Stripe SDK calls through the upstream RoundTripper so 429s, latency,
	// and error mix appear in makeacompany_upstream_http_status_total /
	// _duration_seconds alongside Slack and Shopify.
	stripeHTTPClient := upstream.WrapClient("stripe", &http.Client{Timeout: 30 * time.Second})
	stripe.SetBackend(stripe.APIBackend, stripe.GetBackendWithConfig(stripe.APIBackend, &stripe.BackendConfig{
		HTTPClient: stripeHTTPClient,
	}))
	stripe.SetBackend(stripe.UploadsBackend, stripe.GetBackendWithConfig(stripe.UploadsBackend, &stripe.BackendConfig{
		HTTPClient: stripeHTTPClient,
	}))
	workspaceWriter, werr := NewWorkspaceWriter(cfg.WorkspaceTenantConfig)
	if werr != nil {
		// Bad tenant config JSON is a config error — fail loud, don't 503 silently in prod.
		return nil, fmt.Errorf("workspace writer init: %w", werr)
	}
	if workspaceWriter.Disabled() {
		logger.Printf("workspace writer disabled (no in-cluster config or WORKSPACE_TENANT_CONFIG unset)")
	}
	shopifyWriter, serr := NewShopifyWriter(cfg.ShopifyConnectionNamespace)
	if serr != nil {
		return nil, fmt.Errorf("shopify writer init: %w", serr)
	}
	if shopifyWriter.Disabled() {
		logger.Printf("shopify writer disabled (no in-cluster config)")
	}
	agentToggle, aerr := NewAgentToggleClient()
	if aerr != nil {
		return nil, fmt.Errorf("agent toggle init: %w", aerr)
	}
	if agentToggle.Disabled() {
		logger.Printf("agent toggle disabled (no in-cluster config)")
	}
	clusterHealth, cherr := NewClusterHealthClient()
	if cherr != nil {
		return nil, fmt.Errorf("cluster-health init: %w", cherr)
	}
	if clusterHealth.Disabled() {
		logger.Printf("cluster-health disabled (no in-cluster config)")
	}
	personalAgentWriter, perr := NewPersonalAgentWriter(cfg.PersonalAgentNamespace, "", "")
	if perr != nil {
		return nil, fmt.Errorf("personal agent writer init: %w", perr)
	}
	if personalAgentWriter.Disabled() {
		logger.Printf("personal agent writer disabled (no in-cluster config)")
	}
	slackConfigTokens := NewSlackConfigTokens(cfg.SlackConfigAccessToken, cfg.SlackConfigRefreshToken)
	var slackManifestClient *SlackManifestClient
	if cfg.SlackConfigAccessToken != "" && cfg.SlackConfigRefreshToken != "" {
		slackManifestClient = NewSlackManifestClient(slackConfigTokens, personalAgentWriter.PersistConfigTokens, logger)
	} else {
		logger.Printf("slack manifest client disabled (SLACK_CONFIG_ACCESS_TOKEN/REFRESH_TOKEN missing)")
	}
	imagen := NewGeminiImagen(cfg.GeminiAPIKey)
	if imagen.Disabled() {
		logger.Printf("imagen icon generator disabled (GEMINI_API_KEY missing)")
	}
	s := &Server{
		cfg:                    cfg,
		log:                    logger,
		store:                  store,
		mux:                    http.NewServeMux(),
		cors:                   cfg.AppBaseURL,
		health:                 newHealthChecker(store.rdb, os.Getenv("COOKIE_HEALTH_TOKEN")),
		freeTrialInviteLimiter: newIPRateLimiter(5, 30),
		workspace:              workspaceWriter,
		shopify:                shopifyWriter,
		agentToggle:            agentToggle,
		clusterHealth:          clusterHealth,
		slackManifest:          slackManifestClient,
		personalAgent:          personalAgentWriter,
		imagen:                 imagen,
	}
	s.mux.HandleFunc("/livez", s.handleLivez)
	s.mux.HandleFunc("/readyz", s.handleReadiness)
	s.mux.HandleFunc("/health", s.handleHealth)
	s.mux.HandleFunc("/api/internal/cookie-health", s.handleCookieHealthIngest)
	s.mux.HandleFunc("/api/internal/indexer-recent-requests", s.handleIndexerRecentRequests)
	s.mux.Handle("/metrics", promhttp.Handler())
	s.mux.HandleFunc("/v1/billing/checkout", s.handleCheckout)
	s.mux.HandleFunc("/v1/billing/checkout-status", s.handleCheckoutStatus)
	s.mux.HandleFunc("/v1/billing/free-trial-invite", s.handleBillingFreeTrialInvite)
	s.mux.HandleFunc("/v1/billing/webhook", s.handleWebhook)
	s.mux.HandleFunc("/v1/billing/waitlist-stats", s.handleWaitlistStats)
	s.mux.HandleFunc("/v1/lander/slack-seats", s.handleLanderSlackSeats)
	s.mux.HandleFunc("/v1/lander/testimonials", s.handleLanderTestimonials)
	s.mux.HandleFunc("/v1/admin/testimonials", s.handleAdminTestimonials)
	s.mux.HandleFunc("/v1/admin/testimonials/", s.handleAdminTestimonials)
	// Marketing UTM registry (issue #303). Gated by the admin session cookie
	// plus a separate, narrower allowlist (MarketingAllowlist).
	s.mux.HandleFunc("/v1/admin/marketing/campaigns", s.handleAdminMarketingCampaigns)
	s.mux.HandleFunc("/v1/admin/waitlist", s.handleAdminWaitlist)
	s.mux.HandleFunc("/v1/admin/stripe-waitlist-purchasers", s.handleAdminStripeWaitlistPurchasers)
	s.mux.HandleFunc("/v1/admin/slack-workspace-users", s.handleAdminSlackWorkspaceUsers)
	s.mux.HandleFunc("/v1/admin/slack-bot-author-profiles", s.handleAdminSlackBotAuthorProfiles)
	s.mux.HandleFunc("/v1/admin/slack-activity-daily", s.handleAdminSlackActivityDaily)
	s.mux.HandleFunc("/v1/admin/channels", s.handleAdminChannels)
	s.mux.HandleFunc("/v1/admin/channel-members", s.handleAdminChannelMembers)
	s.mux.HandleFunc("/v1/admin/user-profiles", s.handleAdminUserProfiles)
	s.mux.HandleFunc("/v1/admin/ga4-summary", s.handleAdminGA4Summary)
	s.mux.HandleFunc("/v1/admin/gsc-summary", s.handleAdminGSCSummary)
	s.mux.HandleFunc("GET /v1/admin/agents/status", s.handleAdminAgentsStatus)
	s.mux.HandleFunc("POST /v1/admin/agents/{name}/toggle", s.handleAdminAgentToggle)
	s.mux.HandleFunc("/v1/internal/refresh-stripe-waitlist-snapshot", s.handleInternalRefreshStripeWaitlistSnapshot)
	s.mux.HandleFunc("/v1/internal/refresh-slack-users-snapshot", s.handleInternalRefreshSlackUsersSnapshot)
	s.mux.HandleFunc("/v1/internal/refresh-slack-activity-daily", s.handleInternalRefreshSlackActivityDaily)
	s.mux.HandleFunc("GET /v1/internal/deploy-gate", s.handleInternalDeployGateCheck)
	s.mux.HandleFunc("POST /v1/internal/deploy-gate/consume", s.handleInternalDeployGateConsume)
	s.mux.HandleFunc("GET /v1/internal/user-status", s.handleInternalUserStatus)
	s.mux.HandleFunc("POST /v1/internal/trial-expiry-reaper", s.handleInternalTrialExpiryReaper)
	s.mux.HandleFunc("GET /v1/internal/cluster-health", s.handleInternalClusterHealth)
	s.mux.HandleFunc("/v1/admin/auth/me", s.handleAdminAuthMe)
	s.mux.HandleFunc("/v1/admin/auth/logout", s.handleAdminAuthLogout)
	s.mux.HandleFunc("/v1/admin/auth/google/finish", s.handleAdminAuthGoogleFinish)
	s.mux.HandleFunc("/v1/admin/auth/magic/start", s.handleAdminAuthMagicStart)
	s.mux.HandleFunc("/v1/admin/auth/magic/finish", s.handleAdminAuthMagicFinish)
	s.mux.HandleFunc("/v1/portal/auth/me", s.handlePortalAuthMe)
	s.mux.HandleFunc("/v1/me/auth/me", s.handleUserAuthMe)
	s.mux.HandleFunc("/v1/me/auth/logout", s.handleUserAuthLogout)
	s.mux.HandleFunc("/v1/me/auth/magic/start", s.handleUserAuthMagicStart)
	s.mux.HandleFunc("/v1/me/auth/magic/finish", s.handleUserAuthMagicFinish)
	s.mux.HandleFunc("/v1/me/auth/google/finish", s.handleUserAuthGoogleFinish)
	// Personal agents track (#418)
	s.mux.HandleFunc("POST /v1/me/personal-agents", s.handleCreatePersonalAgent)
	s.mux.HandleFunc("GET /v1/me/personal-agents/mine", s.handleGetMyPersonalAgent)
	s.mux.HandleFunc("POST /v1/me/personal-agents/icon-generate", s.handleGeneratePersonalAgentIcon)
	s.mux.HandleFunc("POST /v1/me/personal-agents/icon", s.handleChangePersonalAgentIcon)
	s.mux.HandleFunc("POST /v1/me/personal-agents/edit", s.handleEditPersonalAgent)
	s.mux.HandleFunc("POST /v1/me/personal-agents/delete", s.handleDeletePersonalAgent)
	s.mux.HandleFunc("POST /v1/internal/personal-agents/rollout-all", s.handlePersonalAgentRolloutAll)
	s.mux.HandleFunc("GET /v1/personal-agents/{id}/install-complete", s.handlePersonalAgentInstallComplete)
	// Shared Slack events gateway for ALL personal-agent apps. The manifest
	// template ships with /slack/events as the events request_url, and Slack
	// persists the value verbatim per app — so we expose the bare path here
	// (the canonical one apps point at) AND a /v1 alias for parity with the
	// rest of our backend.
	s.mux.HandleFunc("POST /slack/events", s.handleSlackEventsGateway)
	s.mux.HandleFunc("POST /v1/slack/events", s.handleSlackEventsGateway)
	// Cancel handler is tenant-agnostic — same code already powers the
	// channel-portal cancel button. Mounting at /v1/me/ keeps the surface
	// boundary clean for the /me browser session cookie.
	s.mux.HandleFunc("POST /v1/me/billing/cancel-subscription", s.handlePortalBillingCancelSubscription)
	s.mux.HandleFunc("POST /v1/portal/billing/cancel-subscription", s.handlePortalBillingCancelSubscription)
	s.mux.HandleFunc("GET /v1/portal/deploy-gate", s.handlePortalDeployGateCheck)
	s.mux.HandleFunc("POST /v1/portal/deploy-gate/consume", s.handlePortalDeployGateConsume)
	s.mux.HandleFunc("/v1/portal/auth/logout", s.handlePortalAuthLogout)
	s.mux.HandleFunc("/v1/portal/auth/google/finish", s.handlePortalAuthGoogleFinish)
	s.mux.HandleFunc("POST /v1/portal/workspace/connect/finish", s.handlePortalWorkspaceConnectFinish)
	s.mux.HandleFunc("POST /v1/portal/workspace/disconnect/finish", s.handlePortalWorkspaceDisconnectFinish)
	s.mux.HandleFunc("GET /v1/portal/workspace/status", s.handlePortalWorkspaceStatus)
	// Shopify Layer 1 (makeacompany-ai#352): portal-driven OAuth + per-user
	// K8s Secret store + harness-facing internal token endpoint + webhook
	// receiver. All gated on ShopifyPartnerClientID/Secret being set.
	s.mux.HandleFunc("POST /v1/integrations/shopify/connect/start", s.handleShopifyConnectStart)
	s.mux.HandleFunc("GET /v1/integrations/shopify/callback", s.handleShopifyCallback)
	s.mux.HandleFunc("POST /v1/integrations/shopify/disconnect", s.handleShopifyDisconnect)
	s.mux.HandleFunc("POST /v1/integrations/shopify/webhook", s.handleShopifyWebhook)
	s.mux.HandleFunc("GET /v1/internal/shopify-token", s.handleInternalShopifyToken)
	s.mux.HandleFunc("/v1/portal/auth/magic/start", s.handlePortalAuthMagicStart)
	s.mux.HandleFunc("/v1/portal/auth/magic/finish", s.handlePortalAuthMagicFinish)
	return s, nil
}

func (s *Server) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		recorder := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		s.withCORS(recorder, r, s.mux)
		duration := time.Since(start).Seconds()
		route := s.labelRoute(r)
		method := strings.ToUpper(strings.TrimSpace(r.Method))
		statusClass := fmt.Sprintf("%dxx", recorder.status/100)
		httpRequestsTotal.WithLabelValues(method, route, statusClass).Inc()
		httpRequestDuration.WithLabelValues(method, route).Observe(duration)
		if recorder.status >= 500 && (route == "/other" || route == "/v1/other") {
			s.log.Printf(
				"unrouted 5xx: method=%s status=%d path=%q user_agent=%q referer=%q",
				method, recorder.status, r.URL.Path,
				r.Header.Get("User-Agent"), r.Header.Get("Referer"),
			)
		}
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (sr *statusRecorder) WriteHeader(statusCode int) {
	sr.status = statusCode
	sr.ResponseWriter.WriteHeader(statusCode)
}

// labelRoute returns the Prometheus `route` label for a request by asking
// the ServeMux which pattern it matched. Bounded cardinality (one label per
// registered pattern) and no hand-maintained switch to drift out of sync with
// the route table (#38 B1: top-routes panel was collapsing real endpoints into
// /other because the switch hadn't been updated when new routes were added).
//
// Unmatched paths fall back to /other or /v1/other so request floods to
// random paths can't blow up cardinality, and the existing "unrouted 5xx"
// log line in Handler() keeps surfacing them.
func (s *Server) labelRoute(r *http.Request) string {
	_, pattern := s.mux.Handler(r)
	if pattern == "" {
		if strings.HasPrefix(r.URL.Path, "/v1/") {
			return "/v1/other"
		}
		return "/other"
	}
	// Go 1.22+ patterns may be method-prefixed ("POST /v1/admin/agents/{name}/toggle").
	// Drop the method since `method` is already a separate label.
	if i := strings.Index(pattern, " "); i >= 0 {
		pattern = pattern[i+1:]
	}
	return pattern
}

func (s *Server) withCORS(w http.ResponseWriter, r *http.Request, next http.Handler) {
	origin := r.Header.Get("Origin")
	allowLocalhost := s.cfg.AppEnv != "production" && strings.HasPrefix(origin, "http://localhost:")
	if origin != "" && (origin == s.cors || allowLocalhost) {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Stripe-Signature, X-Admin-Token, X-Admin-Session, Authorization")
	}
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	next.ServeHTTP(w, r)
}

func (s *Server) handleLivez(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "ts": time.Now().UTC().Format(time.RFC3339)})
}

func (s *Server) handleReadiness(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if err := s.store.Ping(r.Context()); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"status": "degraded", "redis": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok"})
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	writeJSON(w, http.StatusOK, s.health.Build(r.Context()))
}

func (s *Server) handleCookieHealthIngest(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	s.health.handleCookieHealthPush(w, r)
}

func (s *Server) handleIndexerRecentRequests(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	const defaultLimit = 100
	const maxLimit = 5_000_000

	limit := defaultLimit
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 0 {
			http.Error(w, "invalid limit", http.StatusBadRequest)
			return
		}
		limit = parsed
	}
	offset := 0
	if raw := strings.TrimSpace(r.URL.Query().Get("offset")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 0 {
			http.Error(w, "invalid offset", http.StatusBadRequest)
			return
		}
		offset = parsed
	}
	if limit > maxLimit {
		limit = maxLimit
	}
	if offset > maxLimit {
		offset = maxLimit
	}

	payload, err := s.health.fetchIndexerRecentRequests(r.Context(), limit, offset)
	if err != nil {
		// Match buildIndexer: report a missing/unreachable upstream as degraded inside a 200 OK
		// envelope so a known-absent dependency does not burn the backend 5xx SLO every poll.
		writeJSON(w, http.StatusOK, map[string]any{
			"status":   "degraded",
			"error":    err.Error(),
			"offset":   offset,
			"limit":    limit,
			"returned": 0,
			"requests": []any{},
		})
		return
	}

	requests := payload.Requests
	if requests == nil {
		requests = []indexerRecentRequestLog{}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"status":    "ok",
		"offset":    offset,
		"limit":     limit,
		"returned":  len(requests),
		"updatedAt": payload.UpdatedAt,
		"requests":  requests,
	})
}

func (s *Server) handleCheckout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if strings.TrimSpace(s.cfg.StripeSecretKey) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "stripe is not configured"})
		return
	}
	signups, _, err := s.store.GetWaitlistStatsForPublic(r.Context())
	if err != nil {
		s.log.Printf("checkout waitlist stats: %v", err)
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "unable to verify waitlist availability"})
		return
	}
	if signups >= WaitlistCap {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "waitlist full"})
		return
	}
	var reqBody struct {
		Ref string `json:"ref"`
	}
	if r.Body != nil {
		_ = json.NewDecoder(io.LimitReader(r.Body, 4096)).Decode(&reqBody)
	}
	ref := strings.TrimSpace(reqBody.Ref)
	if len(ref) > 64 {
		ref = ref[:64]
	}

	priceID, err := s.basePlanPriceID()
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
		return
	}
	successURL := s.cfg.AppBaseURL + "/success?session_id={CHECKOUT_SESSION_ID}"
	cancelURL := s.cfg.AppBaseURL + "/?checkout=cancelled"
	metadata := map[string]string{"source": "base_plan"}
	if ref != "" {
		metadata["ref"] = ref
	}
	params := &stripe.CheckoutSessionParams{
		Params:     stripe.Params{Context: upstream.WithOperation(r.Context(), "checkout.session.create")},
		Mode:       stripe.String(string(stripe.CheckoutSessionModeSubscription)),
		SuccessURL: stripe.String(successURL),
		CancelURL:  stripe.String(cancelURL),
		LineItems: []*stripe.CheckoutSessionLineItemParams{
			{Price: stripe.String(priceID), Quantity: stripe.Int64(1)},
		},
		Metadata: metadata,
	}
	sess, err := checkoutsession.New(params)
	if err != nil {
		s.log.Printf("checkout session: %v", err)
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"url": sess.URL})
}

func (s *Server) basePlanPriceID() (string, error) {
	id := strings.TrimSpace(s.cfg.StripePriceBasePlan)
	if id == "" {
		return "", fmt.Errorf("STRIPE_PRICE_ID_BASE_PLAN is not set (legacy STRIPE_PRICE_ID_WAITLIST is supported if BASE_PLAN is empty)")
	}
	if !strings.HasPrefix(id, "price_") {
		return "", fmt.Errorf("STRIPE_PRICE_ID_BASE_PLAN must be a Stripe price_ id")
	}
	return id, nil
}

func (s *Server) verifyStripeSignature(body []byte, sig string) (secret string, err error) {
	sec := s.cfg.StripeWebhookSecret
	if sec == "" {
		return "", errors.New("stripe webhook secret not configured")
	}
	if err := stripewebhook.ValidatePayloadWithTolerance(body, sig, sec, stripewebhook.DefaultTolerance); err != nil {
		return "", err
	}
	return sec, nil
}

func (s *Server) handleWaitlistStats(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	signups, amountCents, err := s.store.GetWaitlistStatsForPublic(r.Context())
	if err != nil {
		s.log.Printf("waitlist stats: %v", err)
		http.Error(w, "stats error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"signups":       signups,
		"cap":           WaitlistCap,
		"full":          signups >= WaitlistCap,
		"amountCents":   amountCents,
		"amountDisplay": fmt.Sprintf("%.2f", float64(amountCents)/100),
	})
}

// handleAdminWaitlist lists waitlist rows from Redis (PII). Requires a valid admin session.
func (s *Server) handleAdminWaitlist(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	ok, svcUnavail := s.adminReadOrInternalServiceAuthorized(r)
	if !ok {
		if svcUnavail {
			http.Error(w, "admin auth disabled", http.StatusServiceUnavailable)
		} else {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
		}
		return
	}
	users, err := s.store.ListWaitlistUsers(r.Context())
	if err != nil {
		s.log.Printf("admin waitlist: %v", err)
		http.Error(w, "list error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": users})
}

// handleAdminUserProfiles lists combined Redis user profiles (PII). Same auth as waitlist.
func (s *Server) handleAdminUserProfiles(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	ok, svcUnavail := s.adminReadOrInternalServiceAuthorized(r)
	if !ok {
		if svcUnavail {
			http.Error(w, "admin auth disabled", http.StatusServiceUnavailable)
		} else {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
		}
		return
	}
	waitlistUsers, err := s.store.ListWaitlistUsers(r.Context())
	if err != nil {
		s.log.Printf("admin user-profiles waitlist: %v", err)
		http.Error(w, "list error", http.StatusInternalServerError)
		return
	}
	profiles, err := s.store.ListUserProfiles(r.Context())
	if err != nil {
		s.log.Printf("admin user-profiles: %v", err)
		http.Error(w, "list error", http.StatusInternalServerError)
		return
	}
	slackProfiles := make([]UserProfileRow, 0, len(profiles))
	for _, p := range profiles {
		if strings.TrimSpace(p.SlackUserID) != "" {
			slackProfiles = append(slackProfiles, p)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"waitlistUsers": waitlistUsers,
		"waitlistLimit": maxWaitlistList,
		"slackProfiles": slackProfiles,
		"profiles":      profiles,
		"limit":         maxUserProfileList,
	})
}

func (s *Server) handleCheckoutStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if strings.TrimSpace(s.cfg.StripeSecretKey) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "stripe is not configured"})
		return
	}
	sessionID := strings.TrimSpace(r.URL.Query().Get("session_id"))
	if sessionID == "" || !strings.HasPrefix(sessionID, "cs_") {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid session_id"})
		return
	}
	sess, err := checkoutsession.Get(sessionID, nil)
	if err != nil {
		s.log.Printf("checkout-status retrieve session: %v", err)
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "unable to retrieve checkout session"})
		return
	}

	paymentStatus := string(sess.PaymentStatus)
	if paymentStatus != "paid" && paymentStatus != "no_payment_required" {
		writeJSON(w, http.StatusOK, map[string]any{
			"registered":    false,
			"paymentStatus": paymentStatus,
		})
		return
	}

	email, err := s.saveWaitlistFromSession(context.Background(), sess)
	if err != nil {
		if errors.Is(err, ErrWaitlistFull) {
			writeJSON(w, http.StatusOK, map[string]any{
				"registered":    false,
				"paymentStatus": paymentStatus,
				"waitlistFull":  true,
			})
			return
		}
		s.log.Printf("checkout-status save waitlist: %v", err)
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"registered":    true,
		"paymentStatus": paymentStatus,
		"email":         email,
	})
}

func (s *Server) handleWebhook(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if s.cfg.StripeWebhookSecret == "" {
		http.Error(w, "webhook not configured", http.StatusBadRequest)
		return
	}
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}
	sig := r.Header.Get("Stripe-Signature")
	usedSecret, err := s.verifyStripeSignature(body, sig)
	if err != nil {
		http.Error(w, "invalid signature", http.StatusBadRequest)
		return
	}

	var envelope struct {
		Object string `json:"object"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}

	opts := stripewebhook.ConstructEventOptions{IgnoreAPIVersionMismatch: true}

	switch envelope.Object {
	case "event":
		event, err := stripewebhook.ConstructEventWithOptions(body, sig, usedSecret, opts)
		if err != nil {
			s.log.Printf("webhook construct event: %v", err)
			http.Error(w, "invalid event", http.StatusBadRequest)
			return
		}
		switch event.Type {
		case stripe.EventTypeCheckoutSessionCompleted:
			var sess stripe.CheckoutSession
			if err := json.Unmarshal(event.Data.Raw, &sess); err != nil {
				s.log.Printf("webhook unmarshal session: %v", err)
				http.Error(w, "bad payload", http.StatusBadRequest)
				return
			}
			s.routeCheckoutSessionCompleted(w, &sess)
		case stripe.EventTypeCustomerSubscriptionCreated, stripe.EventTypeCustomerSubscriptionUpdated, stripe.EventTypeCustomerSubscriptionDeleted:
			var sub stripe.Subscription
			if err := json.Unmarshal(event.Data.Raw, &sub); err != nil {
				s.log.Printf("webhook unmarshal subscription: %v", err)
				http.Error(w, "bad payload", http.StatusBadRequest)
				return
			}
			if err := s.syncUserProfileFromStripeSubscription(r.Context(), &sub, event.Data.Raw); err != nil {
				s.log.Printf("webhook subscription profile sync: %v", err)
				writeJSON(w, http.StatusOK, map[string]any{"received": true, "profileSyncError": err.Error()})
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"received": true})
		default:
			writeJSON(w, http.StatusOK, map[string]any{"received": true, "ignored": string(event.Type)})
		}

	case "v2.core.event":
		// Thin payload: fetch full Checkout Session by related_object.id (see Stripe thin events docs).
		var thin struct {
			Type          string `json:"type"`
			RelatedObject struct {
				ID   string `json:"id"`
				Type string `json:"type"`
			} `json:"related_object"`
		}
		if err := json.Unmarshal(body, &thin); err != nil {
			http.Error(w, "bad thin payload", http.StatusBadRequest)
			return
		}
		if thin.Type != "v1.checkout.session.completed" {
			writeJSON(w, http.StatusOK, map[string]any{"received": true, "ignored": thin.Type})
			return
		}
		if thin.RelatedObject.ID == "" || !strings.HasPrefix(thin.RelatedObject.ID, "cs_") {
			s.log.Printf("thin webhook: missing or invalid checkout session id")
			http.Error(w, "bad thin payload", http.StatusBadRequest)
			return
		}
		sess, err := checkoutsession.Get(thin.RelatedObject.ID, nil)
		if err != nil {
			s.log.Printf("retrieve checkout session: %v", err)
			http.Error(w, "stripe retrieve failed", http.StatusBadRequest)
			return
		}
		s.routeCheckoutSessionCompleted(w, sess)

	default:
		http.Error(w, "unsupported webhook object", http.StatusBadRequest)
	}
}

func (s *Server) completeWaitlistFromSession(w http.ResponseWriter, sess *stripe.CheckoutSession) {
	if _, err := s.saveWaitlistFromSession(context.Background(), sess); err != nil {
		if errors.Is(err, ErrWaitlistFull) {
			s.log.Printf("waitlist full: checkout session %s completed after cap", sess.ID)
			writeJSON(w, http.StatusOK, map[string]any{"received": true, "waitlistFull": true})
			return
		}
		s.log.Printf("save waitlist: %v", err)
		http.Error(w, "store error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"received": true})
}

func (s *Server) saveWaitlistFromSession(ctx context.Context, sess *stripe.CheckoutSession) (string, error) {
	var email string
	if sess.CustomerDetails != nil {
		email = strings.TrimSpace(sess.CustomerDetails.Email)
	}
	if email == "" {
		email = strings.TrimSpace(sess.CustomerEmail)
	}
	if email == "" {
		s.log.Printf("checkout session %s completed without email", sess.ID)
		return "", errors.New("missing customer email")
	}
	var custID string
	if sess.Customer != nil {
		custID = sess.Customer.ID
	}
	amount := sess.AmountTotal
	cur := string(sess.Currency)
	status := string(sess.PaymentStatus)
	stripeProductID := ""
	if priceID, err := s.basePlanPriceID(); err == nil {
		if ok, pid, err := checkoutSessionWaitlistLineItem(sess, priceID); err == nil && ok {
			stripeProductID = pid
		}
	}
	ref := strings.TrimSpace(sess.Metadata["ref"])
	if err := s.store.SaveWaitlistSignup(ctx, sess.ID, email, custID, status, amount, cur, stripeProductID, ref); err != nil {
		return "", err
	}
	if err := s.sendCheckoutWelcomeInviteEmail(ctx, sess.ID, email); err != nil {
		s.log.Printf("checkout welcome invite email: %v", err)
	}
	return email, nil
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// writeJSONNoStore sets Cache-Control so browsers and intermediaries do not reuse a stale empty
// snapshot response for GET /v1/admin/... after a live refresh wrote new data to Redis.
func writeJSONNoStore(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Cache-Control", "private, no-store, no-cache, must-revalidate, max-age=0")
	w.Header().Set("Pragma", "no-cache")
	writeJSON(w, status, v)
}
