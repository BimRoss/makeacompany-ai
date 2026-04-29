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

const orchestratorMemberChannelsPath = "/v1/public/member-channels"

// FetchOrchestratorMemberChannels returns the raw JSON body from slack-orchestrator GET /v1/public/member-channels.
func FetchOrchestratorMemberChannels(ctx context.Context, baseURL, bearerToken string) ([]byte, error) {
	base := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if base == "" {
		return nil, fmt.Errorf("orchestrator base URL is empty")
	}
	u, err := url.Parse(base + orchestratorMemberChannelsPath)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	if t := strings.TrimSpace(bearerToken); t != "" {
		req.Header.Set("Authorization", "Bearer "+t)
	}
	client := &http.Client{Timeout: 120 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	body, err := io.ReadAll(io.LimitReader(res.Body, 8<<20))
	if err != nil {
		return nil, err
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		msg := strings.TrimSpace(string(body))
		if len(msg) > 500 {
			msg = msg[:500]
		}
		return nil, fmt.Errorf("orchestrator member-channels: HTTP %d: %s", res.StatusCode, msg)
	}
	var probe map[string]any
	if err := json.Unmarshal(body, &probe); err != nil {
		return nil, fmt.Errorf("orchestrator member-channels: invalid JSON: %w", err)
	}
	chRaw, ok := probe["channels"]
	if !ok {
		return nil, fmt.Errorf("orchestrator member-channels: missing channels field")
	}
	if chRaw == nil {
		return body, nil
	}
	if _, isArr := chRaw.([]any); !isArr {
		return nil, fmt.Errorf("orchestrator member-channels: channels must be an array")
	}
	return body, nil
}

// OrchestratorMemberChannelCount returns len(channels) from orchestrator member-channels JSON, or -1 if invalid.
func OrchestratorMemberChannelCount(orchestratorJSON []byte) int {
	var v struct {
		Channels []any `json:"channels"`
	}
	if err := json.Unmarshal(orchestratorJSON, &v); err != nil {
		return -1
	}
	return len(v.Channels)
}
