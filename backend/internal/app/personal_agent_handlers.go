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

// personalAgentInstallRedirectBase returns the base URL for the per-agent
// OAuth install redirect. Defaults to AppBaseURL + "/api/portal/personal-agents/".
func (s *Server) personalAgentInstallRedirectBase() string {
	if v := strings.TrimSpace(s.cfg.PersonalAgentInstallRedirectBase); v != "" {
		return strings.TrimRight(v, "/") + "/"
	}
	return strings.TrimRight(s.cfg.AppBaseURL, "/") + "/v1/personal-agents/"
}

// personalAgentInstallRedirectFor returns the full per-agent install
// redirect URL Slack should send the user back to after they install the
// minted app.
func (s *Server) personalAgentInstallRedirectFor(agentID string) string {
	return s.personalAgentInstallRedirectBase() + strings.TrimSpace(agentID) + "/install-complete"
}

type createPersonalAgentRequest struct {
	DisplayName     string `json:"displayName"`
	Description     string `json:"description"`
	LongDescription string `json:"longDescription"`
	// IconURL is captured in the request for parity with /me UI but the
	// Slack manifest API doesn't take an icon directly — operators upload
	// the icon via the per-app dashboard, or we add a follow-up to push it
	// via apps.icon.upload (separate ticket).
	IconURL string `json:"iconUrl,omitempty"`
}

type createPersonalAgentResponse struct {
	AgentID    string `json:"agentId"`
	SlackAppID string `json:"slackAppId"`
	InstallURL string `json:"installUrl"`
	Status     string `json:"status"`
}

// handleCreatePersonalAgent provisions a Slack app via the Manifest API and
// persists the agent record. The /me UI calls this after the user submits
// their agent name/description.
func (s *Server) handleCreatePersonalAgent(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if s.slackManifest == nil || s.slackManifest.Disabled() {
		http.Error(w, "personal agents not configured (SLACK_CONFIG_ACCESS_TOKEN/REFRESH_TOKEN missing)", http.StatusServiceUnavailable)
		return
	}
	if s.personalAgent == nil || s.personalAgent.Disabled() {
		http.Error(w, "personal agents disabled (no in-cluster config)", http.StatusServiceUnavailable)
		return
	}

	session, err := s.store.GetPortalSession(r.Context(), tokenFromAuthHeader(r))
	if err != nil || session.TenantType != PortalTenantTypeUser {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	slackUserID, err := s.store.SlackUserIDByProfileEmail(r.Context(), session.Email)
	if err != nil || strings.TrimSpace(slackUserID) == "" {
		// Email isn't in the MakeaCompany Slack workspace snapshot. Without a
		// Slack user id we have no owner to bind the agent to.
		http.Error(w, "your email is not in the MakeaCompany Slack workspace — cannot provision an agent", http.StatusForbidden)
		return
	}

	var req createPersonalAgentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	if strings.TrimSpace(req.DisplayName) == "" || strings.TrimSpace(req.Description) == "" {
		http.Error(w, "displayName and description required", http.StatusBadRequest)
		return
	}

	if existing, err := s.store.GetPersonalAgentByOwner(r.Context(), slackUserID); err == nil {
		writeJSON(w, http.StatusConflict, map[string]any{
			"error":      "personal_agent_already_exists",
			"agentId":    existing.ID,
			"slackAppId": existing.SlackAppID,
			"status":     existing.Status,
		})
		return
	} else if !errors.Is(err, redis.Nil) {
		s.log.Printf("personal agent owner lookup: %v", err)
		http.Error(w, "lookup failed", http.StatusInternalServerError)
		return
	}

	agentID, err := randomTokenHex(16)
	if err != nil {
		http.Error(w, "unable to mint agent id", http.StatusInternalServerError)
		return
	}

	manifest, err := RenderPersonalAgentManifest(PersonalAgentManifestSubstitutions{
		DisplayName:        req.DisplayName,
		Description:        req.Description,
		LongDescription:    req.LongDescription,
		EventsRequestURL:   s.cfg.EventsGatewayRequestURL,
		InstallRedirectURL: s.personalAgentInstallRedirectFor(agentID),
	})
	if err != nil {
		http.Error(w, "manifest render: "+err.Error(), http.StatusBadRequest)
		return
	}

	resp, err := s.slackManifest.CreateManifest(r.Context(), manifest)
	if err != nil {
		s.log.Printf("apps.manifest.create: %v", err)
		http.Error(w, "slack apps.manifest.create failed: "+err.Error(), http.StatusBadGateway)
		return
	}

	rec := PersonalAgentRecord{
		ID:                 agentID,
		OwnerEmail:         session.Email,
		OwnerSlackUserID:   slackUserID,
		DisplayName:        req.DisplayName,
		Description:        req.Description,
		SlackAppID:         resp.AppID,
		SlackClientID:      resp.Credentials.ClientID,
		SlackClientSecret:  resp.Credentials.ClientSecret,
		SlackSigningSecret: resp.Credentials.SigningSecret,
		OAuthAuthorizeURL:  resp.OAuthAuthorizeURL,
		Status:             PersonalAgentStatusPendingInstall,
	}
	if err := s.store.CreatePersonalAgent(r.Context(), rec); err != nil {
		s.log.Printf("persist personal agent: %v", err)
		http.Error(w, "persist agent failed", http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, createPersonalAgentResponse{
		AgentID:    agentID,
		SlackAppID: resp.AppID,
		InstallURL: resp.OAuthAuthorizeURL,
		Status:     PersonalAgentStatusPendingInstall,
	})
}

// handleGetMyPersonalAgent powers the /me UI's "do I already have an agent?"
// check. Returns 404 when no agent exists; the UI then shows the create form.
func (s *Server) handleGetMyPersonalAgent(w http.ResponseWriter, r *http.Request) {
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
		writeJSON(w, http.StatusOK, map[string]any{"hasAgent": false, "reason": "no_slack_user_id"})
		return
	}
	rec, err := s.store.GetPersonalAgentByOwner(r.Context(), slackUserID)
	if errors.Is(err, redis.Nil) {
		writeJSON(w, http.StatusOK, map[string]any{"hasAgent": false})
		return
	}
	if err != nil {
		http.Error(w, "lookup failed", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"hasAgent":    true,
		"agentId":     rec.ID,
		"displayName": rec.DisplayName,
		"description": rec.Description,
		"slackAppId":  rec.SlackAppID,
		"status":      rec.Status,
		// install url only useful while pending
		"installUrl": rec.OAuthAuthorizeURL,
	})
}

// handlePersonalAgentInstallComplete is the Slack OAuth install callback for
// a personal agent. Slack redirects the user here after they authorize the
// minted app on their workspace. We exchange the code for a bot token, write
// the per-agent K8s Secret, mark the record installed, and redirect the user
// back to /me.
//
// Path: /api/portal/personal-agents/<agent_id>/install-complete?code=...
func (s *Server) handlePersonalAgentInstallComplete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	// Route registered with Go 1.22+ pattern: GET /v1/personal-agents/{id}/install-complete
	agentID := strings.TrimSpace(r.PathValue("id"))
	if agentID == "" {
		http.Error(w, "missing agent id", http.StatusBadRequest)
		return
	}
	rec, err := s.store.GetPersonalAgent(r.Context(), agentID)
	if errors.Is(err, redis.Nil) {
		http.Error(w, "agent not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "lookup failed", http.StatusInternalServerError)
		return
	}

	code := strings.TrimSpace(r.URL.Query().Get("code"))
	if errCode := strings.TrimSpace(r.URL.Query().Get("error")); errCode != "" {
		_ = s.store.UpdatePersonalAgentStatus(r.Context(), agentID, PersonalAgentStatusFailed)
		http.Redirect(w, r, "/me?personal_agent_install=failed&reason="+url.QueryEscape(errCode), http.StatusFound)
		return
	}
	if code == "" {
		http.Error(w, "missing code", http.StatusBadRequest)
		return
	}

	redirectURI := s.personalAgentInstallRedirectFor(agentID)
	botToken, err := s.exchangePersonalAgentOAuthCode(r.Context(), rec, code, redirectURI)
	if err != nil {
		s.log.Printf("personal agent oauth exchange: %v", err)
		_ = s.store.UpdatePersonalAgentStatus(r.Context(), agentID, PersonalAgentStatusFailed)
		http.Redirect(w, r, "/me?personal_agent_install=failed&reason=exchange", http.StatusFound)
		return
	}

	if err := s.personalAgent.WriteAgentRuntimeSecret(r.Context(), PersonalAgentRuntimeSecretRequest{
		SlackUserID:           rec.OwnerSlackUserID,
		SlackAppID:            rec.SlackAppID,
		BotToken:              botToken,
		SigningSecret:         rec.SlackSigningSecret,
		ClaudeCodeOAuthToken:  s.cfg.ClaudeCodeOAuthToken,
		ClaudeCodeOAuthToken2: s.cfg.ClaudeCodeOAuthToken2,
	}); err != nil {
		s.log.Printf("personal agent secret write: %v", err)
		_ = s.store.UpdatePersonalAgentStatus(r.Context(), agentID, PersonalAgentStatusFailed)
		http.Redirect(w, r, "/me?personal_agent_install=failed&reason=secret", http.StatusFound)
		return
	}

	// Per-agent Service + Deployment so the events gateway has somewhere to
	// route inbound Slack events. Order: Service first (so the gateway has a
	// stable name to forward to), then Deployment (which produces the
	// endpoints behind the Service).
	if err := s.personalAgent.WriteAgentService(r.Context(), rec.OwnerSlackUserID); err != nil {
		s.log.Printf("personal agent service write: %v", err)
		_ = s.store.UpdatePersonalAgentStatus(r.Context(), agentID, PersonalAgentStatusFailed)
		http.Redirect(w, r, "/me?personal_agent_install=failed&reason=service", http.StatusFound)
		return
	}
	if err := s.personalAgent.WriteAgentDeployment(r.Context(), PersonalAgentDeploymentRequest{
		SlackUserID:      rec.OwnerSlackUserID,
		OwnerSlackUserID: rec.OwnerSlackUserID,
		DisplayName:      rec.DisplayName,
		AgentID:          rec.ID,
		Image:            s.cfg.PersonalAgentImage,
	}); err != nil {
		s.log.Printf("personal agent deployment write: %v", err)
		_ = s.store.UpdatePersonalAgentStatus(r.Context(), agentID, PersonalAgentStatusFailed)
		http.Redirect(w, r, "/me?personal_agent_install=failed&reason=deployment", http.StatusFound)
		return
	}

	resourceName := personalAgentResourceName(rec.OwnerSlackUserID)
	if err := s.store.SetPersonalAgentService(r.Context(), agentID, s.personalAgent.AgentNamespace(), resourceName, PersonalAgentServicePort); err != nil {
		// Non-fatal: pod is up, but the events gateway won't route until this
		// binding lands. Surface as a soft failure so the user retries.
		s.log.Printf("set personal agent service binding: %v", err)
	}

	if err := s.store.MarkPersonalAgentInstalled(r.Context(), agentID); err != nil {
		s.log.Printf("mark personal agent installed: %v", err)
	}
	http.Redirect(w, r, "/me?personal_agent_install=ok", http.StatusFound)
}

// exchangePersonalAgentOAuthCode trades the install auth code for a bot
// token (xoxb-) on the agent's *own* client_id / client_secret.
func (s *Server) exchangePersonalAgentOAuthCode(ctx context.Context, rec PersonalAgentRecord, code, redirectURI string) (string, error) {
	form := url.Values{
		"code":          {code},
		"client_id":     {rec.SlackClientID},
		"client_secret": {rec.SlackClientSecret},
		"redirect_uri":  {redirectURI},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://slack.com/api/oauth.v2.access", strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	httpClient := &http.Client{Timeout: 30 * time.Second}
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
		return "", fmt.Errorf("oauth.v2.access status %d", resp.StatusCode)
	}
	var parsed struct {
		OK         bool   `json:"ok"`
		Error      string `json:"error"`
		AccessToken string `json:"access_token"` // xoxb- bot token (when bot scopes are granted)
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return "", err
	}
	if !parsed.OK || strings.TrimSpace(parsed.AccessToken) == "" {
		return "", fmt.Errorf("oauth.v2.access error: %s", parsed.Error)
	}
	return parsed.AccessToken, nil
}
