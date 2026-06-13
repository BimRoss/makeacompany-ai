// Package upstream emits provider-tagged Prometheus metrics for outbound
// HTTP traffic. Wrap any *http.Client's Transport with NewTransport (or use
// WrapClient) to get latency + status_code series labeled by provider.
//
// Call-sites set operation via context: req = req.WithContext(upstream.WithOperation(ctx, "messages")).
// Unknown operations coerce to "other" so a typo or new endpoint can't blow up cardinality.
package upstream

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/prometheus/client_golang/prometheus"
)

var (
	HTTPStatusTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "makeacompany_upstream_http_status_total",
			Help: "Total outbound HTTP responses by provider, operation, and status_code. status_code=0 on transport error.",
		},
		[]string{"provider", "operation", "status_code"},
	)

	HTTPDurationSeconds = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "makeacompany_upstream_http_duration_seconds",
			Help:    "Outbound HTTP request duration in seconds by provider and operation.",
			Buckets: []float64{.005, .01, .025, .05, .1, .25, .5, 1, 2.5, 5, 10, 30},
		},
		[]string{"provider", "operation"},
	)
)

func init() {
	prometheus.MustRegister(HTTPStatusTotal, HTTPDurationSeconds)
}

type opKey struct{}

// WithOperation tags a context so the upstream RoundTripper labels the emitted
// metric with the given operation. The operation must appear in the provider's
// allow-list (see allowedOps); anything else is coerced to "other".
func WithOperation(ctx context.Context, op string) context.Context {
	return context.WithValue(ctx, opKey{}, op)
}

func operationFrom(ctx context.Context) string {
	if v, ok := ctx.Value(opKey{}).(string); ok {
		return v
	}
	return ""
}

// allowedOps caps cardinality. Add an entry when wiring a new call-site.
var allowedOps = map[string]map[string]struct{}{
	"stripe": {
		"checkout.session.create":     {},
		"checkout.session.retrieve":   {},
		"checkout.session.list":       {},
		"checkout.session.line_items": {},
		"customer.retrieve":           {},
		"subscription.retrieve":       {},
		"subscription.update":         {},
		"webhook.construct":           {},
	},
	"shopify": {
		"oauth.token":  {},
		"oauth.revoke": {},
	},
	"slack": {
		"auth.test":             {},
		"conversations.history": {},
		"conversations.members": {},
		"users.conversations":   {},
		"users.list":            {},
	},
	"anthropic": {
		"messages": {},
	},
	"openai": {
		"chat.completions": {},
	},
}

func coerceOp(provider, op string) string {
	if op == "" {
		return "other"
	}
	if ops, ok := allowedOps[provider]; ok {
		if _, ok := ops[op]; ok {
			return op
		}
	}
	return "other"
}

// Transport wraps an http.RoundTripper and emits provider-tagged metrics on
// every request. Use NewTransport rather than constructing directly so Next
// gets a sensible default.
type Transport struct {
	Provider string
	Next     http.RoundTripper
}

func NewTransport(provider string, next http.RoundTripper) *Transport {
	if next == nil {
		next = http.DefaultTransport
	}
	return &Transport{Provider: provider, Next: next}
}

func (t *Transport) RoundTrip(req *http.Request) (*http.Response, error) {
	op := coerceOp(t.Provider, operationFrom(req.Context()))
	start := time.Now()
	resp, err := t.Next.RoundTrip(req)
	HTTPDurationSeconds.WithLabelValues(t.Provider, op).Observe(time.Since(start).Seconds())
	status := 0
	if resp != nil {
		status = resp.StatusCode
	}
	HTTPStatusTotal.WithLabelValues(t.Provider, op, strconv.Itoa(status)).Inc()
	return resp, err
}

// WrapClient mutates client so its Transport emits provider-tagged metrics,
// then returns it for chained construction. Pass a fresh *http.Client per
// call-site; sharing a wrapped client across providers would mis-label the
// emitted series.
func WrapClient(provider string, client *http.Client) *http.Client {
	if client == nil {
		client = &http.Client{}
	}
	client.Transport = NewTransport(provider, client.Transport)
	return client
}
