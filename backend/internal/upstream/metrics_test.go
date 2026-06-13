package upstream

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/prometheus/client_golang/prometheus"
	dto "github.com/prometheus/client_model/go"
)

type rtFn func(*http.Request) (*http.Response, error)

func (f rtFn) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func newStubResp(status int) *http.Response {
	return &http.Response{
		StatusCode: status,
		Body:       io.NopCloser(strings.NewReader("")),
		Header:     http.Header{},
	}
}

func TestCoerceOpAllowList(t *testing.T) {
	t.Parallel()
	if got := coerceOp("stripe", "customer.retrieve"); got != "customer.retrieve" {
		t.Fatalf("allowed op should pass through, got %q", got)
	}
	if got := coerceOp("stripe", "customer.unlist_endpoint"); got != "other" {
		t.Fatalf("unlisted op must collapse to other, got %q", got)
	}
	if got := coerceOp("nope", "anything"); got != "other" {
		t.Fatalf("unknown provider must collapse to other, got %q", got)
	}
	if got := coerceOp("stripe", ""); got != "other" {
		t.Fatalf("empty op must collapse to other, got %q", got)
	}
}

func TestRoundTripEmitsStatusAndDuration(t *testing.T) {
	t.Parallel()
	next := rtFn(func(r *http.Request) (*http.Response, error) { return newStubResp(429), nil })
	tr := NewTransport("slack", next)

	req, _ := http.NewRequestWithContext(WithOperation(context.Background(), "conversations.history"), http.MethodGet, "https://example.test/x", nil)
	resp, err := tr.RoundTrip(req)
	if err != nil {
		t.Fatalf("round trip: %v", err)
	}
	if resp.StatusCode != 429 {
		t.Fatalf("status: %d", resp.StatusCode)
	}

	if got := promCounterValue(t, HTTPStatusTotal, "slack", "conversations.history", "429"); got < 1 {
		t.Fatalf("expected >=1 emit, got %v", got)
	}
}

func TestRoundTripTransportErrorEmitsZero(t *testing.T) {
	t.Parallel()
	wantErr := errors.New("dial broken")
	tr := NewTransport("stripe", rtFn(func(r *http.Request) (*http.Response, error) { return nil, wantErr }))
	req, _ := http.NewRequest(http.MethodGet, "https://example.test/y", nil)
	_, err := tr.RoundTrip(req)
	if !errors.Is(err, wantErr) {
		t.Fatalf("transport error must propagate, got %v", err)
	}
	if got := promCounterValue(t, HTTPStatusTotal, "stripe", "other", "0"); got < 1 {
		t.Fatalf("transport error should emit status_code=0, got %v", got)
	}
}

func TestWrapClientPreservesExistingTransport(t *testing.T) {
	t.Parallel()
	calls := 0
	inner := rtFn(func(r *http.Request) (*http.Response, error) { calls++; return newStubResp(200), nil })
	client := WrapClient("shopify", &http.Client{Transport: inner})
	req, _ := http.NewRequestWithContext(WithOperation(context.Background(), "oauth.token"), http.MethodGet, "https://example.test/z", nil)
	if _, err := client.Do(req); err != nil {
		t.Fatalf("do: %v", err)
	}
	if calls != 1 {
		t.Fatalf("inner transport should run, calls=%d", calls)
	}
}

func promCounterValue(t *testing.T, vec *prometheus.CounterVec, labels ...string) float64 {
	t.Helper()
	c, err := vec.GetMetricWithLabelValues(labels...)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	m := &dto.Metric{}
	if err := c.(prometheus.Metric).Write(m); err != nil {
		t.Fatalf("write: %v", err)
	}
	if m.Counter == nil {
		return 0
	}
	return m.Counter.GetValue()
}
