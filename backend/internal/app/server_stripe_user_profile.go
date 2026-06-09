package app

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/stripe/stripe-go/v82"
	"github.com/stripe/stripe-go/v82/customer"
)

func subscriptionCustomerID(sub *stripe.Subscription) string {
	if sub == nil {
		return ""
	}
	if sub.Customer != nil && strings.TrimSpace(sub.Customer.ID) != "" {
		return strings.TrimSpace(sub.Customer.ID)
	}
	return ""
}

// subscriptionCustomerIDFromRaw handles webhook JSON where "customer" is either a string id or an object.
func subscriptionCustomerIDFromRaw(raw []byte) string {
	var aux struct {
		Customer json.RawMessage `json:"customer"`
	}
	if err := json.Unmarshal(raw, &aux); err != nil {
		return ""
	}
	if len(aux.Customer) == 0 {
		return ""
	}
	var idStr string
	if err := json.Unmarshal(aux.Customer, &idStr); err == nil && strings.TrimSpace(idStr) != "" {
		return strings.TrimSpace(idStr)
	}
	var obj struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(aux.Customer, &obj); err == nil {
		return strings.TrimSpace(obj.ID)
	}
	return ""
}

func profileTierFromSubscription(sub *stripe.Subscription) string {
	if sub == nil {
		return "none"
	}
	switch sub.Status {
	case stripe.SubscriptionStatusActive, stripe.SubscriptionStatusTrialing:
		return "subscriber"
	case stripe.SubscriptionStatusCanceled, stripe.SubscriptionStatusIncompleteExpired, stripe.SubscriptionStatusUnpaid:
		return "none"
	default:
		return string(sub.Status)
	}
}

func primarySubscriptionPriceID(sub *stripe.Subscription) string {
	if sub == nil || len(sub.Items.Data) == 0 {
		return ""
	}
	it := sub.Items.Data[0]
	if it.Price != nil && strings.TrimSpace(it.Price.ID) != "" {
		return strings.TrimSpace(it.Price.ID)
	}
	return ""
}

// primarySubscriptionProductID returns the Stripe product id for the subscription's primary price (any prod_*).
// subscriptionCurrentPeriodEndUnix returns a display billing-boundary timestamp for Redis/UI.
// stripe-go v82 removed Subscription.CurrentPeriodEnd; use the primary item when present, else CancelAt.
func subscriptionCurrentPeriodEndUnix(sub *stripe.Subscription) int64 {
	if sub == nil {
		return 0
	}
	if sub.Items != nil && len(sub.Items.Data) > 0 {
		it := sub.Items.Data[0]
		if it != nil && it.CurrentPeriodEnd > 0 {
			return it.CurrentPeriodEnd
		}
	}
	if sub.CancelAt > 0 {
		return sub.CancelAt
	}
	return 0
}

func primarySubscriptionProductID(sub *stripe.Subscription) string {
	if sub == nil || len(sub.Items.Data) == 0 {
		return ""
	}
	it := sub.Items.Data[0]
	if it.Price != nil {
		return priceProductID(it.Price)
	}
	return ""
}

func (s *Server) syncUserProfileFromStripeSubscription(ctx context.Context, sub *stripe.Subscription, raw json.RawMessage) error {
	custID := subscriptionCustomerID(sub)
	if custID == "" {
		custID = subscriptionCustomerIDFromRaw(raw)
	}
	if custID == "" {
		return fmt.Errorf("subscription missing customer id")
	}
	cust, err := customer.Get(custID, nil)
	if err != nil {
		return fmt.Errorf("stripe customer get: %w", err)
	}
	email := normalizeProfileEmail(cust.Email)
	if email == "" {
		return fmt.Errorf("customer %s has no email", custID)
	}
	tier := profileTierFromSubscription(sub)
	priceID := primarySubscriptionPriceID(sub)
	productID := primarySubscriptionProductID(sub)
	if err := s.store.UpsertUserProfileStripeSubscription(ctx, email, custID, sub.ID, string(sub.Status), tier, priceID, productID, sub.CancelAtPeriodEnd, subscriptionCurrentPeriodEndUnix(sub)); err != nil {
		return err
	}

	// Cancel webhook → winback DM (#341). One polite Joanne message at the moment the
	// subscription actually terminates (period-end). Idempotent via winback_dm_enqueued_at so a
	// retried webhook or a `subscription.updated → deleted` progression doesn't double-DM.
	if strings.EqualFold(strings.TrimSpace(string(sub.Status)), "canceled") {
		row, rerr := s.store.UserProfileRowByEmail(ctx, email)
		if rerr != nil {
			s.log.Printf("winback dm: load profile %s: %v", email, rerr)
			return nil
		}
		if row.FreeLifetime {
			return nil // pre-cliff user — already preserved by EffectiveStatus, no winback needed
		}
		if strings.TrimSpace(row.WinbackDMEnqueuedAt) != "" {
			return nil // already DM'd them about this cancel
		}
		slackID := strings.TrimSpace(row.SlackUserID)
		if slackID == "" {
			return nil // can't DM without a Slack id (waitlist-only, lander-only, etc.)
		}
		checkoutURL := s.trialExpiryCheckoutURL()
		job := ExpiryDMJob{
			SlackUserID:       slackID,
			Email:             email,
			StripeCheckoutURL: appendClientReferenceID(checkoutURL, slackID),
			Reason:            "subscription_canceled",
		}
		if qerr := s.store.EnqueueWinbackDMJob(ctx, email, job); qerr != nil {
			s.log.Printf("winback dm: enqueue %s: %v", email, qerr)
		}
	}
	return nil
}
