package app

import "testing"

func TestCheckDeployGate(t *testing.T) {
	tests := []struct {
		name        string
		row         UserProfileRow
		gateEnabled bool
		wantAllowed bool
		wantReason  string
	}{
		{
			name:        "gate disabled always allows",
			row:         UserProfileRow{FreeTierConsumed: true},
			gateEnabled: false,
			wantAllowed: true,
			wantReason:  "gate_disabled",
		},
		{
			name:        "active subscription allows",
			row:         UserProfileRow{StripeSubscriptionStatus: "active"},
			gateEnabled: true,
			wantAllowed: true,
			wantReason:  "paid",
		},
		{
			name:        "trialing subscription allows",
			row:         UserProfileRow{StripeSubscriptionStatus: "trialing"},
			gateEnabled: true,
			wantAllowed: true,
			wantReason:  "paid",
		},
		{
			name:        "free user first deploy allowed",
			row:         UserProfileRow{StripeSubscriptionStatus: "", FreeTierConsumed: false},
			gateEnabled: true,
			wantAllowed: true,
			wantReason:  "free_tier_available",
		},
		{
			name:        "free user consumed blocks",
			row:         UserProfileRow{StripeSubscriptionStatus: "", FreeTierConsumed: true},
			gateEnabled: true,
			wantAllowed: false,
			wantReason:  "free_tier_consumed",
		},
		{
			name:        "canceled subscription blocks after free tier consumed",
			row:         UserProfileRow{StripeSubscriptionStatus: "canceled", FreeTierConsumed: true},
			gateEnabled: true,
			wantAllowed: false,
			wantReason:  "free_tier_consumed",
		},
		{
			name:        "canceled subscription allows if free tier not yet consumed",
			row:         UserProfileRow{StripeSubscriptionStatus: "canceled", FreeTierConsumed: false},
			gateEnabled: true,
			wantAllowed: true,
			wantReason:  "free_tier_available",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := CheckDeployGate(tc.row, tc.gateEnabled, "")
			if got.Allowed != tc.wantAllowed {
				t.Errorf("Allowed: got %v want %v", got.Allowed, tc.wantAllowed)
			}
			if got.Reason != tc.wantReason {
				t.Errorf("Reason: got %q want %q", got.Reason, tc.wantReason)
			}
		})
	}
}
