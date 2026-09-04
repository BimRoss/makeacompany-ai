package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// pngBytes is a tiny valid-enough payload; the client only base64-decodes it.
var pngBytes = []byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a}

func TestGenerateIcon_GeminiFlashImage(t *testing.T) {
	var gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		resp := map[string]any{
			"candidates": []map[string]any{{
				"content": map[string]any{
					"parts": []map[string]any{
						{"text": "here you go"},
						{"inlineData": map[string]any{
							"mimeType": "image/png",
							"data":     base64.StdEncoding.EncodeToString(pngBytes),
						}},
					},
				},
			}},
		}
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer srv.Close()

	g := &GeminiImagen{apiKey: "k", model: "gemini-3.1-flash-image", http: srv.Client(), baseURL: srv.URL}
	img, err := g.GenerateIcon(context.Background(), "a friendly robot")
	if err != nil {
		t.Fatalf("GenerateIcon: %v", err)
	}
	if !strings.HasSuffix(gotPath, ":generateContent") {
		t.Errorf("gemini-*-image should hit :generateContent, got %q", gotPath)
	}
	if img.MimeType != "image/png" || string(img.Data) != string(pngBytes) {
		t.Errorf("unexpected image: mime=%q len=%d", img.MimeType, len(img.Data))
	}
}

func TestGenerateIcon_SafetyFilterNoImage(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := map[string]any{
			"candidates": []map[string]any{{
				"content":      map[string]any{"parts": []map[string]any{{"text": "cannot"}}},
				"finishReason": "IMAGE_SAFETY",
			}},
		}
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer srv.Close()

	g := &GeminiImagen{apiKey: "k", model: "gemini-3.1-flash-image", http: srv.Client(), baseURL: srv.URL}
	_, err := g.GenerateIcon(context.Background(), "x")
	if err == nil || !strings.Contains(err.Error(), "IMAGE_SAFETY") {
		t.Fatalf("want safety error surfacing finishReason, got %v", err)
	}
}

func TestGenerateIcon_ImagenRouting(t *testing.T) {
	var gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		resp := map[string]any{
			"predictions": []map[string]any{{
				"mimeType":           "image/png",
				"bytesBase64Encoded": base64.StdEncoding.EncodeToString(pngBytes),
			}},
		}
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer srv.Close()

	g := &GeminiImagen{apiKey: "k", model: "imagen-4.0-fast-generate-001", http: srv.Client(), baseURL: srv.URL}
	if _, err := g.GenerateIcon(context.Background(), "x"); err != nil {
		t.Fatalf("GenerateIcon (imagen): %v", err)
	}
	if !strings.HasSuffix(gotPath, ":predict") {
		t.Errorf("imagen-* should hit :predict, got %q", gotPath)
	}
}
