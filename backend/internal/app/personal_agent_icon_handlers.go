package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	personalAgentIconMaxBytes = 2 << 20 // 2 MiB before base64 expansion
)

// iconGenerateRequest is the body shape for /icon-generate.
type iconGenerateRequest struct {
	DisplayName string `json:"displayName"`
	Description string `json:"description"`
	// Prompt, when non-empty, replaces the IconPromptFor-derived prompt so the
	// user can steer Imagen directly from the /me picker text box.
	Prompt string `json:"prompt,omitempty"`
	// UseSlackProfile, when true, downloads the caller's Slack workspace
	// avatar, asks Gemini Vision to describe it, and weaves that description
	// into the Imagen prompt so the candidates look like the user.
	UseSlackProfile bool `json:"useSlackProfile,omitempty"`
	// Count of candidates to return. Defaults to IconCandidateLimit; clamped
	// to [1, IconCandidateLimit].
	Count int `json:"count,omitempty"`
}

type iconCandidate struct {
	ImageBase64 string `json:"imageBase64"`
	MimeType    string `json:"mimeType"`
}

type iconGenerateResponse struct {
	Candidates []iconCandidate `json:"candidates"`
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
	count := req.Count
	if count <= 0 {
		count = IconCandidateLimit
	}
	prompt := IconPromptWithPortraitFraming(req.Prompt)
	if prompt == "" {
		prompt = IconPromptFor(name, req.Description)
	}
	// Optional Slack-profile enrichment: download the caller's workspace
	// avatar, get a one-sentence visual description via Gemini Vision, and
	// splice it into the Imagen prompt so the candidates look like them.
	// Best-effort — any failure logs and falls back to the plain prompt.
	if req.UseSlackProfile {
		if caption, err := s.captionUserSlackProfile(r.Context(), session.Email); err != nil {
			s.log.Printf("slack-profile enrichment skipped: %v", err)
		} else if caption != "" {
			prompt = "Subject reference (the user, draw the icon to resemble them): " + caption + " " + prompt
		}
	}
	imgs, err := s.imagen.GenerateIconCandidates(r.Context(), prompt, count)
	if err != nil {
		s.log.Printf("imagen generate icon candidates: %v", err)
		http.Error(w, "icon generation failed: "+err.Error(), http.StatusBadGateway)
		return
	}
	candidates := make([]iconCandidate, 0, len(imgs))
	for _, img := range imgs {
		candidates = append(candidates, iconCandidate{
			ImageBase64: base64.StdEncoding.EncodeToString(img.Data),
			MimeType:    img.MimeType,
		})
	}
	writeJSON(w, http.StatusOK, iconGenerateResponse{Candidates: candidates})
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
	// Echo the bytes back so the frontend can keep showing the just-pushed
	// icon as its preview (and persist it to localStorage so refresh survives).
	// Slack's app-icon URL isn't easy to fetch back per-call, so this is the
	// cheapest way to keep the picker honest.
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":          true,
		"imageBase64": base64.StdEncoding.EncodeToString(imageBytes),
		"mimeType":    mime,
	})
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

// captionUserSlackProfile looks up the signed-in user's Slack workspace
// avatar URL, downloads the bytes, and asks Gemini Vision for a one-sentence
// portrait-reference caption. Used by the "Use my Slack photo" generation
// path to give Imagen a description of the human to draw.
func (s *Server) captionUserSlackProfile(ctx context.Context, email string) (string, error) {
	if s.geminiText == nil || s.geminiText.Disabled() {
		return "", errors.New("gemini vision disabled (GEMINI_API_KEY missing)")
	}
	wu, ok, err := s.store.LookupSlackWorkspaceUserByEmail(ctx, email)
	if err != nil {
		return "", fmt.Errorf("workspace user lookup: %w", err)
	}
	if !ok || strings.TrimSpace(wu.ProfileImageURL) == "" {
		return "", errors.New("no slack profile image for this user")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, wu.ProfileImageURL, nil)
	if err != nil {
		return "", err
	}
	httpClient := &http.Client{Timeout: 15 * time.Second}
	resp, err := httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("download avatar: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("avatar status %d", resp.StatusCode)
	}
	bodyBytes, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return "", fmt.Errorf("read avatar: %w", err)
	}
	mime := strings.TrimSpace(resp.Header.Get("Content-Type"))
	if mime == "" {
		mime = "image/jpeg"
	}
	return s.geminiText.DescribeImage(ctx, bodyBytes, mime)
}
