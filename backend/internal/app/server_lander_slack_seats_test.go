package app

import (
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func newLanderSeatsTestServer(t *testing.T) *Server {
	t.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	return &Server{
		store: &Store{rdb: rdb},
		log:   log.New(io.Discard, "", 0),
	}
}

func TestHandleLanderSlackSeats_returnsFreeLifetimeCount(t *testing.T) {
	s := newLanderSeatsTestServer(t)
	ctx := context.Background()
	// Three human profiles stamped, one paid profile not stamped — only stamped count is "claimed".
	for _, em := range []string{"a@x.com", "b@x.com", "c@x.com"} {
		if err := s.store.MarkProfileFreeLifetime(ctx, em); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.store.UpsertUserProfileAfterWaitlist(ctx, "paid@x.com", "cus", "cs", "paid", "prod", ""); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodGet, "/v1/lander/slack-seats", nil)
	rr := httptest.NewRecorder()
	s.handleLanderSlackSeats(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status: %d body=%s", rr.Code, rr.Body.String())
	}
	var got map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	claimed, ok := got["claimed"].(float64)
	if !ok {
		t.Fatalf("claimed not a number: %v", got["claimed"])
	}
	if int(claimed) != 3 {
		t.Fatalf("claimed = %v, want 3", claimed)
	}
	cap, ok := got["cap"].(float64)
	if !ok {
		t.Fatalf("cap not a number: %v", got["cap"])
	}
	if int(cap) != FreeLifetimeSeatCap {
		t.Fatalf("cap = %v, want %d", cap, FreeLifetimeSeatCap)
	}
}

func TestHandleLanderSlackSeats_zeroWhenNothingStamped(t *testing.T) {
	s := newLanderSeatsTestServer(t)
	req := httptest.NewRequest(http.MethodGet, "/v1/lander/slack-seats", nil)
	rr := httptest.NewRecorder()
	s.handleLanderSlackSeats(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status: %d body=%s", rr.Code, rr.Body.String())
	}
	var got map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if claimed, _ := got["claimed"].(float64); int(claimed) != 0 {
		t.Fatalf("claimed = %v, want 0", got["claimed"])
	}
}
