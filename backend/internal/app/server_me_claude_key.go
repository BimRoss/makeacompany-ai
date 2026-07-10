package app

import (
	"encoding/json"
	"net/http"
	"strings"
)

// setClaudeKeyRequest is the body for POST /v1/me/claude-key.
type setClaudeKeyRequest struct {
	Key string `json:"key"`
}

// handleSetMyClaudeKey stores the signed-in user's own Claude key (BYOK, #773),
// encrypted at rest. Only last4 + updatedAt are ever returned; the plaintext is
// never logged or echoed back.
func (s *Server) handleSetMyClaudeKey(w http.ResponseWriter, r *http.Request) {
	session, err := s.store.GetPortalSession(r.Context(), tokenFromAuthHeader(r))
	if err != nil || session.Email == "" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if strings.TrimSpace(s.cfg.UserKeyEncryptionKey) == "" {
		// Fail closed: never store a user key without encryption configured.
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "key storage is not configured"})
		return
	}
	var req setClaudeKeyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	key := strings.TrimSpace(req.Key)
	if !validClaudeKeyShape(key) {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "that doesn't look like a Claude key (expected sk-ant-…)"})
		return
	}
	ciphertext, err := encryptUserKey(s.cfg.UserKeyEncryptionKey, key)
	if err != nil {
		// Log the failure, never the key.
		s.log.Printf("encrypt user claude key: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "unable to store key"})
		return
	}
	last4 := claudeKeyLast4(key)
	if err := s.store.SetUserClaudeKey(r.Context(), session.Email, ciphertext, last4); err != nil {
		s.log.Printf("persist user claude key for %s: %v", session.Email, err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "unable to store key"})
		return
	}
	row, _ := s.store.UserProfileRowByEmail(r.Context(), session.Email)
	writeJSON(w, http.StatusOK, map[string]any{
		"hasKey":    true,
		"last4":     last4,
		"updatedAt": row.ClaudeAPIKeyUpdatedAt,
	})
}

// handleDeleteMyClaudeKey clears the stored key for the signed-in user.
func (s *Server) handleDeleteMyClaudeKey(w http.ResponseWriter, r *http.Request) {
	session, err := s.store.GetPortalSession(r.Context(), tokenFromAuthHeader(r))
	if err != nil || session.Email == "" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if err := s.store.ClearUserClaudeKey(r.Context(), session.Email); err != nil {
		s.log.Printf("clear user claude key for %s: %v", session.Email, err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "unable to remove key"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"hasKey": false})
}

// handleMyClaudeKeyStatus reports whether a key is set (masked) for the /me UI.
func (s *Server) handleMyClaudeKeyStatus(w http.ResponseWriter, r *http.Request) {
	session, err := s.store.GetPortalSession(r.Context(), tokenFromAuthHeader(r))
	if err != nil || session.Email == "" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	row, err := s.store.UserProfileRowByEmail(r.Context(), session.Email)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "unable to load profile"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"hasKey":     strings.TrimSpace(row.ClaudeAPIKeyLast4) != "",
		"last4":      row.ClaudeAPIKeyLast4,
		"updatedAt":  row.ClaudeAPIKeyUpdatedAt,
		"configured": strings.TrimSpace(s.cfg.UserKeyEncryptionKey) != "",
	})
}
