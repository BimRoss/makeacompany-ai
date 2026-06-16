package app

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

// GeminiImagen is a thin client over Google's Generative Language API for
// text-to-image generation. Mirrors the contract used by the ross
// gemini-image skill (same env var, same model defaults) so the personal-
// agents track and the harness keep the same cost knobs.
//
// Default model is Imagen-4-fast for the cheap "make me an icon" reach.
type GeminiImagen struct {
	apiKey  string
	model   string
	http    *http.Client
	baseURL string // override for tests; defaults to https://generativelanguage.googleapis.com
}

const (
	defaultGeminiImagenModel = "imagen-4.0-fast-generate-001"
)

// NewGeminiImagen builds a client. Returns nil when apiKey is empty; callers
// check Disabled() before invoking.
func NewGeminiImagen(apiKey string) *GeminiImagen {
	return &GeminiImagen{
		apiKey:  strings.TrimSpace(apiKey),
		model:   defaultGeminiImagenModel,
		http:    &http.Client{Timeout: 60 * time.Second},
		baseURL: "https://generativelanguage.googleapis.com",
	}
}

func (g *GeminiImagen) Disabled() bool {
	return g == nil || g.apiKey == ""
}

// GeneratedImage is a single image returned by Imagen.
type GeneratedImage struct {
	Data     []byte
	MimeType string
}

// IconCandidateLimit caps the number of icon candidates we ask Imagen for in
// a single user request. Each candidate is a separate API call; 4 is the
// "show a 2x2 grid, pick one" UX without burning credits on long shopping
// sessions. Bump cautiously.
const IconCandidateLimit = 4

// imagenPredictRequest mirrors the Imagen :predict API shape (which differs
// from the Gemini :generateContent shape — Imagen lives at a different endpoint).
type imagenPredictRequest struct {
	Instances  []imagenInstance  `json:"instances"`
	Parameters imagenParameters  `json:"parameters,omitempty"`
}

type imagenInstance struct {
	Prompt string `json:"prompt"`
}

type imagenParameters struct {
	SampleCount   int    `json:"sampleCount,omitempty"`
	AspectRatio   string `json:"aspectRatio,omitempty"`
	SafetySetting string `json:"safetySetting,omitempty"`
}

type imagenPredictResponse struct {
	Predictions []struct {
		BytesBase64Encoded string `json:"bytesBase64Encoded"`
		MimeType           string `json:"mimeType"`
	} `json:"predictions"`
	Error *struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
		Status  string `json:"status"`
	} `json:"error"`
}

// GenerateIcon produces a single square icon image from the given prompt.
// The prompt should be self-contained — typically "<name>: <description>"
// composed at the caller with a fixed style preamble (vector, app-icon,
// minimal, etc.) so the cost knob stays at the helper layer.
func (g *GeminiImagen) GenerateIcon(ctx context.Context, prompt string) (*GeneratedImage, error) {
	if g.Disabled() {
		return nil, errors.New("gemini imagen disabled (GEMINI_API_KEY unset)")
	}
	if strings.TrimSpace(prompt) == "" {
		return nil, errors.New("GenerateIcon: prompt required")
	}

	body, err := json.Marshal(imagenPredictRequest{
		Instances: []imagenInstance{{Prompt: prompt}},
		Parameters: imagenParameters{
			SampleCount: 1,
			AspectRatio: "1:1",
		},
	})
	if err != nil {
		return nil, err
	}

	url := fmt.Sprintf("%s/v1beta/models/%s:predict", g.baseURL, g.model)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-goog-api-key", g.apiKey)

	resp, err := g.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("imagen request: %w", err)
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("imagen read body: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("imagen status %d: %s", resp.StatusCode, clip(string(respBody), 256))
	}
	var parsed imagenPredictResponse
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return nil, fmt.Errorf("imagen parse: %w", err)
	}
	if parsed.Error != nil {
		return nil, fmt.Errorf("imagen error: %s", parsed.Error.Message)
	}
	if len(parsed.Predictions) == 0 || parsed.Predictions[0].BytesBase64Encoded == "" {
		return nil, errors.New("imagen returned no image (likely safety filter — reword prompt)")
	}
	data, err := base64.StdEncoding.DecodeString(parsed.Predictions[0].BytesBase64Encoded)
	if err != nil {
		return nil, fmt.Errorf("imagen base64 decode: %w", err)
	}
	mime := strings.TrimSpace(parsed.Predictions[0].MimeType)
	if mime == "" {
		mime = "image/png"
	}
	return &GeneratedImage{Data: data, MimeType: mime}, nil
}

// GenerateIconCandidates fans out N concurrent GenerateIcon calls so the /me
// UI can show a small grid of candidates instead of forcing the user to
// re-roll one image at a time. N is silently clamped to IconCandidateLimit.
//
// Returns whatever candidates succeeded — partial-success is intentional:
// one bad-prompt rejection shouldn't waste the user's time on the others.
// If ALL fail, the first error is returned so the UI can surface it.
func (g *GeminiImagen) GenerateIconCandidates(ctx context.Context, prompt string, n int) ([]*GeneratedImage, error) {
	if g.Disabled() {
		return nil, errors.New("gemini imagen disabled (GEMINI_API_KEY unset)")
	}
	if n <= 0 {
		n = 1
	}
	if n > IconCandidateLimit {
		n = IconCandidateLimit
	}
	type result struct {
		img *GeneratedImage
		err error
	}
	results := make([]result, n)
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			img, err := g.GenerateIcon(ctx, prompt)
			results[i] = result{img: img, err: err}
		}(i)
	}
	wg.Wait()

	out := make([]*GeneratedImage, 0, n)
	var firstErr error
	for _, r := range results {
		if r.err != nil {
			if firstErr == nil {
				firstErr = r.err
			}
			continue
		}
		out = append(out, r.img)
	}
	if len(out) == 0 && firstErr != nil {
		return nil, firstErr
	}
	return out, nil
}

// portraitFramingSuffix forces every Imagen icon — whether user-typed or
// IconPromptFor-derived — into a profile-picture shape: zoomed-in headshot,
// centered subject, eye-level angle, neutral background, square. Keeps
// candidates visually consistent even when the subject is wildly different
// across prompts (e.g. "Garth from Wayne's World" vs. "a robot mascot").
const portraitFramingSuffix = " " +
	"Framing: tight close-up portrait headshot, subject centered, shoulders-up crop, " +
	"eye-level camera angle, looking toward the camera, neutral solid background with subtle vignette, " +
	"soft even lighting, sharp focus on the face, app-store profile-picture aesthetic, square 1:1 composition, " +
	"no text, no watermarks, no full-body shots, no environment shots."

// IconPromptFor composes an Imagen prompt for an agent icon. Single source
// of truth so the create-time and "regenerate" code paths can't drift.
func IconPromptFor(name, description string) string {
	name = strings.TrimSpace(name)
	description = strings.TrimSpace(description)
	if description == "" {
		description = "a personal AI agent on Slack"
	}
	return fmt.Sprintf(
		"Portrait icon for an AI agent named %q whose purpose is: %s.",
		name, description) + portraitFramingSuffix
}

// IconPromptWithPortraitFraming wraps a user-supplied subject so the same
// framing constraints land regardless of what they typed in.
func IconPromptWithPortraitFraming(userPrompt string) string {
	userPrompt = strings.TrimSpace(userPrompt)
	if userPrompt == "" {
		return ""
	}
	return "Subject: " + userPrompt + "." + portraitFramingSuffix
}
