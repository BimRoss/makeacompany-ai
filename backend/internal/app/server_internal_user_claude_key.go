package app

import (
	"net/http"
	"strings"
)

// handleInternalUserClaudeKey returns the DECRYPTED BYOK Claude key for a user
// (BYOK, #773) so the harness can inject it as that user's per-spawn inference
// credential. Bearer-gated with BACKEND_INTERNAL_SERVICE_TOKEN, same as the
// shopify-token / trial-gate internal endpoints.
//
// GET /v1/internal/user-claude-key?email=user@example.com
//
//	200 { "key": "sk-ant-…", "kind": "api"|"oauth" }  — key is set
//	404                                                — no key stored for user
//	401 — bearer missing/wrong
//	503 — key encryption not configured (USER_KEY_ENCRYPTION_KEY unset)
//
// Keyed by email because the profile hash and the /me save path are both
// email-keyed. The returned key is plaintext-sensitive: the harness injects it
// only as the per-spawn inference credential and never logs it. Decryption
// happens here so the master key stays in this service only.
func (s *Server) handleInternalUserClaudeKey(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.internalServiceBearerAuthorized(r) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if strings.TrimSpace(s.cfg.UserKeyEncryptionKey) == "" {
		http.Error(w, "key storage not configured", http.StatusServiceUnavailable)
		return
	}
	email := strings.TrimSpace(r.URL.Query().Get("email"))
	if email == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "email required"})
		return
	}
	ciphertext, err := s.store.UserClaudeKeyCiphertext(r.Context(), email)
	if err != nil {
		s.log.Printf("internal user claude key: lookup for %s: %v", email, err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "lookup failed"})
		return
	}
	if strings.TrimSpace(ciphertext) == "" {
		http.Error(w, "not set", http.StatusNotFound)
		return
	}
	key, err := decryptUserKey(s.cfg.UserKeyEncryptionKey, ciphertext)
	if err != nil {
		// Never log the key or ciphertext.
		s.log.Printf("internal user claude key: decrypt for %s: %v", email, err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "decrypt failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"key":  key,
		"kind": claudeKeyKind(key),
	})
}
