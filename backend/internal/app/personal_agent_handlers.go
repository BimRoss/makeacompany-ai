package app

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
)

// Personal-agent portal + admin handlers (issue #183 / #186 PR2 of 5).
// Read-modify-write surface on top of store_personal_agent.go. Token
// paste + k8s Secret write deferred to the next PR — that path needs
// the kube client + namespace-scoped RBAC, which lives in its own slice
// so this one stays pure-Go and unit-testable.
//
// All endpoints are gated behind `Config.PersonalAgentsEnabled`. Off
// returns 404 (not 503) so the existence of the surface is not
// advertised to unauthenticated probes.

type portalAgentRequest struct {
	Name string `json:"name"`
}

type portalAgentResponse struct {
	Slug                string `json:"slug"`
	OwnerUserID         string `json:"ownerUserId"`
	DisplayName         string `json:"displayName"`
	AgentSlackBotUserID string `json:"agentSlackBotUserId,omitempty"`
	GoogleEmail         string `json:"googleEmail,omitempty"`
	GoogleConnected     bool   `json:"googleConnected"`
	CreatedAt           string `json:"createdAt"`
}

type portalAgentsListResponse struct {
	Agents []portalAgentResponse `json:"agents"`
}

func newPortalAgentResponse(pa PersonalAgent) portalAgentResponse {
	out := portalAgentResponse{
		Slug:                pa.Slug,
		OwnerUserID:         pa.OwnerUserID,
		DisplayName:         pa.DisplayName,
		AgentSlackBotUserID: pa.AgentSlackBotUserID,
		GoogleConnected:     pa.GoogleSubject != "",
	}
	if pa.GoogleEmail != "" {
		out.GoogleEmail = pa.GoogleEmail
	}
	if !pa.CreatedAt.IsZero() {
		out.CreatedAt = pa.CreatedAt.UTC().Format("2006-01-02T15:04:05Z")
	}
	return out
}

// personalAgentsSurfaceEnabled returns true if PersonalAgentsEnabled is
// on. When off, all routes 404 — same as if the endpoint didn't exist.
// Done at the boundary so each handler can early-return without
// re-checking; pattern matches `s.workspace.Disabled()` in the
// company-tenant flows.
func (s *Server) personalAgentsSurfaceEnabled() bool {
	return s.cfg.PersonalAgentsEnabled
}

// resolvePortalAgentOwner extracts the calling user's Slack user id by
// chaining: bearer token → portal session → user profile email →
// slack_user_id. Returns 401 to the caller for any link in that chain
// failing; returns 403 when the email has no linked Slack identity
// (can't own personal agents without a Slack user to bind responses
// to). On success returns (slackUserID, email, nil).
func (s *Server) resolvePortalAgentOwner(r *http.Request) (slackUserID string, email string, status int, err error) {
	// Any auth failure (missing bearer, expired session, malformed
	// token) collapses to 401. Existing handlers (portal_billing.go)
	// follow the same pattern — surface a single "unauthorized"
	// without distinguishing the cause, so probes can't fingerprint.
	session, err := s.store.GetPortalSession(r.Context(), tokenFromAuthHeader(r))
	if err != nil || session.Email == "" {
		return "", "", http.StatusUnauthorized, errors.New("unauthorized")
	}
	email = normalizeProfileEmail(session.Email)
	if email == "" {
		return "", "", http.StatusUnauthorized, errors.New("unauthorized")
	}
	uid, err := s.store.SlackUserIDByProfileEmail(r.Context(), email)
	if err != nil {
		return "", "", http.StatusInternalServerError, err
	}
	if !ValidSlackUserID(uid) {
		return "", "", http.StatusForbidden, errors.New("profile has no linked Slack user; sign into a portal channel first")
	}
	return uid, email, 0, nil
}

// handlePortalAgents is mounted at `/v1/portal/agents` and
// `/v1/portal/agents/` to capture both the list/create and the
// per-slug routes in one entry point. Dispatch is by method + path
// suffix; we explicitly enumerate the cases so a malformed path 404s
// instead of falling through to "list".
func (s *Server) handlePortalAgents(w http.ResponseWriter, r *http.Request) {
	if !s.personalAgentsSurfaceEnabled() {
		http.NotFound(w, r)
		return
	}
	suffix := strings.TrimPrefix(r.URL.Path, "/v1/portal/agents")
	suffix = strings.TrimPrefix(suffix, "/")

	// Subpath dispatch. /v1/portal/agents/<slug>/slack-token is the
	// only nested action in v1; everything else with a slash is 404
	// to keep the surface explicit.
	switch {
	case suffix == "" && r.Method == http.MethodGet:
		s.handlePortalAgentsList(w, r)
	case suffix == "" && r.Method == http.MethodPost:
		s.handlePortalAgentsCreate(w, r)
	case !strings.Contains(suffix, "/") && r.Method == http.MethodGet:
		s.handlePortalAgentGet(w, r, suffix)
	case !strings.Contains(suffix, "/") && r.Method == http.MethodDelete:
		s.handlePortalAgentDelete(w, r, suffix)
	default:
		if slug, action, ok := splitAgentSubpath(suffix); ok && action == "slack-token" && r.Method == http.MethodPost {
			s.handlePortalAgentSlackToken(w, r, slug)
			return
		}
		http.NotFound(w, r)
	}
}

// splitAgentSubpath parses "<slug>/<action>" suffixes. Returns ok=true
// only when the slug passes ValidPersonalAgentSlug — malformed paths
// short-circuit to 404 in the caller.
func splitAgentSubpath(suffix string) (slug, action string, ok bool) {
	parts := strings.SplitN(suffix, "/", 2)
	if len(parts) != 2 {
		return "", "", false
	}
	if !ValidPersonalAgentSlug(parts[0]) {
		return "", "", false
	}
	if parts[1] == "" || strings.Contains(parts[1], "/") {
		return "", "", false
	}
	return parts[0], parts[1], true
}

func (s *Server) handlePortalAgentsList(w http.ResponseWriter, r *http.Request) {
	owner, _, status, err := s.resolvePortalAgentOwner(r)
	if err != nil {
		http.Error(w, err.Error(), status)
		return
	}
	agents, err := s.store.ListPersonalAgentsByOwner(r.Context(), owner)
	if err != nil {
		s.log.Printf("personal agents list by owner %s: %v", owner, err)
		http.Error(w, "failed", http.StatusInternalServerError)
		return
	}
	out := portalAgentsListResponse{Agents: make([]portalAgentResponse, 0, len(agents))}
	for _, pa := range agents {
		out.Agents = append(out.Agents, newPortalAgentResponse(pa))
	}
	writeJSONNoStore(w, http.StatusOK, out)
}

func (s *Server) handlePortalAgentsCreate(w http.ResponseWriter, r *http.Request) {
	owner, _, status, err := s.resolvePortalAgentOwner(r)
	if err != nil {
		http.Error(w, err.Error(), status)
		return
	}
	var body portalAgentRequest
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&body); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	slug, ok := SlugifyAgentName(body.Name)
	if !ok {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error":  "invalid name",
			"detail": "agent name must contain at least 3 letters or digits",
		})
		return
	}
	display := strings.TrimSpace(body.Name)
	if err := s.store.CreatePersonalAgent(r.Context(), slug, owner, display); err != nil {
		switch {
		case errors.Is(err, ErrPersonalAgentSlugTaken):
			writeJSON(w, http.StatusConflict, map[string]any{
				"error":  "slug taken",
				"detail": "an agent named " + display + " already exists in this workspace — pick a different name",
				"slug":   slug,
			})
			return
		case errors.Is(err, ErrInvalidPersonalAgentSlug),
			errors.Is(err, ErrInvalidPersonalAgentOwner):
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		default:
			s.log.Printf("personal agent create %s: %v", slug, err)
			http.Error(w, "failed", http.StatusInternalServerError)
			return
		}
	}
	pa, err := s.store.GetPersonalAgent(r.Context(), slug)
	if err != nil {
		s.log.Printf("personal agent post-create get %s: %v", slug, err)
		http.Error(w, "failed", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusCreated, newPortalAgentResponse(*pa))
}

func (s *Server) handlePortalAgentGet(w http.ResponseWriter, r *http.Request, slug string) {
	owner, _, status, err := s.resolvePortalAgentOwner(r)
	if err != nil {
		http.Error(w, err.Error(), status)
		return
	}
	pa, err := s.fetchOwnedAgent(r, owner, slug)
	if err != nil {
		s.handlePersonalAgentLookupError(w, err)
		return
	}
	writeJSONNoStore(w, http.StatusOK, newPortalAgentResponse(*pa))
}

func (s *Server) handlePortalAgentDelete(w http.ResponseWriter, r *http.Request, slug string) {
	owner, _, status, err := s.resolvePortalAgentOwner(r)
	if err != nil {
		http.Error(w, err.Error(), status)
		return
	}
	if _, err := s.fetchOwnedAgent(r, owner, slug); err != nil {
		s.handlePersonalAgentLookupError(w, err)
		return
	}
	if err := s.store.DeletePersonalAgent(r.Context(), slug); err != nil {
		s.log.Printf("personal agent delete %s: %v", slug, err)
		http.Error(w, "failed", http.StatusInternalServerError)
		return
	}
	// Best-effort Secret cleanup. Errors here don't fail the delete —
	// the tenant record is already gone, and a stale Secret is a
	// soft inconsistency that PR4's RBAC scope makes harmless (no pod
	// reads it once the deployment is torn down). Surface to audit log.
	if !s.personalAgentSecrets.Disabled() {
		if err := s.personalAgentSecrets.DeleteSlackSecret(r.Context(), slug); err != nil {
			s.log.Printf("personal agent secret cleanup %s: %v", slug, err)
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

// fetchOwnedAgent loads the agent + verifies the caller owns it. Two
// failure modes the caller distinguishes: not-found vs not-yours. We
// collapse them into a single 404 to the wire (don't leak the
// existence of someone else's agent slug to a probe) but log the
// distinction so admins can see ownership attempts in the access log.
func (s *Server) fetchOwnedAgent(r *http.Request, owner, slug string) (*PersonalAgent, error) {
	if !ValidPersonalAgentSlug(slug) {
		return nil, ErrPersonalAgentNotFound
	}
	pa, err := s.store.GetPersonalAgent(r.Context(), slug)
	if err != nil {
		return nil, err
	}
	if pa.OwnerUserID != owner {
		s.log.Printf("personal agent ownership mismatch: caller=%s requested=%s actual=%s", owner, slug, pa.OwnerUserID)
		return nil, ErrPersonalAgentNotFound
	}
	return pa, nil
}

func (s *Server) handlePersonalAgentLookupError(w http.ResponseWriter, err error) {
	if errors.Is(err, ErrPersonalAgentNotFound) || errors.Is(err, ErrInvalidPersonalAgentSlug) {
		http.NotFound(w, nil)
		return
	}
	s.log.Printf("personal agent lookup: %v", err)
	http.Error(w, "failed", http.StatusInternalServerError)
}

type portalAgentSlackTokenRequest struct {
	BotToken  string `json:"bot_token"`
	AppToken  string `json:"app_token"`
	BotUserID string `json:"bot_user_id"`
}

// handlePortalAgentSlackToken accepts the three pasted Slack
// credentials, validates them, writes the per-agent k8s Secret in the
// `personal-agents` namespace, then records the bot user id on the
// AgentTenant so the dispatcher reverse index resolves inbound events.
//
// Returns:
//   - 204 No Content on success.
//   - 400 if validation fails (malformed token shape, swapped fields).
//   - 404 if slug isn't owned by the caller.
//   - 503 if the secret writer is disabled (local dev, no in-cluster
//     config). Operator never sees this in prod.
func (s *Server) handlePortalAgentSlackToken(w http.ResponseWriter, r *http.Request, slug string) {
	owner, _, status, err := s.resolvePortalAgentOwner(r)
	if err != nil {
		http.Error(w, err.Error(), status)
		return
	}
	if _, err := s.fetchOwnedAgent(r, owner, slug); err != nil {
		s.handlePersonalAgentLookupError(w, err)
		return
	}
	var body portalAgentSlackTokenRequest
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&body); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	tokens := PersonalAgentSlackTokens{
		BotToken:  body.BotToken,
		AppToken:  body.AppToken,
		BotUserID: body.BotUserID,
	}
	if err := ValidatePersonalAgentSlackTokens(tokens); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error":  "invalid tokens",
			"detail": err.Error(),
		})
		return
	}
	if s.personalAgentSecrets.Disabled() {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{
			"error":  "secret writer disabled",
			"detail": "the backend is not running in-cluster — token paste only works in prod/dev k8s",
		})
		return
	}
	if err := s.personalAgentSecrets.WriteSlackSecret(r.Context(), slug, tokens); err != nil {
		s.log.Printf("personal agent slack secret write %s: %v", slug, err)
		http.Error(w, "failed", http.StatusInternalServerError)
		return
	}
	// Bind the bot user id on the tenant record after the Secret write
	// succeeds. If this fails the Secret is the source of truth and a
	// retry will re-converge — the reverse index is purely an index
	// over the canonical Secret content, not a separate fact.
	if err := s.store.SetPersonalAgentSlackBot(r.Context(), slug, strings.TrimSpace(tokens.BotUserID)); err != nil {
		s.log.Printf("personal agent set bot %s: %v", slug, err)
		http.Error(w, "failed", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleAdminPersonalAgents is the read-only admin aggregate
// (`/v1/admin/personal-agents`). v1: list all agents across owners,
// no write surface. Per #183 final decisions: admin is read-only;
// suspension/disable is owner-only via `/me/agents/<slug>`.
func (s *Server) handleAdminPersonalAgents(w http.ResponseWriter, r *http.Request) {
	if !s.personalAgentsSurfaceEnabled() {
		http.NotFound(w, r)
		return
	}
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if _, err := s.validateAdminSession(r.Context(), tokenFromAuthHeader(r)); err != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	agents, err := s.store.ListAllPersonalAgents(r.Context())
	if err != nil {
		s.log.Printf("admin personal agents list: %v", err)
		http.Error(w, "failed", http.StatusInternalServerError)
		return
	}
	out := portalAgentsListResponse{Agents: make([]portalAgentResponse, 0, len(agents))}
	for _, pa := range agents {
		out.Agents = append(out.Agents, newPortalAgentResponse(pa))
	}
	writeJSONNoStore(w, http.StatusOK, out)
}
