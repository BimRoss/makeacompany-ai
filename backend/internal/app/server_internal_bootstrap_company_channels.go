package app

import (
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"
)

const bootstrapChannelMembersConcurrency = 6

type orchMemberRow struct {
	ChannelID string `json:"channel_id"`
	Name      string `json:"name"`
}

// handleInternalBootstrapCompanyChannelsFromOrchestrator saves the Slack member-channels snapshot
// from slack-orchestrator and upserts employee-factory company channel registry rows (same data
// as /admin Companies discover), for local compose one-shots and CronJobs.
func (s *Server) handleInternalBootstrapCompanyChannelsFromOrchestrator(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.internalRefreshAuthorized(r) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	base := strings.TrimSpace(s.cfg.OrchestratorDebugBaseURL)
	if base == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "ORCHESTRATOR_DEBUG_BASE_URL is not set"})
		return
	}
	ctx := r.Context()
	body, err := FetchOrchestratorMemberChannels(ctx, base, s.cfg.OrchestratorDebugToken)
	if err != nil {
		s.log.Printf("bootstrap company channels: member-channels: %v", err)
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}
	fetchedAt := time.Now().UTC().Format(time.RFC3339)
	if err := s.store.SaveSlackMemberChannelsSnapshot(ctx, fetchedAt, body); err != nil {
		s.log.Printf("bootstrap company channels: save snapshot: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}

	var list struct {
		Channels []orchMemberRow `json:"channels"`
	}
	if err := json.Unmarshal(body, &list); err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": "invalid member-channels JSON: " + err.Error()})
		return
	}
	var work []orchMemberRow
	for _, ch := range list.Channels {
		if strings.TrimSpace(ch.ChannelID) == "" {
			continue
		}
		work = append(work, ch)
		if len(work) >= maxDiscoverChannels {
			break
		}
	}
	if len(work) == 0 {
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":                    true,
			"fetchedAt":             fetchedAt,
			"snapshot_saved":        true,
			"upserted_count":        0,
			"redisKey":              strings.TrimSpace(s.cfg.CompanyChannelsRedisKey),
			"member_channel_rows":   len(list.Channels),
			"discovered_for_upsert": 0,
		})
		return
	}

	inputs := make([]DiscoveredChannelInput, len(work))
	sem := make(chan struct{}, bootstrapChannelMembersConcurrency)
	var wg sync.WaitGroup
	for i := range work {
		i := i
		wg.Add(1)
		sem <- struct{}{}
		go func() {
			defer wg.Done()
			defer func() { <-sem }()
			ch := work[i]
			cid := strings.TrimSpace(ch.ChannelID)
			name := strings.TrimSpace(ch.Name)
			if name == "" {
				name = cid
			}
			ownerIDs, ferr := FetchOrchestratorChannelHumanUserIDs(ctx, base, s.cfg.OrchestratorDebugToken, cid)
			if ferr != nil {
				s.log.Printf("bootstrap company channels: channel-members %s: %v", cid, ferr)
			}
			inputs[i] = DiscoveredChannelInput{ChannelID: cid, Name: name, OwnerIDs: ownerIDs}
		}()
	}
	wg.Wait()

	touched, err := s.store.UpsertDiscoveredCompanyChannels(ctx, s.cfg.CompanyChannelsRedisKey, inputs)
	if err != nil {
		s.log.Printf("bootstrap company channels: upsert: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":                    true,
		"fetchedAt":             fetchedAt,
		"snapshot_saved":        true,
		"upserted":              touched,
		"upserted_count":        len(touched),
		"redisKey":              strings.TrimSpace(s.cfg.CompanyChannelsRedisKey),
		"member_channel_rows":   len(list.Channels),
		"discovered_for_upsert": len(inputs),
	})
}
