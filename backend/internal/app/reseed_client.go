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
	"time"
)

// reseed_client.go talks to the per-pod admin HTTP surface that the
// claude-code-ross binary exposes on :8092 (#287, claude-code-ross#305).
// One client per agent (ross / joanne) so a future bulk-reseed can fan
// out across both pods.

// RossAdminClient calls into a single claude-code-ross-style pod's
// /admin/* endpoints. Same shape works for the joanne pod since the
// HTTP surface is symmetric.
type RossAdminClient struct {
	baseURL string
	token   string
	http    *http.Client
}

// ReseedResult mirrors the JSON the ross pod emits. Schema is pinned by
// claude-code-ross/cmd/ross/reseed.go.
type ReseedResult struct {
	Workspace          string         `json:"workspace"`
	ChannelID          string         `json:"channel_id"`
	CurrentSeedVersion string         `json:"current_seed_version"`
	StampedSeedVersion string         `json:"stamped_seed_version"`
	DryRun             bool           `json:"dry_run"`
	NoOp               bool           `json:"no_op"`
	Changes            []ReseedChange `json:"changes"`
	SnapshotPath       string         `json:"snapshot_path,omitempty"`
	StampedTo          string         `json:"stamped_to,omitempty"`
}

type ReseedChange struct {
	Kind    string `json:"kind"`
	Name    string `json:"name,omitempty"`
	Summary string `json:"summary,omitempty"`
}

// ErrWorkspaceNotFound is returned for channel IDs that the ross pod
// has never provisioned a PVC subdirectory for. The bulk-reseed
// orchestrator treats this as "skip, not an error."
var ErrWorkspaceNotFound = errors.New("workspace not found on agent pod")

// NewRossAdminClient returns nil when baseURL or token is empty. Callers
// must Disabled-check before use so dev pods running without the wiring
// fall through cleanly. (Mirrors AgentToggleClient.)
func NewRossAdminClient(baseURL, token string) *RossAdminClient {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	token = strings.TrimSpace(token)
	if baseURL == "" || token == "" {
		return nil
	}
	return &RossAdminClient{
		baseURL: baseURL,
		token:   token,
		http:    &http.Client{Timeout: 30 * time.Second},
	}
}

func (c *RossAdminClient) Disabled() bool { return c == nil }

// Reseed runs the ross-side headless reseed against one channel
// workspace. dryRun=true reports the would-be changes without writing.
func (c *RossAdminClient) Reseed(ctx context.Context, channelID string, dryRun bool) (*ReseedResult, error) {
	if c.Disabled() {
		return nil, errors.New("ross admin client disabled (ROSS_ADMIN_URL / ROSS_ADMIN_TOKEN unset)")
	}
	body, _ := json.Marshal(map[string]any{
		"channel_id": channelID,
		"dry_run":    dryRun,
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/admin/reseed", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("ross admin reseed: %w", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	switch resp.StatusCode {
	case http.StatusOK:
		var out ReseedResult
		if err := json.Unmarshal(raw, &out); err != nil {
			return nil, fmt.Errorf("decode reseed response: %w", err)
		}
		return &out, nil
	case http.StatusNotFound:
		return nil, ErrWorkspaceNotFound
	default:
		msg := strings.TrimSpace(string(raw))
		if msg == "" {
			msg = resp.Status
		}
		return nil, fmt.Errorf("ross admin reseed: %s (%d)", msg, resp.StatusCode)
	}
}
