package app

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

func (s *Server) hasAgentFactoryAuthority() bool {
	return strings.TrimSpace(s.cfg.AgentFactoryAdminBaseURL) != ""
}

// FireAgentFactoryChannelKnowledgeRefresh POSTs digest refresh for each Slack channel id (best-effort, async).
func (s *Server) FireAgentFactoryChannelKnowledgeRefresh(channelIDs []string) {
	if !s.hasAgentFactoryAuthority() {
		return
	}
	base := strings.TrimSuffix(strings.TrimSpace(s.cfg.AgentFactoryAdminBaseURL), "/")
	tok := strings.TrimSpace(s.cfg.AgentFactoryAdminToken)
	if base == "" || tok == "" {
		return
	}
	var ids []string
	seen := map[string]struct{}{}
	for _, id := range channelIDs {
		id = strings.TrimSpace(id)
		if id == "" || !ValidSlackChannelID(id) {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	if len(ids) == 0 {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
		defer cancel()
		client := &http.Client{Timeout: 12 * time.Minute}
		for _, id := range ids {
			u := base + "/v1/admin/channel-knowledge/" + url.PathEscape(id) + "/refresh"
			req, err := http.NewRequestWithContext(ctx, http.MethodPost, u, nil)
			if err != nil {
				continue
			}
			req.Header.Set("Authorization", "Bearer "+tok)
			req.Header.Set("Accept", "application/json")
			resp, err := client.Do(req)
			if err != nil {
				s.log.Printf("channel_knowledge_refresh proxy: channel=%s err=%v", id, err)
				continue
			}
			_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<20))
			_ = resp.Body.Close()
			if resp.StatusCode >= 300 {
				s.log.Printf("channel_knowledge_refresh proxy: channel=%s status=%d", id, resp.StatusCode)
			}
		}
	}()
}

func (s *Server) proxyAgentFactoryJSON(w http.ResponseWriter, r *http.Request, upstreamPath string) bool {
	if !s.hasAgentFactoryAuthority() {
		return false
	}
	base := strings.TrimSpace(s.cfg.AgentFactoryAdminBaseURL)
	if base == "" {
		return false
	}
	path := strings.TrimSpace(upstreamPath)
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	url := base + path
	if r != nil && r.URL != nil && r.URL.RawQuery != "" {
		url = url + "?" + r.URL.RawQuery
	}

	var body []byte
	if r != nil && r.Body != nil && (r.Method == http.MethodPost || r.Method == http.MethodPut || r.Method == http.MethodPatch) {
		raw, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
		if err != nil {
			writeJSONNoStore(w, http.StatusBadRequest, map[string]any{"error": "failed to read request body"})
			return true
		}
		body = raw
	}

	ctx := context.Background()
	if r != nil {
		ctx = r.Context()
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()

	method := http.MethodGet
	if r != nil && strings.TrimSpace(r.Method) != "" {
		method = strings.TrimSpace(r.Method)
	}
	req, err := http.NewRequestWithContext(ctx, method, url, bytes.NewReader(body))
	if err != nil {
		writeJSONNoStore(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return true
	}
	req.Header.Set("Accept", "application/json")
	if len(body) > 0 {
		req.Header.Set("Content-Type", "application/json")
	}
	if tok := strings.TrimSpace(s.cfg.AgentFactoryAdminToken); tok != "" {
		req.Header.Set("Authorization", "Bearer "+tok)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		writeJSONNoStore(w, http.StatusBadGateway, map[string]any{"error": fmt.Sprintf("agent-factory admin proxy failed: %v", err)})
		return true
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if ct := strings.ToLower(strings.TrimSpace(resp.Header.Get("Content-Type"))); strings.Contains(ct, "application/json") {
		var payload any
		if err := json.Unmarshal(raw, &payload); err == nil {
			writeJSONNoStore(w, resp.StatusCode, payload)
			return true
		}
	}
	msg := strings.TrimSpace(string(raw))
	if msg == "" {
		msg = http.StatusText(resp.StatusCode)
	}
	writeJSONNoStore(w, resp.StatusCode, map[string]any{"error": msg})
	return true
}
