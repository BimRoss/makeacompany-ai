package app

import (
	"context"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"
)

// landerPersonalAgentsCacheTTL bounds backend fan-out (a Redis SCAN over every
// personal agent plus one snapshot parse) under public lander traffic. The page
// is force-dynamic and the client polls, so without this we'd re-scan on every
// visit. Two minutes is invisible at this scale — a freshly installed agent
// joins the row within a couple minutes.
const landerPersonalAgentsCacheTTL = 120 * time.Second

// landerPersonalAgentsMax caps the array so a growing agent count can't bloat
// the payload. Total is reported separately so the UI can render "+N".
const landerPersonalAgentsMax = 60

type landerPersonalAgent struct {
	Name     string `json:"name"`
	ImageURL string `json:"imageUrl,omitempty"`
}

type landerPersonalAgentsPayload struct {
	Total  int                   `json:"total"`
	Agents []landerPersonalAgent `json:"agents"`
}

type landerPersonalAgentsCache struct {
	mu      sync.Mutex
	at      time.Time
	payload landerPersonalAgentsPayload
	ok      bool
}

var landerPersonalAgentsMemo landerPersonalAgentsCache

func (s *Server) computeLanderPersonalAgents(ctx context.Context) (landerPersonalAgentsPayload, error) {
	recs, err := s.store.ListPersonalAgents(ctx)
	if err != nil {
		return landerPersonalAgentsPayload{}, err
	}
	// The Slack workspace-users snapshot that used to resolve each agent bot's
	// profile image was retired, so every circle falls back to initials on the
	// frontend (imageUrl left empty).
	// Only installed agents with a display name are live, named teammates.
	live := make([]PersonalAgentRecord, 0, len(recs))
	for _, rec := range recs {
		if rec.Status != PersonalAgentStatusInstalled {
			continue
		}
		if strings.TrimSpace(rec.DisplayName) == "" {
			continue
		}
		live = append(live, rec)
	}
	// Stable oldest-first order so the row doesn't reshuffle between polls.
	sort.SliceStable(live, func(i, j int) bool {
		return live[i].CreatedAt < live[j].CreatedAt
	})
	total := len(live)
	if len(live) > landerPersonalAgentsMax {
		live = live[:landerPersonalAgentsMax]
	}
	agents := make([]landerPersonalAgent, 0, len(live))
	for _, rec := range live {
		agents = append(agents, landerPersonalAgent{
			Name: strings.TrimSpace(rec.DisplayName),
		})
	}
	return landerPersonalAgentsPayload{Total: total, Agents: agents}, nil
}

// handleLanderPersonalAgents serves the public, unauthenticated row of personal
// agents users have built, shown on the lander next to Ross and Joanne. Only
// the agent's display name and Slack avatar are exposed — no owner identity.
// Cached for landerPersonalAgentsCacheTTL to bound Redis fan-out under public
// traffic, with fallback to the last good value so the lander never breaks on a
// backend hiccup.
func (s *Server) handleLanderPersonalAgents(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	landerPersonalAgentsMemo.mu.Lock()
	fresh := landerPersonalAgentsMemo.ok && time.Since(landerPersonalAgentsMemo.at) < landerPersonalAgentsCacheTTL
	cached := landerPersonalAgentsMemo.payload
	landerPersonalAgentsMemo.mu.Unlock()
	if fresh {
		writeJSON(w, http.StatusOK, cached)
		return
	}
	payload, err := s.computeLanderPersonalAgents(r.Context())
	if err != nil {
		s.log.Printf("lander personal-agents: %v", err)
		landerPersonalAgentsMemo.mu.Lock()
		stale := landerPersonalAgentsMemo.ok
		last := landerPersonalAgentsMemo.payload
		landerPersonalAgentsMemo.mu.Unlock()
		if stale {
			writeJSON(w, http.StatusOK, last)
			return
		}
		writeJSON(w, http.StatusOK, landerPersonalAgentsPayload{Total: 0, Agents: []landerPersonalAgent{}})
		return
	}
	landerPersonalAgentsMemo.mu.Lock()
	landerPersonalAgentsMemo.payload = payload
	landerPersonalAgentsMemo.at = time.Now()
	landerPersonalAgentsMemo.ok = true
	landerPersonalAgentsMemo.mu.Unlock()
	writeJSON(w, http.StatusOK, payload)
}
