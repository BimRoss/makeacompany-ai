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

	switch {
	case suffix == "" && r.Method == http.MethodGet:
		s.handlePortalAgentsList(w, r)
	case suffix == "" && r.Method == http.MethodPost:
		s.handlePortalAgentsCreate(w, r)
	case suffix != "" && !strings.Contains(suffix, "/") && r.Method == http.MethodGet:
		s.handlePortalAgentGet(w, r, suffix)
	case suffix != "" && !strings.Contains(suffix, "/") && r.Method == http.MethodDelete:
		s.handlePortalAgentDelete(w, r, suffix)
	default:
		http.NotFound(w, r)
	}
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
