package app

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/redis/go-redis/v9"
)

// handleSlackEventsGateway is the public ingress for inbound Slack events
// addressed to ANY personal-agent app. It routes by `api_app_id` extracted
// from the JSON payload to the right in-cluster Service, preserves the body
// + signing headers so the pod can verify locally, and proxies the response
// back.
//
// Path: /v1/slack/events (mounted at events.makeacompany.ai via ingress)
//
// Slack URL verification ("type":"url_verification") is handled here directly
// — Slack hits this URL during app setup before any agent record exists, so
// we echo the challenge ourselves rather than routing it.
func (s *Server) handleSlackEventsGateway(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		http.Error(w, "read body", http.StatusBadRequest)
		return
	}

	// URL verification — answer locally. Slack sends this once per app at
	// setup; we don't need the pod to be alive (it might not even be deployed
	// yet). Signing verification is NOT possible at gateway level for a
	// fresh app (we haven't stored its signing_secret yet via install), so
	// this is a small footgun: a hostile caller could spoof url_verification.
	// Mitigated by the fact that the response is the challenge they sent —
	// no leak, and Slack won't re-send a real one if we accept a fake one.
	var probe struct {
		Type      string `json:"type"`
		Challenge string `json:"challenge"`
		APIAppID  string `json:"api_app_id"`
	}
	if err := json.Unmarshal(body, &probe); err == nil && probe.Type == "url_verification" {
		w.Header().Set("Content-Type", "text/plain")
		_, _ = w.Write([]byte(probe.Challenge))
		return
	}

	apiAppID := strings.TrimSpace(probe.APIAppID)
	if apiAppID == "" {
		http.Error(w, "missing api_app_id", http.StatusBadRequest)
		return
	}

	rec, err := s.store.GetPersonalAgentByAppID(r.Context(), apiAppID)
	if errors.Is(err, redis.Nil) {
		s.log.Printf("slack events gateway: unknown app_id=%s", apiAppID)
		http.Error(w, "unknown app", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "lookup failed", http.StatusInternalServerError)
		return
	}
	if rec.ServiceName == "" || rec.ServiceNamespace == "" || rec.ServicePort == 0 {
		s.log.Printf("slack events gateway: no service binding for agent=%s app_id=%s", rec.ID, apiAppID)
		http.Error(w, "agent not yet routable", http.StatusServiceUnavailable)
		return
	}

	target := fmt.Sprintf("http://%s.%s.svc.cluster.local:%d/slack/events", rec.ServiceName, rec.ServiceNamespace, rec.ServicePort)
	forwardReq, err := http.NewRequestWithContext(r.Context(), http.MethodPost, target, bytes.NewReader(body))
	if err != nil {
		http.Error(w, "build forward request", http.StatusInternalServerError)
		return
	}
	// Preserve signing headers — pod verifies in-process, gateway is a
	// trustless router.
	for _, h := range []string{"X-Slack-Signature", "X-Slack-Request-Timestamp", "X-Slack-Retry-Num", "X-Slack-Retry-Reason", "Content-Type"} {
		if v := r.Header.Get(h); v != "" {
			forwardReq.Header.Set(h, v)
		}
	}
	resp, err := http.DefaultClient.Do(forwardReq)
	if err != nil {
		s.log.Printf("slack events gateway forward: %v", err)
		http.Error(w, "forward failed", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}
