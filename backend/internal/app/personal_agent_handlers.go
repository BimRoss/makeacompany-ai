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

// pinInstallURLToTeam appends ?team=<MakeacompanySlackTeamID> to the OAuth
// authorize URL Slack returns from apps.manifest.create so users hit the
// makeacompany workspace install consent directly, skipping the generic
// "find your workspace" picker when they're not signed in to any workspace.
// No-op when the team ID is unset or the URL is empty.
func (s *Server) pinInstallURLToTeam(raw string) string {
	teamID := strings.TrimSpace(s.cfg.MakeacompanySlackTeamID)
	if teamID == "" || raw == "" {
		return raw
	}
	u, err := url.Parse(raw)
	if err != nil {
		return raw
	}
	q := u.Query()
	q.Set("team", teamID)
	u.RawQuery = q.Encode()
	return u.String()
}

type createPersonalAgentRequest struct {
	DisplayName     string `json:"displayName"`
	Description     string `json:"description"`
	LongDescription string `json:"longDescription"`
	SystemPrompt    string `json:"systemPrompt,omitempty"`
	// Icon payload — optional. Either supply base64-encoded image bytes
	// (uploaded file or a previously-generated candidate), or set
	// IconRegenerate=true to have the backend roll a fresh Imagen call
	// right before apps.icon.set. Slack's manifest format has no icon
	// field; we upload via apps.icon.set after manifest.create succeeds.
	IconBase64     string `json:"iconBase64,omitempty"`
	IconMimeType   string `json:"iconMimeType,omitempty"`
	IconRegenerate bool   `json:"iconRegenerate,omitempty"`
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

	installURL := s.pinInstallURLToTeam(resp.OAuthAuthorizeURL)
	rec := PersonalAgentRecord{
		ID:                 agentID,
		OwnerEmail:         session.Email,
		OwnerSlackUserID:   slackUserID,
		DisplayName:        req.DisplayName,
		Description:        req.Description,
		LongDescription:    req.LongDescription,
		SystemPrompt:       req.SystemPrompt,
		SlackAppID:         resp.AppID,
		SlackClientID:      resp.Credentials.ClientID,
		SlackClientSecret:  resp.Credentials.ClientSecret,
		SlackSigningSecret: resp.Credentials.SigningSecret,
		OAuthAuthorizeURL:  installURL,
		Status:             PersonalAgentStatusPendingInstall,
	}
	if err := s.store.CreatePersonalAgent(r.Context(), rec); err != nil {
		s.log.Printf("persist personal agent: %v", err)
		http.Error(w, "persist agent failed", http.StatusInternalServerError)
		return
	}

	// Best-effort icon upload. Failure here doesn't fail the provision — the
	// agent still works, it just shows Slack's default avatar until the user
	// hits the "Change icon" path. Logged so the operator can see it.
	if req.IconRegenerate || strings.TrimSpace(req.IconBase64) != "" {
		imageBytes, mime, ierr := s.resolveIconImage(r.Context(), req.DisplayName, req.Description, iconChangeRequest{
			IconBase64:   req.IconBase64,
			IconMimeType: req.IconMimeType,
			Regenerate:   req.IconRegenerate,
		})
		if ierr != nil {
			s.log.Printf("personal agent icon resolve: %v", ierr)
		} else if ierr := s.slackManifest.SetAppIcon(r.Context(), resp.AppID, imageBytes, mime); ierr != nil {
			s.log.Printf("personal agent apps.icon.set: %v", ierr)
		}
	}

	writeJSON(w, http.StatusOK, createPersonalAgentResponse{
		AgentID:    agentID,
		SlackAppID: resp.AppID,
		InstallURL: installURL,
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
	// SystemPrompt may carry a legacy yt-intel fence (frontend used to bake
	// bullets in there). Strip on read so the textarea hydrates with just the
	// operator's typed personality. The structured YouTubeSources field is
	// returned alongside for the "Learn from a video" UI to consume directly.
	cleanedPersona := strings.TrimSpace(stripYouTubeIntelFence(rec.SystemPrompt))
	sources := rec.YouTubeSources
	if sources == nil {
		sources = []PersonalAgentYouTubeSource{}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"hasAgent":        true,
		"agentId":         rec.ID,
		"displayName":     rec.DisplayName,
		"description":     rec.Description,
		"longDescription": rec.LongDescription,
		"systemPrompt":    cleanedPersona,
		"youtubeSources":  sources,
		"slackAppId":      rec.SlackAppID,
		"status":          rec.Status,
		// install url only useful while pending. Re-pin team= on read: records
		// minted before the pin landed (#454) have a bare authorize URL stored,
		// which lets Slack fall back to the installer's active workspace and
		// fail with invalid_team_for_non_distributed_app. pinInstallURLToTeam is
		// idempotent (q.Set), so this is safe for already-pinned URLs too.
		"installUrl": s.pinInstallURLToTeam(rec.OAuthAuthorizeURL),
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
	oauthOut := &personalAgentOAuthResult{}
	oauthCtx := context.WithValue(r.Context(), personalAgentOAuthResultKey, oauthOut)
	botToken, err := s.exchangePersonalAgentOAuthCode(oauthCtx, rec, code, redirectURI)
	if err != nil {
		s.log.Printf("personal agent oauth exchange: %v", err)
		_ = s.store.UpdatePersonalAgentStatus(r.Context(), agentID, PersonalAgentStatusFailed)
		http.Redirect(w, r, "/me?personal_agent_install=failed&reason=exchange", http.StatusFound)
		return
	}

	// Mint (or fetch) the per-agent knowledge token so it lands in the
	// runtime Secret on first install rather than via a separate backfill.
	knowledgeToken, err := s.store.EnsurePersonalAgentKnowledgeToken(r.Context(), agentID)
	if err != nil {
		s.log.Printf("ensure knowledge token at install: %v", err)
		// Non-fatal — the lazy-load skill will surface a clear error if the
		// token is missing, and the operator can retry. Install shouldn't
		// fail because the lazy-load lane isn't wired.
	}
	if err := s.personalAgent.WriteAgentRuntimeSecret(r.Context(), PersonalAgentRuntimeSecretRequest{
		SlackUserID:    rec.OwnerSlackUserID,
		SlackAppID:     rec.SlackAppID,
		BotToken:       botToken,
		SigningSecret:  rec.SlackSigningSecret,
		SystemPrompt:   rec.SystemPrompt,
		AgentID:        rec.ID,
		KnowledgeToken: knowledgeToken,
		BackendBaseURL: s.personalAgentAPIBase(),
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
	// Almost always false at install time (Google is connected later from /me),
	// but check so a re-provision after a connect doesn't strip the sidecar. A
	// lookup error defaults to no sidecar — safe, the reconciler re-adds it.
	googleConnected, _ := s.personalAgent.HasGoogleCredentials(r.Context(), rec.OwnerSlackUserID)
	if err := s.personalAgent.WriteAgentDeployment(r.Context(), PersonalAgentDeploymentRequest{
		SlackUserID:              rec.OwnerSlackUserID,
		OwnerSlackUserID:         rec.OwnerSlackUserID,
		DisplayName:              rec.DisplayName,
		AgentID:                  rec.ID,
		Image:                    s.cfg.PersonalAgentImage,
		GoogleWorkspaceConnected: googleConnected,
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
	if oauthOut.BotUserID != "" {
		if err := s.store.SetPersonalAgentBotUserID(r.Context(), agentID, oauthOut.BotUserID); err != nil {
			s.log.Printf("set personal agent bot_user_id: %v", err)
		}
	}
	http.Redirect(w, r, "/me?personal_agent_install=ok", http.StatusFound)
}

// personalAgentOAuthResult is the subset of oauth.v2.access we keep on hand
// after install-complete.
type personalAgentOAuthResult struct {
	BotToken  string
	BotUserID string
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
		OK          bool   `json:"ok"`
		Error       string `json:"error"`
		AccessToken string `json:"access_token"` // xoxb- bot token (when bot scopes are granted)
		BotUserID   string `json:"bot_user_id"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return "", err
	}
	if !parsed.OK || strings.TrimSpace(parsed.AccessToken) == "" {
		return "", fmt.Errorf("oauth.v2.access error: %s", parsed.Error)
	}
	// Stash bot_user_id on a per-context value the install handler reads back.
	// Threading it via the return signature would touch every caller; an
	// out-of-band ctx-bound holder keeps the change tight.
	if h, ok := ctx.Value(personalAgentOAuthResultKey).(*personalAgentOAuthResult); ok {
		h.BotToken = parsed.AccessToken
		h.BotUserID = strings.TrimSpace(parsed.BotUserID)
	}
	return parsed.AccessToken, nil
}

type personalAgentOAuthResultCtxKey struct{}

var personalAgentOAuthResultKey personalAgentOAuthResultCtxKey
