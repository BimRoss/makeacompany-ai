package app

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// Fence markers used by the legacy frontend ingest flow to bake harvested
// YouTube bullets into rec.SystemPrompt as a JSON-encoded block. Kept in sync
// with src/components/me/me-personal-agent-youtube-ingest.tsx — the Go side
// strips them so harvested content cannot reach the agent's system prompt
// even when stored data still carries the fence from before #605.
const (
	youtubeIntelFenceStart = "<!-- yt-intel-start -->"
	youtubeIntelFenceEnd   = "<!-- yt-intel-end -->"
)

// stripYouTubeIntelFence returns the input with any yt-intel fenced block
// removed. Idempotent and safe on input with no fence.
func stripYouTubeIntelFence(prompt string) string {
	start := strings.Index(prompt, youtubeIntelFenceStart)
	end := strings.Index(prompt, youtubeIntelFenceEnd)
	if start < 0 || end < 0 || end < start {
		return prompt
	}
	before := strings.TrimRight(prompt[:start], " \t\r\n")
	after := strings.TrimLeft(prompt[end+len(youtubeIntelFenceEnd):], " \t\r\n")
	if before == "" {
		return after
	}
	if after == "" {
		return before
	}
	return before + "\n\n" + after
}

// MaxPersonalityChars caps the user-typed persona that drives every spawn.
// Personality is small-and-always-on; harvested intelligence belongs in a
// lazy-loaded tool, not the system prompt (see #605). Bumped 600 → 1500 after
// the first real operator persona blew the original cap.
const MaxPersonalityChars = 1500

// renderPersonalAgentRuntimePrompt returns the value the per-agent K8s Secret
// should carry under PERSONAL_AGENT_SYSTEM_PROMPT. It is the user-typed
// persona, stripped of any legacy yt-intel fenced bullets. Harvested
// YouTubeSources are no longer rendered into the prompt; the agent fetches
// them on demand via a lazy-load tool so transcript content can't bind as
// system instructions.
func renderPersonalAgentRuntimePrompt(rec PersonalAgentRecord) string {
	return strings.TrimSpace(stripYouTubeIntelFence(rec.SystemPrompt))
}

type addPersonalAgentYouTubeSourceRequest struct {
	URL     string   `json:"url"`
	Title   string   `json:"title,omitempty"`
	Bullets []string `json:"bullets"`
}

// handleAddPersonalAgentYouTubeSource accepts a pre-harvested YouTube source
// (URL + title + bullets) from the Next.js ingest route, persists it onto the
// agent record, re-renders the runtime system prompt with the new bullets
// folded in, and rolls the agent's dispatcher pod so the next inbound Slack
// message sees the updated persona.
//
// Why pre-harvested instead of doing fetch+extract here: the transcript fetch
// + LLM extraction lives in the Next.js layer (one-process, easier streaming
// SSE back to the browser). The Go side stays the durable-state owner.
func (s *Server) handleAddPersonalAgentYouTubeSource(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	rec, status, err := s.ownerPersonalAgentForRequest(r)
	if err != nil {
		http.Error(w, err.Error(), status)
		return
	}

	var req addPersonalAgentYouTubeSourceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	url := strings.TrimSpace(req.URL)
	if url == "" {
		http.Error(w, "url required", http.StatusBadRequest)
		return
	}
	// Filter empty bullets defensively — the extractor sometimes emits a
	// trailing blank, and renderPersonalAgentRuntimePrompt would skip it
	// anyway but counting them on the record reads weird.
	bullets := make([]string, 0, len(req.Bullets))
	for _, b := range req.Bullets {
		if t := strings.TrimSpace(b); t != "" {
			bullets = append(bullets, t)
		}
	}
	if len(bullets) == 0 {
		http.Error(w, "bullets required", http.StatusBadRequest)
		return
	}

	source := PersonalAgentYouTubeSource{
		URL:        url,
		Title:      strings.TrimSpace(req.Title),
		Bullets:    bullets,
		IngestedAt: time.Now().UTC().Format(time.RFC3339),
	}
	updated, err := s.store.AppendPersonalAgentYouTubeSource(r.Context(), rec.ID, source)
	if err != nil {
		s.log.Printf("append youtube source: %v", err)
		http.Error(w, "persist failed", http.StatusInternalServerError)
		return
	}

	s.applyPersonalAgentRuntimePrompt(r, updated)

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":             true,
		"youtubeSources": updated.YouTubeSources,
	})
}

type removePersonalAgentYouTubeSourceRequest struct {
	URL string `json:"url"`
}

// handleRemovePersonalAgentYouTubeSource drops a source by URL, then re-renders
// + rolls. Idempotent: removing an unknown URL returns 200 with the current
// list so the UI can reconcile.
func (s *Server) handleRemovePersonalAgentYouTubeSource(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	rec, status, err := s.ownerPersonalAgentForRequest(r)
	if err != nil {
		http.Error(w, err.Error(), status)
		return
	}
	var req removePersonalAgentYouTubeSourceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	url := strings.TrimSpace(req.URL)
	if url == "" {
		http.Error(w, "url required", http.StatusBadRequest)
		return
	}

	updated, err := s.store.RemovePersonalAgentYouTubeSource(r.Context(), rec.ID, url)
	if err != nil {
		s.log.Printf("remove youtube source: %v", err)
		http.Error(w, "persist failed", http.StatusInternalServerError)
		return
	}

	s.applyPersonalAgentRuntimePrompt(r, updated)

	writeJSON(w, http.StatusOK, map[string]any{
		"ok":             true,
		"youtubeSources": updated.YouTubeSources,
	})
}

// applyPersonalAgentRuntimePrompt re-renders the combined SystemPrompt + YouTube
// bullets onto the K8s Secret and rolls the deployment. Failures are logged
// but not propagated — the Redis write already landed, so a transient K8s
// hiccup shouldn't fail the user's add/remove call.
func (s *Server) applyPersonalAgentRuntimePrompt(r *http.Request, rec PersonalAgentRecord) {
	if s.personalAgent == nil || s.personalAgent.Disabled() {
		return
	}
	rendered := renderPersonalAgentRuntimePrompt(rec)
	if err := s.personalAgent.PatchAgentSystemPrompt(r.Context(), rec.OwnerSlackUserID, rendered); err != nil {
		s.log.Printf("patch runtime prompt for %s: %v", rec.OwnerSlackUserID, err)
		return
	}
	if err := s.personalAgent.RestartAgentDeployment(r.Context(), rec.OwnerSlackUserID); err != nil {
		s.log.Printf("restart agent deployment for %s: %v", rec.OwnerSlackUserID, err)
	}
}

// Ensure the fmt import isn't unused if a future cleanup strips error
// formatting (kept defensively — used for log lines via Printf).
var _ = fmt.Sprintf
