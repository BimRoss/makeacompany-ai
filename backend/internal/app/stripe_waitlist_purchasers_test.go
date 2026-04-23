package app

import (
	"encoding/json"
	"testing"

	"github.com/stripe/stripe-go/v82"
)

func TestPriceProductID_IDOnlyPriceStub(t *testing.T) {
	var p stripe.Price
	if err := json.Unmarshal([]byte(`"price_123"`), &p); err != nil {
		t.Fatal(err)
	}
	if p.ID != "price_123" || p.Product != nil {
		t.Fatalf("expected ID-only stub, got id=%q product=%v", p.ID, p.Product)
	}
	if got := priceProductID(&p); got != "" {
		t.Fatalf("priceProductID: want empty for ID-only price, got %q", got)
	}
}

func TestPriceProductID_UnexpandedProductString(t *testing.T) {
	var p stripe.Price
	raw := `{"id":"price_123","object":"price","product":"prod_456"}`
	if err := json.Unmarshal([]byte(raw), &p); err != nil {
		t.Fatal(err)
	}
	if got := priceProductID(&p); got != "prod_456" {
		t.Fatalf("priceProductID: want prod_456, got %q", got)
	}
}
