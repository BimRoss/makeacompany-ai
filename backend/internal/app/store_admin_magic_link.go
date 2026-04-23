package app

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

const adminMagicLinkKeyPrefix = keyPrefix + ":admin_magic:"

func adminMagicLinkRedisKey(token string) string {
	return adminMagicLinkKeyPrefix + strings.TrimSpace(token)
}

type adminMagicLinkPayload struct {
	Email string `json:"email"`
}

// SetAdminMagicLink stores a one-time admin sign-in token (GETDEL on consume).
func (s *Store) SetAdminMagicLink(ctx context.Context, token, email string, ttl time.Duration) error {
	if s == nil || s.rdb == nil {
		return fmt.Errorf("nil store")
	}
	token = strings.TrimSpace(token)
	email = normalizeProfileEmail(email)
	if token == "" || email == "" {
		return fmt.Errorf("missing magic link fields")
	}
	if ttl <= 0 {
		return fmt.Errorf("missing ttl")
	}
	b, err := json.Marshal(adminMagicLinkPayload{Email: email})
	if err != nil {
		return err
	}
	return s.rdb.Set(ctx, adminMagicLinkRedisKey(token), string(b), ttl).Err()
}

// ConsumeAdminMagicLink atomically reads and deletes the token. Returns redis.Nil if missing/expired.
func (s *Store) ConsumeAdminMagicLink(ctx context.Context, token string) (email string, err error) {
	if s == nil || s.rdb == nil {
		return "", fmt.Errorf("nil store")
	}
	token = strings.TrimSpace(token)
	if token == "" {
		return "", fmt.Errorf("missing token")
	}
	raw, err := s.rdb.GetDel(ctx, adminMagicLinkRedisKey(token)).Result()
	if err == redis.Nil {
		return "", redis.Nil
	}
	if err != nil {
		return "", err
	}
	var p adminMagicLinkPayload
	if err := json.Unmarshal([]byte(raw), &p); err != nil {
		return "", fmt.Errorf("magic link payload: %w", err)
	}
	return normalizeProfileEmail(p.Email), nil
}

// DeleteAdminMagicLink removes a token without consuming it (e.g. after failed email send).
func (s *Store) DeleteAdminMagicLink(ctx context.Context, token string) error {
	if s == nil || s.rdb == nil {
		return nil
	}
	token = strings.TrimSpace(token)
	if token == "" {
		return nil
	}
	return s.rdb.Del(ctx, adminMagicLinkRedisKey(token)).Err()
}
