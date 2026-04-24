package app

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestFetchOrchestratorMemberChannels_OK(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"schema_version":1,"channels":[{"channel_id":"C1","name":"general"}],"truncated":false}`))
	}))
	t.Cleanup(srv.Close)

	body, err := FetchOrchestratorMemberChannels(context.Background(), srv.URL, "")
	if err != nil {
		t.Fatal(err)
	}
	if string(body) == "" {
		t.Fatal("empty body")
	}
}

func TestOrchestratorMemberChannelCount(t *testing.T) {
	n := OrchestratorMemberChannelCount([]byte(`{"channels":[{"channel_id":"C1"}]}`))
	if n != 1 {
		t.Fatalf("got %d", n)
	}
	if OrchestratorMemberChannelCount([]byte(`{`)) != -1 {
		t.Fatal("expected -1 for invalid json")
	}
}

func TestFetchOrchestratorMemberChannels_RejectsNonArrayChannels(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"channels":"nope"}`))
	}))
	t.Cleanup(srv.Close)

	_, err := FetchOrchestratorMemberChannels(context.Background(), srv.URL, "")
	if err == nil {
		t.Fatal("expected error")
	}
}
