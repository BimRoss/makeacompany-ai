package app

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"makeacompany-ai/backend/internal/upstream"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// Personal-agent liveness prune.
//
// The image reconciler (reconcilePersonalAgentImages) only ever patches
// deployments it finds — it never removes one. So an agent that's deleted on
// the Slack side (its bot deactivated / app uninstalled) leaves its
// Deployment + Service + Secret behind forever. The fresh pod runs auth.test
// at boot, gets `account_inactive`, and CrashLoopBackOffs indefinitely while
// the stale pre-deactivation pod keeps serving. We hit exactly this on
// 2026-06-18 (slack user U0B9Q7ZFY3W). This pass closes that gap by treating
// a *definitively dead* Slack token as the deprovision signal.
//
// Safety is the whole game here: a false positive nukes a live agent's
// Deployment + runtime Secret. Two guards:
//   - Only DEFINITIVE dead-token codes count (account_inactive, token_revoked).
//     Ambiguous/transient outcomes (invalid_auth — could be a mid-rotation
//     race — ratelimited, network errors, a missing secret on a just-created
//     agent) never prune and RESET the streak, so a single flaky pass can't
//     accumulate toward a delete.
//   - A deployment is only torn down after the definitive signal is observed
//     on pruneStreakThreshold consecutive reconciler passes. account_inactive
//     is sticky once Slack deactivates an account, so a genuinely-dead agent
//     trips this within ~2 ticks; a blip does not.

const (
	// pruneStreakThreshold is how many consecutive reconciler passes must
	// observe a definitive dead-token signal before we deprovision. >1 so a
	// single anomalous pass can't delete a live agent.
	pruneStreakThreshold = 2

	// slackAuthTestURL is the Slack auth.test endpoint. Var (not const) so
	// tests can point it at an httptest server.
	slackAuthTestURLDefault = "https://slack.com/api/auth.test"

	pruneAuthTestHTTPTimeout = 15 * time.Second
)

// slackAuthTestURL is overridable in tests.
var slackAuthTestURL = slackAuthTestURLDefault

// definitiveDeadTokenCodes are the Slack auth.test error codes that mean the
// token's identity is gone for good — not a transient or recoverable state.
// Deliberately narrow. invalid_auth is intentionally EXCLUDED: it also fires
// during a token rotation before the new secret lands, and auto-deleting on it
// would race-delete a healthy agent mid-rotation.
var definitiveDeadTokenCodes = map[string]bool{
	"account_inactive": true,
	"token_revoked":    true,
}

func isDefinitiveDeadToken(code string) bool {
	return definitiveDeadTokenCodes[strings.TrimSpace(code)]
}

// pruneDecision is the pure guard logic, isolated for exhaustive testing.
// Given the streak carried from prior passes and this pass's auth.test
// outcome, it returns the new streak and whether to deprovision now.
//
//   - auth ok                  → reset streak, never prune (agent is alive)
//   - definitive dead token    → increment streak; prune once it reaches
//     pruneStreakThreshold
//   - anything else (ambiguous / transient / network) → reset streak, never
//     prune (don't let flaky signals accumulate)
func pruneDecision(prevStreak int, authOK bool, errCode string) (streak int, prune bool) {
	if authOK {
		return 0, false
	}
	if isDefinitiveDeadToken(errCode) {
		streak = prevStreak + 1
		return streak, streak >= pruneStreakThreshold
	}
	return 0, false
}

// slackAuthTestResponse is the subset of auth.test we read.
type slackAuthTestResponse struct {
	OK    bool   `json:"ok"`
	Error string `json:"error"`
}

// slackAuthTest calls Slack auth.test with the given bot token and reports
// whether the token is live plus, on failure, the Slack error code. A non-nil
// err means we couldn't get a verdict (network / non-200 / unparseable) — the
// caller treats that as a non-definitive outcome and resets the streak.
func slackAuthTest(ctx context.Context, token string) (ok bool, errCode string, err error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return false, "", fmt.Errorf("auth.test: empty token")
	}
	client := upstream.WrapClient("slack", &http.Client{Timeout: pruneAuthTestHTTPTimeout})
	req, err := http.NewRequestWithContext(upstream.WithOperation(ctx, "auth.test"), http.MethodPost, slackAuthTestURL, nil)
	if err != nil {
		return false, "", err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := client.Do(req)
	if err != nil {
		return false, "", err
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	_ = resp.Body.Close()
	if err != nil {
		return false, "", err
	}
	if resp.StatusCode != http.StatusOK {
		return false, "", fmt.Errorf("auth.test: status %d", resp.StatusCode)
	}
	var parsed slackAuthTestResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return false, "", fmt.Errorf("auth.test: decode: %w", err)
	}
	return parsed.OK, strings.TrimSpace(parsed.Error), nil
}

type reconcilePruneResult struct {
	Checked      int
	DeadObserved int // passes this tick that saw a definitive dead token
	Pruned       int
	Errors       []string
}

// reconcilePersonalAgentLiveness checks each live personal-agent deployment's
// Slack token and deprovisions any whose token is definitively dead across
// pruneStreakThreshold consecutive passes. streak is owned by the reconciler
// goroutine and carried across ticks (keyed by the deployment's agent-id
// annotation, #651 — so one owner's multiple agents don't collapse into a
// single dead-token streak); entries for deployments that no longer exist or
// recover are pruned from the map so it can't grow unbounded.
func (s *Server) reconcilePersonalAgentLiveness(ctx context.Context, streak map[string]int) reconcilePruneResult {
	var result reconcilePruneResult
	if s.personalAgent == nil || s.personalAgent.Disabled() {
		return result
	}

	ns := s.personalAgent.AgentNamespace()
	deps, err := s.personalAgent.cs.AppsV1().Deployments(ns).List(ctx, metav1.ListOptions{
		LabelSelector: "app.kubernetes.io/managed-by=" + personalAgentManagedByLabelValue,
	})
	if err != nil {
		result.Errors = append(result.Errors, fmt.Sprintf("list deployments: %v", err))
		return result
	}

	seen := make(map[string]bool, len(deps.Items))
	for i := range deps.Items {
		dep := &deps.Items[i]
		agentID := strings.TrimSpace(dep.Annotations[personalAgentAnnoAgentID])
		if agentID == "" {
			// No agent-id annotation — can't safely target a delete by agent id
			// (the resource key). Pre-migration deployments are renamed under the
			// agent-id-hashed name by the migration pass, which carries the
			// annotation, so this only fires for genuinely-malformed objects.
			// Leave it for the operator.
			continue
		}
		ownerSlackUserID := strings.TrimSpace(dep.Annotations[personalAgentAnnoSlackUserID])
		// Safety assertion: only ever act on a deployment whose name is the one
		// the AGENT ID hashes to. If they disagree, something is off with this
		// deployment's provenance — skip rather than risk deleting the wrong
		// resources by name.
		if personalAgentResourceName(agentID) != dep.Name {
			result.Errors = append(result.Errors,
				fmt.Sprintf("skip %s: name does not match agent-id hash (annotation %s)", dep.Name, agentID))
			continue
		}
		seen[agentID] = true
		result.Checked++

		token, err := s.personalAgent.ReadAgentBotToken(ctx, agentID)
		if err != nil {
			// Missing/unreadable secret is non-definitive (e.g. a just-created
			// agent whose secret hasn't landed). Reset and move on.
			delete(streak, agentID)
			continue
		}

		ok, code, err := slackAuthTest(ctx, token)
		if err != nil {
			// No verdict (network/non-200). Treat as non-definitive: reset.
			delete(streak, agentID)
			continue
		}

		newStreak, prune := pruneDecision(streak[agentID], ok, code)
		if newStreak > 0 {
			streak[agentID] = newStreak
			result.DeadObserved++
		} else {
			delete(streak, agentID)
		}

		if !prune {
			continue
		}

		s.log.Printf("personal-agent liveness: deprovisioning %s/%s (agent=%s owner=%s) — slack token dead (error=%q, %d consecutive passes)",
			ns, dep.Name, agentID, ownerSlackUserID, code, newStreak)
		if derr := s.deprovisionDeadPersonalAgent(ctx, agentID, ownerSlackUserID); derr != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("deprovision %s: %v", dep.Name, derr))
			continue
		}
		delete(streak, agentID)
		result.Pruned++
	}

	// Drop streak entries for deployments that vanished between passes so the
	// map tracks only currently-live agents.
	for id := range streak {
		if !seen[id] {
			delete(streak, id)
		}
	}
	return result
}

// deprovisionDeadPersonalAgent tears down a personal agent the liveness pass
// found dead. agentID is the authoritative resource key (#651) read from the
// deployment's agent-id annotation; ownerSlackUserID is carried only for log
// attribution. Resolves the store record (best-effort) for DB cleanup, then
// delegates to the shared teardown keyed by agent id.
//
// For THIS PR behavior is unchanged (still one agent per owner): the record is
// resolved via GetPersonalAgentByOwner. PR #2's Redis-list work replaces that
// owner lookup; the K8s teardown is already keyed by agent id here.
func (s *Server) deprovisionDeadPersonalAgent(ctx context.Context, agentID, ownerSlackUserID string) error {
	var rec *PersonalAgentRecord
	if r, err := s.store.GetPersonalAgentByOwner(ctx, ownerSlackUserID); err != nil {
		s.log.Printf("personal-agent liveness: DB row lookup for owner=%s (agent=%s) skipped/failed: %v", ownerSlackUserID, agentID, err)
	} else {
		rec = &r
	}
	return s.deprovisionPersonalAgent(ctx, agentID, rec)
}

// deprovisionPersonalAgent is the single end-to-end teardown, mirroring the
// portal delete handler: K8s resources first (Deployment + Service + Secret),
// then the store record. Shared by the liveness prune and the app_uninstalled
// webhook so there is exactly one teardown definition.
//
//   - agentID is the authoritative key the per-agent K8s resources are NAMED by
//     (#651). It is what DeleteAgentResources keys off.
//   - rec, when non-nil, is the store record to delete. DB cleanup is
//     best-effort: the K8s teardown is the load-bearing part (it stops the
//     crashloop / frees the slot), so a missing or failed DB delete must not
//     fail the whole operation. A nil rec means "no record to clean" (already
//     gone, or never resolved).
func (s *Server) deprovisionPersonalAgent(ctx context.Context, agentID string, rec *PersonalAgentRecord) error {
	if err := s.personalAgent.DeleteAgentResources(ctx, agentID); err != nil {
		return fmt.Errorf("delete k8s resources: %w", err)
	}
	if rec == nil {
		return nil
	}
	if err := s.store.DeletePersonalAgent(ctx, *rec); err != nil {
		s.log.Printf("personal-agent deprovision: k8s torn down for %s but DB delete failed: %v", agentID, err)
	}
	return nil
}
