package app

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// handleInternalIngestUserEngagement accepts batched Slack message events
// from Ross / Joanne pods and writes per-(user, day) engagement counters.
// Auth via internalServiceBearer; admin-session fallback is intentionally
// NOT allowed because this endpoint mutates aggregate counters.
//
// Wire shape mirrors claude-code-core/engagement.wireBatch.
type ingestUserEngagementRequest struct {
	Bot    string                           `json:"bot"`
	Events []ingestUserEngagementWireEvent `json:"events"`
}

type ingestUserEngagementWireEvent struct {
	WorkspaceID string `json:"workspace_id"`
	SlackUserID string `json:"slack_user_id"`
	ChannelID   string `json:"channel_id"`
	ChannelType string `json:"channel_type,omitempty"`
	MessageTS   string `json:"message_ts,omitempty"`
	OccurredAt  string `json:"occurred_at"`
	MentionsBot bool   `json:"mentions_bot"`
}

func (s *Server) handleInternalIngestUserEngagement(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.internalServiceBearerAuthorized(r) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	var req ingestUserEngagementRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid json: " + err.Error()})
		return
	}
	bot := strings.ToLower(strings.TrimSpace(req.Bot))
	if bot != "ross" && bot != "joanne" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "bot must be ross or joanne"})
		return
	}
	if len(req.Events) == 0 {
		writeJSON(w, http.StatusOK, map[string]any{"ingested": 0})
		return
	}
	// Hard cap matches engagement.Recorder's default BatchSize *2 — a
	// safety net against runaway clients, not a normal-path constraint.
	if len(req.Events) > 200 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "too many events in one batch"})
		return
	}
	ingest := make([]IngestEvent, 0, len(req.Events))
	for _, ev := range req.Events {
		if ev.SlackUserID == "" {
			continue
		}
		var ts time.Time
		if ev.OccurredAt != "" {
			if t, err := time.Parse(time.RFC3339, ev.OccurredAt); err == nil {
				ts = t
			}
		}
		if ts.IsZero() {
			ts = time.Now().UTC()
		}
		ingest = append(ingest, IngestEvent{
			WorkspaceID: ev.WorkspaceID,
			SlackUserID: ev.SlackUserID,
			ChannelID:   ev.ChannelID,
			ChannelType: ev.ChannelType,
			MessageTS:   ev.MessageTS,
			OccurredAt:  ts,
			MentionsBot: ev.MentionsBot,
		})
	}
	// Legacy per-bot counters (kept for one release for safety, reads
	// no longer use them). Real path is the dedup store below.
	if err := s.store.IngestUserEngagementBatch(r.Context(), bot, ingest); err != nil {
		s.log.Printf("ingest user engagement (legacy): %v", err)
	}
	if err := s.store.IngestUserMessagesBatch(r.Context(), ingest); err != nil {
		s.log.Printf("ingest user messages: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "store error"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ingested": len(ingest)})
}

// handleAdminUserEngagement returns a single user's engagement summary plus
// 30-day sparkline. Path: /v1/admin/user-engagement/{slackUserId}.
func (s *Server) handleAdminUserEngagement(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	ok, unavailable := s.adminReadAuthorized(r)
	if !ok {
		if unavailable {
			http.Error(w, "service unavailable", http.StatusServiceUnavailable)
			return
		}
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	slackUserID := r.PathValue("slackUserId")
	if slackUserID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "slackUserId required"})
		return
	}
	summary, err := s.store.LoadUserMessages(r.Context(), slackUserID)
	if err != nil {
		s.log.Printf("load user messages %s: %v", slackUserID, err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "store error"})
		return
	}
	writeJSONNoStore(w, http.StatusOK, summary)
}

// handleAdminUserEngagementTop returns the top-N users by total_messages.
// Used by the /admin list endpoint to power the sortable "messages" column
// without N round-trips per row.
func (s *Server) handleAdminUserEngagementTop(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	ok, unavailable := s.adminReadAuthorized(r)
	if !ok {
		if unavailable {
			http.Error(w, "service unavailable", http.StatusServiceUnavailable)
			return
		}
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	limit := 100
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 && n <= 500 {
			limit = n
		}
	}
	top, err := s.store.TopUsersByMessages(r.Context(), limit)
	if err != nil {
		s.log.Printf("top users by messages: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "store error"})
		return
	}
	writeJSONNoStore(w, http.StatusOK, map[string]any{"users": top, "limit": limit})
}
