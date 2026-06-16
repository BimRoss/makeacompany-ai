package app

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"strings"
)

// SetAppIcon uploads an image as the avatar/icon for the given Slack app.
// Uses the undocumented apps.icon.set endpoint, which accepts multipart
// form data with two fields: app_id and file. Authenticated with the
// SlackManifestClient's config access token (the same one used for
// apps.manifest.create — apps.icon.set takes the same auth).
func (c *SlackManifestClient) SetAppIcon(ctx context.Context, appID string, imageBytes []byte, contentType string) error {
	if c.Disabled() {
		return errors.New("slack manifest client disabled (config tokens unset)")
	}
	if strings.TrimSpace(appID) == "" {
		return errors.New("SetAppIcon: app_id required")
	}
	if len(imageBytes) == 0 {
		return errors.New("SetAppIcon: empty image")
	}
	if strings.TrimSpace(contentType) == "" {
		contentType = "image/png"
	}

	// Try once, refresh + retry on auth error — same pattern as the manifest
	// calls in this client.
	for attempt := 0; attempt < 2; attempt++ {
		retry, err := c.setAppIconOnce(ctx, appID, imageBytes, contentType)
		if err == nil {
			return nil
		}
		if !retry || attempt == 1 {
			return err
		}
		c.log.Printf("apps.icon.set auth error, rotating + retrying: %v", err)
		if rerr := c.rotate(ctx); rerr != nil {
			return fmt.Errorf("rotate during retry: %w (original: %v)", rerr, err)
		}
	}
	return errors.New("unreachable")
}

func (c *SlackManifestClient) setAppIconOnce(ctx context.Context, appID string, imageBytes []byte, contentType string) (retryAfterAuth bool, err error) {
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	if err := mw.WriteField("app_id", appID); err != nil {
		return false, err
	}
	ext := "png"
	switch contentType {
	case "image/jpeg":
		ext = "jpg"
	case "image/webp":
		ext = "webp"
	}
	fileHeader := make(map[string][]string)
	fileHeader["Content-Disposition"] = []string{
		fmt.Sprintf(`form-data; name="file"; filename="icon.%s"`, ext),
	}
	fileHeader["Content-Type"] = []string{contentType}
	part, err := mw.CreatePart(fileHeader)
	if err != nil {
		return false, err
	}
	if _, err := part.Write(imageBytes); err != nil {
		return false, err
	}
	if err := mw.Close(); err != nil {
		return false, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/api/apps.icon.set", &body)
	if err != nil {
		return false, err
	}
	req.Header.Set("Authorization", "Bearer "+c.tokens.Access())
	req.Header.Set("Content-Type", mw.FormDataContentType())

	resp, err := c.http.Do(req)
	if err != nil {
		return false, fmt.Errorf("apps.icon.set: %w", err)
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return false, fmt.Errorf("apps.icon.set read body: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		c.log.Printf("apps.icon.set non-2xx: status=%d body=%s", resp.StatusCode, clip(string(respBody), 256))
		return false, fmt.Errorf("apps.icon.set status %d", resp.StatusCode)
	}
	var parsed struct {
		OK    bool   `json:"ok"`
		Error string `json:"error"`
	}
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return false, fmt.Errorf("apps.icon.set parse: %w", err)
	}
	if !parsed.OK {
		if isAuthError(parsed.Error) {
			return true, fmt.Errorf("apps.icon.set auth error: %s", parsed.Error)
		}
		return false, fmt.Errorf("apps.icon.set rejected: %s", parsed.Error)
	}
	return false, nil
}
