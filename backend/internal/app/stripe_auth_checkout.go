package app

import (
	"context"
	"net/http"
	"strings"

	"github.com/stripe/stripe-go/v82"
)

func sessionEmailFromCheckout(sess *stripe.CheckoutSession) string {
	if sess == nil {
		return ""
	}
	if sess.CustomerDetails != nil {
		if email := strings.ToLower(strings.TrimSpace(sess.CustomerDetails.Email)); email != "" {
			return email
		}
	}
	return strings.ToLower(strings.TrimSpace(sess.CustomerEmail))
}

// routeCheckoutSessionCompleted dispatches Stripe checkout.session.completed for waitlist payment sessions.
func (s *Server) routeCheckoutSessionCompleted(w http.ResponseWriter, ctx context.Context, sess *stripe.CheckoutSession) {
	if sess == nil {
		http.Error(w, "nil session", http.StatusBadRequest)
		return
	}
	mode := strings.TrimSpace(string(sess.Mode))

	if mode == string(stripe.CheckoutSessionModePayment) {
		if strings.TrimSpace(sess.Metadata["source"]) == "waitlist" {
			s.completeWaitlistFromSession(w, sess)
			return
		}
		priceID, err := s.waitlistPriceID()
		if err != nil {
			s.log.Printf("webhook waitlist price id: %v", err)
			writeJSON(w, http.StatusOK, map[string]any{"received": true, "ignored": "waitlist_price_unconfigured"})
			return
		}
		ok, _, err := checkoutSessionWaitlistLineItem(sess, priceID)
		if err != nil {
			s.log.Printf("webhook waitlist line items: %v", err)
			http.Error(w, "line items", http.StatusInternalServerError)
			return
		}
		if ok {
			s.completeWaitlistFromSession(w, sess)
			return
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{"received": true, "ignored": "not_waitlist_payment"})
}
