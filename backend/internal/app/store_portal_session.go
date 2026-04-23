package app

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

const portalSessionKeyPrefix = keyPrefix + ":portal_session:"

func portalSessionKey(token string) string {
	return portalSessionKeyPrefix + strings.TrimSpace(token)
}

// PortalSession is a browser session for /{channelId} company portal (Stripe-verified owner email).
type PortalSession struct {
	Token     string `json:"token"`
	Email     string `json:"email"`
	ChannelID string `json:"channelId"`
	CreatedAt string `json:"createdAt"`
	ExpiresAt string `json:"expiresAt"`
}

func (s *Store) CreatePortalSession(ctx context.Context, token, email, channelID string, expiresAt time.Time) error {
	token = strings.TrimSpace(token)
	email = normalizeProfileEmail(email)
	channelID = strings.TrimSpace(channelID)
	if token == "" || email == "" || channelID == "" {
		return fmt.Errorf("missing portal session token/email/channel")
	}
	if expiresAt.IsZero() {
		return fmt.Errorf("missing portal session expiration")
	}
	ttl := time.Until(expiresAt)
	if ttl <= 0 {
		return fmt.Errorf("portal session already expired")
	}
	now := time.Now().UTC().Format(time.RFC3339)
	key := portalSessionKey(token)
	pipe := s.rdb.TxPipeline()
	pipe.HSet(ctx, key, map[string]any{
		"email":      email,
		"channel_id": channelID,
		"createdAt":  now,
		"expiresAt":  expiresAt.UTC().Format(time.RFC3339),
	})
	pipe.Expire(ctx, key, ttl)
	_, err := pipe.Exec(ctx)
	if err != nil {
		_ = s.rdb.Del(ctx, key).Err()
		return err
	}
	return nil
}

func (s *Store) GetPortalSession(ctx context.Context, token string) (PortalSession, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return PortalSession{}, fmt.Errorf("missing portal session token")
	}
	key := portalSessionKey(token)
	vals, err := s.rdb.HGetAll(ctx, key).Result()
	if err != nil {
		return PortalSession{}, err
	}
	if len(vals) == 0 {
		return PortalSession{}, redis.Nil
	}
	out := PortalSession{
		Token:     token,
		Email:     normalizeProfileEmail(vals["email"]),
		ChannelID: strings.TrimSpace(vals["channel_id"]),
		CreatedAt: strings.TrimSpace(vals["createdAt"]),
		ExpiresAt: strings.TrimSpace(vals["expiresAt"]),
	}
	if out.Email == "" || out.ChannelID == "" {
		return PortalSession{}, redis.Nil
	}
	gone, err := s.repairPortalSessionTTLIfNeeded(ctx, key, out.ExpiresAt)
	if err != nil {
		return PortalSession{}, err
	}
	if gone {
		return PortalSession{}, redis.Nil
	}
	return out, nil
}

func (s *Store) repairPortalSessionTTLIfNeeded(ctx context.Context, key, expiresAtRFC3339 string) (gone bool, err error) {
	ttl, err := s.rdb.TTL(ctx, key).Result()
	if err != nil {
		return false, err
	}
	if ttl != time.Duration(-1) {
		return false, nil
	}
	expiresAtRFC3339 = strings.TrimSpace(expiresAtRFC3339)
	if expiresAtRFC3339 == "" {
		if err := s.rdb.Del(ctx, key).Err(); err != nil {
			return false, err
		}
		return true, nil
	}
	expiresAt, err := time.Parse(time.RFC3339, expiresAtRFC3339)
	if err != nil {
		if err := s.rdb.Del(ctx, key).Err(); err != nil {
			return false, err
		}
		return true, nil
	}
	remaining := time.Until(expiresAt.UTC())
	if remaining <= 0 {
		if err := s.rdb.Del(ctx, key).Err(); err != nil {
			return false, err
		}
		return true, nil
	}
	if err := s.rdb.Expire(ctx, key, remaining).Err(); err != nil {
		return false, err
	}
	return false, nil
}

func (s *Store) DeletePortalSession(ctx context.Context, token string) error {
	token = strings.TrimSpace(token)
	if token == "" {
		return nil
	}
	return s.rdb.Del(ctx, portalSessionKey(token)).Err()
}

// OwnerEmailsForCompanyChannel returns distinct normalized emails for registry owner_ids via makeacompany:user_by_slack:<id>.
// Requires Slack user index sync (see SyncSlackUserIndexFromWorkspaceUsers) for non-empty results.
func (s *Store) OwnerEmailsForCompanyChannel(ctx context.Context, hashKey, channelID string) ([]string, error) {
	if s == nil {
		return nil, fmt.Errorf("nil store")
	}
	ch, err := s.GetCompanyChannel(ctx, hashKey, channelID)
	if err != nil {
		return nil, err
	}
	var emails []string
	seen := map[string]bool{}
	for _, uid := range ch.OwnerIDs {
		uid = strings.TrimSpace(uid)
		if uid == "" {
			continue
		}
		em, err := s.rdb.Get(ctx, userBySlackRedisKey(uid)).Result()
		if err == redis.Nil || strings.TrimSpace(em) == "" {
			continue
		}
		if err != nil {
			return nil, err
		}
		em = normalizeProfileEmail(em)
		if em != "" && !seen[em] {
			seen[em] = true
			emails = append(emails, em)
		}
	}
	return emails, nil
}

// OwnerStripeCustomerIDsForCompanyChannel returns distinct non-empty Stripe customer ids on owner profiles.
func (s *Store) OwnerStripeCustomerIDsForCompanyChannel(ctx context.Context, hashKey, channelID string) ([]string, error) {
	if s == nil {
		return nil, fmt.Errorf("nil store")
	}
	ch, err := s.GetCompanyChannel(ctx, hashKey, channelID)
	if err != nil {
		return nil, err
	}
	var out []string
	seen := map[string]bool{}
	for _, uid := range ch.OwnerIDs {
		uid = strings.TrimSpace(uid)
		if uid == "" {
			continue
		}
		em, err := s.rdb.Get(ctx, userBySlackRedisKey(uid)).Result()
		if err == redis.Nil || strings.TrimSpace(em) == "" {
			continue
		}
		if err != nil {
			return nil, err
		}
		em = normalizeProfileEmail(em)
		if em == "" {
			continue
		}
		cus, err := s.rdb.HGet(ctx, userProfileRedisKey(em), "stripe_customer_id").Result()
		if err == redis.Nil || strings.TrimSpace(cus) == "" {
			continue
		}
		if err != nil {
			return nil, err
		}
		cus = strings.TrimSpace(cus)
		if cus != "" && !seen[cus] {
			seen[cus] = true
			out = append(out, cus)
		}
	}
	return out, nil
}
