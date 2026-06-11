package app

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

// Short-lived OAuth state store for the Shopify connect flow. The
// browser-side `state` parameter Shopify echoes back to our callback is
// a 64-char random nonce; the actual payload (email, channel, shop)
// lives in Redis with a 10-minute TTL. GETDEL on consume — single-use.
//
// Driver: makeacompany-ai#352 Layer 1.

const (
	shopifyOAuthNonceKeyPrefix = keyPrefix + ":shopify_oauth_nonce:"
	shopifyOAuthNonceDefaultTTL = 10 * time.Minute
)

type shopifyOAuthNoncePayload struct {
	Email       string `json:"email"`
	ChannelID   string `json:"channelId"`
	Shop        string `json:"shop"`
	SlackUserID string `json:"slackUserId"`
	CreatedAt   string `json:"createdAt"`
}

func shopifyOAuthNonceRedisKey(nonce string) string {
	return shopifyOAuthNonceKeyPrefix + strings.TrimSpace(nonce)
}

// SetShopifyOAuthNonce stores the binding so the callback can look up
// who initiated the flow and which shop they intended to connect.
func (s *Store) SetShopifyOAuthNonce(ctx context.Context, nonce, email, channelID, shop, slackUserID string, ttl time.Duration) error {
	if s == nil || s.rdb == nil {
		return fmt.Errorf("nil store")
	}
	nonce = strings.TrimSpace(nonce)
	if nonce == "" {
		return fmt.Errorf("nonce required")
	}
	if ttl <= 0 {
		ttl = shopifyOAuthNonceDefaultTTL
	}
	payload := shopifyOAuthNoncePayload{
		Email:       normalizeProfileEmail(email),
		ChannelID:   strings.TrimSpace(channelID),
		Shop:        strings.ToLower(strings.TrimSpace(shop)),
		SlackUserID: strings.TrimSpace(slackUserID),
		CreatedAt:   time.Now().UTC().Format(time.RFC3339),
	}
	b, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	return s.rdb.Set(ctx, shopifyOAuthNonceRedisKey(nonce), string(b), ttl).Err()
}

// ConsumeShopifyOAuthNonce atomically reads + deletes the nonce. Returns
// redis.Nil if the nonce is missing or expired so the callback can 400
// without leaking which.
func (s *Store) ConsumeShopifyOAuthNonce(ctx context.Context, nonce string) (email, channelID, shop, slackUserID string, err error) {
	if s == nil || s.rdb == nil {
		return "", "", "", "", fmt.Errorf("nil store")
	}
	nonce = strings.TrimSpace(nonce)
	if nonce == "" {
		return "", "", "", "", fmt.Errorf("nonce required")
	}
	raw, err := s.rdb.GetDel(ctx, shopifyOAuthNonceRedisKey(nonce)).Result()
	if err == redis.Nil {
		return "", "", "", "", redis.Nil
	}
	if err != nil {
		return "", "", "", "", err
	}
	var p shopifyOAuthNoncePayload
	if err := json.Unmarshal([]byte(raw), &p); err != nil {
		return "", "", "", "", fmt.Errorf("nonce payload: %w", err)
	}
	return p.Email, p.ChannelID, p.Shop, p.SlackUserID, nil
}
