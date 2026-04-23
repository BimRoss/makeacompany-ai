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

// StripeWaitlistPurchaser is one deduped paid waitlist row from Stripe Checkout (source of truth for admin).
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
}

// stripeWaitlistSnapshotEnvelope is stored in Redis and returned to the admin UI.
type stripeWaitlistSnapshotEnvelope struct {
	FetchedAt    string                    `json:"fetchedAt"`
	PriceID      string                    `json:"priceId"`
	Purchasers   []StripeWaitlistPurchaser `json:"purchasers"`
	SnapshotNote string                    `json:"snapshotNote,omitempty"`
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

// FetchStripeWaitlistPurchasers lists completed Checkout Sessions in payment mode with paid status,
// keeps sessions whose line items include waitlistPriceID, dedupes by normalized email (latest checkout wins).
func FetchStripeWaitlistPurchasers(ctx context.Context, waitlistPriceID string) ([]StripeWaitlistPurchaser, error) {
	waitlistPriceID = strings.TrimSpace(waitlistPriceID)
	if waitlistPriceID == "" {
		return nil, errors.New("missing waitlist price id")
	}
	if strings.TrimSpace(stripe.Key) == "" {
		return nil, errors.New("stripe is not configured")
	}

	listParams := &stripe.CheckoutSessionListParams{}
	listParams.Status = stripe.String(string(stripe.CheckoutSessionStatusComplete))
	listParams.Limit = stripe.Int64(100)
	listParams.AddExpand("data.line_items")
	// Omit data.line_items.data.price.product: Stripe max expand depth is 4; product id
	// is still present on Price as an unexpanded string (stripe-go → Product.ID).
	listParams.AddExpand("data.line_items.data.price")
	listParams.AddExpand("data.customer")

	bestByEmail := make(map[string]*stripe.CheckoutSession)
	bestProductIDByEmail := make(map[string]string)
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
		if sess.Mode != stripe.CheckoutSessionModePayment {
			continue
		}
		if sess.PaymentStatus != stripe.CheckoutSessionPaymentStatusPaid {
			continue
		}
		em := sessionEmailFromCheckout(sess)
		if em == "" {
			continue
		}
		ok, productID, err := checkoutSessionWaitlistLineItem(sess, waitlistPriceID)
		if err != nil {
			return nil, fmt.Errorf("line items for session %s: %w", sess.ID, err)
		}
		if !ok {
			continue
		}
		prev := bestByEmail[em]
		if prev == nil || sess.Created > prev.Created {
			cp := *sess
			bestByEmail[em] = &cp
			bestProductIDByEmail[em] = productID
		}
	}
	if err := iter.Err(); err != nil {
		return nil, err
	}

	out := make([]StripeWaitlistPurchaser, 0, len(bestByEmail))
	for email, sess := range bestByEmail {
		created := time.Unix(sess.Created, 0).UTC().Format(time.RFC3339)
		out = append(out, StripeWaitlistPurchaser{
			Email:           email,
			PaymentStatus:   string(sess.PaymentStatus),
			AmountTotal:     strconv.FormatInt(sess.AmountTotal, 10),
			Currency:        string(sess.Currency),
			StripeCustomer:  checkoutSessionCustomerID(sess),
			StripeSessionID: sess.ID,
			StripeProductID: strings.TrimSpace(bestProductIDByEmail[email]),
			CheckoutCreated: created,
			Source:          "stripe_api",
			WaitlistPriceID: waitlistPriceID,
		})
	}
	sort.Slice(out, func(i, j int) bool {
		ti, _ := time.Parse(time.RFC3339, out[i].CheckoutCreated)
		tj, _ := time.Parse(time.RFC3339, out[j].CheckoutCreated)
		if ti.Equal(tj) {
			return out[i].Email < out[j].Email
		}
		return ti.After(tj)
	})
	return out, nil
}

// MarshalStripeWaitlistSnapshot builds the JSON blob for Redis.
func MarshalStripeWaitlistSnapshot(priceID string, purchasers []StripeWaitlistPurchaser) ([]byte, error) {
	env := stripeWaitlistSnapshotEnvelope{
		FetchedAt:    time.Now().UTC().Format(time.RFC3339),
		PriceID:      strings.TrimSpace(priceID),
		Purchasers:   purchasers,
		SnapshotNote: "Refreshed from Stripe Checkout Session list (paid, waitlist price). Deduped by email.",
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
