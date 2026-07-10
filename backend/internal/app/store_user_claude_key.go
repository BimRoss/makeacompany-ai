package app

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

// Redis hash fields for the BYOK Claude key (#773), stored on the existing
// user_profile:<email> hash alongside Stripe/tier fields.
const (
	claudeKeyCiphertextField = "claude_api_key_ciphertext"
	claudeKeyLast4Field      = "claude_api_key_last4"
	claudeKeyUpdatedAtField  = "claude_api_key_updated_at"
)

// SetUserClaudeKey stores the encrypted BYOK Claude key plus its last4 for
// masked display. The ciphertext is opaque (AES-256-GCM, see
// user_claude_key_crypto.go); plaintext never reaches this layer.
func (s *Store) SetUserClaudeKey(ctx context.Context, email, ciphertext, last4 string) error {
	email = normalizeProfileEmail(email)
	if email == "" {
		return fmt.Errorf("missing email")
	}
	if strings.TrimSpace(ciphertext) == "" {
		return fmt.Errorf("missing ciphertext")
	}
	now := time.Now().UTC().Format(time.RFC3339)
	return s.MergeUserProfileFields(ctx, email, map[string]any{
		claudeKeyCiphertextField: ciphertext,
		claudeKeyLast4Field:      last4,
		claudeKeyUpdatedAtField:  now,
	})
}

// ClearUserClaudeKey removes the stored BYOK key fields.
func (s *Store) ClearUserClaudeKey(ctx context.Context, email string) error {
	email = normalizeProfileEmail(email)
	if email == "" {
		return fmt.Errorf("missing email")
	}
	return s.rdb.HDel(ctx, userProfileRedisKey(email),
		claudeKeyCiphertextField, claudeKeyLast4Field, claudeKeyUpdatedAtField).Err()
}

// UserClaudeKeyCiphertext returns the stored ciphertext blob (empty string if
// none is set). The inference-credential injection path decrypts this via
// decryptUserKey; it is never returned to the browser.
func (s *Store) UserClaudeKeyCiphertext(ctx context.Context, email string) (string, error) {
	email = normalizeProfileEmail(email)
	if email == "" {
		return "", fmt.Errorf("missing email")
	}
	v, err := s.rdb.HGet(ctx, userProfileRedisKey(email), claudeKeyCiphertextField).Result()
	if err == redis.Nil {
		return "", nil
	}
	return v, err
}
