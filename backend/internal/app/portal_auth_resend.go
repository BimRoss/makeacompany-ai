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

const (
	defaultResendMagicLinkTemplateLinkVar      = "login_url"
	defaultResendMagicLinkTemplateFirstNameVar = "recipient_first_name"
)

// resendMagicLinkTemplateVariables builds Resend template.variables for magic-link sends.
func resendMagicLinkTemplateVariables(cfg Config, linkURL, firstName string) map[string]string {
	linkKey := strings.TrimSpace(cfg.ResendMagicLinkTemplateLinkVar)
	if linkKey == "" {
		linkKey = defaultResendMagicLinkTemplateLinkVar
	}
	nameKey := strings.TrimSpace(cfg.ResendMagicLinkTemplateFirstNameVar)
	if nameKey == "" {
		nameKey = defaultResendMagicLinkTemplateFirstNameVar
	}
	return map[string]string{
		linkKey: linkURL,
		nameKey: strings.TrimSpace(firstName),
	}
}

// sendEmailViaResendTemplate sends one email from a published Resend template. Do not pass html/text
// when using this path (Resend rejects mixed payloads). Subject/from override template defaults when set.
func sendEmailViaResendTemplate(apiKey, from, to, subject, templateID string, variables map[string]string) error {
	apiKey = strings.TrimSpace(apiKey)
	from = strings.TrimSpace(from)
	to = strings.TrimSpace(to)
	templateID = strings.TrimSpace(templateID)
	if apiKey == "" || from == "" || to == "" || templateID == "" {
		return fmt.Errorf("missing resend template parameters")
	}
	vars := make(map[string]string, len(variables))
	for k, v := range variables {
		k = strings.TrimSpace(k)
		if k != "" {
			vars[k] = v
		}
	}
	return postResendEmail(apiKey, map[string]any{
		"from":    from,
		"to":      []string{to},
		"subject": strings.TrimSpace(subject),
		"template": map[string]any{
			"id":        templateID,
			"variables": vars,
		},
	})
}

// sendEmailViaResend sends one transactional email with inline HTML/text (no template).
func sendEmailViaResend(apiKey, from, to, subject, textBody, htmlBody string) error {
	apiKey = strings.TrimSpace(apiKey)
	from = strings.TrimSpace(from)
	to = strings.TrimSpace(to)
	if apiKey == "" || from == "" || to == "" {
		return fmt.Errorf("missing resend parameters")
	}
	return postResendEmail(apiKey, map[string]any{
		"from":    from,
		"to":      []string{to},
		"subject": subject,
		"text":    textBody,
		"html":    htmlBody,
	})
}

func postResendEmail(apiKey string, body map[string]any) error {
	apiKey = strings.TrimSpace(apiKey)
	if apiKey == "" {
		return fmt.Errorf("missing resend api key")
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
