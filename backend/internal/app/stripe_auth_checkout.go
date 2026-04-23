package app

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/stripe/stripe-go/v82"
	checkoutsession "github.com/stripe/stripe-go/v82/checkout/session"
)

const (
	stripeAuthMetadataKey    = "mac_auth"
	stripeAuthMetadataAdmin  = "admin"
	stripeAuthMetadataPortal = "portal"
)

func checkoutSessionStatusComplete(sess *stripe.CheckoutSession) bool {
	if sess == nil {
		return false
	}
	return strings.EqualFold(strings.TrimSpace(string(sess.Status)), "complete")
}

// getCheckoutSessionForAuthFinish polls Stripe for a completed Checkout Session. Browsers can hit
// success_url before the session API reports status=complete; checkout.session.completed (webhook)
// may arrive in the same window and extends polling when a Redis marker is present.
func (s *Server) getCheckoutSessionForAuthFinish(ctx context.Context, sessionID string) (*stripe.CheckoutSession, error) {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" || !strings.HasPrefix(sessionID, "cs_") {
		return nil, fmt.Errorf("invalid session id")
	}

	delays := []time.Duration{
		0,
		150 * time.Millisecond,
		300 * time.Millisecond,
		500 * time.Millisecond,
		700 * time.Millisecond,
		time.Second,
		time.Second,
		time.Second,
	}

	var last *stripe.CheckoutSession
	for i, d := range delays {
		if i > 0 {
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(d):
			}
		}
		sess, err := checkoutsession.Get(sessionID, nil)
		if err != nil {
			return nil, err
		}
		last = sess
		if checkoutSessionStatusComplete(sess) {
			_ = s.store.ClearStripeAuthCheckoutWebhookSeen(ctx, sessionID)
			return sess, nil
		}
		if i >= 3 {
			seen, err := s.store.StripeAuthCheckoutWebhookSeen(ctx, sessionID)
			if err != nil {
				s.log.Printf("auth finish webhook marker read: %v", err)
			} else if seen {
				continue
			}
		}
	}
	if last != nil {
		return nil, fmt.Errorf("checkout session not complete (last status=%s)", string(last.Status))
	}
	return nil, fmt.Errorf("checkout session not retrieved")
}

// routeCheckoutSessionCompleted dispatches Stripe checkout.session.completed: setup auth sessions
// get a webhook marker; waitlist payment sessions are saved; everything else is ignored.
func (s *Server) routeCheckoutSessionCompleted(w http.ResponseWriter, ctx context.Context, sess *stripe.CheckoutSession) {
	if sess == nil {
		http.Error(w, "nil session", http.StatusBadRequest)
		return
	}
	mode := strings.TrimSpace(string(sess.Mode))
	macAuth := strings.TrimSpace(sess.Metadata[stripeAuthMetadataKey])
	if mode == string(stripe.CheckoutSessionModeSetup) && (macAuth == stripeAuthMetadataAdmin || macAuth == stripeAuthMetadataPortal) {
		if err := s.store.SetStripeAuthCheckoutWebhookSeen(ctx, sess.ID); err != nil {
			s.log.Printf("stripe auth webhook marker: %v", err)
		}
		writeJSON(w, http.StatusOK, map[string]any{"received": true, "stripeAuthSetup": macAuth})
		return
	}

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

	writeJSON(w, http.StatusOK, map[string]any{"received": true, "ignored": "not_waitlist_or_auth_setup"})
}
