package app

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// FetchCapabilityCatalogFromOrchestrator performs GET rawURL (typically slack-orchestrator
// GET /debug/capability-catalog). If bearerToken is set, it is sent as Authorization: Bearer
// for clusters where orchestrator debug routes require auth.
func FetchCapabilityCatalogFromOrchestrator(ctx context.Context, rawURL, bearerToken string) (CapabilityCatalog, error) {
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" {
		return CapabilityCatalog{}, fmt.Errorf("orchestrator catalog url empty")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return CapabilityCatalog{}, err
	}
	if token := strings.TrimSpace(bearerToken); token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return CapabilityCatalog{}, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return CapabilityCatalog{}, err
	}
	if resp.StatusCode != http.StatusOK {
		snippet := strings.TrimSpace(string(body))
		if len(snippet) > 240 {
			snippet = snippet[:240] + "…"
		}
		return CapabilityCatalog{}, fmt.Errorf("orchestrator catalog http %d: %s", resp.StatusCode, snippet)
	}
	var c CapabilityCatalog
	if err := json.Unmarshal(body, &c); err != nil {
		return CapabilityCatalog{}, fmt.Errorf("decode catalog json: %w", err)
	}
	c.Source = "slack-orchestrator"
	return c, nil
}
