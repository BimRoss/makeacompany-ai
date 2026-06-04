package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
)

// stubRossServer fakes the ross /admin/reseed endpoint. Per-channel
// behavior is controlled by the channels map: a result, or one of the
// sentinels "missing" / "error".
type stubRossServer struct {
	*httptest.Server
	mu        sync.Mutex
	calls     []string
	maxInFlight int32
	curInFlight int32
}

func newStubRoss(t *testing.T, channels map[string]string) *stubRossServer {
	t.Helper()
	stub := &stubRossServer{}
	stub.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer secret" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		var req struct {
			ChannelID string `json:"channel_id"`
			DryRun    bool   `json:"dry_run"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		stub.mu.Lock()
		stub.calls = append(stub.calls, req.ChannelID)
		stub.mu.Unlock()
		cur := atomic.AddInt32(&stub.curInFlight, 1)
		defer atomic.AddInt32(&stub.curInFlight, -1)
		for {
			old := atomic.LoadInt32(&stub.maxInFlight)
			if cur <= old || atomic.CompareAndSwapInt32(&stub.maxInFlight, old, cur) {
				break
			}
		}
		mode, ok := channels[req.ChannelID]
		if !ok {
			http.Error(w, "workspace not found", http.StatusNotFound)
			return
		}
		switch mode {
		case "missing":
			http.Error(w, "workspace not found", http.StatusNotFound)
		case "error":
			http.Error(w, "boom", http.StatusInternalServerError)
		case "noop":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"channel_id": req.ChannelID,
				"dry_run":    req.DryRun,
				"no_op":      true,
			})
		default:
			_ = json.NewEncoder(w).Encode(map[string]any{
				"channel_id": req.ChannelID,
				"dry_run":    req.DryRun,
				"no_op":      false,
				"stamped_to": "3",
				"changes": []map[string]any{
					{"kind": "stamp_updated", "summary": "1 → 3"},
				},
			})
		}
	}))
	return stub
}

func TestRunBulkReseed_BucketsResults(t *testing.T) {
	stub := newStubRoss(t, map[string]string{
		"C0APPLIED1": "applied",
		"C0NOOP0001": "noop",
		"C0MISSING1": "missing",
		"C0ERROR001": "error",
	})
	defer stub.Close()
	client := NewRossAdminClient(stub.URL, "secret")
	channels := []SlackChannel{
		{ChannelID: "C0APPLIED1", Name: "applied"},
		{ChannelID: "C0NOOP0001", Name: "noop"},
		{ChannelID: "C0MISSING1", Name: "missing"},
		{ChannelID: "C0ERROR001", Name: "error"},
	}
	res := runBulkReseed(context.Background(), client, channels, false, 2)
	if len(res) != 4 {
		t.Fatalf("want 4 results, got %d", len(res))
	}
	summary := summarizeReseedResults(res)
	if summary.Applied != 1 || summary.NoOp != 1 || summary.Missing != 1 || summary.Errored != 1 {
		t.Errorf("summary buckets wrong: %+v", summary)
	}
	// Stable-sort puts errors first
	if res[0].Status != "error" {
		t.Errorf("expected error row first, got %q", res[0].Status)
	}
}

func TestRunBulkReseed_RespectsConcurrencyCap(t *testing.T) {
	channels := []SlackChannel{}
	stubMap := map[string]string{}
	for i := 0; i < 20; i++ {
		id := "C0CHAN" + strings.Repeat("X", 4-len(itoa(i))) + itoa(i)
		channels = append(channels, SlackChannel{ChannelID: id})
		stubMap[id] = "applied"
	}
	stub := newStubRoss(t, stubMap)
	defer stub.Close()
	client := NewRossAdminClient(stub.URL, "secret")
	_ = runBulkReseed(context.Background(), client, channels, false, 3)
	if got := atomic.LoadInt32(&stub.maxInFlight); got > 3 {
		t.Errorf("concurrency leaked past cap: peak=%d want<=3", got)
	}
}

func TestRunBulkReseed_DryRunPropagates(t *testing.T) {
	stub := newStubRoss(t, map[string]string{"C0DRY00001": "applied"})
	defer stub.Close()
	client := NewRossAdminClient(stub.URL, "secret")
	res := runBulkReseed(context.Background(), client, []SlackChannel{{ChannelID: "C0DRY00001"}}, true, 1)
	if len(res) != 1 || res[0].Status != "dry_run" {
		t.Fatalf("want dry_run status, got %+v", res)
	}
	if !res[0].DryRun {
		t.Errorf("DryRun flag not propagated")
	}
}

// itoa is a tiny stdlib-free int->string for the test helper; keeps
// the test self-contained without an extra import.
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	buf := [16]byte{}
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[i:])
}
