package app

import (
	"fmt"
	"strings"
	"testing"
)

// TestPersonalAgentForwardTarget_IgnoresStaleServiceName is the regression
// guard for the #653 prod incident: the events gateway must derive the forward
// service name from the agent id, NOT from rec.ServiceName, which went stale
// after the #651 re-key migration renamed the Services.
func TestPersonalAgentForwardTarget_IgnoresStaleServiceName(t *testing.T) {
	const agentID = "agent-abc-123"
	want := personalAgentResourceName(agentID)

	rec := PersonalAgentRecord{
		ID:               agentID,
		ServiceName:      "personal-agent-deadbeefcafe", // stale: a name that no longer exists
		ServiceNamespace: defaultPersonalAgentNamespace,
		ServicePort:      PersonalAgentServicePort,
	}

	target := personalAgentForwardTarget(rec)

	if strings.Contains(target, rec.ServiceName) {
		t.Fatalf("target leaked stale service_name %q: %s", rec.ServiceName, target)
	}
	if !strings.Contains(target, want) {
		t.Fatalf("target = %s, want it to use computed name %q", target, want)
	}

	expected := fmt.Sprintf("http://%s.%s.svc.cluster.local:%d/slack/events",
		want, defaultPersonalAgentNamespace, PersonalAgentServicePort)
	if target != expected {
		t.Fatalf("target = %s, want %s", target, expected)
	}
}

// TestPersonalAgentForwardTarget_DefaultsWhenBindingEmpty covers a pre-#651
// record whose namespace/port were never stored: the helper falls back to the
// well-known defaults rather than emitting an unroutable URL.
func TestPersonalAgentForwardTarget_DefaultsWhenBindingEmpty(t *testing.T) {
	const agentID = "agent-no-binding"
	rec := PersonalAgentRecord{ID: agentID} // ServiceNamespace/Port zero-valued

	want := fmt.Sprintf("http://%s.%s.svc.cluster.local:%d/slack/events",
		personalAgentResourceName(agentID), defaultPersonalAgentNamespace, PersonalAgentServicePort)

	if got := personalAgentForwardTarget(rec); got != want {
		t.Fatalf("target = %s, want %s", got, want)
	}
}
