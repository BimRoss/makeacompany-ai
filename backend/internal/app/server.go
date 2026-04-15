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
	httpRequestDuration = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "makeacompany_http_request_duration_seconds",
			Help:    "HTTP request latency in seconds for the makeacompany backend.",
			Buckets: prometheus.DefBuckets,
		},
		[]string{"method", "route"},
	)
)

func init() {
	prometheus.MustRegister(httpRequestsTotal, httpRequestDuration)
}

type Server struct {
	cfg    Config
	log    *log.Logger
	store  *Store
	mux    *http.ServeMux
	cors   string
	health *healthChecker
}

func NewServer(cfg Config, logger *log.Logger, store *Store) (*Server, error) {
	stripe.Key = cfg.StripeSecretKey
	s := &Server{
		cfg:    cfg,
		log:    logger,
		store:  store,
		mux:    http.NewServeMux(),
		cors:   cfg.AppBaseURL,
		health: newHealthChecker(store.rdb, os.Getenv("COOKIE_HEALTH_TOKEN")),
	}
	s.mux.HandleFunc("/livez", s.handleLivez)
	s.mux.HandleFunc("/readyz", s.handleReadiness)
	s.mux.HandleFunc("/health", s.handleHealth)
	s.mux.HandleFunc("/api/internal/cookie-health", s.handleCookieHealthIngest)
	s.mux.HandleFunc("/api/internal/indexer-recent-requests", s.handleIndexerRecentRequests)
	s.mux.Handle("/metrics", promhttp.Handler())
	s.mux.HandleFunc("/v1/billing/checkout", s.handleCheckout)
	s.mux.HandleFunc("/v1/billing/checkout-status", s.handleCheckoutStatus)
	s.mux.HandleFunc("/v1/billing/webhook", s.handleWebhook)
	s.mux.HandleFunc("/v1/billing/waitlist-stats", s.handleWaitlistStats)
	s.mux.HandleFunc("/v1/admin/waitlist", s.handleAdminWaitlist)
	s.mux.HandleFunc("/v1/admin/catalog", s.handleAdminCatalog)
	s.mux.HandleFunc("/v1/admin/company-channels", s.handleAdminCompanyChannels)
	s.mux.HandleFunc("GET /v1/admin/company-channels/{channelId}", s.handleAdminCompanyChannelGet)
	s.mux.HandleFunc("PATCH /v1/admin/company-channels/{channelId}", s.handleAdminCompanyChannelPatch)
	s.mux.HandleFunc("GET /v1/admin/channel-knowledge/{channelId}", s.handleAdminChannelKnowledge)
	s.mux.HandleFunc("/v1/runtime/capability-catalog", s.handleRuntimeCapabilityCatalog)
	s.mux.HandleFunc("/v1/admin/auth/start", s.handleAdminAuthStart)
	s.mux.HandleFunc("/v1/admin/auth/finish", s.handleAdminAuthFinish)
	s.mux.HandleFunc("/v1/admin/auth/me", s.handleAdminAuthMe)
	s.mux.HandleFunc("/v1/admin/auth/logout", s.handleAdminAuthLogout)
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
	case path == "/v1/billing/checkout":
		return "/v1/billing/checkout"
	case path == "/v1/billing/checkout-status":
		return "/v1/billing/checkout-status"
	case path == "/v1/billing/webhook":
		return "/v1/billing/webhook"
	case path == "/v1/billing/waitlist-stats":
		return "/v1/billing/waitlist-stats"
	case path == "/v1/admin/waitlist":
		return "/v1/admin/waitlist"
	case path == "/v1/admin/catalog":
		return "/v1/admin/catalog"
	case path == "/v1/admin/company-channels":
		return "/v1/admin/company-channels"
	case strings.HasPrefix(path, "/v1/admin/company-channels/"):
		return "/v1/admin/company-channels/{channelId}"
	case strings.HasPrefix(path, "/v1/admin/channel-knowledge/"):
		return "/v1/admin/channel-knowledge/{channelId}"
	case path == "/v1/runtime/capability-catalog":
		return "/v1/runtime/capability-catalog"
	case path == "/v1/admin/auth/start":
		return "/v1/admin/auth/start"
	case path == "/v1/admin/auth/finish":
		return "/v1/admin/auth/finish"
	case path == "/v1/admin/auth/me":
		return "/v1/admin/auth/me"
	case path == "/v1/admin/auth/logout":
		return "/v1/admin/auth/logout"
	case strings.HasPrefix(path, "/v1/"):
		return "/v1/other"
	default:
		return "/other"
	}
}

func (s *Server) withCORS(w http.ResponseWriter, r *http.Request, next http.Handler) {
	origin := r.Header.Get("Origin")
	if origin != "" && (origin == s.cors || strings.HasPrefix(origin, "http://localhost:")) {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Stripe-Signature, X-Admin-Token, X-Admin-Session, X-Capability-Catalog-Token, Authorization")
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
		writeJSON(w, http.StatusBadGateway, map[string]any{
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
	signups, _, err := s.store.GetWaitlistStats(r.Context())
	if err != nil {
		s.log.Printf("checkout waitlist stats: %v", err)
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "unable to verify waitlist availability"})
		return
	}
	if signups >= WaitlistCap {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "waitlist full"})
		return
	}
	priceID, err := s.waitlistPriceID()
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
		return
	}
	successURL := s.cfg.AppBaseURL + "/?checkout=success&session_id={CHECKOUT_SESSION_ID}"
	cancelURL := s.cfg.AppBaseURL + "/?checkout=cancelled"
	params := &stripe.CheckoutSessionParams{
		Mode:       stripe.String(string(stripe.CheckoutSessionModePayment)),
		SuccessURL: stripe.String(successURL),
		CancelURL:  stripe.String(cancelURL),
		LineItems: []*stripe.CheckoutSessionLineItemParams{
			{Price: stripe.String(priceID), Quantity: stripe.Int64(1)},
		},
		Metadata: map[string]string{
			"source": "waitlist",
		},
	}
	sess, err := checkoutsession.New(params)
	if err != nil {
		s.log.Printf("checkout session: %v", err)
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"url": sess.URL})
}

func (s *Server) waitlistPriceID() (string, error) {
	key := s.cfg.StripeSecretKey
	live := strings.TrimSpace(s.cfg.StripePriceWaitlistLive)
	test := strings.TrimSpace(s.cfg.StripePriceWaitlistTest)
	if strings.HasPrefix(key, "sk_live_") {
		if live == "" {
			return "", fmt.Errorf("STRIPE_PRICE_ID_WAITLIST_LIVE is not set")
		}
		if !strings.HasPrefix(live, "price_") {
			return "", fmt.Errorf("STRIPE_PRICE_ID_WAITLIST_LIVE must be a Stripe price_ id")
		}
		return live, nil
	}
	if test == "" {
		return "", fmt.Errorf("STRIPE_PRICE_ID_WAITLIST_TEST is not set")
	}
	if !strings.HasPrefix(test, "price_") {
		return "", fmt.Errorf("STRIPE_PRICE_ID_WAITLIST_TEST must be a Stripe price_ id")
	}
	return test, nil
}

func (s *Server) webhookSigningSecrets() []string {
	var out []string
	if s.cfg.StripeWebhookSecretSnapshot != "" {
		out = append(out, s.cfg.StripeWebhookSecretSnapshot)
	}
	if s.cfg.StripeWebhookSecretThin != "" {
		out = append(out, s.cfg.StripeWebhookSecretThin)
	}
	return out
}

func (s *Server) verifyStripeSignature(body []byte, sig string) (secret string, err error) {
	for _, sec := range s.webhookSigningSecrets() {
		if err := stripewebhook.ValidatePayloadWithTolerance(body, sig, sec, stripewebhook.DefaultTolerance); err == nil {
			return sec, nil
		}
	}
	return "", errors.New("no matching signature")
}

func (s *Server) handleWaitlistStats(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	signups, amountCents, err := s.store.GetWaitlistStats(r.Context())
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

// handleAdminWaitlist lists waitlist rows from Redis (PII). Requires the same admin session as other /v1/admin routes.
func (s *Server) handleAdminWaitlist(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.adminAuthEnabled() {
		http.Error(w, "admin auth disabled", http.StatusServiceUnavailable)
		return
	}
	if _, err := s.validateAdminSession(r.Context(), tokenFromAuthHeader(r)); err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
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

func (s *Server) handleAdminCatalog(w http.ResponseWriter, r *http.Request) {
	serviceWriteAuthorized := r.Method == http.MethodPut && s.catalogServiceWriteAuthorized(r)
	if !serviceWriteAuthorized {
		if !s.adminAuthEnabled() {
			http.Error(w, "admin auth disabled", http.StatusServiceUnavailable)
			return
		}
		if _, err := s.validateAdminSession(r.Context(), tokenFromAuthHeader(r)); err != nil {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
	}
	switch r.Method {
	case http.MethodGet:
		catalog, err := s.store.GetCapabilityCatalog(r.Context())
		if err != nil {
			s.log.Printf("admin catalog get: %v", err)
			http.Error(w, "catalog error", http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, catalog)
		return
	case http.MethodPut:
		// Authorization is already satisfied above: either matching X-Admin-Token
		// (serviceWriteAuthorized) or a valid admin session. Do not require both.
		var catalog CapabilityCatalog
		if err := json.NewDecoder(r.Body).Decode(&catalog); err != nil {
			http.Error(w, "invalid json", http.StatusBadRequest)
			return
		}
		if strings.TrimSpace(catalog.Revision) == "" {
			catalog.Revision = strings.TrimSpace(r.Header.Get("X-Capability-Catalog-Revision"))
		}
		if err := s.store.PutCapabilityCatalog(r.Context(), catalog); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		stored, err := s.store.GetCapabilityCatalog(r.Context())
		if err != nil {
			writeJSON(w, http.StatusOK, map[string]any{"status": "ok"})
			return
		}
		writeJSON(w, http.StatusOK, stored)
		return
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
}

func (s *Server) handleAdminCompanyChannels(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.adminAuthEnabled() {
		http.Error(w, "admin auth disabled", http.StatusServiceUnavailable)
		return
	}
	if _, err := s.validateAdminSession(r.Context(), tokenFromAuthHeader(r)); err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	channels, truncated, err := s.store.ListCompanyChannels(r.Context(), s.cfg.CompanyChannelsRedisKey)
	if err != nil {
		s.log.Printf("admin company channels: %v", err)
		http.Error(w, "company channels error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"channels":  channels,
		"truncated": truncated,
		"redisKey":  strings.TrimSpace(s.cfg.CompanyChannelsRedisKey),
	})
}

func (s *Server) handleAdminCompanyChannelGet(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.adminAuthEnabled() {
		http.Error(w, "admin auth disabled", http.StatusServiceUnavailable)
		return
	}
	if _, err := s.validateAdminSession(r.Context(), tokenFromAuthHeader(r)); err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	chID := strings.TrimSpace(r.PathValue("channelId"))
	if chID == "" || !validAdminSlackChannelID(chID) {
		http.Error(w, "bad channel id", http.StatusBadRequest)
		return
	}
	e, err := s.store.GetCompanyChannel(r.Context(), s.cfg.CompanyChannelsRedisKey, chID)
	if err != nil {
		if errors.Is(err, ErrCompanyChannelNotFound) {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		s.log.Printf("admin company channel get: %v", err)
		http.Error(w, "company channel error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"channel":  e,
		"redisKey": strings.TrimSpace(s.cfg.CompanyChannelsRedisKey),
	})
}

func (s *Server) handleAdminCompanyChannelPatch(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPatch {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.adminAuthEnabled() {
		http.Error(w, "admin auth disabled", http.StatusServiceUnavailable)
		return
	}
	if _, err := s.validateAdminSession(r.Context(), tokenFromAuthHeader(r)); err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	chID := strings.TrimSpace(r.PathValue("channelId"))
	if chID == "" || !validAdminSlackChannelID(chID) {
		http.Error(w, "bad channel id", http.StatusBadRequest)
		return
	}
	var patch CompanyChannelPatch
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&patch); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	if patch.GeneralAutoReactionEnabled == nil {
		http.Error(w, "no updatable fields", http.StatusBadRequest)
		return
	}
	e, err := s.store.PatchCompanyChannel(r.Context(), s.cfg.CompanyChannelsRedisKey, chID, patch)
	if err != nil {
		if errors.Is(err, ErrCompanyChannelNotFound) {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		s.log.Printf("admin company channel patch: %v", err)
		http.Error(w, "company channel error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"channel": e,
	})
}

func validAdminSlackChannelID(id string) bool {
	id = strings.TrimSpace(id)
	if len(id) < 8 || len(id) > 24 {
		return false
	}
	for i := 0; i < len(id); i++ {
		c := id[i]
		if (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') {
			continue
		}
		return false
	}
	switch id[0] {
	case 'C', 'G':
		return true
	default:
		return false
	}
}

func (s *Server) handleAdminChannelKnowledge(w http.ResponseWriter, r *http.Request) {
	if !s.adminAuthEnabled() {
		http.Error(w, "admin auth disabled", http.StatusServiceUnavailable)
		return
	}
	if _, err := s.validateAdminSession(r.Context(), tokenFromAuthHeader(r)); err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	chID := strings.TrimSpace(r.PathValue("channelId"))
	if chID == "" || !validAdminSlackChannelID(chID) {
		http.Error(w, "bad channel id", http.StatusBadRequest)
		return
	}
	md, err := s.store.GetChannelKnowledgeMarkdown(r.Context(), chID)
	if err != nil {
		s.log.Printf("admin channel knowledge: %v", err)
		http.Error(w, "channel knowledge error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"channel_id": chID,
		"markdown":   md,
		"empty":      strings.TrimSpace(md) == "",
	})
}

func (s *Server) catalogServiceWriteAuthorized(r *http.Request) bool {
	if r == nil {
		return false
	}
	expected := strings.TrimSpace(s.cfg.AdminCatalogToken)
	if expected == "" {
		return false
	}
	provided := strings.TrimSpace(r.Header.Get("X-Admin-Token"))
	return provided != "" && provided == expected
}

func (s *Server) handleRuntimeCapabilityCatalog(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	expectedToken := strings.TrimSpace(s.cfg.CapabilityCatalogReadToken)
	if expectedToken != "" {
		got := strings.TrimSpace(capabilityCatalogTokenFromRequest(r))
		if got == "" || got != expectedToken {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
	}
	catalog, err := s.store.GetCapabilityCatalog(r.Context())
	if err != nil {
		s.log.Printf("runtime capability catalog get: %v", err)
		http.Error(w, "catalog error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, catalog)
}

func capabilityCatalogTokenFromRequest(r *http.Request) string {
	if r == nil {
		return ""
	}
	if v := strings.TrimSpace(r.Header.Get("X-Capability-Catalog-Token")); v != "" {
		return v
	}
	auth := strings.TrimSpace(r.Header.Get("Authorization"))
	if auth == "" {
		return ""
	}
	if strings.HasPrefix(strings.ToLower(auth), "bearer ") {
		return strings.TrimSpace(auth[7:])
	}
	return ""
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
	if len(s.webhookSigningSecrets()) == 0 {
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
		if event.Type != stripe.EventTypeCheckoutSessionCompleted {
			writeJSON(w, http.StatusOK, map[string]any{"received": true, "ignored": string(event.Type)})
			return
		}
		var sess stripe.CheckoutSession
		if err := json.Unmarshal(event.Data.Raw, &sess); err != nil {
			s.log.Printf("webhook unmarshal session: %v", err)
			http.Error(w, "bad payload", http.StatusBadRequest)
			return
		}
		s.completeWaitlistFromSession(w, &sess)

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
		s.completeWaitlistFromSession(w, sess)

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
	if err := s.store.SaveWaitlistSignup(ctx, sess.ID, email, custID, status, amount, cur); err != nil {
		return "", err
	}
	return email, nil
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
