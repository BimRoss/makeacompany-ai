package app

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"strconv"
	"testing"
	"time"
)

// signSlack builds a valid signature for body at ts using secret — the same
// computation a real Slack request carries.
func signSlack(secret, ts string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte("v0:" + ts + ":"))
	mac.Write(body)
	return "v0=" + hex.EncodeToString(mac.Sum(nil))
}

func TestVerifySlackSignature(t *testing.T) {
	secret := "8f742231b10e8888abcd99yyyzzz85a5"
	body := []byte(`{"type":"event_callback","event":{"type":"app_uninstalled"}}`)
	now := time.Unix(1700000000, 0)
	ts := strconv.FormatInt(now.Unix(), 10)
	good := signSlack(secret, ts, body)

	t.Run("valid", func(t *testing.T) {
		if err := verifySlackSignature(secret, good, ts, body, now); err != nil {
			t.Fatalf("expected valid, got %v", err)
		}
	})
	t.Run("wrong secret fails", func(t *testing.T) {
		if err := verifySlackSignature("other-secret", good, ts, body, now); err == nil {
			t.Fatal("expected mismatch")
		}
	})
	t.Run("tampered body fails", func(t *testing.T) {
		if err := verifySlackSignature(secret, good, ts, []byte(`{"type":"x"}`), now); err == nil {
			t.Fatal("expected mismatch on tampered body")
		}
	})
	t.Run("stale timestamp fails", func(t *testing.T) {
		stale := now.Add(10 * time.Minute)
		if err := verifySlackSignature(secret, good, ts, body, stale); err == nil {
			t.Fatal("expected stale-timestamp rejection")
		}
	})
	t.Run("future timestamp fails", func(t *testing.T) {
		past := now.Add(-10 * time.Minute)
		if err := verifySlackSignature(secret, good, ts, body, past); err == nil {
			t.Fatal("expected future-timestamp rejection")
		}
	})
	t.Run("empty secret fails", func(t *testing.T) {
		if err := verifySlackSignature("", good, ts, body, now); err == nil {
			t.Fatal("expected empty-secret rejection")
		}
	})
	t.Run("missing signature fails", func(t *testing.T) {
		if err := verifySlackSignature(secret, "", ts, body, now); err == nil {
			t.Fatal("expected missing-signature rejection")
		}
	})
	t.Run("non-numeric timestamp fails", func(t *testing.T) {
		if err := verifySlackSignature(secret, good, "not-a-number", body, now); err == nil {
			t.Fatal("expected bad-timestamp rejection")
		}
	})
}
