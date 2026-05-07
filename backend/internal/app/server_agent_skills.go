package app

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// agentSkill mirrors skills-mcp-server `internal/skills.Skill` (subset). Instructions are dropped from the list
// proxy because the read-only UI only renders summary cards; the raw markdown can be fetched via skills-mcp-server
// directly when an editor is added later.
type agentSkill struct {
	Name          string            `json:"name"`
	Description   string            `json:"description,omitempty"`
	License       string            `json:"license,omitempty"`
	Compatibility string            `json:"compatibility,omitempty"`
	Metadata      map[string]string `json:"metadata,omitempty"`
	AllowedTools  string            `json:"allowedTools,omitempty"`
	UpdatedAt     string            `json:"updatedAt,omitempty"`
}

type agentSkillsListResponse struct {
	Skills []agentSkill `json:"skills"`
	Source string       `json:"source"`
}

// handlePublicAgentSkills proxies skills-mcp-server `GET /api/skills` (read-only). Designed for /admin and /skills
// summary cards, so it strips the markdown body to keep the payload small.
func (s *Server) handlePublicAgentSkills(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	base := strings.TrimSpace(s.cfg.SkillsMCPBaseURL)
	if base == "" {
		writeJSONNoStore(w, http.StatusServiceUnavailable, map[string]any{
			"error": "skills-mcp-server is not configured (SKILLS_MCP_BASE_URL)",
		})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	upstreamURL := strings.TrimRight(base, "/") + "/api/skills"
	if q := strings.TrimSpace(r.URL.Query().Get("q")); q != "" {
		upstreamURL += "?q=" + url.QueryEscape(q)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, upstreamURL, nil)
	if err != nil {
		writeJSONNoStore(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}
	req.Header.Set("Accept", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		writeJSONNoStore(w, http.StatusBadGateway, map[string]any{
			"error": fmt.Sprintf("skills-mcp-server unreachable: %s", err.Error()),
		})
		return
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20)) // 4 MiB cap
	if err != nil {
		writeJSONNoStore(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}
	if resp.StatusCode/100 != 2 {
		writeJSONNoStore(w, http.StatusBadGateway, map[string]any{
			"error":          "skills-mcp-server returned non-2xx",
			"upstreamStatus": resp.StatusCode,
			"upstreamBody":   firstLine(string(body), 500),
		})
		return
	}

	// skills-mcp-server returns `{ "skills": [Skill, ...] }`; we re-encode through our own struct so callers do not
	// see the markdown body or any future fields we have not opted into.
	var raw struct {
		Skills []struct {
			Name          string            `json:"name"`
			Description   string            `json:"description"`
			License       string            `json:"license,omitempty"`
			Compatibility string            `json:"compatibility,omitempty"`
			Metadata      map[string]string `json:"metadata,omitempty"`
			AllowedTools  string            `json:"allowedTools,omitempty"`
			UpdatedAt     time.Time         `json:"updatedAt"`
		} `json:"skills"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		writeJSONNoStore(w, http.StatusBadGateway, map[string]any{
			"error":        fmt.Sprintf("decode skills-mcp-server payload: %s", err.Error()),
			"upstreamBody": firstLine(string(body), 500),
		})
		return
	}

	out := agentSkillsListResponse{
		Source: base,
		Skills: make([]agentSkill, 0, len(raw.Skills)),
	}
	for _, sk := range raw.Skills {
		updated := ""
		if !sk.UpdatedAt.IsZero() {
			updated = sk.UpdatedAt.UTC().Format(time.RFC3339)
		}
		out.Skills = append(out.Skills, agentSkill{
			Name:          sk.Name,
			Description:   sk.Description,
			License:       sk.License,
			Compatibility: sk.Compatibility,
			Metadata:      sk.Metadata,
			AllowedTools:  sk.AllowedTools,
			UpdatedAt:     updated,
		})
	}
	writeJSONNoStore(w, http.StatusOK, out)
}

func firstLine(text string, max int) string {
	line := strings.SplitN(strings.TrimSpace(text), "\n", 2)[0]
	if len(line) > max {
		return line[:max] + "…"
	}
	return line
}
