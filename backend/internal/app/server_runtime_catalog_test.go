package app

import (
	"context"
	"log"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/alicebob/miniredis/v2"
)

func TestRuntimeCatalogRequiresTokenWhenConfigured(t *testing.T) {
	t.Parallel()

	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mr.Close)

	store, err := NewStore("redis://"+mr.Addr()+"/0", "", "")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })

	cfg := LoadConfig()
	cfg.RequireCapabilityCatalogReadToken = true
	cfg.CapabilityCatalogReadToken = ""

	srv, err := NewServer(cfg, log.Default(), store)
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodGet, "/v1/runtime/capability-catalog", nil)
	rr := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("status: got %d want %d", rr.Code, http.StatusServiceUnavailable)
	}
}

func TestRuntimeCatalogReadsRedisWithoutServerSideOrchestratorFetch(t *testing.T) {
	t.Parallel()

	mr, err := miniredis.Run()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mr.Close)

	store, err := NewStore("redis://"+mr.Addr()+"/0", "", "")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })

	catalog := CapabilityContractLikeOrchestrator(t)
	if err := store.PutCapabilityCatalog(context.Background(), catalog); err != nil {
		t.Fatal(err)
	}

	var orchestratorHits int64
	orch := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		atomic.AddInt64(&orchestratorHits, 1)
	}))
	t.Cleanup(orch.Close)

	cfg := LoadConfig()
	cfg.RequireCapabilityCatalogReadToken = false
	cfg.CapabilityCatalogReadToken = ""
	cfg.SlackOrchestratorCapabilityCatalogURL = orch.URL

	srv, err := NewServer(cfg, log.Default(), store)
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodGet, "/v1/runtime/capability-catalog", nil)
	rr := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status: got %d want %d", rr.Code, http.StatusOK)
	}
	if got := atomic.LoadInt64(&orchestratorHits); got != 0 {
		t.Fatalf("orchestrator fetches: got %d want 0", got)
	}
}
