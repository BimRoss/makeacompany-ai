package app

import "testing"

func TestPortalBillingPublicJSON(t *testing.T) {
	row := UserProfileRow{
		StripeSubscriptionID:                "sub_x",
		StripeSubscriptionStatus:            "active",
		StripeSubscriptionCancelAtPeriodEnd: false,
		StripeSubscriptionCurrentPeriodEnd:  1735689600,
	}
	j := portalBillingPublicJSON(row)
	if j["hasManageableSubscription"] != true {
		t.Fatalf("expected manageable subscription")
	}
	if j["cancelAtPeriodEnd"] != false {
		t.Fatalf("cancelAtPeriodEnd")
	}
	row.StripeSubscriptionCancelAtPeriodEnd = true
	j2 := portalBillingPublicJSON(row)
	if j2["hasManageableSubscription"] != false {
		t.Fatalf("expected no manageable when cancel scheduled")
	}
	if j2["cancelAtPeriodEnd"] != true {
		t.Fatalf("cancelAtPeriodEnd expected true")
	}
}

func TestPortalBillingCanCancel(t *testing.T) {
	row := UserProfileRow{
		StripeCustomerID:                    "cus_a",
		StripeSubscriptionID:                "sub_x",
		StripeSubscriptionStatus:            "active",
		StripeSubscriptionCancelAtPeriodEnd: false,
	}
	if !portalBillingCanCancel(row) {
		t.Fatal("expected can cancel")
	}
	row.StripeSubscriptionCancelAtPeriodEnd = true
	if portalBillingCanCancel(row) {
		t.Fatal("expected cannot cancel when already scheduled")
	}
	row.StripeSubscriptionCancelAtPeriodEnd = false
	row.StripeSubscriptionStatus = "canceled"
	if portalBillingCanCancel(row) {
		t.Fatal("expected cannot cancel when canceled")
	}
}
