package app

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
)

func (s *Server) handleInternalRefreshSlackMemberChannelsSnapshot(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.internalRefreshAuthorized(r) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if strings.TrimSpace(s.cfg.OrchestratorDebugBaseURL) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "ORCHESTRATOR_DEBUG_BASE_URL is not set (same base URL used for orchestrator member-channel reads)"})
		return
	}
	body, err := FetchOrchestratorMemberChannels(r.Context(), s.cfg.OrchestratorDebugBaseURL, s.cfg.OrchestratorDebugToken)
	if err != nil {
		s.writeSlackRefreshError(w, "member_channels", err)
		return
	}
	fetchedAt := time.Now().UTC().Format(time.RFC3339)
	if err := s.store.SaveSlackMemberChannelsSnapshot(r.Context(), fetchedAt, body); err != nil {
		s.recordSlackRefreshFailure("member_channels")
		s.log.Printf("save slack member channels snapshot: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	var meta struct {
		Channels  []json.RawMessage `json:"channels"`
		Truncated bool              `json:"truncated"`
	}
	_ = json.Unmarshal(body, &meta)
	s.recordSlackRefreshSuccess("member_channels")
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":          true,
		"fetchedAt":   fetchedAt,
		"channelRows": len(meta.Channels),
		"truncated":   meta.Truncated,
	})
}

// handleAdminSlackMemberChannels returns cached orchestrator member-channels JSON from Redis, or live upstream when source=live.
func (s *Server) handleAdminSlackMemberChannels(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	ok, svcUnavail := s.adminReadOrInternalServiceAuthorized(r)
	if !ok {
		if svcUnavail {
			http.Error(w, "admin auth disabled", http.StatusServiceUnavailable)
		} else {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
		}
		return
	}
	live := strings.EqualFold(strings.TrimSpace(r.URL.Query().Get("source")), "live")
	if live {
		s.writeAdminSlackMemberChannelsLive(w, r, "live")
		return
	}

	raw, err := s.store.GetSlackMemberChannelsSnapshotBytes(r.Context())
	if err != nil && !errors.Is(err, ErrSlackMemberChannelsSnapshotMissing) {
		s.log.Printf("admin slack member channels snapshot get: %v", err)
		writeJSONNoStore(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}

	missing := errors.Is(err, ErrSlackMemberChannelsSnapshotMissing)
	var env slackMemberChannelsSnapshotEnvelope
	parsed := false
	if !missing {
		if uerr := json.Unmarshal(raw, &env); uerr != nil {
			s.log.Printf("admin slack member channels snapshot parse envelope: %v", uerr)
			missing = true
		} else {
			parsed = true
		}
	}

	zeroChannels := false
	if parsed {
		n := OrchestratorMemberChannelCount([]byte(env.MemberChannels))
		zeroChannels = n == 0
	}

	// Cold path: empty/missing snapshot still yields an empty Companies strip; one-shot fill from orchestrator when configured.
	if (missing || zeroChannels) && strings.TrimSpace(s.cfg.OrchestratorDebugBaseURL) != "" {
		body, fetchErr := FetchOrchestratorMemberChannels(r.Context(), s.cfg.OrchestratorDebugBaseURL, s.cfg.OrchestratorDebugToken)
		if fetchErr != nil {
			s.log.Printf("admin slack member channels snapshot warm (orchestrator): %v", fetchErr)
		} else {
			fetchedAt := time.Now().UTC().Format(time.RFC3339)
			if svErr := s.store.SaveSlackMemberChannelsSnapshot(r.Context(), fetchedAt, body); svErr != nil {
				s.log.Printf("admin slack member channels snapshot warm save: %v", svErr)
			}
			resp, mErr := slackMemberChannelsResponseMap(fetchedAt, "live_warm", body)
			if mErr == nil {
				resp["snapshotNote"] = "Filled from slack-orchestrator (Redis snapshot was missing or had no channels)."
				writeJSONNoStore(w, http.StatusOK, resp)
				return
			}
		}
	}

	if missing && !parsed {
		writeJSONNoStore(w, http.StatusOK, map[string]any{
			"channels":     []any{},
			"truncated":    false,
			"source":       "snapshot",
			"fetchedAt":    nil,
			"snapshotNote": "No snapshot yet and orchestrator warm failed or is not configured. Set ORCHESTRATOR_DEBUG_BASE_URL on the backend, POST /v1/internal/refresh-slack-member-channels-snapshot, or open /admin with ?source=live on the member-channels API once.",
		})
		return
	}

	if !parsed {
		writeJSONNoStore(w, http.StatusInternalServerError, map[string]any{"error": "invalid slack member channels snapshot envelope"})
		return
	}
	resp, err := slackMemberChannelsResponseMap(env.FetchedAt, "snapshot", []byte(env.MemberChannels))
	if err != nil {
		writeJSONNoStore(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSONNoStore(w, http.StatusOK, resp)
}

func (s *Server) writeAdminSlackMemberChannelsLive(w http.ResponseWriter, r *http.Request, source string) {
	if strings.TrimSpace(s.cfg.OrchestratorDebugBaseURL) == "" {
		writeJSONNoStore(w, http.StatusBadRequest, map[string]any{"error": "ORCHESTRATOR_DEBUG_BASE_URL is not set"})
		return
	}
	body, err := FetchOrchestratorMemberChannels(r.Context(), s.cfg.OrchestratorDebugBaseURL, s.cfg.OrchestratorDebugToken)
	if err != nil {
		s.log.Printf("admin slack member channels live: %v", err)
		writeJSONNoStore(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}
	fetchedAt := time.Now().UTC().Format(time.RFC3339)
	resp, mErr := slackMemberChannelsResponseMap(fetchedAt, source, body)
	if mErr != nil {
		writeJSONNoStore(w, http.StatusBadGateway, map[string]any{"error": mErr.Error()})
		return
	}
	resp["snapshotNote"] = "Queried slack-orchestrator GET /v1/public/member-channels; snapshot written to Redis."
	if svErr := s.store.SaveSlackMemberChannelsSnapshot(r.Context(), fetchedAt, body); svErr != nil {
		s.log.Printf("admin slack member channels live save snapshot: %v", svErr)
		resp["redisSaveError"] = svErr.Error()
	}
	writeJSONNoStore(w, http.StatusOK, resp)
}

func slackMemberChannelsResponseMap(fetchedAt, source string, orchestratorJSON []byte) (map[string]any, error) {
	var m map[string]any
	if err := json.Unmarshal(orchestratorJSON, &m); err != nil {
		return nil, err
	}
	if m == nil {
		m = map[string]any{}
	}
	m["source"] = source
	m["fetchedAt"] = fetchedAt
	return m, nil
}
