package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/stripe/stripe-go/v82"
	checkoutsession "github.com/stripe/stripe-go/v82/checkout/session"
)

// Stripe checkout price roles for admin snapshots (distinct from legacy Redis waitlist keys).
const (
	StripeCheckoutPriceRoleBasePlan        = "base_plan"
	StripeCheckoutPriceRoleWaitlistDeposit = "waitlist_deposit"
)

// StripeWaitlistPurchaser is one deduped paid checkout row per (email, matched price) from Stripe (admin source of truth).
type StripeWaitlistPurchaser struct {
	Email           string `json:"email"`
	PaymentStatus   string `json:"paymentStatus"`
	AmountTotal     string `json:"amountTotal"`
	Currency        string `json:"currency"`
	StripeCustomer  string `json:"stripeCustomer"`
	StripeSessionID string `json:"stripeSessionId"`
	StripeProductID string `json:"stripeProductId"`
	CheckoutCreated string `json:"checkoutCreated"`
	Source          string `json:"source"`
	WaitlistPriceID string `json:"waitlistPriceId"`
	// PriceRole distinguishes monthly/base-plan checkouts vs legacy waitlist deposit (same table in admin).
	PriceRole string `json:"priceRole,omitempty"`
}

// stripeWaitlistSnapshotEnvelope is stored in Redis and returned to the admin UI.
type stripeWaitlistSnapshotEnvelope struct {
	FetchedAt    string                    `json:"fetchedAt"`
	PriceID      string                    `json:"priceId"` // legacy single price; equals PriceIDs[0] when present
	PriceIDs     []string                  `json:"priceIds,omitempty"`
	Purchasers   []StripeWaitlistPurchaser `json:"purchasers"`
	SnapshotNote string                    `json:"snapshotNote,omitempty"`
}

// SnapshotPriceIDs returns configured Stripe price ids from an unmarshaled envelope (backward compatible).
func SnapshotPriceIDs(env stripeWaitlistSnapshotEnvelope) []string {
	if len(env.PriceIDs) > 0 {
		out := make([]string, 0, len(env.PriceIDs))
		for _, id := range env.PriceIDs {
			id = strings.TrimSpace(id)
			if id != "" {
				out = append(out, id)
			}
		}
		if len(out) > 0 {
			return out
		}
	}
	if id := strings.TrimSpace(env.PriceID); id != "" {
		return []string{id}
	}
	return nil
}

// StripeWaitlistPurchaserCountsTowardPublicSignupStats treats explicit base_plan rows as non-waitlist for max(signups) merge.
func StripeWaitlistPurchaserCountsTowardPublicSignupStats(p StripeWaitlistPurchaser) bool {
	switch strings.TrimSpace(p.PriceRole) {
	case "", StripeCheckoutPriceRoleWaitlistDeposit:
		return true
	case StripeCheckoutPriceRoleBasePlan:
		return false
	default:
		return true
	}
}

// AdminStripeCheckoutPriceSlot binds a Stripe price id to its admin/stats role.
type AdminStripeCheckoutPriceSlot struct {
	PriceID string
	Role    string
}

func purchaserDedupeKey(email, priceID string) string {
	return normalizeStripePurchaserEmail(email) + "\x00" + strings.TrimSpace(priceID)
}

func normalizeStripePurchaserEmail(s string) string {
	return strings.ToLower(strings.TrimSpace(s))
}

// maxStripeWaitlistSessionsScanned caps Stripe list iteration (complete sessions) to avoid runaway.
const maxStripeWaitlistSessionsScanned = 50000

func priceProductID(p *stripe.Price) string {
	if p == nil {
		return ""
	}
	if p.Product != nil {
		if id := strings.TrimSpace(p.Product.ID); id != "" {
			return id
		}
	}
	return ""
}

func checkoutSessionWaitlistLineItem(sess *stripe.CheckoutSession, wantPriceID string) (found bool, productID string, err error) {
	if sess == nil || wantPriceID == "" {
		return false, "", nil
	}
	tryList := func(list *stripe.LineItemList) (bool, string) {
		if list == nil {
			return false, ""
		}
		for _, li := range list.Data {
			if li != nil && li.Price != nil && li.Price.ID == wantPriceID {
				return true, priceProductID(li.Price)
			}
		}
		return false, ""
	}
	if ok, pid := tryList(sess.LineItems); ok {
		return true, pid, nil
	}
	params := &stripe.CheckoutSessionListLineItemsParams{
		Session: stripe.String(sess.ID),
	}
	params.Limit = stripe.Int64(100)
	params.AddExpand("data.price")
	iter := checkoutsession.ListLineItems(params)
	for iter.Next() {
		li := iter.LineItem()
		if li != nil && li.Price != nil && li.Price.ID == wantPriceID {
			return true, priceProductID(li.Price), nil
		}
	}
	if err := iter.Err(); err != nil {
		return false, "", err
	}
	return false, "", nil
}

func checkoutSessionCustomerID(sess *stripe.CheckoutSession) string {
	if sess == nil || sess.Customer == nil {
		return ""
	}
	return strings.TrimSpace(sess.Customer.ID)
}

// checkoutSessionCountsForBasePlanSnapshot is true for completed checkout we treat as a Base Plan signup
// (one-time payment legacy or active subscription checkout).
func checkoutSessionCountsForBasePlanSnapshot(sess *stripe.CheckoutSession) bool {
	if sess == nil {
		return false
	}
	switch sess.Mode {
	case stripe.CheckoutSessionModePayment:
		return sess.PaymentStatus == stripe.CheckoutSessionPaymentStatusPaid
	case stripe.CheckoutSessionModeSubscription:
		return sess.PaymentStatus == stripe.CheckoutSessionPaymentStatusPaid ||
			sess.PaymentStatus == stripe.CheckoutSessionPaymentStatusNoPaymentRequired
	default:
		return false
	}
}

// FetchStripeWaitlistPurchasers lists completed Checkouts for a single price id (backward compatible wrapper).
func FetchStripeWaitlistPurchasers(ctx context.Context, basePlanPriceID string) ([]StripeWaitlistPurchaser, error) {
	basePlanPriceID = strings.TrimSpace(basePlanPriceID)
	if basePlanPriceID == "" {
		return nil, errors.New("missing base plan price id")
	}
	return FetchStripeAdminCheckoutPurchasers(ctx, []AdminStripeCheckoutPriceSlot{
		{PriceID: basePlanPriceID, Role: StripeCheckoutPriceRoleBasePlan},
	})
}

// FetchStripeAdminCheckoutPurchasers lists completed Checkout Sessions for any of the given price ids,
// deduping per (normalized email, price id) with latest checkout winning.
func FetchStripeAdminCheckoutPurchasers(ctx context.Context, slots []AdminStripeCheckoutPriceSlot) ([]StripeWaitlistPurchaser, error) {
	if strings.TrimSpace(stripe.Key) == "" {
		return nil, errors.New("stripe is not configured")
	}
	priceToRole := make(map[string]string)
	for _, sl := range slots {
		pid := strings.TrimSpace(sl.PriceID)
		if pid == "" {
			continue
		}
		if _, ok := priceToRole[pid]; ok {
			continue
		}
		role := strings.TrimSpace(sl.Role)
		if role == "" {
			role = StripeCheckoutPriceRoleBasePlan
		}
		priceToRole[pid] = role
	}
	if len(priceToRole) == 0 {
		return nil, errors.New("no stripe checkout price ids configured")
	}

	listParams := &stripe.CheckoutSessionListParams{}
	listParams.Status = stripe.String(string(stripe.CheckoutSessionStatusComplete))
	listParams.Limit = stripe.Int64(100)
	listParams.AddExpand("data.line_items")
	listParams.AddExpand("data.line_items.data.price")
	listParams.AddExpand("data.customer")

	bestByKey := make(map[string]*stripe.CheckoutSession)
	bestProductByKey := make(map[string]string)
	bestPriceIDByKey := make(map[string]string)

	iter := checkoutsession.List(listParams)
	scanned := 0
	for iter.Next() {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}
		scanned++
		if scanned > maxStripeWaitlistSessionsScanned {
			break
		}
		sess := iter.CheckoutSession()
		if sess == nil {
			continue
		}
		if !checkoutSessionCountsForBasePlanSnapshot(sess) {
			continue
		}
		em := normalizeStripePurchaserEmail(sessionEmailFromCheckout(sess))
		if em == "" {
			continue
		}
		for priceID := range priceToRole {
			ok, productID, err := checkoutSessionWaitlistLineItem(sess, priceID)
			if err != nil {
				return nil, fmt.Errorf("line items for session %s: %w", sess.ID, err)
			}
			if !ok {
				continue
			}
			k := purchaserDedupeKey(em, priceID)
			prev := bestByKey[k]
			if prev == nil || sess.Created > prev.Created {
				cp := *sess
				bestByKey[k] = &cp
				bestProductByKey[k] = productID
				bestPriceIDByKey[k] = priceID
			}
		}
	}
	if err := iter.Err(); err != nil {
		return nil, err
	}

	out := make([]StripeWaitlistPurchaser, 0, len(bestByKey))
	for k, sess := range bestByKey {
		priceID := bestPriceIDByKey[k]
		role := priceToRole[priceID]
		em := normalizeStripePurchaserEmail(sessionEmailFromCheckout(sess))
		created := time.Unix(sess.Created, 0).UTC().Format(time.RFC3339)
		out = append(out, StripeWaitlistPurchaser{
			Email:           em,
			PaymentStatus:   string(sess.PaymentStatus),
			AmountTotal:     strconv.FormatInt(sess.AmountTotal, 10),
			Currency:        string(sess.Currency),
			StripeCustomer:  checkoutSessionCustomerID(sess),
			StripeSessionID: sess.ID,
			StripeProductID: strings.TrimSpace(bestProductByKey[k]),
			CheckoutCreated: created,
			Source:          "stripe_api",
			WaitlistPriceID: priceID,
			PriceRole:       role,
		})
	}
	sort.Slice(out, func(i, j int) bool {
		ti, _ := time.Parse(time.RFC3339, out[i].CheckoutCreated)
		tj, _ := time.Parse(time.RFC3339, out[j].CheckoutCreated)
		if ti.Equal(tj) {
			if out[i].Email != out[j].Email {
				return out[i].Email < out[j].Email
			}
			return out[i].WaitlistPriceID < out[j].WaitlistPriceID
		}
		return ti.After(tj)
	})
	return out, nil
}

// MarshalStripeWaitlistSnapshot builds the JSON blob for Redis.
func MarshalStripeWaitlistSnapshot(priceIDs []string, purchasers []StripeWaitlistPurchaser) ([]byte, error) {
	ids := make([]string, 0, len(priceIDs))
	seen := map[string]struct{}{}
	for _, id := range priceIDs {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	primary := ""
	if len(ids) > 0 {
		primary = ids[0]
	}
	note := "Refreshed from Stripe Checkout Session list (configured price_* ids; payment or subscription). Deduped per email per price."
	env := stripeWaitlistSnapshotEnvelope{
		FetchedAt:    time.Now().UTC().Format(time.RFC3339),
		PriceID:      primary,
		PriceIDs:     ids,
		Purchasers:   purchasers,
		SnapshotNote: note,
	}
	return json.Marshal(env)
}

// ParseStripeWaitlistSnapshotEnvelope unmarshals Redis JSON.
func ParseStripeWaitlistSnapshotEnvelope(raw []byte) (stripeWaitlistSnapshotEnvelope, error) {
	var env stripeWaitlistSnapshotEnvelope
	if len(raw) == 0 {
		return env, errors.New("empty snapshot")
	}
	if err := json.Unmarshal(raw, &env); err != nil {
		return env, err
	}
	return env, nil
}
