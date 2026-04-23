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

func errStringOrNil(err error) any {
	if err == nil {
		return nil
	}
	return err.Error()
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
	s.mux.HandleFunc("/v1/admin/stripe-waitlist-purchasers", s.handleAdminStripeWaitlistPurchasers)
	s.mux.HandleFunc("/v1/admin/slack-workspace-users", s.handleAdminSlackWorkspaceUsers)
	s.mux.HandleFunc("/v1/admin/user-profiles", s.handleAdminUserProfiles)
	s.mux.HandleFunc("/v1/internal/refresh-stripe-waitlist-snapshot", s.handleInternalRefreshStripeWaitlistSnapshot)
	s.mux.HandleFunc("/v1/internal/refresh-slack-users-snapshot", s.handleInternalRefreshSlackUsersSnapshot)
	s.mux.HandleFunc("/v1/admin/catalog", s.handleAdminCatalog)
	s.mux.HandleFunc("/v1/admin/company-channels", s.handleAdminCompanyChannels)
	s.mux.HandleFunc("POST /v1/admin/company-channels/discover", s.handleAdminCompanyChannelsDiscover)
	s.mux.HandleFunc("GET /v1/admin/company-channels/{channelId}", s.handleAdminCompanyChannelGet)
	s.mux.HandleFunc("PATCH /v1/admin/company-channels/{channelId}", s.handleAdminCompanyChannelPatch)
	s.mux.HandleFunc("GET /v1/admin/channel-knowledge/{channelId}", s.handleAdminChannelKnowledge)
	s.mux.HandleFunc("GET /v1/admin/capability-routing-events", s.handleAdminCapabilityRoutingEvents)
	s.mux.HandleFunc("/v1/runtime/capability-catalog", s.handleRuntimeCapabilityCatalog)
	s.mux.HandleFunc("/v1/admin/auth/start", s.handleAdminAuthStart)
	s.mux.HandleFunc("/v1/admin/auth/finish", s.handleAdminAuthFinish)
	s.mux.HandleFunc("/v1/admin/auth/me", s.handleAdminAuthMe)
	s.mux.HandleFunc("/v1/admin/auth/logout", s.handleAdminAuthLogout)
	s.mux.HandleFunc("/v1/portal/auth/start", s.handlePortalAuthStart)
	s.mux.HandleFunc("/v1/portal/auth/finish", s.handlePortalAuthFinish)
	s.mux.HandleFunc("/v1/portal/auth/me", s.handlePortalAuthMe)
	s.mux.HandleFunc("/v1/portal/auth/logout", s.handlePortalAuthLogout)
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
	case path == "/v1/admin/stripe-waitlist-purchasers":
		return "/v1/admin/stripe-waitlist-purchasers"
	case path == "/v1/admin/slack-workspace-users":
		return "/v1/admin/slack-workspace-users"
	case path == "/v1/admin/user-profiles":
		return "/v1/admin/user-profiles"
	case path == "/v1/internal/refresh-stripe-waitlist-snapshot":
		return "/v1/internal/refresh-stripe-waitlist-snapshot"
	case path == "/v1/internal/refresh-slack-users-snapshot":
		return "/v1/internal/refresh-slack-users-snapshot"
	case path == "/v1/admin/catalog":
		return "/v1/admin/catalog"
	case path == "/v1/admin/company-channels":
		return "/v1/admin/company-channels"
	case path == "/v1/admin/company-channels/discover":
		return "/v1/admin/company-channels/discover"
	case strings.HasPrefix(path, "/v1/admin/company-channels/"):
		return "/v1/admin/company-channels/{channelId}"
	case strings.HasPrefix(path, "/v1/admin/channel-knowledge/"):
		return "/v1/admin/channel-knowledge/{channelId}"
	case path == "/v1/admin/capability-routing-events":
		return "/v1/admin/capability-routing-events"
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
	case path == "/v1/portal/auth/start":
		return "/v1/portal/auth/start"
	case path == "/v1/portal/auth/finish":
		return "/v1/portal/auth/finish"
	case path == "/v1/portal/auth/me":
		return "/v1/portal/auth/me"
	case path == "/v1/portal/auth/logout":
		return "/v1/portal/auth/logout"
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
		// Always create a Stripe Customer on completion so admin + webhooks get cus_… (not guest-only sessions).
		CustomerCreation: stripe.String(string(stripe.CheckoutSessionCustomerCreationAlways)),
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
	id := strings.TrimSpace(s.cfg.StripePriceWaitlist)
	if id == "" {
		return "", fmt.Errorf("STRIPE_PRICE_ID_WAITLIST is not set")
	}
	if !strings.HasPrefix(id, "price_") {
		return "", fmt.Errorf("STRIPE_PRICE_ID_WAITLIST must be a Stripe price_ id")
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

// handleAdminWaitlist lists waitlist rows from Redis (PII). Allowed with BACKEND_INTERNAL_SERVICE_TOKEN or Stripe admin session.
func (s *Server) handleAdminWaitlist(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	ok, svcUnavail := s.adminReadAuthorized(r)
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
	ok, svcUnavail := s.adminReadAuthorized(r)
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

func (s *Server) handleAdminCatalog(w http.ResponseWriter, r *http.Request) {
	serviceWriteAuthorized := r.Method == http.MethodPut && s.catalogServiceWriteAuthorized(r)
	if !serviceWriteAuthorized {
		if r.Method == http.MethodGet {
			ok, svcUnavail := s.adminReadAuthorized(r)
			if !ok {
				if svcUnavail {
					http.Error(w, "admin auth disabled", http.StatusServiceUnavailable)
				} else {
					http.Error(w, "unauthorized", http.StatusUnauthorized)
				}
				return
			}
		} else {
			if !s.adminAuthEnabled() {
				http.Error(w, "admin auth disabled", http.StatusServiceUnavailable)
				return
			}
			if _, err := s.validateAdminSession(r.Context(), tokenFromAuthHeader(r)); err != nil {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
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
	ok, svcUnavail := s.companyRegistryReadAuthorized(r)
	if !ok {
		if svcUnavail {
			http.Error(w, "admin auth disabled", http.StatusServiceUnavailable)
		} else {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
		}
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

func (s *Server) handleAdminCompanyChannelsDiscover(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	ok, svcUnavail := s.companyRegistryReadAuthorized(r)
	if !ok {
		if svcUnavail {
			http.Error(w, "admin auth disabled", http.StatusServiceUnavailable)
		} else {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
		}
		return
	}
	var body struct {
		Channels []struct {
			ChannelID string   `json:"channel_id"`
			Name      string   `json:"name"`
			OwnerIDs  []string `json:"owner_ids"`
		} `json:"channels"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&body); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	var in []DiscoveredChannelInput
	for _, c := range body.Channels {
		cid := strings.TrimSpace(c.ChannelID)
		if cid == "" || !ValidSlackChannelID(cid) {
			continue
		}
		in = append(in, DiscoveredChannelInput{ChannelID: cid, Name: c.Name, OwnerIDs: c.OwnerIDs})
	}
	if len(in) == 0 {
		writeJSON(w, http.StatusOK, map[string]any{
			"upserted":       []string{},
			"upserted_count": 0,
			"requested":      0,
			"redisKey":       strings.TrimSpace(s.cfg.CompanyChannelsRedisKey),
		})
		return
	}
	touched, err := s.store.UpsertDiscoveredCompanyChannels(r.Context(), s.cfg.CompanyChannelsRedisKey, in)
	if err != nil {
		s.log.Printf("admin company channels discover: %v", err)
		http.Error(w, "company channels discover error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"upserted":       touched,
		"upserted_count": len(touched),
		"requested":      len(in),
		"redisKey":       strings.TrimSpace(s.cfg.CompanyChannelsRedisKey),
	})
}

func (s *Server) handleAdminCompanyChannelGet(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	chID := strings.TrimSpace(r.PathValue("channelId"))
	if chID == "" || !ValidSlackChannelID(chID) {
		http.Error(w, "bad channel id", http.StatusBadRequest)
		return
	}
	if !s.authorizedForCompanyChannelRead(r, chID) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
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
	chID := strings.TrimSpace(r.PathValue("channelId"))
	if chID == "" || !ValidSlackChannelID(chID) {
		http.Error(w, "bad channel id", http.StatusBadRequest)
		return
	}
	if !s.authorizedForCompanyChannelPatch(r, chID) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	var patch CompanyChannelPatch
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&patch); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	if patch.GeneralAutoReactionEnabled == nil && patch.GeneralResponsesMuted == nil && patch.OutOfOfficeEnabled == nil {
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

func (s *Server) handleAdminChannelKnowledge(w http.ResponseWriter, r *http.Request) {
	chID := strings.TrimSpace(r.PathValue("channelId"))
	if chID == "" || !ValidSlackChannelID(chID) {
		http.Error(w, "bad channel id", http.StatusBadRequest)
		return
	}
	if !s.authorizedForCompanyChannelRead(r, chID) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
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
	if orchURL := strings.TrimSpace(s.cfg.SlackOrchestratorCapabilityCatalogURL); orchURL != "" {
		cat, err := FetchCapabilityCatalogFromOrchestrator(r.Context(), orchURL)
		if err != nil {
			s.log.Printf("runtime capability catalog: orchestrator fetch failed, using redis: %v", err)
		} else {
			cat = normalizeCapabilityCatalog(cat)
			if err := validateCapabilityCatalog(cat); err != nil {
				s.log.Printf("runtime capability catalog: orchestrator payload invalid (%v), using redis", err)
			} else {
				writeJSON(w, http.StatusOK, cat)
				return
			}
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
			s.routeCheckoutSessionCompleted(w, r.Context(), &sess)
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
		s.routeCheckoutSessionCompleted(w, r.Context(), sess)

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
	if priceID, err := s.waitlistPriceID(); err == nil {
		if ok, pid, err := checkoutSessionWaitlistLineItem(sess, priceID); err == nil && ok {
			stripeProductID = pid
		}
	}
	if err := s.store.SaveWaitlistSignup(ctx, sess.ID, email, custID, status, amount, cur, stripeProductID); err != nil {
		return "", err
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
