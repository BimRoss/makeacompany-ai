package app

import (
	"testing"

	"github.com/stripe/stripe-go/v82"
)

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
