package app

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/stripe/stripe-go/v82"
	checkoutsession "github.com/stripe/stripe-go/v82/checkout/session"
	stripewebhook "github.com/stripe/stripe-go/v82/webhook"
)

type Server struct {
	cfg    Config
	log    *log.Logger
	store  *Store
	mux    *http.ServeMux
	cors   string
}

func NewServer(cfg Config, logger *log.Logger, store *Store) (*Server, error) {
	stripe.Key = cfg.StripeSecretKey
	s := &Server{
		cfg:   cfg,
		log:   logger,
		store: store,
		mux:   http.NewServeMux(),
		cors:  cfg.AppBaseURL,
	}
	s.mux.HandleFunc("/livez", s.handleLivez)
	s.mux.HandleFunc("/readyz", s.handleReadiness)
	s.mux.HandleFunc("/health", s.handleHealth)
	s.mux.HandleFunc("/v1/billing/checkout", s.handleCheckout)
	s.mux.HandleFunc("/v1/billing/webhook", s.handleWebhook)
	return s, nil
}

func (s *Server) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.withCORS(w, r, s.mux)
	})
}

func (s *Server) withCORS(w http.ResponseWriter, r *http.Request, next http.Handler) {
	origin := r.Header.Get("Origin")
	if origin != "" && (origin == s.cors || strings.HasPrefix(origin, "http://localhost:")) {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Stripe-Signature")
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
	s.handleReadiness(w, r)
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
	event, err := stripewebhook.ConstructEvent(body, r.Header.Get("Stripe-Signature"), s.cfg.StripeWebhookSecret)
	if err != nil {
		http.Error(w, "invalid signature", http.StatusBadRequest)
		return
	}
	if event.Type != "checkout.session.completed" {
		writeJSON(w, http.StatusOK, map[string]any{"received": true, "ignored": event.Type})
		return
	}
	var sess stripe.CheckoutSession
	if err := json.Unmarshal(event.Data.Raw, &sess); err != nil {
		s.log.Printf("webhook unmarshal: %v", err)
		http.Error(w, "bad payload", http.StatusBadRequest)
		return
	}
	email := strings.TrimSpace(sess.CustomerDetails.Email)
	if email == "" {
		email = strings.TrimSpace(sess.CustomerEmail)
	}
	if email == "" {
		s.log.Printf("checkout session %s completed without email", sess.ID)
		http.Error(w, "missing customer email", http.StatusBadRequest)
		return
	}
	var custID string
	if sess.Customer != nil {
		custID = sess.Customer.ID
	}
	amount := sess.AmountTotal
	cur := string(sess.Currency)
	status := string(sess.PaymentStatus)
	ctx := context.Background()
	if err := s.store.SaveWaitlistSignup(ctx, sess.ID, email, custID, status, amount, cur); err != nil {
		s.log.Printf("save waitlist: %v", err)
		http.Error(w, "store error", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"received": true})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
