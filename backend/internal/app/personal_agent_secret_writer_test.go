package app

import (
	"context"
	"strings"
	"testing"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
)

func TestValidatePersonalAgentSlackTokens(t *testing.T) {
	good := PersonalAgentSlackTokens{
		BotToken:  "xoxb-1234567890-abcdef",
		AppToken:  "xapp-1234567890-abcdef",
		BotUserID: "U0BARTBOT01",
	}
	if err := ValidatePersonalAgentSlackTokens(good); err != nil {
		t.Fatalf("good tokens rejected: %v", err)
	}

	cases := []struct {
		name string
		in   PersonalAgentSlackTokens
	}{
		{"empty bot", PersonalAgentSlackTokens{BotToken: "", AppToken: good.AppToken, BotUserID: good.BotUserID}},
		{"empty app", PersonalAgentSlackTokens{BotToken: good.BotToken, AppToken: "", BotUserID: good.BotUserID}},
		{"empty bot id", PersonalAgentSlackTokens{BotToken: good.BotToken, AppToken: good.AppToken, BotUserID: ""}},
		{"swapped bot/app", PersonalAgentSlackTokens{BotToken: good.AppToken, AppToken: good.BotToken, BotUserID: good.BotUserID}},
		{"channel id as bot user", PersonalAgentSlackTokens{BotToken: good.BotToken, AppToken: good.AppToken, BotUserID: "C0CHANNEL"}},
		{"bot token without prefix", PersonalAgentSlackTokens{BotToken: "1234567890-abcdef", AppToken: good.AppToken, BotUserID: good.BotUserID}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if err := ValidatePersonalAgentSlackTokens(tc.in); err == nil {
				t.Fatalf("%s: expected error", tc.name)
			}
		})
	}
}

func TestPersonalAgentSecretName(t *testing.T) {
	if got := PersonalAgentSecretName("bart"); got != "personal-agent-bart-secrets" {
		t.Fatalf("name = %q", got)
	}
}

func TestPersonalAgentSecretWriter_DisabledByDefault(t *testing.T) {
	// Zero-value writer is disabled (matches the out-of-cluster path
	// from NewPersonalAgentSecretWriter when InClusterConfig fails).
	var w *PersonalAgentSecretWriter
	if !w.Disabled() {
		t.Fatal("nil writer should be Disabled()")
	}
	w2 := &PersonalAgentSecretWriter{disabled: true}
	if !w2.Disabled() {
		t.Fatal("disabled flag should make Disabled() true")
	}
	if err := w2.WriteSlackSecret(context.Background(), "bart", PersonalAgentSlackTokens{
		BotToken: "xoxb-1234567890-abc", AppToken: "xapp-1234567890-abc", BotUserID: "U0BART00001",
	}); err == nil {
		t.Fatal("disabled writer should return error")
	}
}

func TestPersonalAgentSecretWriter_WriteSlackSecretCreates(t *testing.T) {
	cs := fake.NewSimpleClientset()
	w := newPersonalAgentSecretWriterFromClient(cs)
	ctx := context.Background()

	tokens := PersonalAgentSlackTokens{
		BotToken:  "xoxb-1234567890-abcdef",
		AppToken:  "xapp-1234567890-abcdef",
		BotUserID: "U0BARTBOT01",
	}
	if err := w.WriteSlackSecret(ctx, "bart", tokens); err != nil {
		t.Fatalf("write: %v", err)
	}

	got, err := cs.CoreV1().Secrets(PersonalAgentNamespace).Get(ctx, "personal-agent-bart-secrets", metav1.GetOptions{})
	if err != nil {
		t.Fatalf("get after write: %v", err)
	}
	if got.Type != corev1.SecretTypeOpaque {
		t.Fatalf("Type = %s, want Opaque", got.Type)
	}
	for _, key := range []string{"slack_bot_token", "slack_app_token", "agent_slack_bot_user_id"} {
		if _, ok := got.Data[key]; !ok {
			t.Errorf("missing data key %q", key)
		}
	}
	if string(got.Data["slack_bot_token"]) != tokens.BotToken {
		t.Errorf("bot token round-trip drift: %q != %q", got.Data["slack_bot_token"], tokens.BotToken)
	}
	if got.Labels["bimross.com/personal-agent"] != "bart" {
		t.Errorf("label missing or wrong: %q", got.Labels["bimross.com/personal-agent"])
	}
	if got.Annotations["bimross.com/written-at"] == "" {
		t.Error("written-at annotation should be set")
	}
}

func TestPersonalAgentSecretWriter_WriteIsIdempotent(t *testing.T) {
	cs := fake.NewSimpleClientset()
	w := newPersonalAgentSecretWriterFromClient(cs)
	ctx := context.Background()

	tokens := PersonalAgentSlackTokens{
		BotToken: "xoxb-1234567890-abc", AppToken: "xapp-1234567890-abc", BotUserID: "U0BART00001",
	}
	if err := w.WriteSlackSecret(ctx, "bart", tokens); err != nil {
		t.Fatalf("first write: %v", err)
	}
	// Re-paste with rotated tokens should update in place, not error.
	tokens2 := PersonalAgentSlackTokens{
		BotToken: "xoxb-9999999999-xyz", AppToken: "xapp-9999999999-xyz", BotUserID: "U0BART00002",
	}
	if err := w.WriteSlackSecret(ctx, "bart", tokens2); err != nil {
		t.Fatalf("second write: %v", err)
	}
	got, err := cs.CoreV1().Secrets(PersonalAgentNamespace).Get(ctx, "personal-agent-bart-secrets", metav1.GetOptions{})
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if string(got.Data["slack_bot_token"]) != tokens2.BotToken {
		t.Errorf("rotation didn't take: got %q", got.Data["slack_bot_token"])
	}
	if string(got.Data["agent_slack_bot_user_id"]) != tokens2.BotUserID {
		t.Errorf("bot user id rotation didn't take: got %q", got.Data["agent_slack_bot_user_id"])
	}
}

func TestPersonalAgentSecretWriter_WriteRejectsInvalidInput(t *testing.T) {
	cs := fake.NewSimpleClientset()
	w := newPersonalAgentSecretWriterFromClient(cs)
	ctx := context.Background()

	// Invalid slug must short-circuit before any cluster call.
	if err := w.WriteSlackSecret(ctx, "Bart", PersonalAgentSlackTokens{
		BotToken: "xoxb-1234567890-abc", AppToken: "xapp-1234567890-abc", BotUserID: "U0BART00001",
	}); err == nil {
		t.Fatal("uppercase slug: expected error")
	}
	// Invalid tokens short-circuit too.
	if err := w.WriteSlackSecret(ctx, "bart", PersonalAgentSlackTokens{
		BotToken: "not-a-bot-token", AppToken: "xapp-1234567890-abc", BotUserID: "U0BART00001",
	}); err == nil || !strings.Contains(err.Error(), "bot_token") {
		t.Fatalf("invalid bot token: expected validation error, got %v", err)
	}
	// No Secret should have been created.
	list, err := cs.CoreV1().Secrets(PersonalAgentNamespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(list.Items) != 0 {
		t.Fatalf("expected no secrets, got %d", len(list.Items))
	}
}

func TestPersonalAgentSecretWriter_DeleteSlackSecret(t *testing.T) {
	cs := fake.NewSimpleClientset()
	w := newPersonalAgentSecretWriterFromClient(cs)
	ctx := context.Background()

	tokens := PersonalAgentSlackTokens{
		BotToken: "xoxb-1234567890-abc", AppToken: "xapp-1234567890-abc", BotUserID: "U0BART00001",
	}
	if err := w.WriteSlackSecret(ctx, "bart", tokens); err != nil {
		t.Fatalf("seed write: %v", err)
	}
	if err := w.DeleteSlackSecret(ctx, "bart"); err != nil {
		t.Fatalf("delete: %v", err)
	}
	_, err := cs.CoreV1().Secrets(PersonalAgentNamespace).Get(ctx, "personal-agent-bart-secrets", metav1.GetOptions{})
	if !apierrors.IsNotFound(err) {
		t.Fatalf("expected NotFound after delete, got %v", err)
	}
	// Second delete is a no-op, not an error.
	if err := w.DeleteSlackSecret(ctx, "bart"); err != nil {
		t.Fatalf("delete of missing: %v", err)
	}
}
