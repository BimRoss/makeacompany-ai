package app

import (
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

// routeCheckoutSessionCompleted dispatches Stripe checkout.session.completed for Base Plan (subscription)
// and legacy one-time waitlist (payment) sessions.
func (s *Server) routeCheckoutSessionCompleted(w http.ResponseWriter, sess *stripe.CheckoutSession) {
	if sess == nil {
		http.Error(w, "nil session", http.StatusBadRequest)
		return
	}

	switch sess.Mode {
	case stripe.CheckoutSessionModePayment:
		if sess.PaymentStatus != stripe.CheckoutSessionPaymentStatusPaid {
			writeJSON(w, http.StatusOK, map[string]any{"received": true, "ignored": "payment_not_paid"})
			return
		}
	case stripe.CheckoutSessionModeSubscription:
		ps := sess.PaymentStatus
		if ps != stripe.CheckoutSessionPaymentStatusPaid && ps != stripe.CheckoutSessionPaymentStatusNoPaymentRequired {
			writeJSON(w, http.StatusOK, map[string]any{"received": true, "ignored": "subscription_payment_pending"})
			return
		}
	default:
		writeJSON(w, http.StatusOK, map[string]any{"received": true, "ignored": "unsupported_checkout_mode"})
		return
	}

	source := strings.TrimSpace(sess.Metadata["source"])
	if source == "waitlist" || source == "base_plan" {
		s.completeWaitlistFromSession(w, sess)
		return
	}

	priceID, err := s.basePlanPriceID()
	if err != nil {
		s.log.Printf("webhook STRIPE_PRICE_ID_BASE_PLAN: %v", err)
		writeJSON(w, http.StatusOK, map[string]any{"received": true, "ignored": "waitlist_price_unconfigured"})
		return
	}
	ok, _, err := checkoutSessionWaitlistLineItem(sess, priceID)
	if err != nil {
		s.log.Printf("webhook checkout line items: %v", err)
		http.Error(w, "line items", http.StatusInternalServerError)
		return
	}
	if ok {
		s.completeWaitlistFromSession(w, sess)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"received": true, "ignored": "not_base_plan_checkout"})
}
