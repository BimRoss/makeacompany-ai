package app

import (
	"context"
	"strings"
	"testing"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
)

func TestPersonalAgentSecretName_Deterministic(t *testing.T) {
	n1 := personalAgentSecretName("U0APBT3364D")
	n2 := personalAgentSecretName("U0APBT3364D")
	if n1 != n2 {
		t.Fatalf("name not deterministic: %q vs %q", n1, n2)
	}
	if !strings.HasPrefix(n1, "personal-agent-") || !strings.HasSuffix(n1, "-runtime-secrets") {
		t.Errorf("unexpected name shape: %q", n1)
	}
	if n1 == personalAgentSecretName("U0OTHER") {
		t.Errorf("different inputs produced same name")
	}
}

func TestWriteAgentRuntimeSecret_CreatesSecret(t *testing.T) {
	cs := fake.NewSimpleClientset()
	w := newPersonalAgentWriterWithClient(cs, "personal-agents", "", "")
	ctx := context.Background()

	req := PersonalAgentRuntimeSecretRequest{
		SlackUserID:   "U0APBT3364D",
		SlackAppID:    "A0GARTH",
		BotToken:      "xoxb-test",
		SigningSecret: "sig-test",
	}
	if err := w.WriteAgentRuntimeSecret(ctx, req); err != nil {
		t.Fatalf("WriteAgentRuntimeSecret: %v", err)
	}

	name := personalAgentSecretName(req.SlackUserID)
	got, err := cs.CoreV1().Secrets("personal-agents").Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		t.Fatalf("get secret: %v", err)
	}
	if got.Type != corev1.SecretTypeOpaque {
		t.Errorf("Type = %v, want Opaque", got.Type)
	}
	if got.StringData["PERSONAL_SLACK_BOT_TOKEN"] != "xoxb-test" {
		t.Errorf("PERSONAL_SLACK_BOT_TOKEN = %q, want xoxb-test", got.StringData["PERSONAL_SLACK_BOT_TOKEN"])
	}
	if got.StringData["PERSONAL_SLACK_SIGNING_SECRET"] != "sig-test" {
		t.Errorf("PERSONAL_SLACK_SIGNING_SECRET = %q, want sig-test", got.StringData["PERSONAL_SLACK_SIGNING_SECRET"])
	}
	if got.Annotations[personalAgentAnnoSlackUserID] != "U0APBT3364D" {
		t.Errorf("slack-user-id annotation missing/wrong: %q", got.Annotations[personalAgentAnnoSlackUserID])
	}
	if got.Annotations[personalAgentAnnoAppID] != "A0GARTH" {
		t.Errorf("slack-app-id annotation missing/wrong: %q", got.Annotations[personalAgentAnnoAppID])
	}
}

func TestWriteAgentRuntimeSecret_UpdatesExisting(t *testing.T) {
	cs := fake.NewSimpleClientset()
	w := newPersonalAgentWriterWithClient(cs, "personal-agents", "", "")
	ctx := context.Background()

	req := PersonalAgentRuntimeSecretRequest{
		SlackUserID:   "U0APBT3364D",
		SlackAppID:    "A0GARTH",
		BotToken:      "xoxb-1",
		SigningSecret: "sig-1",
	}
	if err := w.WriteAgentRuntimeSecret(ctx, req); err != nil {
		t.Fatalf("first write: %v", err)
	}
	req.BotToken = "xoxb-2"
	req.SigningSecret = "sig-2"
	if err := w.WriteAgentRuntimeSecret(ctx, req); err != nil {
		t.Fatalf("second write (update): %v", err)
	}
	name := personalAgentSecretName(req.SlackUserID)
	got, err := cs.CoreV1().Secrets("personal-agents").Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		t.Fatalf("get secret: %v", err)
	}
	// fake client strategic merge: stringData field reflects last patch
	if got.StringData["PERSONAL_SLACK_BOT_TOKEN"] != "xoxb-2" {
		t.Errorf("BOT_TOKEN after update = %q, want xoxb-2", got.StringData["PERSONAL_SLACK_BOT_TOKEN"])
	}
}

func TestWriteAgentRuntimeSecret_RejectsEmpty(t *testing.T) {
	cs := fake.NewSimpleClientset()
	w := newPersonalAgentWriterWithClient(cs, "", "", "")
	ctx := context.Background()

	if err := w.WriteAgentRuntimeSecret(ctx, PersonalAgentRuntimeSecretRequest{}); err == nil {
		t.Fatal("expected error on empty slack user id")
	}
	if err := w.WriteAgentRuntimeSecret(ctx, PersonalAgentRuntimeSecretRequest{
		SlackUserID: "U1",
	}); err == nil {
		t.Fatal("expected error on missing bot token / signing secret")
	}
}

func TestPersistConfigTokens_PatchesSecret(t *testing.T) {
	// Seed the makeacompany-ai-runtime-secrets Secret so the patch has a target.
	existing := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{Name: defaultConfigTokensSecretName, Namespace: defaultConfigTokensNamespace},
		Data: map[string][]byte{
			"SLACK_CONFIG_ACCESS_TOKEN":  []byte("old-access"),
			"SLACK_CONFIG_REFRESH_TOKEN": []byte("old-refresh"),
			"UNRELATED":                  []byte("preserved"),
		},
	}
	cs := fake.NewSimpleClientset(existing)
	w := newPersonalAgentWriterWithClient(cs, "", "", "")
	ctx := context.Background()

	if err := w.PersistConfigTokens(ctx, "new-access", "new-refresh"); err != nil {
		t.Fatalf("PersistConfigTokens: %v", err)
	}
	got, err := cs.CoreV1().Secrets(defaultConfigTokensNamespace).Get(ctx, defaultConfigTokensSecretName, metav1.GetOptions{})
	if err != nil {
		t.Fatalf("get patched secret: %v", err)
	}
	if string(got.Data["UNRELATED"]) != "preserved" {
		t.Errorf("unrelated key got clobbered: %q", got.Data["UNRELATED"])
	}
}

func TestPersistConfigTokens_DisabledNoop(t *testing.T) {
	w := &PersonalAgentWriter{disabled: true}
	if err := w.PersistConfigTokens(context.Background(), "a", "b"); err != nil {
		t.Errorf("expected no error in Disabled() mode, got %v", err)
	}
}

func TestPersistConfigTokens_RejectsEmptyValues(t *testing.T) {
	cs := fake.NewSimpleClientset()
	w := newPersonalAgentWriterWithClient(cs, "", "", "")
	if err := w.PersistConfigTokens(context.Background(), "", "r"); err == nil {
		t.Fatal("expected error on empty access token")
	}
	if err := w.PersistConfigTokens(context.Background(), "a", ""); err == nil {
		t.Fatal("expected error on empty refresh token")
	}
}
