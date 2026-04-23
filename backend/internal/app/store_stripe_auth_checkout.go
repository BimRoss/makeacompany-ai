package app

import (
	"context"
	"fmt"
	"strings"
	"time"
)

const stripeAuthCheckoutWebhookTTL = 30 * time.Minute

func stripeAuthCheckoutWebhookRedisKey(sessionID string) string {
	return fmt.Sprintf("%s:stripe_auth_checkout_webhook:%s", keyPrefix, strings.TrimSpace(sessionID))
}

// SetStripeAuthCheckoutWebhookSeen records that Stripe sent checkout.session.completed for a
// setup-mode portal/admin auth session, so /auth/finish can keep polling if status lags.
func (s *Store) SetStripeAuthCheckoutWebhookSeen(ctx context.Context, sessionID string) error {
	if s == nil || s.rdb == nil {
		return fmt.Errorf("nil store")
	}
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return fmt.Errorf("missing session id")
	}
	return s.rdb.Set(ctx, stripeAuthCheckoutWebhookRedisKey(sessionID), "1", stripeAuthCheckoutWebhookTTL).Err()
}

// ClearStripeAuthCheckoutWebhookSeen removes the marker after a successful auth finish read.
func (s *Store) ClearStripeAuthCheckoutWebhookSeen(ctx context.Context, sessionID string) error {
	if s == nil || s.rdb == nil {
		return nil
	}
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return nil
	}
	return s.rdb.Del(ctx, stripeAuthCheckoutWebhookRedisKey(sessionID)).Err()
}

// StripeAuthCheckoutWebhookSeen reports whether the webhook path recorded completion for this session.
func (s *Store) StripeAuthCheckoutWebhookSeen(ctx context.Context, sessionID string) (bool, error) {
	if s == nil || s.rdb == nil {
		return false, nil
	}
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return false, nil
	}
	n, err := s.rdb.Exists(ctx, stripeAuthCheckoutWebhookRedisKey(sessionID)).Result()
	if err != nil {
		return false, err
	}
	return n == 1, nil
}
