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
)

func init() {
	prometheus.MustRegister(
		httpRequestsTotal,
		httpRequestDuration,
		slackRefreshRunsTotal,
		slackRefreshUpstreamHTTPStatusTotal,
		slackUpstreamHTTPStatusTotal,
		cronjobDurationSeconds,
	)
}

func errStringOrNil(err error) any {
	if err == nil {
		return nil
	}
	return err.Error()
}

type Server struct {
	cfg                   Config
	log                   *log.Logger
	store                 *Store
	mux                   *http.ServeMux
	cors                  string
	health                *healthChecker
	freeTrialInviteLimiter *ipRateLimiter
	workspace             *WorkspaceWriter
	// personalAgentSecrets writes per-agent k8s Secrets in the
	// `personal-agents` namespace (issue #183 / #186 PR3). nil-safe
	// Disabled() check so handlers can branch without crashing on
	// out-of-cluster local dev.
	personalAgentSecrets *PersonalAgentSecretWriter
	// agentToggle scales the ross/joanne prod Deployments between 0 and 1
	// for the /admin kill switch (#215). nil-safe Disabled() for local dev.
	agentToggle *AgentToggleClient
}

func NewServer(cfg Config, logger *log.Logger, store *Store) (*Server, error) {
	stripe.Key = cfg.StripeSecretKey
	workspaceWriter, werr := NewWorkspaceWriter(cfg.WorkspaceTenantConfig)
	if werr != nil {
		// Bad tenant config JSON is a config error — fail loud, don't 503 silently in prod.
		return nil, fmt.Errorf("workspace writer init: %w", werr)
	}
	if workspaceWriter.Disabled() {
		logger.Printf("workspace writer disabled (no in-cluster config or WORKSPACE_TENANT_CONFIG unset)")
	}
	personalAgentSecrets, perr := NewPersonalAgentSecretWriter()
	if perr != nil {
		return nil, fmt.Errorf("personal-agent secret writer init: %w", perr)
	}
	if personalAgentSecrets.Disabled() {
		logger.Printf("personal-agent secret writer disabled (no in-cluster config)")
	}
	agentToggle, aerr := NewAgentToggleClient()
	if aerr != nil {
		return nil, fmt.Errorf("agent toggle init: %w", aerr)
	}
	if agentToggle.Disabled() {
		logger.Printf("agent toggle disabled (no in-cluster config)")
	}
	s := &Server{
		cfg:    cfg,
		log:    logger,
		store:  store,
		mux:    http.NewServeMux(),
		cors:                   cfg.AppBaseURL,
		health:                 newHealthChecker(store.rdb, os.Getenv("COOKIE_HEALTH_TOKEN")),
		freeTrialInviteLimiter: newIPRateLimiter(5, 30),
		workspace:              workspaceWriter,
		personalAgentSecrets:   personalAgentSecrets,
		agentToggle:            agentToggle,
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
	s.mux.HandleFunc("/v1/admin/waitlist", s.handleAdminWaitlist)
	s.mux.HandleFunc("/v1/admin/stripe-waitlist-purchasers", s.handleAdminStripeWaitlistPurchasers)
	s.mux.HandleFunc("/v1/admin/slack-workspace-users", s.handleAdminSlackWorkspaceUsers)
	s.mux.HandleFunc("/v1/admin/slack-bot-author-profiles", s.handleAdminSlackBotAuthorProfiles)
	s.mux.HandleFunc("/v1/admin/channels", s.handleAdminChannels)
	s.mux.HandleFunc("/v1/admin/channel-members", s.handleAdminChannelMembers)
	s.mux.HandleFunc("/v1/admin/user-profiles", s.handleAdminUserProfiles)
	s.mux.HandleFunc("/v1/admin/ga4-summary", s.handleAdminGA4Summary)
	s.mux.HandleFunc("/v1/admin/gsc-summary", s.handleAdminGSCSummary)
	s.mux.HandleFunc("GET /v1/admin/agents/status", s.handleAdminAgentsStatus)
	s.mux.HandleFunc("POST /v1/admin/agents/{name}/toggle", s.handleAdminAgentToggle)
	s.mux.HandleFunc("/v1/internal/refresh-stripe-waitlist-snapshot", s.handleInternalRefreshStripeWaitlistSnapshot)
	s.mux.HandleFunc("/v1/internal/refresh-slack-users-snapshot", s.handleInternalRefreshSlackUsersSnapshot)
	s.mux.HandleFunc("GET /v1/internal/deploy-gate", s.handleInternalDeployGateCheck)
	s.mux.HandleFunc("POST /v1/internal/deploy-gate/consume", s.handleInternalDeployGateConsume)
	s.mux.HandleFunc("GET /v1/internal/user-status", s.handleInternalUserStatus)
	s.mux.HandleFunc("/v1/admin/auth/me", s.handleAdminAuthMe)
	s.mux.HandleFunc("/v1/admin/auth/logout", s.handleAdminAuthLogout)
	s.mux.HandleFunc("/v1/admin/auth/google/finish", s.handleAdminAuthGoogleFinish)
	s.mux.HandleFunc("/v1/admin/auth/magic/start", s.handleAdminAuthMagicStart)
	s.mux.HandleFunc("/v1/admin/auth/magic/finish", s.handleAdminAuthMagicFinish)
	s.mux.HandleFunc("/v1/portal/auth/me", s.handlePortalAuthMe)
	s.mux.HandleFunc("POST /v1/portal/billing/cancel-subscription", s.handlePortalBillingCancelSubscription)
	s.mux.HandleFunc("GET /v1/portal/deploy-gate", s.handlePortalDeployGateCheck)
	s.mux.HandleFunc("POST /v1/portal/deploy-gate/consume", s.handlePortalDeployGateConsume)
	s.mux.HandleFunc("/v1/portal/auth/logout", s.handlePortalAuthLogout)
	s.mux.HandleFunc("/v1/portal/auth/google/finish", s.handlePortalAuthGoogleFinish)
	// Personal-scope (cid-less) sign-in — entry point for /me/login.
	// Magic-link variant deferred to a follow-up; Google-only is enough
	// to unblock #199 / Garth provisioning.
	s.mux.HandleFunc("/v1/portal/auth/personal/google/finish", s.handlePortalAuthGooglePersonalFinish)
	s.mux.HandleFunc("POST /v1/portal/workspace/connect/finish", s.handlePortalWorkspaceConnectFinish)
	s.mux.HandleFunc("POST /v1/portal/workspace/disconnect/finish", s.handlePortalWorkspaceDisconnectFinish)
	s.mux.HandleFunc("GET /v1/portal/workspace/status", s.handlePortalWorkspaceStatus)
	s.mux.HandleFunc("/v1/portal/auth/magic/start", s.handlePortalAuthMagicStart)
	s.mux.HandleFunc("/v1/portal/auth/magic/finish", s.handlePortalAuthMagicFinish)
	// Personal agents (issue #183, gated on PERSONAL_AGENTS_ENABLED).
	// Trailing-slash route covers the per-slug subtree; bare path is
	// list+create. Method dispatch happens inside the handler.
	s.mux.HandleFunc("/v1/portal/agents", s.handlePortalAgents)
	s.mux.HandleFunc("/v1/portal/agents/", s.handlePortalAgents)
	s.mux.HandleFunc("/v1/admin/personal-agents", s.handleAdminPersonalAgents)
	return s, nil
}

func (s *Server) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		recorder := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		s.withCORS(recorder, r, s.mux)
		duration := time.Since(start).Seconds()
		route := normalizeMetricRoute(r.URL.Path)
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

func normalizeMetricRoute(path string) string {
	switch {
	case path == "/livez":
		return "/livez"
	case path == "/readyz":
		return "/readyz"
	case path == "/health":
		return "/health"
	case path == "/metrics":
		return "/metrics"
	case path == "/api/internal/cookie-health":
		return "/api/internal/cookie-health"
	case path == "/api/internal/indexer-recent-requests":
		return "/api/internal/indexer-recent-requests"
	case path == "/v1/billing/checkout":
		return "/v1/billing/checkout"
	case path == "/v1/billing/checkout-status":
		return "/v1/billing/checkout-status"
	case path == "/v1/billing/free-trial-invite":
		return "/v1/billing/free-trial-invite"
	case path == "/v1/billing/webhook":
		return "/v1/billing/webhook"
	case path == "/v1/billing/waitlist-stats":
		return "/v1/billing/waitlist-stats"
	case path == "/v1/lander/slack-seats":
		return "/v1/lander/slack-seats"
	case path == "/v1/lander/testimonials":
		return "/v1/lander/testimonials"
	case path == "/v1/admin/testimonials":
		return "/v1/admin/testimonials"
	case strings.HasPrefix(path, "/v1/admin/testimonials/"):
		return "/v1/admin/testimonials/:id"
	case path == "/v1/admin/waitlist":
		return "/v1/admin/waitlist"
	case path == "/v1/admin/stripe-waitlist-purchasers":
		return "/v1/admin/stripe-waitlist-purchasers"
	case path == "/v1/admin/slack-workspace-users":
		return "/v1/admin/slack-workspace-users"
	case path == "/v1/admin/slack-bot-author-profiles":
		return "/v1/admin/slack-bot-author-profiles"
	case path == "/v1/admin/channels":
		return "/v1/admin/channels"
	case path == "/v1/admin/channel-members":
		return "/v1/admin/channel-members"
	case path == "/v1/admin/user-profiles":
		return "/v1/admin/user-profiles"
	case path == "/v1/admin/ga4-summary":
		return "/v1/admin/ga4-summary"
	case path == "/v1/admin/gsc-summary":
		return "/v1/admin/gsc-summary"
	case path == "/v1/admin/agents/status":
		return "/v1/admin/agents/status"
	case strings.HasPrefix(path, "/v1/admin/agents/") && strings.HasSuffix(path, "/toggle"):
		return "/v1/admin/agents/:name/toggle"
	case path == "/v1/internal/refresh-stripe-waitlist-snapshot":
		return "/v1/internal/refresh-stripe-waitlist-snapshot"
	case path == "/v1/internal/refresh-slack-users-snapshot":
		return "/v1/internal/refresh-slack-users-snapshot"
	case path == "/v1/internal/deploy-gate":
		return "/v1/internal/deploy-gate"
	case path == "/v1/internal/deploy-gate/consume":
		return "/v1/internal/deploy-gate/consume"
	case path == "/v1/internal/user-status":
		return "/v1/internal/user-status"
	case path == "/v1/admin/auth/me":
		return "/v1/admin/auth/me"
	case path == "/v1/admin/auth/logout":
		return "/v1/admin/auth/logout"
	case path == "/v1/admin/auth/google/finish":
		return "/v1/admin/auth/google/finish"
	case path == "/v1/admin/auth/magic/start":
		return "/v1/admin/auth/magic/start"
	case path == "/v1/admin/auth/magic/finish":
		return "/v1/admin/auth/magic/finish"
	case path == "/v1/portal/auth/me":
		return "/v1/portal/auth/me"
	case path == "/v1/portal/billing/cancel-subscription":
		return "/v1/portal/billing/cancel-subscription"
	case path == "/v1/portal/deploy-gate":
		return "/v1/portal/deploy-gate"
	case path == "/v1/portal/deploy-gate/consume":
		return "/v1/portal/deploy-gate/consume"
	case path == "/v1/portal/auth/logout":
		return "/v1/portal/auth/logout"
	case path == "/v1/portal/auth/google/finish":
		return "/v1/portal/auth/google/finish"
	case path == "/v1/portal/auth/magic/start":
		return "/v1/portal/auth/magic/start"
	case path == "/v1/portal/auth/magic/finish":
		return "/v1/portal/auth/magic/finish"
	case path == "/v1/portal/workspace/connect/finish":
		return "/v1/portal/workspace/connect/finish"
	case path == "/v1/portal/workspace/disconnect/finish":
		return "/v1/portal/workspace/disconnect/finish"
	case path == "/v1/portal/workspace/status":
		return "/v1/portal/workspace/status"
	case strings.HasPrefix(path, "/v1/"):
		return "/v1/other"
	default:
		return "/other"
	}
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
