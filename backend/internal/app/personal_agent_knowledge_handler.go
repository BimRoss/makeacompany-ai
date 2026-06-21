package app

import (
	"errors"
	"net/http"
	"strings"

	"github.com/redis/go-redis/v9"
)

// handleGetPersonalAgentKnowledge returns the harvested intelligence (today:
// YouTube bullets) attached to the calling personal agent. Authenticated via
// a per-agent bearer token (PersonalAgentRecord.KnowledgeToken) injected into
// the agent's pod as PERSONAL_AGENT_KNOWLEDGE_TOKEN. Designed to be called
// from the agent-knowledge skill in claude-code-personal-agent (#48).
//
// Response shape (stable contract for the skill — don't break without bumping):
//
//	{
//	  "agentId":  "agt_…",
//	  "sources": [
//	    { "url":..., "title":..., "bullets":[...], "ingestedAt":... }
//	  ]
//	}
//
// 401 is returned for missing/invalid tokens — never leak which agent the
// token would have matched. Per-token rate limiting isn't enforced here; if
// a leaked token gets abused, rotate via the (forthcoming) /rotate endpoint.
func (s *Server) handleGetPersonalAgentKnowledge(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	token := strings.TrimSpace(tokenFromAuthHeader(r))
	if token == "" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	rec, err := s.store.GetPersonalAgentByKnowledgeToken(r.Context(), token)
	if errors.Is(err, redis.Nil) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if err != nil {
		s.log.Printf("knowledge lookup: %v", err)
		http.Error(w, "lookup failed", http.StatusInternalServerError)
		return
	}
	sources := rec.YouTubeSources
	if sources == nil {
		sources = []PersonalAgentYouTubeSource{}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"agentId": rec.ID,
		"sources": sources,
	})
}

// handleBackfillPersonalAgentKnowledgeTokens mints (where missing) a
// knowledge token on every PersonalAgentRecord and patches the per-agent K8s
// runtime Secret with PERSONAL_AGENT_ID / PERSONAL_AGENT_KNOWLEDGE_TOKEN /
// MAKEACOMPANY_API_BASE so agents minted before #607 can use the lazy-load
// skill without a fresh install. Auth: internal service token.
//
// Idempotent: agents that already have a token just get their K8s Secret
// reconciled with the current backend base URL.
func (s *Server) handleBackfillPersonalAgentKnowledgeTokens(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.internalServiceBearerAuthorized(r) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	ctx := r.Context()
	agents, err := s.store.ListPersonalAgents(ctx)
	if err != nil {
		http.Error(w, "list failed: "+err.Error(), http.StatusInternalServerError)
		return
	}
	var processed, k8sSkipped, k8sFailed int
	for _, rec := range agents {
		token, err := s.store.EnsurePersonalAgentKnowledgeToken(ctx, rec.ID)
		if err != nil {
			s.log.Printf("backfill token for %s: %v", rec.ID, err)
			continue
		}
		processed++
		if s.personalAgent == nil || s.personalAgent.Disabled() {
			k8sSkipped++
			continue
		}
		if err := s.personalAgent.PatchAgentKnowledgeEnv(ctx, rec.OwnerSlackUserID, rec.ID, token, s.cfg.AppBaseURL); err != nil {
			s.log.Printf("patch knowledge env for %s: %v", rec.ID, err)
			k8sFailed++
			continue
		}
		if err := s.personalAgent.RestartAgentDeployment(ctx, rec.OwnerSlackUserID); err != nil {
			s.log.Printf("restart agent after knowledge env backfill for %s: %v", rec.ID, err)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":         true,
		"total":      len(agents),
		"processed":  processed,
		"k8sSkipped": k8sSkipped,
		"k8sFailed":  k8sFailed,
	})
}
