package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/redis/go-redis/v9"
)

const (
	personalAgentIconMaxBytes = 2 << 20 // 2 MiB before base64 expansion
)

// iconGenerateRequest is the body shape for /icon-generate.
type iconGenerateRequest struct {
	DisplayName string `json:"displayName"`
	Description string `json:"description"`
}

type iconGenerateResponse struct {
	ImageBase64 string `json:"imageBase64"`
	MimeType    string `json:"mimeType"`
}

// handleGeneratePersonalAgentIcon produces a single icon candidate via
// Imagen-4-fast. Stateless — the frontend keeps the bytes and submits them
// back on create / change. Gated on the /me session so we don't burn API
// credits for unauthenticated callers.
func (s *Server) handleGeneratePersonalAgentIcon(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if s.imagen == nil || s.imagen.Disabled() {
		http.Error(w, "icon generation disabled (GEMINI_API_KEY missing)", http.StatusServiceUnavailable)
		return
	}
	session, err := s.store.GetPortalSession(r.Context(), tokenFromAuthHeader(r))
	if err != nil || session.TenantType != PortalTenantTypeUser {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	var req iconGenerateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	name := strings.TrimSpace(req.DisplayName)
	if name == "" {
		http.Error(w, "displayName required", http.StatusBadRequest)
		return
	}
	prompt := IconPromptFor(name, req.Description)
	img, err := s.imagen.GenerateIcon(r.Context(), prompt)
	if err != nil {
		s.log.Printf("imagen generate icon: %v", err)
		http.Error(w, "icon generation failed: "+err.Error(), http.StatusBadGateway)
		return
	}
	writeJSON(w, http.StatusOK, iconGenerateResponse{
		ImageBase64: base64.StdEncoding.EncodeToString(img.Data),
		MimeType:    img.MimeType,
	})
}

// iconChangeRequest is what the "Change icon" button on the status panel
// posts. iconBase64 may be supplied directly (uploaded file) OR omitted in
// favour of the `regenerate=true` flag which makes the server roll a new
// Imagen call using the existing record's name+description.
type iconChangeRequest struct {
	IconBase64   string `json:"iconBase64"`
	IconMimeType string `json:"iconMimeType"`
	Regenerate   bool   `json:"regenerate"`
}

// handleChangePersonalAgentIcon swaps an existing agent's Slack app icon.
// Gated on /me session + slack_user_id ownership.
func (s *Server) handleChangePersonalAgentIcon(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if s.slackManifest == nil || s.slackManifest.Disabled() {
		http.Error(w, "manifest client disabled", http.StatusServiceUnavailable)
		return
	}
	session, err := s.store.GetPortalSession(r.Context(), tokenFromAuthHeader(r))
	if err != nil || session.TenantType != PortalTenantTypeUser {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	slackUserID, err := s.store.SlackUserIDByProfileEmail(r.Context(), session.Email)
	if err != nil || strings.TrimSpace(slackUserID) == "" {
		http.Error(w, "no slack identity for this account", http.StatusForbidden)
		return
	}
	rec, err := s.store.GetPersonalAgentByOwner(r.Context(), slackUserID)
	if errors.Is(err, redis.Nil) {
		http.Error(w, "no personal agent for this user", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "lookup failed", http.StatusInternalServerError)
		return
	}
	var req iconChangeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}

	imageBytes, mime, err := s.resolveIconImage(r.Context(), rec.DisplayName, rec.Description, req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if err := s.slackManifest.SetAppIcon(r.Context(), rec.SlackAppID, imageBytes, mime); err != nil {
		s.log.Printf("apps.icon.set: %v", err)
		http.Error(w, "slack apps.icon.set failed: "+err.Error(), http.StatusBadGateway)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// resolveIconImage handles the regenerate/upload branching used by both the
// create-time and change-time flows. Returns the raw bytes ready to hand to
// apps.icon.set.
func (s *Server) resolveIconImage(ctx context.Context, name, description string, req iconChangeRequest) ([]byte, string, error) {
	if req.Regenerate {
		if s.imagen == nil || s.imagen.Disabled() {
			return nil, "", errors.New("icon generation disabled (GEMINI_API_KEY missing)")
		}
		img, err := s.imagen.GenerateIcon(ctx, IconPromptFor(name, description))
		if err != nil {
			return nil, "", err
		}
		return img.Data, img.MimeType, nil
	}
	if strings.TrimSpace(req.IconBase64) == "" {
		return nil, "", errors.New("iconBase64 or regenerate=true required")
	}
	data, err := base64.StdEncoding.DecodeString(req.IconBase64)
	if err != nil {
		return nil, "", errors.New("iconBase64 must be valid base64")
	}
	if len(data) > personalAgentIconMaxBytes {
		return nil, "", errors.New("icon exceeds 2 MiB")
	}
	mime := strings.TrimSpace(req.IconMimeType)
	if mime == "" {
		mime = "image/png"
	}
	return data, mime, nil
}
