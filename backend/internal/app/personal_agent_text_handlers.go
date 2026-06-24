package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// textSuggestRequest is the body shape for /text-suggest. Field selects which
// copy slot the suggestion is for; the other current values give Gemini
// context so suggestions stay coherent (don't propose a name that conflicts
// with the current description, etc).
type textSuggestRequest struct {
	Field           string `json:"field"` // "name" | "description" | "longDescription" | "systemPrompt"
	Name            string `json:"name,omitempty"`
	Description     string `json:"description,omitempty"`
	LongDescription string `json:"longDescription,omitempty"`
	SystemPrompt    string `json:"systemPrompt,omitempty"`
	// Owner context so suggestions can name-drop the human ("Grant's
	// dedicated agent…") instead of generic "the user's agent".
	OwnerName        string `json:"ownerName,omitempty"`
	OwnerSlackUserID string `json:"ownerSlackUserId,omitempty"`
	// Optional staged-icon bytes. When the user has picked a new icon but
	// hasn't synced it yet, the frontend forwards the base64 here so a
	// system-prompt suggestion reflects the visual they're about to ship,
	// not the stale live one. Both fields must be set or both empty.
	IconBase64   string `json:"iconBase64,omitempty"`
	IconMimeType string `json:"iconMimeType,omitempty"`
}

type textSuggestResponse struct {
	Text string `json:"text"`
}

// handleSuggestPersonalAgentText returns a Gemini-2.5-flash suggestion for
// the requested copy slot. Gated on the /me session; same auth shape as the
// rest of /v1/me/personal-agents/*.
func (s *Server) handleSuggestPersonalAgentText(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if s.geminiText == nil || s.geminiText.Disabled() {
		http.Error(w, "text generation disabled (GEMINI_API_KEY missing)", http.StatusServiceUnavailable)
		return
	}
	session, err := s.store.GetPortalSession(r.Context(), tokenFromAuthHeader(r))
	if err != nil || session.TenantType != PortalTenantTypeUser {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	var req textSuggestRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid json", http.StatusBadRequest)
		return
	}
	field := strings.ToLower(strings.TrimSpace(req.Field))

	// Best-effort icon caption for the system-prompt field — gives the
	// persona suggestion something to riff on visually ("looks like a
	// stoic viking" → match the voice). Errors are swallowed; the prompt
	// just runs without the visual context.
	iconCaption := ""
	if field == "systemprompt" || field == "system_prompt" || field == "persona" {
		if c, err := s.captureAgentIconCaption(r.Context(), session.Email, req.IconBase64, req.IconMimeType); err != nil {
			s.log.Printf("agent-icon caption skipped: %v", err)
		} else {
			iconCaption = c
		}
	}

	prompt, maxTokens := personalAgentTextSuggestionPrompt(field, req, iconCaption)
	if prompt == "" {
		http.Error(w, "unknown field", http.StatusBadRequest)
		return
	}
	text, err := s.geminiText.Generate(r.Context(), prompt, maxTokens)
	if err != nil {
		s.log.Printf("gemini text suggest %q: %v", field, err)
		http.Error(w, "text generation failed: "+err.Error(), http.StatusBadGateway)
		return
	}
	writeJSON(w, http.StatusOK, textSuggestResponse{Text: sanitizeSuggestion(text)})
}

// captureAgentIconCaption returns a one-sentence description of the agent's
// current visual identity. Prefers staged bytes from the request (so unsaved
// icon edits get reflected), then falls back to the live Slack icon. Returns
// ("", nil) when no source is available — caller treats as best-effort.
func (s *Server) captureAgentIconCaption(ctx context.Context, email, stagedB64, stagedMime string) (string, error) {
	if s.geminiText == nil || s.geminiText.Disabled() {
		return "", nil
	}

	// Staged bytes win — they're what the user is about to push.
	if strings.TrimSpace(stagedB64) != "" {
		data, err := base64.StdEncoding.DecodeString(strings.TrimSpace(stagedB64))
		if err != nil {
			return "", fmt.Errorf("decode staged icon: %w", err)
		}
		mime := strings.TrimSpace(stagedMime)
		if mime == "" {
			mime = "image/png"
		}
		return s.geminiText.DescribeImage(ctx, data, mime)
	}

	// Fall back to whatever is currently in Slack. This is best-effort visual
	// context for a suggestion, so when the owner has more than one agent (and
	// the request didn't stage icon bytes) we can't tell which to caption —
	// skip rather than guess. Single-agent owners keep the old behavior.
	slackUserID, err := s.store.SlackUserIDByProfileEmail(ctx, email)
	if err != nil || strings.TrimSpace(slackUserID) == "" {
		return "", nil
	}
	agents, err := s.store.ListPersonalAgentsByOwner(ctx, slackUserID)
	if err != nil {
		return "", err
	}
	if len(agents) != 1 {
		return "", nil
	}
	rec := agents[0]
	if s.personalAgent == nil || s.personalAgent.Disabled() {
		return "", nil
	}
	botToken, err := s.personalAgent.ReadAgentBotToken(ctx, rec.ID)
	if err != nil {
		return "", err
	}
	botUserID := strings.TrimSpace(rec.BotUserID)
	if botUserID == "" {
		resolved, terr := slackAuthTestUserID(ctx, botToken)
		if terr != nil {
			return "", terr
		}
		botUserID = resolved
	}
	imageURL, err := slackUserProfileImageURL(ctx, botToken, botUserID)
	if err != nil || strings.TrimSpace(imageURL) == "" {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, imageURL, nil)
	if err != nil {
		return "", err
	}
	httpClient := &http.Client{Timeout: 15 * time.Second}
	resp, err := httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("agent icon status %d", resp.StatusCode)
	}
	bodyBytes, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return "", err
	}
	mime := strings.TrimSpace(resp.Header.Get("Content-Type"))
	if mime == "" {
		mime = "image/png"
	}
	return s.geminiText.DescribeImage(ctx, bodyBytes, mime)
}

func personalAgentTextSuggestionPrompt(field string, req textSuggestRequest, iconCaption string) (string, int) {
	name := strings.TrimSpace(req.Name)
	description := strings.TrimSpace(req.Description)
	long := strings.TrimSpace(req.LongDescription)
	sys := strings.TrimSpace(req.SystemPrompt)
	owner := strings.TrimSpace(req.OwnerName)
	ownerFirst := firstWord(owner)
	ownerLine := ""
	if owner != "" {
		ownerLine = fmt.Sprintf(" The agent's sole owner is named %q — reference them by first name (%q) when natural.", owner, ownerFirst)
	}
	ctx := fmt.Sprintf(
		"Current name: %q. Current short description: %q. Current long description: %q. Current persona/system prompt: %q.",
		valueOrDash(name), valueOrDash(description), valueOrDash(long), valueOrDash(sys))

	switch field {
	case "name":
		return "You are naming a user's personal AI agent that lives in their Slack DM. " +
			ctx + " The name should feel like a trusted human sidekick — one memorable word, 1-2 syllables, easy to @mention. " +
			"Good examples: Garth, Atlas, Nova, Sage, Echo, Vega. Avoid: 'Assistant', 'Bot', 'AI', anything with punctuation or numbers. " +
			"If the existing description/persona hints at a vibe, lean into it. Reply with just the name, nothing else.", 30

	case "description":
		ownerHint := "the owner"
		if ownerFirst != "" {
			ownerHint = ownerFirst
		}
		seed := description
		if seed == "" {
			seed = long
		}
		seedLine := ""
		if seed != "" {
			seedLine = fmt.Sprintf(" The user already typed %q — sharpen it, expand it, don't replace the intent.", seed)
		}
		return "You are writing the one-line Slack-app short description for a user's personal AI agent." +
			ownerLine + " " + ctx + seedLine +
			fmt.Sprintf(" Output a single substantive line of 60-110 characters (12-20 words). Anchor on the owner — patterns like \"%s's personal AI agent for X\" or \"%s's <role> in Slack\" work well. ", ownerHint, ownerHint) +
			"Ban generic phrases: 'AI assistant', 'helpful bot', 'powered by'. " +
			"HARD FLOOR: at least 60 characters. A short fragment like just the name is a failure — name the role AND the value. " +
			"Reply with just the description — no quotes, no period if it reads better without.", 256

	case "longdescription", "long_description", "longdesc":
		seedLine := ""
		switch {
		case long != "":
			seedLine = fmt.Sprintf(" The user already typed %q — rewrite it richer and longer (must end up 250+ chars), preserving their intent. Don't just polish — EXPAND with specificity.", long)
		case description != "":
			seedLine = fmt.Sprintf(" Use the existing short description as the seed and expand it substantially: %q. Reuse its angle and specificity, then go deeper.", description)
		case name != "":
			seedLine = fmt.Sprintf(" Only the name %q exists so far — invent a coherent role from it with concrete detail.", name)
		}
		return "You are writing the long-form Slack-app description for a user's personal AI agent. " +
			"HARD REQUIREMENT: between 250 and 450 characters (roughly 40-75 words) — count carefully, under 250 is a failure and will be rejected." +
			ownerLine + " " + ctx + seedLine +
			" Write 3-4 specific sentences covering: (1) what the agent does for its owner day-to-day, (2) what tone/voice it uses, (3) one concrete example of help it provides, and (4) what makes it distinct from a generic chatbot. " +
			"Be specific, not vague — name actual workflows, decisions, or moments the agent shows up in. " +
			"Reply with just the description — no quotes, no markdown. Remember the 250-character floor.", 768

	case "systemprompt", "system_prompt", "persona":
		seedLine := ""
		if sys != "" {
			seedLine = fmt.Sprintf(" The user already wrote a draft persona — refine and EXPAND it, don't discard or shrink: %q.", sys)
		} else {
			parts := []string{}
			if name != "" {
				parts = append(parts, fmt.Sprintf("name %q", name))
			}
			if description != "" {
				parts = append(parts, fmt.Sprintf("short description %q", description))
			}
			if long != "" {
				parts = append(parts, fmt.Sprintf("long description %q", long))
			}
			if len(parts) > 0 {
				seedLine = " Build the persona to be coherent with the other fields the user has set: " + strings.Join(parts, "; ") + "."
			}
		}
		iconLine := ""
		if strings.TrimSpace(iconCaption) != "" {
			iconLine = fmt.Sprintf(" The agent's current Slack icon looks like: %s. Let the visual inform the personality — a stoic portrait → measured tone, a playful mascot → looser tone, etc.", strings.TrimSpace(iconCaption))
		}
		return "You are writing the system prompt / persona for a user's personal AI agent — the durable description of how the agent should behave when answering its owner in Slack." +
			ownerLine + " " + ctx + seedLine + iconLine +
			" Write a substantive persona paragraph: 6-10 sentences, 600-900 characters total. Cover: voice/tone (with examples), how it approaches problems, what kinds of help it is for, what it refuses or pushes back on, any non-negotiable rules, and one signature mannerism. " +
			"HARD FLOOR: at least 500 characters. A short paragraph is a failure — the persona needs enough specificity that the agent's voice is unmistakable. " +
			"Address the agent in the second person ('You are…'). Reply with just the persona text — no preface, no quotes, no markdown headings.", 1024

	default:
		return "", 0
	}
}

func firstWord(s string) string {
	s = strings.TrimSpace(s)
	if i := strings.IndexAny(s, " \t"); i >= 0 {
		return s[:i]
	}
	return s
}

func valueOrDash(s string) string {
	if s == "" {
		return "—"
	}
	return s
}

// sanitizeSuggestion strips any leading/trailing quotes or markdown the model
// tends to wrap around short outputs, so the value drops straight into the
// form field without surprise characters.
func sanitizeSuggestion(s string) string {
	s = strings.TrimSpace(s)
	for {
		trimmed := s
		trimmed = strings.TrimPrefix(trimmed, "**")
		trimmed = strings.TrimSuffix(trimmed, "**")
		trimmed = strings.TrimPrefix(trimmed, "\"")
		trimmed = strings.TrimSuffix(trimmed, "\"")
		trimmed = strings.TrimPrefix(trimmed, "'")
		trimmed = strings.TrimSuffix(trimmed, "'")
		trimmed = strings.TrimSpace(trimmed)
		if trimmed == s {
			break
		}
		s = trimmed
	}
	return s
}
