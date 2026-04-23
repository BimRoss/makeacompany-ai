package app

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

const portalMagicLinkKeyPrefix = keyPrefix + ":portal_magic:"

func portalMagicLinkRedisKey(token string) string {
	return portalMagicLinkKeyPrefix + strings.TrimSpace(token)
}

type portalMagicLinkPayload struct {
	ChannelID string `json:"channelId"`
	Email     string `json:"email"`
}

// SetPortalMagicLink stores a one-time sign-in token (GETDEL on consume).
func (s *Store) SetPortalMagicLink(ctx context.Context, token, channelID, email string, ttl time.Duration) error {
	if s == nil || s.rdb == nil {
		return fmt.Errorf("nil store")
	}
	token = strings.TrimSpace(token)
	channelID = strings.TrimSpace(channelID)
	email = normalizeProfileEmail(email)
	if token == "" || channelID == "" || email == "" {
		return fmt.Errorf("missing magic link fields")
	}
	if ttl <= 0 {
		return fmt.Errorf("missing ttl")
	}
	b, err := json.Marshal(portalMagicLinkPayload{ChannelID: channelID, Email: email})
	if err != nil {
		return err
	}
	return s.rdb.Set(ctx, portalMagicLinkRedisKey(token), string(b), ttl).Err()
}

// ConsumePortalMagicLink atomically reads and deletes the token. Returns redis.Nil if missing/expired.
func (s *Store) ConsumePortalMagicLink(ctx context.Context, token string) (channelID, email string, err error) {
	if s == nil || s.rdb == nil {
		return "", "", fmt.Errorf("nil store")
	}
	token = strings.TrimSpace(token)
	if token == "" {
		return "", "", fmt.Errorf("missing token")
	}
	raw, err := s.rdb.GetDel(ctx, portalMagicLinkRedisKey(token)).Result()
	if err == redis.Nil {
		return "", "", redis.Nil
	}
	if err != nil {
		return "", "", err
	}
	var p portalMagicLinkPayload
	if err := json.Unmarshal([]byte(raw), &p); err != nil {
		return "", "", fmt.Errorf("magic link payload: %w", err)
	}
	return strings.TrimSpace(p.ChannelID), normalizeProfileEmail(p.Email), nil
}

// DeletePortalMagicLink removes a magic link token without consuming it (e.g. after failed email send).
func (s *Store) DeletePortalMagicLink(ctx context.Context, token string) error {
	if s == nil || s.rdb == nil {
		return nil
	}
	token = strings.TrimSpace(token)
	if token == "" {
		return nil
	}
	return s.rdb.Del(ctx, portalMagicLinkRedisKey(token)).Err()
}
