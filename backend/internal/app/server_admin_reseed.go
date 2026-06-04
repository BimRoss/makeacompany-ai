package app

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"
)

// server_admin_reseed.go exposes the bulk-reseed surface used by the
// /admin "Reseed all channels" button (BimRoss/makeacompany-ai#287).
// One channel and many-channel variants share the same per-channel
// fan-out so a single PR ships the read path the UI needs.

// reseedAllRequest is the body for POST /v1/admin/reseed-all. Empty body
// is also accepted — defaults apply.
type reseedAllRequest struct {
	DryRun      bool `json:"dry_run"`
	Concurrency int  `json:"concurrency,omitempty"` // optional, defaults / caps applied server-side
}

type reseedChannelResult struct {
	ChannelID   string         `json:"channelId"`
	Name        string         `json:"name,omitempty"`
	Status      string         `json:"status"` // applied | noop | dry_run | missing | error
	DryRun      bool           `json:"dryRun"`
	NoOp        bool           `json:"noOp,omitempty"`
	Changes     []ReseedChange `json:"changes,omitempty"`
	Error       string         `json:"error,omitempty"`
	StampedTo   string         `json:"stampedTo,omitempty"`
	DurationMS  int64          `json:"durationMs"`
}

type reseedAllSummary struct {
	Total    int `json:"total"`
	Applied  int `json:"applied"`
	NoOp     int `json:"noop"`
	DryRun   int `json:"dryRun"`
	Missing  int `json:"missing"`
	Errored  int `json:"errored"`
}

const (
	reseedDefaultConcurrency = 4
	reseedMaxConcurrency     = 16
)

// handleAdminReseed runs a single-channel reseed. Useful for the per-row
// "reseed this channel" button on /admin without paying for a full fan-
// out.
//
//	POST /v1/admin/reseed { "channel_id": "C0...", "dry_run": false }
func (s *Server) handleAdminReseed(w http.ResponseWriter, r *http.Request) {
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
	if s.rossAdmin.Disabled() {
		writeJSONNoStore(w, http.StatusServiceUnavailable, map[string]any{
			"error": "ross admin client disabled (ROSS_ADMIN_URL / ROSS_ADMIN_TOKEN unset)",
		})
		return
	}
	var req struct {
		ChannelID string `json:"channel_id"`
		DryRun    bool   `json:"dry_run"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	req.ChannelID = strings.TrimSpace(req.ChannelID)
	if req.ChannelID == "" {
		http.Error(w, "channel_id required", http.StatusBadRequest)
		return
	}
	res, err := s.rossAdmin.Reseed(r.Context(), req.ChannelID, req.DryRun)
	if err != nil {
		if errors.Is(err, ErrWorkspaceNotFound) {
			writeJSONNoStore(w, http.StatusNotFound, map[string]any{
				"error":     "workspace not found on agent pod",
				"channelId": req.ChannelID,
			})
			return
		}
		s.log.Printf("admin reseed %q by %q: %v", req.ChannelID, session.Email, err)
		writeJSONNoStore(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}
	s.log.Printf("audit: admin reseed channel=%s actor=%s dry_run=%t no_op=%t",
		req.ChannelID, session.Email, req.DryRun, res.NoOp)
	writeJSONNoStore(w, http.StatusOK, map[string]any{"result": res})
}

// handleAdminReseedAll enumerates Slack channels the bot is in and runs
// the per-channel reseed against each, in parallel with a small worker
// pool. Returns one row per channel so the UI can render success / no-op
// / missing / error distinctly.
//
//	POST /v1/admin/reseed-all { "dry_run": true, "concurrency": 4 }
func (s *Server) handleAdminReseedAll(w http.ResponseWriter, r *http.Request) {
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
	if s.rossAdmin.Disabled() {
		writeJSONNoStore(w, http.StatusServiceUnavailable, map[string]any{
			"error": "ross admin client disabled (ROSS_ADMIN_URL / ROSS_ADMIN_TOKEN unset)",
		})
		return
	}
	var req reseedAllRequest
	if r.ContentLength > 0 {
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "bad json", http.StatusBadRequest)
			return
		}
	}
	concurrency := req.Concurrency
	if concurrency <= 0 {
		concurrency = reseedDefaultConcurrency
	}
	if concurrency > reseedMaxConcurrency {
		concurrency = reseedMaxConcurrency
	}

	// 5m cap on the whole fan-out — comfortably above the per-call 30s
	// http timeout times any reasonable channel count, well under any
	// browser/ALB read timeout.
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Minute)
	defer cancel()

	channels, err := FetchSlackBotChannels(ctx, s.cfg.SlackBotToken)
	if err != nil {
		writeJSONNoStore(w, http.StatusBadGateway, map[string]any{
			"error": "fetch channels failed: " + err.Error(),
		})
		return
	}

	results := runBulkReseed(ctx, s.rossAdmin, channels, req.DryRun, concurrency)
	summary := summarizeReseedResults(results)

	s.log.Printf("audit: admin reseed-all actor=%s dry_run=%t total=%d applied=%d noop=%d missing=%d errored=%d",
		session.Email, req.DryRun, summary.Total, summary.Applied, summary.NoOp, summary.Missing, summary.Errored)

	writeJSONNoStore(w, http.StatusOK, map[string]any{
		"summary": summary,
		"results": results,
	})
}

// runBulkReseed is split out so it's straightforward to unit-test the
// fan-out logic against a stub client.
func runBulkReseed(ctx context.Context, client *RossAdminClient, channels []SlackChannel, dryRun bool, concurrency int) []reseedChannelResult {
	type job struct {
		idx int
		ch  SlackChannel
	}
	jobs := make(chan job)
	results := make([]reseedChannelResult, len(channels))

	var wg sync.WaitGroup
	for i := 0; i < concurrency; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := range jobs {
				start := time.Now()
				row := reseedChannelResult{
					ChannelID: j.ch.ChannelID,
					Name:      j.ch.Name,
					DryRun:    dryRun,
				}
				res, err := client.Reseed(ctx, j.ch.ChannelID, dryRun)
				row.DurationMS = time.Since(start).Milliseconds()
				switch {
				case errors.Is(err, ErrWorkspaceNotFound):
					row.Status = "missing"
				case err != nil:
					row.Status = "error"
					row.Error = err.Error()
				case dryRun:
					row.Status = "dry_run"
					row.NoOp = res.NoOp
					row.Changes = res.Changes
				case res.NoOp:
					row.Status = "noop"
					row.NoOp = true
				default:
					row.Status = "applied"
					row.Changes = res.Changes
					row.StampedTo = res.StampedTo
				}
				results[j.idx] = row
			}
		}()
	}
	for i, ch := range channels {
		select {
		case jobs <- job{idx: i, ch: ch}:
		case <-ctx.Done():
			close(jobs)
			wg.Wait()
			return results
		}
	}
	close(jobs)
	wg.Wait()
	// Stable sort: errors first, then missing, then applied, then noop,
	// then dry_run — so the UI surfaces what needs attention.
	sort.SliceStable(results, func(i, j int) bool {
		return statusRank(results[i].Status) < statusRank(results[j].Status)
	})
	return results
}

func statusRank(s string) int {
	switch s {
	case "error":
		return 0
	case "missing":
		return 1
	case "applied":
		return 2
	case "noop":
		return 3
	case "dry_run":
		return 4
	default:
		return 5
	}
}

func summarizeReseedResults(rs []reseedChannelResult) reseedAllSummary {
	var sum reseedAllSummary
	sum.Total = len(rs)
	for _, r := range rs {
		switch r.Status {
		case "applied":
			sum.Applied++
		case "noop":
			sum.NoOp++
		case "dry_run":
			sum.DryRun++
		case "missing":
			sum.Missing++
		case "error":
			sum.Errored++
		}
	}
	return sum
}
