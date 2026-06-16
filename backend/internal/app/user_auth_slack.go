package app

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

type userAuthSlackFinishRequest struct {
	SlackUserAccessToken string `json:"slackUserAccessToken"`
}

// slackOAuthV2AccessResponse models the subset of oauth.v2.access we use.
// Slack returns authed_user.access_token (xoxp-) when user_scope was requested.
type slackOAuthV2AccessResponse struct {
	OK         bool   `json:"ok"`
	Error      string `json:"error"`
	AuthedUser struct {
		ID          string `json:"id"`
		AccessToken string `json:"access_token"`
		TokenType   string `json:"token_type"`
		Scope       string `json:"scope"`
	} `json:"authed_user"`
	Team struct {
		ID string `json:"id"`
	} `json:"team"`
}

// slackUsersIdentityResponse models the subset of users.identity we use.
// Requires identity.basic + identity.email user scopes.
type slackUsersIdentityResponse struct {
	OK    bool   `json:"ok"`
	Error string `json:"error"`
	User  struct {
		ID    string `json:"id"`
		Name  string `json:"name"`
		Email string `json:"email"`
	} `json:"user"`
	Team struct {
		ID string `json:"id"`
	} `json:"team"`
}

func (s *Server) userSlackAuthEnabled() bool {
	return strings.TrimSpace(s.cfg.SlackOAuthClientID) != "" && strings.TrimSpace(s.cfg.SlackOAuthClientSecret) != ""
}

// handleUserAuthSlackFinish is called by the Next.js /api/me/auth/slack/callback
// route once it has the authorization code from Slack. The Next.js layer passes
// the user access token it received from oauth.v2.access; this handler
// independently verifies identity by calling users.identity with that token and
// mints a /me session bound to (email, slackUserID, slackTeamID).
func (s *Server) handleUserAuthSlackFinish(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.userSlackAuthEnabled() {
		http.Error(w, "slack user auth not configured", http.StatusServiceUnavailable)
		return
	}
	var req userAuthSlackFinishRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	userTok := strings.TrimSpace(req.SlackUserAccessToken)
	if userTok == "" {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	identity, err := s.slackUsersIdentity(r.Context(), userTok)
	if err != nil {
		s.log.Printf("user slack identity: %v", err)
		http.Error(w, "unable to verify slack identity", http.StatusUnauthorized)
		return
	}
	email := normalizeProfileEmail(identity.User.Email)
	if email == "" {
		http.Error(w, "missing email scope on slack token (identity.email required)", http.StatusForbidden)
		return
	}
	slackUserID := strings.TrimSpace(identity.User.ID)
	slackTeamID := strings.TrimSpace(identity.Team.ID)
	if slackUserID == "" {
		http.Error(w, "missing slack user id", http.StatusUnauthorized)
		return
	}
	s.writeUserMintResponse(w, r, email, slackUserID, slackTeamID)
}

func (s *Server) slackUsersIdentity(ctx context.Context, userToken string) (slackUsersIdentityResponse, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://slack.com/api/users.identity", nil)
	if err != nil {
		return slackUsersIdentityResponse{}, err
	}
	req.Header.Set("Authorization", "Bearer "+userToken)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return slackUsersIdentityResponse{}, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return slackUsersIdentityResponse{}, err
	}
	if resp.StatusCode != http.StatusOK {
		// Fail-open HTTP-gate guidance per memory: log non-2xx so silent 4xx
		// don't bite us. Caller still treats this as auth failure.
		s.log.Printf("slack users.identity non-2xx: status=%d body=%s", resp.StatusCode, truncate(string(body), 256))
		return slackUsersIdentityResponse{}, fmt.Errorf("users.identity status %d", resp.StatusCode)
	}
	var out slackUsersIdentityResponse
	if err := json.Unmarshal(body, &out); err != nil {
		return slackUsersIdentityResponse{}, err
	}
	if !out.OK {
		return slackUsersIdentityResponse{}, fmt.Errorf("slack users.identity error: %s", out.Error)
	}
	return out, nil
}

// SlackOAuthV2Exchange is exposed for the Next.js callback route to perform the
// code-for-token exchange via the backend (keeps the client_secret out of the
// Next.js process). Returns the authed_user access token and team id.
func (s *Server) handleUserAuthSlackTokenExchange(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.userSlackAuthEnabled() {
		http.Error(w, "slack user auth not configured", http.StatusServiceUnavailable)
		return
	}
	var req struct {
		Code        string `json:"code"`
		RedirectURI string `json:"redirectUri"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	if strings.TrimSpace(req.Code) == "" || strings.TrimSpace(req.RedirectURI) == "" {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	form := url.Values{
		"code":          {req.Code},
		"client_id":     {s.cfg.SlackOAuthClientID},
		"client_secret": {s.cfg.SlackOAuthClientSecret},
		"redirect_uri":  {req.RedirectURI},
	}
	httpReq, err := http.NewRequestWithContext(r.Context(), http.MethodPost, "https://slack.com/api/oauth.v2.access", strings.NewReader(form.Encode()))
	if err != nil {
		http.Error(w, "unable to build slack request", http.StatusInternalServerError)
		return
	}
	httpReq.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		s.log.Printf("slack oauth.v2.access: %v", err)
		http.Error(w, "unable to reach slack", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		http.Error(w, "unable to read slack response", http.StatusBadGateway)
		return
	}
	if resp.StatusCode != http.StatusOK {
		s.log.Printf("slack oauth.v2.access non-2xx: status=%d body=%s", resp.StatusCode, truncate(string(body), 256))
		http.Error(w, "slack token exchange failed", http.StatusBadGateway)
		return
	}
	var parsed slackOAuthV2AccessResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		http.Error(w, "slack response unparseable", http.StatusBadGateway)
		return
	}
	if !parsed.OK || strings.TrimSpace(parsed.AuthedUser.AccessToken) == "" {
		s.log.Printf("slack oauth.v2.access error: %s", parsed.Error)
		http.Error(w, "slack token exchange rejected", http.StatusUnauthorized)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"slackUserAccessToken": parsed.AuthedUser.AccessToken,
		"slackUserId":          parsed.AuthedUser.ID,
		"slackTeamId":          parsed.Team.ID,
	})
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}
