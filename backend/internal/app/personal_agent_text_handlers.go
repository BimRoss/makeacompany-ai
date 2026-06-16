package app

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
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
	prompt, maxTokens := personalAgentTextSuggestionPrompt(field, req)
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

func personalAgentTextSuggestionPrompt(field string, req textSuggestRequest) (string, int) {
	name := strings.TrimSpace(req.Name)
	description := strings.TrimSpace(req.Description)
	long := strings.TrimSpace(req.LongDescription)
	sys := strings.TrimSpace(req.SystemPrompt)
	ctx := fmt.Sprintf(
		"Current name: %q. Current short description: %q. Current long description: %q. Current persona/system prompt: %q.",
		valueOrDash(name), valueOrDash(description), valueOrDash(long), valueOrDash(sys))
	switch field {
	case "name":
		return "You are writing the display name for a user's personal AI agent that lives in their Slack DM. " +
			ctx + " Suggest ONE short, memorable, friendly name (1-2 words, no punctuation, no quotes). " +
			"Reply with just the name, nothing else.", 30
	case "description":
		return "You are writing a one-line Slack-app short description for a user's personal AI agent. " +
			ctx + " Suggest ONE concise description (max 120 characters) that reads natural in a Slack app listing. " +
			"Avoid generic phrases like 'AI assistant'. Reply with just the description.", 80
	case "longdescription", "long_description", "longdesc":
		return "You are writing the long-form Slack-app description for a user's personal AI agent (175-450 characters). " +
			ctx + " Write 2-3 sentences explaining what the agent does for its owner. Friendly, specific. " +
			"Reply with just the description.", 220
	case "systemprompt", "system_prompt", "persona":
		return "You are writing the system prompt / persona for a user's personal AI agent — this is the durable description of how the agent should behave when answering its owner in Slack. " +
			ctx + " Write a focused persona paragraph (4-8 sentences, ~400-700 characters): cover voice/tone, how it should approach problems, what kinds of help it is for, and any non-negotiable rules. Address the agent in the second person ('You are…'). Reply with just the persona text — no preface, no quotes, no markdown headings.", 500
	default:
		return "", 0
	}
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
