package app

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// handlePublicAgentsRoster proxies agents-mcp-server GET /api/roster (read-only, no auth).
func (s *Server) handlePublicAgentsRoster(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	base := strings.TrimSpace(s.cfg.AgentsMCPBaseURL)
	if base == "" {
		writeJSONNoStore(w, http.StatusServiceUnavailable, map[string]any{
			"error": "agents-mcp-server is not configured (AGENTS_MCP_BASE_URL)",
		})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()

	upstreamURL := strings.TrimRight(base, "/") + "/api/roster"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, upstreamURL, nil)
	if err != nil {
		writeJSONNoStore(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}
	req.Header.Set("Accept", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		writeJSONNoStore(w, http.StatusBadGateway, map[string]any{
			"error": fmt.Sprintf("agents-mcp-server unreachable: %s", err.Error()),
		})
		return
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 512<<10)) // 512 KiB cap
	if err != nil {
		writeJSONNoStore(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}
	if resp.StatusCode/100 != 2 {
		writeJSONNoStore(w, http.StatusBadGateway, map[string]any{
			"error":          "agents-mcp-server returned non-2xx",
			"upstreamStatus": resp.StatusCode,
			"upstreamBody":   firstLine(string(body), 500),
		})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "private, no-store, no-cache, must-revalidate, max-age=0")
	w.Header().Set("Pragma", "no-cache")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(body)
}
