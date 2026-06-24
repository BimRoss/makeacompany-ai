package app

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/redis/go-redis/v9"
)

type editPersonalAgentRequest struct {
	DisplayName     string `json:"displayName,omitempty"`
	Description     string `json:"description,omitempty"`
	LongDescription string `json:"longDescription,omitempty"`
	// SystemPrompt is the user-defined persona. Empty string means "no
	// change"; we don't currently expose a way to clear back to blank-slate
	// from this endpoint (would require a sentinel like SystemPromptClear).
	SystemPrompt    string `json:"systemPrompt,omitempty"`
}

// handleEditPersonalAgent updates the agent's display name and/or description
// on the Redis record AND pushes the change to Slack via apps.manifest.update
// so the Slack bot listing stays in sync.
//
// Gated on the /me session + slack_user_id ownership.
func (s *Server) handleEditPersonalAgent(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if s.slackManifest == nil || s.slackManifest.Disabled() {
		http.Error(w, "manifest client disabled", http.StatusServiceUnavailable)
		return
	}
	rec, status, err := s.ownerPersonalAgentForRequest(r)
	if err != nil {
		http.Error(w, err.Error(), status)
		return
	}
	var req editPersonalAgentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	newName := strings.TrimSpace(req.DisplayName)
	newDesc := strings.TrimSpace(req.Description)
	// Strip any yt-intel fenced bullets the legacy frontend may have baked in
	// before measuring against MaxPersonalityChars — the cap applies to the
	// operator's own typed personality, not transcript content. Harvested
	// intelligence belongs in lazy-loaded knowledge, not the system prompt.
	newSystemPrompt := strings.TrimSpace(stripYouTubeIntelFence(req.SystemPrompt))
	if n := len([]rune(newSystemPrompt)); n > MaxPersonalityChars {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error": fmt.Sprintf("Personality is %d characters; the limit is %d. Trim it down and try again.", n, MaxPersonalityChars),
			"code":  "personality_too_long",
			"chars": n,
			"max":   MaxPersonalityChars,
		})
		return
	}
	s.log.Printf("edit personal agent %s: name=%d desc=%d longDesc=%d systemPrompt=%d",
		rec.ID, len(newName), len(newDesc), len(strings.TrimSpace(req.LongDescription)), len(newSystemPrompt))
	if newName == "" && newDesc == "" && strings.TrimSpace(req.LongDescription) == "" && newSystemPrompt == "" {
		http.Error(w, "no fields to update", http.StatusBadRequest)
		return
	}

	// Render an updated manifest using the new values (falling back to the
	// stored ones for fields the caller didn't change). install_redirect_url
	// is per-agent and immutable; events_request_url is constant.
	manifestName := firstNonEmptyTrim(newName, rec.DisplayName)
	manifestDesc := firstNonEmptyTrim(newDesc, rec.Description)
	manifest, err := RenderPersonalAgentManifest(PersonalAgentManifestSubstitutions{
		DisplayName:        manifestName,
		Description:        manifestDesc,
		LongDescription:    req.LongDescription,
		EventsRequestURL:   s.cfg.EventsGatewayRequestURL,
		InstallRedirectURL: s.personalAgentInstallRedirectFor(rec.ID),
	})
	if err != nil {
		http.Error(w, "manifest render: "+err.Error(), http.StatusBadRequest)
		return
	}
	if err := s.slackManifest.UpdateManifest(r.Context(), rec.SlackAppID, manifest); err != nil {
		s.log.Printf("apps.manifest.update: %v", err)
		http.Error(w, "slack apps.manifest.update failed: "+err.Error(), http.StatusBadGateway)
		return
	}

	// Persist to our store. Slack-side change has already landed, so even if
	// this fails the user sees the edited bot in Slack — log loud and move on.
	if err := s.store.UpdatePersonalAgentDisplay(r.Context(), rec.ID, newName, newDesc, req.LongDescription, newSystemPrompt); err != nil {
		s.log.Printf("update personal agent display: %v", err)
	}

	// System prompt round-trip: patch the per-agent Secret and roll the
	// dispatcher pod so the next inbound message renders instructions.md
	// against the new persona. Skipped when the field wasn't touched.
	if newSystemPrompt != "" && s.personalAgent != nil && !s.personalAgent.Disabled() {
		if err := s.personalAgent.PatchAgentSystemPrompt(r.Context(), rec.ID, newSystemPrompt); err != nil {
			s.log.Printf("patch system prompt secret: %v", err)
		} else if err := s.personalAgent.RestartAgentDeployment(r.Context(), rec.ID); err != nil {
			s.log.Printf("restart agent deployment after system prompt change: %v", err)
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":              true,
		"displayName":     manifestName,
		"description":     manifestDesc,
		"longDescription": strings.TrimSpace(req.LongDescription),
		"systemPrompt":    newSystemPrompt,
	})
}

type deletePersonalAgentRequest struct {
	// WipeWorkspace, when true, also spawns a one-shot K8s Job that rm -rfs
	// the per-agent hostPath subdirectory so a recreated agent gets a clean
	// /data instead of inheriting the previous ~/.claude transcripts.
	WipeWorkspace bool `json:"wipeWorkspace,omitempty"`
}

// handleDeletePersonalAgent removes the personal agent end-to-end:
//
//  1. Slack app via apps.manifest.delete
//  2. In-cluster Deployment, Service, runtime Secret
//  3. (optional) hostPath workspace wipe Job
//  4. Redis record + both indexes
//
// Each step is best-effort; failures are surfaced in a multi-error so the
// user knows what didn't clean up. The owner index is removed last so the
// frontend can immediately offer "create a new agent" once this returns.
func (s *Server) handleDeletePersonalAgent(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	rec, status, err := s.ownerPersonalAgentForRequest(r)
	if err != nil {
		http.Error(w, err.Error(), status)
		return
	}

	// Body is optional — empty body means "delete but keep workspace".
	var req deletePersonalAgentRequest
	_ = json.NewDecoder(r.Body).Decode(&req)

	var problems []string

	if s.slackManifest != nil && !s.slackManifest.Disabled() {
		if err := s.slackManifest.DeleteApp(r.Context(), rec.SlackAppID); err != nil {
			s.log.Printf("apps.manifest.delete: %v", err)
			problems = append(problems, "slack app delete failed: "+err.Error())
		}
	}
	if s.personalAgent != nil && !s.personalAgent.Disabled() {
		if err := s.personalAgent.DeleteAgentResources(r.Context(), rec.ID); err != nil {
			s.log.Printf("delete agent k8s resources: %v", err)
			problems = append(problems, "k8s resources cleanup failed: "+err.Error())
		}
		if req.WipeWorkspace {
			if err := s.personalAgent.WipeAgentWorkspace(r.Context(), rec.ID); err != nil {
				s.log.Printf("wipe agent workspace: %v", err)
				problems = append(problems, "workspace wipe failed: "+err.Error())
			}
		}
	}
	if err := s.store.DeletePersonalAgent(r.Context(), rec); err != nil {
		s.log.Printf("delete personal agent record: %v", err)
		problems = append(problems, "record delete failed: "+err.Error())
	}

	if len(problems) > 0 {
		// Partial success; tell the caller what's still hanging.
		writeJSON(w, http.StatusMultiStatus, map[string]any{
			"ok":       false,
			"problems": problems,
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// ownerPersonalAgentForRequest resolves the caller's /me session, maps it to a
// slack_user_id, and resolves the TARGET agent it owns. The target is selected
// by an `agentId` field in the request (body for writes, query param for
// reads) and validated against the owner's agent list (#651).
//
// Returns (record, status, error) where status is the HTTP code the caller
// should write on error.
func (s *Server) ownerPersonalAgentForRequest(r *http.Request) (PersonalAgentRecord, int, error) {
	session, err := s.store.GetPortalSession(r.Context(), tokenFromAuthHeader(r))
	if err != nil || session.TenantType != PortalTenantTypeUser {
		return PersonalAgentRecord{}, http.StatusUnauthorized, errors.New("unauthorized")
	}
	slackUserID, err := s.store.SlackUserIDByProfileEmail(r.Context(), session.Email)
	if err != nil || strings.TrimSpace(slackUserID) == "" {
		return PersonalAgentRecord{}, http.StatusForbidden, errors.New("no slack identity for this account")
	}
	rec, err := s.personalAgentForOwnerRequest(r.Context(), r, slackUserID, agentIDFromRequest(r))
	if err != nil {
		return PersonalAgentRecord{}, personalAgentResolveStatus(err), err
	}
	return rec, 0, nil
}

// Sentinel errors the personalAgentForOwnerRequest resolver returns; mapped to
// HTTP status by personalAgentResolveStatus.
var (
	errPersonalAgentIDRequired = errors.New("agentId required (you have more than one agent)")
	errPersonalAgentNotOwned   = errors.New("no such personal agent for this user")
)

// personalAgentForOwnerRequest resolves the target agent for an owner-scoped
// /me request and validates it belongs to ownerUID (#651). Resolution rules:
//
//   - agentID given + owned by ownerUID  → that agent.
//   - agentID given + NOT owned          → errPersonalAgentNotOwned (404/403).
//   - agentID empty + owner has exactly one agent → that one agent. This is the
//     back-compat path for the CURRENT frontend, which sends no agentId; it
//     keeps working until PR #3 ships the multi-agent UI.
//   - agentID empty + owner has >1 agent → errPersonalAgentIDRequired (400).
//   - owner has zero agents              → redis.Nil (404 "no agent").
//
// Ownership is checked against the owner's list index, never the record's
// OwnerSlackUserID alone, so a stale/forged agentId can't slip through.
func (s *Server) personalAgentForOwnerRequest(ctx context.Context, _ *http.Request, ownerUID, agentID string) (PersonalAgentRecord, error) {
	agents, err := s.store.ListPersonalAgentsByOwner(ctx, ownerUID)
	if err != nil {
		return PersonalAgentRecord{}, err
	}
	if len(agents) == 0 {
		return PersonalAgentRecord{}, redis.Nil
	}
	agentID = strings.TrimSpace(agentID)
	if agentID == "" {
		if len(agents) == 1 {
			return agents[0], nil
		}
		return PersonalAgentRecord{}, errPersonalAgentIDRequired
	}
	for _, a := range agents {
		if a.ID == agentID {
			return a, nil
		}
	}
	return PersonalAgentRecord{}, errPersonalAgentNotOwned
}

// personalAgentResolveStatus maps a personalAgentForOwnerRequest error to the
// HTTP status the handler should write.
func personalAgentResolveStatus(err error) int {
	switch {
	case errors.Is(err, redis.Nil), errors.Is(err, errPersonalAgentNotOwned):
		// Don't distinguish "no agent" from "not your agent" — same posture as
		// the public endpoint: a 404 either way.
		return http.StatusNotFound
	case errors.Is(err, errPersonalAgentIDRequired):
		return http.StatusBadRequest
	default:
		return http.StatusInternalServerError
	}
}

// agentIDFromRequest extracts the target agent id from a /me request. For GETs
// it reads the `agentId` query param; for writes it peeks the JSON body for an
// `agentId` field WITHOUT consuming the body the handler still needs to decode.
// Returns "" when absent (back-compat single-agent path).
func agentIDFromRequest(r *http.Request) string {
	if id := strings.TrimSpace(r.URL.Query().Get("agentId")); id != "" {
		return id
	}
	if r.Method == http.MethodGet || r.Method == http.MethodHead {
		return ""
	}
	return peekAgentIDFromBody(r)
}

// peekAgentIDFromBody reads the request body, extracts an optional top-level
// `agentId`, and REPLACES r.Body with a fresh reader over the same bytes so the
// handler's own json.Decode still sees the full payload. Bounded read so a
// malicious giant body can't OOM us here (the handlers don't impose their own
// cap on these small JSON posts).
func peekAgentIDFromBody(r *http.Request) string {
	if r.Body == nil {
		return ""
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	_ = r.Body.Close()
	// Restore the body for the handler regardless of parse outcome.
	r.Body = io.NopCloser(bytes.NewReader(body))
	if err != nil || len(body) == 0 {
		return ""
	}
	var probe struct {
		AgentID string `json:"agentId"`
	}
	if err := json.Unmarshal(body, &probe); err != nil {
		return ""
	}
	return strings.TrimSpace(probe.AgentID)
}

func firstNonEmptyTrim(values ...string) string {
	for _, v := range values {
		if t := strings.TrimSpace(v); t != "" {
			return t
		}
	}
	return ""
}
