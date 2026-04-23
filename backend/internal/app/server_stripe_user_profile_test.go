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
