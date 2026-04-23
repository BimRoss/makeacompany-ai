package app

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// sendEmailViaResend sends one transactional email (magic link). apiKey is RESEND_API_KEY.
func sendEmailViaResend(apiKey, from, to, subject, textBody, htmlBody string) error {
	apiKey = strings.TrimSpace(apiKey)
	from = strings.TrimSpace(from)
	to = strings.TrimSpace(to)
	if apiKey == "" || from == "" || to == "" {
		return fmt.Errorf("missing resend parameters")
	}
	body := map[string]any{
		"from":    from,
		"to":      []string{to},
		"subject": subject,
		"text":    textBody,
		"html":    htmlBody,
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequest(http.MethodPost, "https://api.resend.com/emails", bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("resend: status %d: %s", resp.StatusCode, strings.TrimSpace(string(respBody)))
	}
	return nil
}
