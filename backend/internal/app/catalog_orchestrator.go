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

const (
	legacyDebugCatalogPath = "/debug/capability-catalog"
	publicCatalogV1Path    = "/v1/public/capability-catalog"
)

// FetchCapabilityCatalogFromOrchestrator performs GET rawURL (typically slack-orchestrator
// GET /v1/public/capability-catalog).
func FetchCapabilityCatalogFromOrchestrator(ctx context.Context, rawURL string) (CapabilityCatalog, error) {
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" {
		return CapabilityCatalog{}, fmt.Errorf("orchestrator catalog url empty")
	}
	catalog, status, err := fetchCapabilityCatalogFromURL(ctx, rawURL)
	if err == nil {
		return catalog, nil
	}
	// Backward compatibility for old defaults that still point at /debug/capability-catalog.
	if status == http.StatusNotFound && strings.Contains(rawURL, legacyDebugCatalogPath) {
		fallbackURL := strings.Replace(rawURL, legacyDebugCatalogPath, publicCatalogV1Path, 1)
		catalog, _, fallbackErr := fetchCapabilityCatalogFromURL(ctx, fallbackURL)
		if fallbackErr == nil {
			return catalog, nil
		}
		return CapabilityCatalog{}, fmt.Errorf("%v (fallback %s failed: %v)", err, fallbackURL, fallbackErr)
	}
	return CapabilityCatalog{}, err
}

func fetchCapabilityCatalogFromURL(ctx context.Context, rawURL string) (CapabilityCatalog, int, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return CapabilityCatalog{}, 0, err
	}

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return CapabilityCatalog{}, 0, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return CapabilityCatalog{}, resp.StatusCode, err
	}
	if resp.StatusCode != http.StatusOK {
		snippet := strings.TrimSpace(string(body))
		if len(snippet) > 240 {
			snippet = snippet[:240] + "…"
		}
		return CapabilityCatalog{}, resp.StatusCode, fmt.Errorf("orchestrator catalog http %d: %s", resp.StatusCode, snippet)
	}
	var c CapabilityCatalog
	if err := json.Unmarshal(body, &c); err != nil {
		return CapabilityCatalog{}, resp.StatusCode, fmt.Errorf("decode catalog json: %w", err)
	}
	c.Source = "slack-orchestrator"
	return c, resp.StatusCode, nil
}
