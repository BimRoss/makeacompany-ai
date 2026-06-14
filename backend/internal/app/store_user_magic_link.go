package app

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

const userMagicLinkKeyPrefix = keyPrefix + ":user_magic:"

func userMagicLinkRedisKey(token string) string {
	return userMagicLinkKeyPrefix + strings.TrimSpace(token)
}

type userMagicLinkPayload struct {
	Email string `json:"email"`
}

// SetUserMagicLink stores a one-time sign-in token for /me email auth (GETDEL on consume).
func (s *Store) SetUserMagicLink(ctx context.Context, token, email string, ttl time.Duration) error {
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
	b, err := json.Marshal(userMagicLinkPayload{Email: email})
	if err != nil {
		return err
	}
	return s.rdb.Set(ctx, userMagicLinkRedisKey(token), string(b), ttl).Err()
}

// ConsumeUserMagicLink atomically reads and deletes the token. Returns redis.Nil if missing/expired.
func (s *Store) ConsumeUserMagicLink(ctx context.Context, token string) (email string, err error) {
	if s == nil || s.rdb == nil {
		return "", fmt.Errorf("nil store")
	}
	token = strings.TrimSpace(token)
	if token == "" {
		return "", fmt.Errorf("missing token")
	}
	raw, err := s.rdb.GetDel(ctx, userMagicLinkRedisKey(token)).Result()
	if err == redis.Nil {
		return "", redis.Nil
	}
	if err != nil {
		return "", err
	}
	var p userMagicLinkPayload
	if err := json.Unmarshal([]byte(raw), &p); err != nil {
		return "", fmt.Errorf("magic link payload: %w", err)
	}
	return normalizeProfileEmail(p.Email), nil
}

// DeleteUserMagicLink removes a magic link token without consuming it (e.g. after failed email send).
func (s *Store) DeleteUserMagicLink(ctx context.Context, token string) error {
	if s == nil || s.rdb == nil {
		return nil
	}
	token = strings.TrimSpace(token)
	if token == "" {
		return nil
	}
	return s.rdb.Del(ctx, userMagicLinkRedisKey(token)).Err()
}
