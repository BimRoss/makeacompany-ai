package app

import (
	"encoding/base64"
	"strings"
	"testing"
)

func testMasterKey() string {
	b := make([]byte, 32)
	for i := range b {
		b[i] = byte(i + 1)
	}
	return base64.StdEncoding.EncodeToString(b)
}

func TestEncryptDecryptUserKeyRoundTrip(t *testing.T) {
	mk := testMasterKey()
	plain := "sk-ant-api03-abc123def456ghi789"
	blob, err := encryptUserKey(mk, plain)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	if strings.Contains(blob, plain) {
		t.Fatal("ciphertext leaks plaintext")
	}
	got, err := decryptUserKey(mk, blob)
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	if got != plain {
		t.Fatalf("round trip mismatch: %q != %q", got, plain)
	}
}

func TestEncryptUserKeyNonceIsRandom(t *testing.T) {
	mk := testMasterKey()
	a, err := encryptUserKey(mk, "sk-ant-api03-same")
	if err != nil {
		t.Fatalf("encrypt a: %v", err)
	}
	b, err := encryptUserKey(mk, "sk-ant-api03-same")
	if err != nil {
		t.Fatalf("encrypt b: %v", err)
	}
	if a == b {
		t.Fatal("expected distinct ciphertexts (random nonce)")
	}
}

func TestDecryptUserKeyTamperFails(t *testing.T) {
	mk := testMasterKey()
	blob, err := encryptUserKey(mk, "sk-ant-api03-tamper")
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	raw, _ := base64.StdEncoding.DecodeString(blob)
	raw[len(raw)-1] ^= 0xff
	if _, err := decryptUserKey(mk, base64.StdEncoding.EncodeToString(raw)); err == nil {
		t.Fatal("expected decrypt to fail on tampered ciphertext")
	}
}

func TestMasterKeyRejectsBadLength(t *testing.T) {
	if _, err := encryptUserKey("short", "x"); err == nil {
		t.Fatal("expected error for a master key that isn't 32 bytes")
	}
	if _, err := encryptUserKey("", "x"); err == nil {
		t.Fatal("expected error for empty master key")
	}
}

func TestClaudeKeyLast4(t *testing.T) {
	if got := claudeKeyLast4("sk-ant-api03-wxyz"); got != "wxyz" {
		t.Fatalf("last4 = %q, want wxyz", got)
	}
	if got := claudeKeyLast4("ab"); got != "ab" {
		t.Fatalf("last4 short = %q, want ab", got)
	}
}

func TestValidClaudeKeyShape(t *testing.T) {
	if !validClaudeKeyShape("sk-ant-api03-abcdefghijklmnop") {
		t.Fatal("valid key rejected")
	}
	if validClaudeKeyShape("nope") {
		t.Fatal("short non-prefixed key accepted")
	}
	if validClaudeKeyShape("pk-live-somethingsomething") {
		t.Fatal("wrong-prefix key accepted")
	}
}
