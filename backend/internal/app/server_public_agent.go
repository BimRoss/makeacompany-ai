package app

import (
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

// publicAgentSitemapEntry is the minimal shape returned by the sitemap index
// endpoint — only what Next.js sitemap.ts needs to build the URL and set
// lastModified. No owner data, no content.
type publicAgentSitemapEntry struct {
	ID        string `json:"id"`
	CreatedAt string `json:"createdAt,omitempty"`
}

type publicAgentSitemapPayload struct {
	Agents []publicAgentSitemapEntry `json:"agents"`
}

type publicAgentSitemapCache struct {
	mu      sync.Mutex
	at      time.Time
	payload publicAgentSitemapPayload
	ok      bool
}

const publicAgentSitemapCacheTTL = 5 * time.Minute

var publicAgentSitemapMemo publicAgentSitemapCache

// handlePublicAgentSitemap serves a lightweight list of all installed, publicly-
// visible agent IDs for consumption by the frontend sitemap.ts. Only agents
// with visibility=public are included — unlisted agents are reachable by direct
// link but must not appear in the sitemap or be indexed. Cached for
// publicAgentSitemapCacheTTL to keep the Redis SCAN from firing on every
// Googlebot crawl.
func (s *Server) handlePublicAgentSitemap(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	publicAgentSitemapMemo.mu.Lock()
	fresh := publicAgentSitemapMemo.ok && time.Since(publicAgentSitemapMemo.at) < publicAgentSitemapCacheTTL
	cached := publicAgentSitemapMemo.payload
	publicAgentSitemapMemo.mu.Unlock()
	if fresh {
		writeJSON(w, http.StatusOK, cached)
		return
	}

	recs, err := s.store.ListPersonalAgents(r.Context())
	if err != nil {
		s.log.Printf("public-agent sitemap: %v", err)
		publicAgentSitemapMemo.mu.Lock()
		stale := publicAgentSitemapMemo.ok
		last := publicAgentSitemapMemo.payload
		publicAgentSitemapMemo.mu.Unlock()
		if stale {
			writeJSON(w, http.StatusOK, last)
			return
		}
		writeJSON(w, http.StatusOK, publicAgentSitemapPayload{Agents: []publicAgentSitemapEntry{}})
		return
	}

	entries := make([]publicAgentSitemapEntry, 0, len(recs))
	for _, rec := range recs {
		if rec.Status != PersonalAgentStatusInstalled {
			continue
		}
		if effectivePersonalAgentVisibility(rec.Visibility) != PersonalAgentVisibilityPublic {
			continue
		}
		entries = append(entries, publicAgentSitemapEntry{
			ID:        rec.ID,
			CreatedAt: strings.TrimSpace(rec.CreatedAt),
		})
	}

	payload := publicAgentSitemapPayload{Agents: entries}
	publicAgentSitemapMemo.mu.Lock()
	publicAgentSitemapMemo.payload = payload
	publicAgentSitemapMemo.at = time.Now()
	publicAgentSitemapMemo.ok = true
	publicAgentSitemapMemo.mu.Unlock()
	writeJSON(w, http.StatusOK, payload)
}

// PublicAgentProfile is the deliberately-narrow public face of a personal
// agent, served unauthenticated at GET /v1/personal-agents/{id}/public (#657).
//
// It is a hand-written allowlist, NOT a filtered PersonalAgentRecord. That is
// the whole point: a field added to the record later cannot silently leak to
// the public page, because nothing reaches this struct unless it is mapped
// here on purpose. Secrets (client secret, signing secret, knowledge token),
// the raw SystemPrompt, owner email, and the in-cluster service coordinates
// are never represented here under any setting.
type PublicAgentProfile struct {
	ID              string                  `json:"id"`
	DisplayName     string                  `json:"displayName"`
	Description     string                  `json:"description"`
	LongDescription string                  `json:"longDescription,omitempty"`
	AvatarURL       string                  `json:"avatarUrl,omitempty"`
	BuiltBy         string                  `json:"builtBy,omitempty"`
	CreatedAt       string                  `json:"createdAt,omitempty"`
	// Intelligence is the agent's "what it knows" showcase. Shown by default on
	// any public/unlisted agent that has harvested sources; nil/empty otherwise.
	// Carries the harvested source title + bullets, never the raw SystemPrompt.
	Intelligence []PublicAgentKnowledge `json:"intelligence,omitempty"`
	// InviteURL is the "Build your agent" CTA target. The canonical Slack
	// join link; true who-referred-whom capture on join is a follow-up.
	InviteURL string `json:"inviteUrl"`
}

// PublicAgentKnowledge is one curated knowledge block for the showcase. Source
// URL is intentionally omitted — we show what the agent learned, not where the
// owner sourced it from.
type PublicAgentKnowledge struct {
	Title   string   `json:"title,omitempty"`
	Bullets []string `json:"bullets,omitempty"`
}

// buildPublicAgentProfile maps an installed agent record to its public face.
// avatarURL and builtBy are resolved by the caller (one snapshot read) and
// passed in so this stays a pure, testable mapping with no Redis dependency —
// which is what the denylist test exercises.
func buildPublicAgentProfile(rec PersonalAgentRecord, avatarURL, builtBy, inviteURL string) PublicAgentProfile {
	p := PublicAgentProfile{
		ID:              rec.ID,
		DisplayName:     strings.TrimSpace(rec.DisplayName),
		Description:     strings.TrimSpace(rec.Description),
		LongDescription: strings.TrimSpace(rec.LongDescription),
		AvatarURL:       strings.TrimSpace(avatarURL),
		BuiltBy:         strings.TrimSpace(builtBy),
		CreatedAt:       strings.TrimSpace(rec.CreatedAt),
		InviteURL:       inviteURL,
	}
	// Intelligence shows by default on any agent the page is willing to render
	// (visibility gating already happened upstream). No per-agent opt-in: if the
	// agent learned something, the showcase says so.
	for _, src := range rec.YouTubeSources {
		title := strings.TrimSpace(src.Title)
		bullets := make([]string, 0, len(src.Bullets))
		for _, b := range src.Bullets {
			if b = strings.TrimSpace(b); b != "" {
				bullets = append(bullets, b)
			}
		}
		if title == "" && len(bullets) == 0 {
			continue
		}
		p.Intelligence = append(p.Intelligence, PublicAgentKnowledge{Title: title, Bullets: bullets})
	}
	return p
}

// handlePublicAgentProfile serves the unauthenticated showcase profile for one
// personal agent. 404 for anything not meant to be public: a missing agent, an
// agent that hasn't finished installing, or one whose visibility is private
// (the default). A 404 (not 403) is deliberate — we don't confirm that a
// private agent id exists.
func (s *Server) handlePublicAgentProfile(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	agentID := strings.TrimSpace(r.PathValue("id"))
	if agentID == "" {
		http.NotFound(w, r)
		return
	}
	rec, err := s.store.GetPersonalAgent(r.Context(), agentID)
	if errors.Is(err, redis.Nil) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		http.Error(w, "lookup failed", http.StatusInternalServerError)
		return
	}
	if rec.Status != PersonalAgentStatusInstalled {
		http.NotFound(w, r)
		return
	}
	if effectivePersonalAgentVisibility(rec.Visibility) == PersonalAgentVisibilityPrivate {
		http.NotFound(w, r)
		return
	}

	// The Slack workspace-users snapshot that used to resolve the bot avatar and
	// the owner's display name was retired, so the page renders with no avatar and
	// a generic "built by" — same fallback posture as the lander row.
	profile := buildPublicAgentProfile(rec, "", "", checkoutInviteURL)
	writeJSON(w, http.StatusOK, profile)
}
