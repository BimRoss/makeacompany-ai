package app

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestFetchOrchestratorChannelHumanUserIDs_OK(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/debug/channel-members" {
			http.NotFound(w, r)
			return
		}
		if r.URL.Query().Get("channel_id") != "C01234567" {
			http.Error(w, "bad channel", http.StatusBadRequest)
			return
		}
		_, _ = w.Write([]byte(`{"human_user_ids":["U111","U222"]}`))
	}))
	defer srv.Close()

	got, err := FetchOrchestratorChannelHumanUserIDs(context.Background(), srv.URL, "", "C01234567")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0] != "U111" || got[1] != "U222" {
		t.Fatalf("got %#v", got)
	}
}

func TestFetchOrchestratorChannelHumanUserIDs_EmptyChannel(t *testing.T) {
	_, err := FetchOrchestratorChannelHumanUserIDs(context.Background(), "http://x", "", "  ")
	if err == nil {
		t.Fatal("expected error")
	}
}
