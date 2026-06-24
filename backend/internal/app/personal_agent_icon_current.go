package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

// handlePersonalAgentIconCurrent returns the Slack-side profile image URL for
// the signed-in user's personal-agent bot. The URL is fetched live from Slack
// (auth.test + users.info) using the per-agent bot token so the answer is
// always source-of-truth, not a stale cache.
//
// Response: { "imageUrl": "https://avatars.slack-edge.com/..." } | { "imageUrl": "" }
// 200 even when Slack returns no custom icon — empty string lets the
// frontend fall back to its localStorage cache without a noisy error.
func (s *Server) handlePersonalAgentIconCurrent(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
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
	if s.personalAgent == nil || s.personalAgent.Disabled() {
		writeJSON(w, http.StatusOK, map[string]string{"imageUrl": ""})
		return
	}

	botToken, err := s.personalAgent.ReadAgentBotToken(r.Context(), rec.ID)
	if err != nil {
		s.log.Printf("icon-current: read bot token: %v", err)
		writeJSON(w, http.StatusOK, map[string]string{"imageUrl": ""})
		return
	}

	botUserID := strings.TrimSpace(rec.BotUserID)
	if botUserID == "" {
		// Historical record without bot_user_id. Resolve via auth.test, then
		// persist so we don't pay the round trip on every load.
		resolved, terr := slackAuthTestUserID(r.Context(), botToken)
		if terr != nil {
			s.log.Printf("icon-current: auth.test: %v", terr)
			writeJSON(w, http.StatusOK, map[string]string{"imageUrl": ""})
			return
		}
		botUserID = resolved
		if err := s.store.SetPersonalAgentBotUserID(r.Context(), rec.ID, botUserID); err != nil {
			s.log.Printf("icon-current: persist bot_user_id: %v", err)
		}
	}

	imageURL, err := slackUserProfileImageURL(r.Context(), botToken, botUserID)
	if err != nil {
		s.log.Printf("icon-current: users.info: %v", err)
		writeJSON(w, http.StatusOK, map[string]string{"imageUrl": ""})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"imageUrl": imageURL})
}

// slackAuthTestUserID calls auth.test with a bot token and returns the bot's
// own user_id. Cheap (no rate-limit tier above default).
func slackAuthTestUserID(ctx context.Context, botToken string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://slack.com/api/auth.test", nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(botToken))
	httpClient := &http.Client{Timeout: 15 * time.Second}
	resp, err := httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("auth.test status %d", resp.StatusCode)
	}
	var parsed struct {
		OK     bool   `json:"ok"`
		Error  string `json:"error"`
		UserID string `json:"user_id"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return "", err
	}
	if !parsed.OK || strings.TrimSpace(parsed.UserID) == "" {
		return "", fmt.Errorf("auth.test rejected: %s", parsed.Error)
	}
	return parsed.UserID, nil
}

// slackUserProfileImageURL calls users.info and returns the largest readily
// available profile image (image_192 → image_72 → image_48 → image_32).
// Empty string when Slack returns no image fields.
func slackUserProfileImageURL(ctx context.Context, botToken, userID string) (string, error) {
	form := url.Values{"user": {userID}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://slack.com/api/users.info", strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(botToken))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	httpClient := &http.Client{Timeout: 15 * time.Second}
	resp, err := httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("users.info status %d", resp.StatusCode)
	}
	var parsed struct {
		OK    bool   `json:"ok"`
		Error string `json:"error"`
		User  struct {
			Profile struct {
				Image192 string `json:"image_192"`
				Image72  string `json:"image_72"`
				Image48  string `json:"image_48"`
				Image32  string `json:"image_32"`
			} `json:"profile"`
		} `json:"user"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return "", err
	}
	if !parsed.OK {
		return "", fmt.Errorf("users.info rejected: %s", parsed.Error)
	}
	for _, candidate := range []string{
		parsed.User.Profile.Image192,
		parsed.User.Profile.Image72,
		parsed.User.Profile.Image48,
		parsed.User.Profile.Image32,
	} {
		if s := strings.TrimSpace(candidate); s != "" {
			return s, nil
		}
	}
	return "", nil
}
