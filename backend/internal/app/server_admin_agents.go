package app

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
)

// handleAdminAgentsStatus returns the current scale state of every
// agent we expose a kill switch for. Read-only; admin session gates.
//
//	GET /v1/admin/agents/status
//	{
//	  "agents": [
//	    {"name":"ross","state":"live","replicas":1,"ready":1,"updatedAt":"..."},
//	    {"name":"joanne","state":"down","replicas":0,"ready":0,"reason":"killed via toggle","updatedAt":"..."}
//	  ]
//	}
func (s *Server) handleAdminAgentsStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	ok, svcUnavail := s.adminReadAuthorized(r)
	if !ok {
		if svcUnavail {
			http.Error(w, "admin auth disabled", http.StatusServiceUnavailable)
		} else {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
		}
		return
	}
	if s.agentToggle == nil || s.agentToggle.Disabled() {
		writeJSONNoStore(w, http.StatusServiceUnavailable, map[string]any{
			"error": "agent toggle disabled (no in-cluster config)",
		})
		return
	}
	agents := make([]AgentStatus, 0, len(agentTargets))
	for _, name := range AgentTargetNames() {
		st, err := s.agentToggle.Status(r.Context(), name)
		if err != nil {
			s.log.Printf("admin agents status %q: %v", name, err)
			writeJSONNoStore(w, http.StatusBadGateway, map[string]any{
				"error": "failed to read agent status: " + err.Error(),
				"agent": name,
			})
			return
		}
		agents = append(agents, *st)
	}
	writeJSONNoStore(w, http.StatusOK, map[string]any{"agents": agents})
}

// handleAdminAgentToggle flips the named agent's replicas between 0 and 1.
//
//	POST /v1/admin/agents/{name}/toggle
//	-> 200 {"agent": {...AgentStatus}}
//	-> 404 unknown agent
//	-> 503 disabled (out-of-cluster)
func (s *Server) handleAdminAgentToggle(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	tok := tokenFromAuthHeader(r)
	session, err := s.validateAdminSession(r.Context(), tok)
	if err != nil {
		if !s.adminAuthEnabled() {
			http.Error(w, "admin auth disabled", http.StatusServiceUnavailable)
			return
		}
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	name := strings.TrimSpace(r.PathValue("name"))
	if _, known := agentTargets[name]; !known {
		writeJSONNoStore(w, http.StatusNotFound, map[string]any{
			"error": "unknown agent: " + name,
			"known": AgentTargetNames(),
		})
		return
	}
	if s.agentToggle == nil || s.agentToggle.Disabled() {
		writeJSONNoStore(w, http.StatusServiceUnavailable, map[string]any{
			"error": "agent toggle disabled (no in-cluster config)",
		})
		return
	}
	st, err := s.agentToggle.Toggle(r.Context(), name)
	if err != nil {
		if errors.Is(err, ErrUnknownAgent) {
			writeJSONNoStore(w, http.StatusNotFound, map[string]any{"error": err.Error()})
			return
		}
		s.log.Printf("admin agent toggle %q by %q: %v", name, session.Email, err)
		writeJSONNoStore(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}
	// Audit line — stdout, picked up by the same log pipeline as the other
	// admin actions. If you need queryable audit later, push to Redis or a
	// dedicated table; for v1 a grep over pod logs is the read path.
	s.log.Printf("audit: admin agent toggle name=%s actor=%s new_replicas=%d new_state=%s",
		name, session.Email, st.Replicas, st.State)
	writeJSONNoStore(w, http.StatusOK, map[string]any{"agent": st})
}

// adminAgentGoogleConnectRequest is the body the callback route POSTs after it
// exchanges the auth code for a refresh token at the admin gateway.
type adminAgentGoogleConnectRequest struct {
	ClientID     string `json:"clientId"`
	ClientSecret string `json:"clientSecret"`
	RefreshToken string `json:"refreshToken"`
}

// handleAdminAgentGoogleConnectFinish receives the DCR client + refresh token
// captured by the admin Google consent dance and re-writes the named system
// agent's gws-mcp-oauth Secret, then rolls the pod so the token sidecar
// remounts them. Admin-gated exactly like handleAdminAgentToggle.
//
//	POST /v1/admin/agents/{name}/google/connect/finish
//	body: {"clientId":"...","clientSecret":"...","refreshToken":"..."}
//	-> 200 {"agent": {...AgentStatus}}
//	-> 404 unknown agent / agent has no Google connect
//	-> 503 disabled (out-of-cluster)
func (s *Server) handleAdminAgentGoogleConnectFinish(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	tok := tokenFromAuthHeader(r)
	session, err := s.validateAdminSession(r.Context(), tok)
	if err != nil {
		if !s.adminAuthEnabled() {
			http.Error(w, "admin auth disabled", http.StatusServiceUnavailable)
			return
		}
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	name := strings.TrimSpace(r.PathValue("name"))
	target, known := agentTargets[name]
	if !known {
		writeJSONNoStore(w, http.StatusNotFound, map[string]any{
			"error": "unknown agent: " + name,
			"known": AgentTargetNames(),
		})
		return
	}
	if target.GoogleSecret == "" {
		writeJSONNoStore(w, http.StatusNotFound, map[string]any{
			"error": "agent has no Google connect: " + name,
		})
		return
	}
	if s.agentToggle == nil || s.agentToggle.Disabled() {
		writeJSONNoStore(w, http.StatusServiceUnavailable, map[string]any{
			"error": "agent toggle disabled (no in-cluster config)",
		})
		return
	}

	var req adminAgentGoogleConnectRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	clientID := strings.TrimSpace(req.ClientID)
	clientSecret := strings.TrimSpace(req.ClientSecret)
	refreshToken := strings.TrimSpace(req.RefreshToken)
	// Same minimum-length sanity check as the PA flow: gateway DCR client_id
	// ~40 chars, client_secret ~60, refresh_token ~640.
	if len(clientID) < 16 || len(clientSecret) < 16 || len(refreshToken) < 64 {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}

	if err := s.agentToggle.WriteAgentGoogleCredentials(r.Context(), name, clientID, clientSecret, refreshToken); err != nil {
		if errors.Is(err, ErrUnknownAgent) {
			writeJSONNoStore(w, http.StatusNotFound, map[string]any{"error": err.Error()})
			return
		}
		s.log.Printf("admin agent google connect %q by %q: %v", name, session.Email, err)
		writeJSONNoStore(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}
	// Audit line — same pipeline as the toggle action.
	s.log.Printf("audit: admin agent google connect name=%s actor=%s email=%s",
		name, session.Email, target.GoogleEmail)

	st, err := s.agentToggle.Status(r.Context(), name)
	if err != nil {
		s.log.Printf("admin agent google connect %q status refresh: %v", name, err)
		writeJSONNoStore(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}
	writeJSONNoStore(w, http.StatusOK, map[string]any{"agent": st})
}
