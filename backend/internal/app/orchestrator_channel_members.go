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

const orchestratorChannelMembersPath = "/debug/channel-members"

// FetchOrchestratorChannelHumanUserIDs returns human_user_ids from slack-orchestrator
// GET /debug/channel-members?channel_id=C....
func FetchOrchestratorChannelHumanUserIDs(ctx context.Context, baseURL, bearerToken, channelID string) ([]string, error) {
	chID := strings.TrimSpace(channelID)
	if chID == "" {
		return nil, fmt.Errorf("channel id is empty")
	}
	base := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if base == "" {
		return nil, fmt.Errorf("orchestrator base URL is empty")
	}
	u, err := url.Parse(base + orchestratorChannelMembersPath)
	if err != nil {
		return nil, err
	}
	q := u.Query()
	q.Set("channel_id", chID)
	u.RawQuery = q.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	if t := strings.TrimSpace(bearerToken); t != "" {
		req.Header.Set("Authorization", "Bearer "+t)
	}
	client := &http.Client{Timeout: 90 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	body, err := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	if err != nil {
		return nil, err
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		msg := strings.TrimSpace(string(body))
		if len(msg) > 500 {
			msg = msg[:500]
		}
		return nil, fmt.Errorf("orchestrator channel-members %s: HTTP %d: %s", chID, res.StatusCode, msg)
	}
	var out struct {
		HumanUserIDs []string `json:"human_user_ids"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, fmt.Errorf("orchestrator channel-members %s: invalid JSON: %w", chID, err)
	}
	return out.HumanUserIDs, nil
}
