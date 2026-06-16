package app

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// GeminiText is a thin client over Google's Generative Language API for
// short-form text generation (gemini-2.5-flash). Mirrors GeminiImagen's
// shape so both keep the same env var + base URL.
type GeminiText struct {
	apiKey  string
	model   string
	http    *http.Client
	baseURL string
}

const (
	defaultGeminiTextModel = "gemini-2.5-flash"
)

func NewGeminiText(apiKey string) *GeminiText {
	return &GeminiText{
		apiKey:  strings.TrimSpace(apiKey),
		model:   defaultGeminiTextModel,
		http:    &http.Client{Timeout: 30 * time.Second},
		baseURL: "https://generativelanguage.googleapis.com",
	}
}

func (g *GeminiText) Disabled() bool {
	return g == nil || g.apiKey == ""
}

type geminiGenerateContentRequest struct {
	Contents         []geminiContent       `json:"contents"`
	GenerationConfig geminiGenerationConfig `json:"generationConfig"`
}

type geminiContent struct {
	Role  string       `json:"role,omitempty"`
	Parts []geminiPart `json:"parts"`
}

type geminiPart struct {
	Text string `json:"text"`
}

type geminiGenerationConfig struct {
	Temperature     float64 `json:"temperature"`
	MaxOutputTokens int     `json:"maxOutputTokens"`
}

type geminiGenerateContentResponse struct {
	Candidates []struct {
		Content struct {
			Parts []geminiPart `json:"parts"`
		} `json:"content"`
	} `json:"candidates"`
	PromptFeedback struct {
		BlockReason string `json:"blockReason"`
	} `json:"promptFeedback"`
}

// Generate runs one prompt → one short text completion. Returns the trimmed
// first candidate. maxTokens caps the output (defaults to 200 when <= 0).
func (g *GeminiText) Generate(ctx context.Context, prompt string, maxTokens int) (string, error) {
	if g.Disabled() {
		return "", errors.New("gemini text disabled (GEMINI_API_KEY missing)")
	}
	if strings.TrimSpace(prompt) == "" {
		return "", errors.New("Generate: prompt required")
	}
	if maxTokens <= 0 {
		maxTokens = 200
	}
	body := geminiGenerateContentRequest{
		Contents: []geminiContent{
			{Role: "user", Parts: []geminiPart{{Text: prompt}}},
		},
		GenerationConfig: geminiGenerationConfig{
			Temperature:     0.8,
			MaxOutputTokens: maxTokens,
		},
	}
	buf, err := json.Marshal(body)
	if err != nil {
		return "", err
	}
	url := fmt.Sprintf("%s/v1beta/models/%s:generateContent?key=%s", g.baseURL, g.model, g.apiKey)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(buf))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := g.http.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("gemini text generate status %d: %s", resp.StatusCode, clipText(string(respBytes), 256))
	}
	var parsed geminiGenerateContentResponse
	if err := json.Unmarshal(respBytes, &parsed); err != nil {
		return "", err
	}
	if reason := strings.TrimSpace(parsed.PromptFeedback.BlockReason); reason != "" {
		return "", fmt.Errorf("gemini blocked: %s", reason)
	}
	if len(parsed.Candidates) == 0 || len(parsed.Candidates[0].Content.Parts) == 0 {
		return "", errors.New("gemini returned no text")
	}
	return strings.TrimSpace(parsed.Candidates[0].Content.Parts[0].Text), nil
}

func clipText(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}
