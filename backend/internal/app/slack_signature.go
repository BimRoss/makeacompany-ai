package app

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// slackSignatureMaxSkew bounds how stale a request timestamp may be before we
// reject it as a possible replay. Slack's own guidance is 5 minutes.
const slackSignatureMaxSkew = 5 * time.Minute

// verifySlackSignature checks a Slack request signature against a signing
// secret, per https://api.slack.com/authentication/verifying-requests-from-slack:
//
//	basestring = "v0:" + timestamp + ":" + rawBody
//	expected   = "v0=" + hex(HMAC_SHA256(signingSecret, basestring))
//	valid      = constant-time-equal(expected, X-Slack-Signature)
//
// `now` is injected so tests can pin time. It also enforces a ±5m timestamp
// skew so a captured request can't be replayed indefinitely. Returns nil when
// the signature is valid; a descriptive error otherwise (never leak the error
// text to the caller — log it, return 401).
func verifySlackSignature(signingSecret, signature, timestamp string, body []byte, now time.Time) error {
	signingSecret = strings.TrimSpace(signingSecret)
	if signingSecret == "" {
		return fmt.Errorf("slack signature: no signing secret")
	}
	signature = strings.TrimSpace(signature)
	if signature == "" {
		return fmt.Errorf("slack signature: missing X-Slack-Signature")
	}
	tsRaw := strings.TrimSpace(timestamp)
	tsSec, err := strconv.ParseInt(tsRaw, 10, 64)
	if err != nil {
		return fmt.Errorf("slack signature: bad timestamp %q", tsRaw)
	}
	if skew := now.Sub(time.Unix(tsSec, 0)); skew > slackSignatureMaxSkew || skew < -slackSignatureMaxSkew {
		return fmt.Errorf("slack signature: timestamp skew %s exceeds %s", skew.Round(time.Second), slackSignatureMaxSkew)
	}

	mac := hmac.New(sha256.New, []byte(signingSecret))
	mac.Write([]byte("v0:" + tsRaw + ":"))
	mac.Write(body)
	expected := "v0=" + hex.EncodeToString(mac.Sum(nil))

	// Constant-time compare. hmac.Equal also guards against the length-leak of
	// a plain ==.
	if !hmac.Equal([]byte(expected), []byte(signature)) {
		return fmt.Errorf("slack signature: mismatch")
	}
	return nil
}
