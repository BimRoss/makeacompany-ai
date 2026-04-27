package app

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"
)

type joanneWelcomeTriggerBody struct {
	Email string `json:"email"`
	Force *bool  `json:"force"`
}

// handleAdminJoanneHumansWelcomeTrigger proxies to employee-factory Joanne to post the #humans welcome + terms thread.
// Resolves slack_user_id from makeacompany:user_profile for the requested email (admin session still required).
func (s *Server) handleAdminJoanneHumansWelcomeTrigger(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	ok, svcUnavail := s.adminReadAuthorized(r)
	if !ok {
		if svcUnavail {
			writeJSONNoStore(w, http.StatusServiceUnavailable, map[string]any{"error": "admin auth disabled"})
		} else {
			writeJSONNoStore(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		}
		return
	}
	if _, err := s.validateAdminSession(r.Context(), tokenFromAuthHeader(r)); err != nil {
		writeJSONNoStore(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	base := strings.TrimSpace(s.cfg.JoanneHumansWelcomeTriggerURL)
	tok := strings.TrimSpace(s.cfg.JoanneHumansWelcomeTriggerToken)
	if base == "" || tok == "" {
		writeJSONNoStore(w, http.StatusServiceUnavailable, map[string]any{
			"error": "JOANNE_HUMANS_WELCOME_TRIGGER_URL and JOANNE_HUMANS_WELCOME_TRIGGER_TOKEN must be set on the makeacompany backend",
		})
		return
	}

	var body joanneWelcomeTriggerBody
	_ = json.NewDecoder(r.Body).Decode(&body)
	email := strings.TrimSpace(body.Email)
	if email == "" {
		writeJSONNoStore(w, http.StatusBadRequest, map[string]any{"error": "email is required"})
		return
	}
	if !strings.Contains(email, "@") {
		writeJSONNoStore(w, http.StatusBadRequest, map[string]any{"error": "invalid email"})
		return
	}
	slackUID, err := s.store.SlackUserIDByProfileEmail(r.Context(), email)
	if err != nil {
		s.log.Printf("admin joanne welcome trigger: profile slack lookup: %v", err)
		writeJSONNoStore(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	if slackUID == "" {
		writeJSONNoStore(w, http.StatusBadRequest, map[string]any{
			"error": "no slack_user_id on makeacompany:user_profile for " + email + " — run Slack users snapshot / index sync so the profile is populated",
		})
		return
	}
	force := true
	if body.Force != nil {
		force = *body.Force
	}

	down := map[string]any{
		"slack_user_id": slackUID,
		"force":         force,
	}
	raw, err := json.Marshal(down)
	if err != nil {
		writeJSONNoStore(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	url := base + "/internal/joanne/humans-welcome/trigger"
	ctx, cancel := context.WithTimeout(r.Context(), 28*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(raw))
	if err != nil {
		writeJSONNoStore(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+tok)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		s.log.Printf("admin joanne welcome trigger: http: %v", err)
		writeJSONNoStore(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	parsed := map[string]any{}
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		t := strings.TrimSpace(string(respBody))
		if t != "" {
			parsed["error"] = t
		}
	}
	parsed["slackUserId"] = slackUID
	parsed["profileEmail"] = email
	parsed["proxiedFrom"] = url
	writeJSONNoStore(w, resp.StatusCode, parsed)
}
