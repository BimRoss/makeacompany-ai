package app

import (
	"net/http"
	"strings"

	"github.com/stripe/stripe-go/v82"
	"github.com/stripe/stripe-go/v82/subscription"
)

func portalBillingManageableStatus(status string) bool {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case string(stripe.SubscriptionStatusActive), string(stripe.SubscriptionStatusTrialing), string(stripe.SubscriptionStatusPastDue):
		return true
	default:
		return false
	}
}

func portalBillingPublicJSON(row UserProfileRow) map[string]any {
	st := strings.ToLower(strings.TrimSpace(row.StripeSubscriptionStatus))
	subID := strings.TrimSpace(row.StripeSubscriptionID)
	hasPaying := subID != "" && portalBillingManageableStatus(st)
	cancelScheduled := row.StripeSubscriptionCancelAtPeriodEnd
	out := map[string]any{
		"hasManageableSubscription": hasPaying && !cancelScheduled,
		"subscriptionStatus":        st,
		"cancelAtPeriodEnd":         cancelScheduled,
	}
	if row.StripeSubscriptionCurrentPeriodEnd > 0 {
		out["currentPeriodEnd"] = row.StripeSubscriptionCurrentPeriodEnd
	}
	return out
}

func portalBillingCanCancel(row UserProfileRow) bool {
	st := strings.ToLower(strings.TrimSpace(row.StripeSubscriptionStatus))
	subID := strings.TrimSpace(row.StripeSubscriptionID)
	if subID == "" || !portalBillingManageableStatus(st) {
		return false
	}
	return !row.StripeSubscriptionCancelAtPeriodEnd
}

func (s *Server) handlePortalBillingCancelSubscription(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if strings.TrimSpace(s.cfg.StripeSecretKey) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "stripe is not configured"})
		return
	}
	session, err := s.store.GetPortalSession(r.Context(), tokenFromAuthHeader(r))
	if err != nil || session.Email == "" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	row, err := s.store.UserProfileRowByEmail(r.Context(), session.Email)
	if err != nil {
		s.log.Printf("portal cancel subscription profile: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "unable to load billing profile"})
		return
	}
	if !portalBillingCanCancel(row) {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "no active subscription to cancel"})
		return
	}
	subID := strings.TrimSpace(row.StripeSubscriptionID)
	subLive, err := subscription.Get(subID, nil)
	if err != nil {
		s.log.Printf("portal cancel subscription get: %v", err)
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "unable to verify subscription"})
		return
	}
	custLive := subscriptionCustomerID(subLive)
	wantCust := strings.TrimSpace(row.StripeCustomerID)
	if custLive == "" || wantCust == "" || custLive != wantCust {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "subscription does not match this account"})
		return
	}
	if strings.TrimSpace(subLive.ID) != subID {
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "subscription mismatch"})
		return
	}
	if subLive.CancelAtPeriodEnd {
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":                true,
			"alreadyScheduled":  true,
			"cancelAtPeriodEnd": true,
			"currentPeriodEnd":  subscriptionCurrentPeriodEndUnix(subLive),
		})
		return
	}
	updated, err := subscription.Update(subID, &stripe.SubscriptionParams{
		CancelAtPeriodEnd: stripe.Bool(true),
	})
	if err != nil {
		s.log.Printf("portal cancel subscription update: %v", err)
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":                true,
		"cancelAtPeriodEnd": updated.CancelAtPeriodEnd,
		"currentPeriodEnd":  subscriptionCurrentPeriodEndUnix(updated),
	})
}
