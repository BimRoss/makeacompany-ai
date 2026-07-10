package app

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"strings"
)

// User-provided Claude key encryption (BYOK, issue #773).
//
// User API keys are encrypted at rest with AES-256-GCM. The 32-byte master key
// comes from USER_KEY_ENCRYPTION_KEY (a mounted K8s secret in prod), base64- or
// hex-encoded. Plaintext keys are never written to Redis, logs, or API
// responses — only the opaque ciphertext blob and the last 4 characters (for
// masked display) are persisted. See the security decision recorded on #773.

var errKeyStorageUnconfigured = errors.New("user key encryption not configured")

// claudeKeyMasterKey decodes USER_KEY_ENCRYPTION_KEY into exactly 32 bytes,
// trying standard base64 first, then hex.
func claudeKeyMasterKey(raw string) ([]byte, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, errKeyStorageUnconfigured
	}
	if b, err := base64.StdEncoding.DecodeString(raw); err == nil && len(b) == 32 {
		return b, nil
	}
	if b, err := hex.DecodeString(raw); err == nil && len(b) == 32 {
		return b, nil
	}
	return nil, fmt.Errorf("USER_KEY_ENCRYPTION_KEY must decode (base64 or hex) to exactly 32 bytes")
}

// encryptUserKey seals plaintext with AES-256-GCM. The random nonce is
// prepended to the ciphertext and the whole blob is std-base64 encoded for
// Redis storage.
func encryptUserKey(masterKeyRaw, plaintext string) (string, error) {
	key, err := claudeKeyMasterKey(masterKeyRaw)
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	sealed := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return base64.StdEncoding.EncodeToString(sealed), nil
}

// decryptUserKey reverses encryptUserKey. Consumed by the inference-credential
// injection path (wired cross-repo in the harness, PR 2 on #773).
func decryptUserKey(masterKeyRaw, blob string) (string, error) {
	key, err := claudeKeyMasterKey(masterKeyRaw)
	if err != nil {
		return "", err
	}
	raw, err := base64.StdEncoding.DecodeString(strings.TrimSpace(blob))
	if err != nil {
		return "", fmt.Errorf("decode ciphertext: %w", err)
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(raw) < gcm.NonceSize() {
		return "", errors.New("ciphertext too short")
	}
	nonce, ct := raw[:gcm.NonceSize()], raw[gcm.NonceSize():]
	plain, err := gcm.Open(nil, nonce, ct, nil)
	if err != nil {
		return "", fmt.Errorf("decrypt: %w", err)
	}
	return string(plain), nil
}

// claudeKeyLast4 returns the last 4 characters of a key for masked display.
func claudeKeyLast4(key string) string {
	key = strings.TrimSpace(key)
	if len(key) <= 4 {
		return key
	}
	return key[len(key)-4:]
}

// validClaudeKeyShape is a cheap format gate. Anthropic API keys are
// sk-ant-api...; Claude Code / OAuth keys share the sk-ant- prefix. We accept
// that prefix plus a sane length. A live validation ping is a deliberate
// follow-up, kept out of the request path here so a save never blocks on a
// network call.
func validClaudeKeyShape(key string) bool {
	key = strings.TrimSpace(key)
	return strings.HasPrefix(key, "sk-ant-") && len(key) >= 20 && len(key) <= 512
}

// claudeKeyKind classifies a key so the harness knows which credential env var
// to set on the spawn: "api" for sk-ant-api… (ANTHROPIC_API_KEY, metered
// pay-as-you-go), "oauth" for a Claude Code / subscription token
// (CLAUDE_CODE_OAUTH_TOKEN, flat).
func claudeKeyKind(key string) string {
	if strings.HasPrefix(strings.TrimSpace(key), "sk-ant-api") {
		return "api"
	}
	return "oauth"
}
