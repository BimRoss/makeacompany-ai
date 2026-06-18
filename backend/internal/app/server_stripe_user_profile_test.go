package app

import (
	"context"
	"testing"

	"github.com/stripe/stripe-go/v82"
)

func TestSubscriptionProductIsForeign(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name      string
		productID string
		basePlan  string
		want      bool
	}{
		{"foreign product is foreign", "prod_cycler", "prod_base", true},
		{"base product is not foreign", "prod_base", "prod_base", false},
		{"empty product id is lenient (not foreign)", "", "prod_base", false},
		{"unresolved base plan is lenient (not foreign)", "prod_cycler", "", false},
		{"both empty is lenient", "", "", false},
		{"whitespace tolerated", " prod_base ", "prod_base", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := subscriptionProductIsForeign(tc.productID, tc.basePlan); got != tc.want {
				t.Fatalf("subscriptionProductIsForeign(%q,%q) = %v, want %v", tc.productID, tc.basePlan, got, tc.want)
			}
		})
	}
}

// A subscription webhook for another product on the shared Stripe account (e.g. cycler.io) must not
// create a MaC profile. The guard runs before customer.Get, so this also proves no Stripe API call is
// needed for a foreign-product webhook. See #492.
func TestSyncUserProfileFromStripeSubscription_skipsForeignProduct(t *testing.T) {
	s, _ := newReaperTestServer(t)
	s.cfg.StripeProductBasePlan = "prod_base"
	ctx := context.Background()

	sub := &stripe.Subscription{
		ID:     "sub_cycler",
		Status: stripe.SubscriptionStatusActive,
		Items: &stripe.SubscriptionItemList{Data: []*stripe.SubscriptionItem{{
			Price: &stripe.Price{ID: "price_cycler", Product: &stripe.Product{ID: "prod_cycler"}},
		}}},
	}
	if err := s.syncUserProfileFromStripeSubscription(ctx, sub, nil); err != nil {
		t.Fatalf("expected nil (skipped), got %v", err)
	}
	rows, err := s.store.ListUserProfiles(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 0 {
		t.Fatalf("expected no profile minted for foreign product, got %d: %+v", len(rows), rows)
	}
}

func TestPrimarySubscriptionProductID(t *testing.T) {
	t.Parallel()
	sub := &stripe.Subscription{
		Items: &stripe.SubscriptionItemList{
			Data: []*stripe.SubscriptionItem{
				{
					Price: &stripe.Price{
						ID:      "price_monthly",
						Product: &stripe.Product{ID: "prod_monthly"},
					},
				},
			},
		},
	}
	if got := primarySubscriptionProductID(sub); got != "prod_monthly" {
		t.Fatalf("primarySubscriptionProductID: got %q", got)
	}
	if got := primarySubscriptionProductID(nil); got != "" {
		t.Fatalf("nil sub: got %q", got)
	}
}

func TestSubscriptionCurrentPeriodEndUnix(t *testing.T) {
	t.Parallel()
	if got := subscriptionCurrentPeriodEndUnix(nil); got != 0 {
		t.Fatalf("nil: %d", got)
	}
	sub := &stripe.Subscription{
		CancelAt: 999,
		Items: &stripe.SubscriptionItemList{
			Data: []*stripe.SubscriptionItem{{CurrentPeriodEnd: 42}},
		},
	}
	if got := subscriptionCurrentPeriodEndUnix(sub); got != 42 {
		t.Fatalf("from item: %d", got)
	}
	sub.Items.Data[0].CurrentPeriodEnd = 0
	if got := subscriptionCurrentPeriodEndUnix(sub); got != 999 {
		t.Fatalf("fallback CancelAt: %d", got)
	}
}
