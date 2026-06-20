package app

import (
	"context"
	"fmt"
	"strings"
	"time"
)

// FreeLifetimeSeatCap is the size of the pre-cliff free-for-life cohort. Matches WaitlistCap and
// LanderSeatCap today; #324 unifies these three constants into one source of truth.
const FreeLifetimeSeatCap = 100

// FreeTrialDuration is how long a post-cliff signup gets full access before Joanne's expiry DM
// fires (#244) and the dispatcher silence gate (#243) kicks in.
const FreeTrialDuration = 10 * 24 * time.Hour

// LifecycleAssignment is the outcome of AssignInitialLifecycleTier.
type LifecycleAssignment string

const (
	LifecycleAssignmentUnchanged    LifecycleAssignment = "unchanged"
	LifecycleAssignmentFreeLifetime LifecycleAssignment = "free_lifetime"
	LifecycleAssignmentTrialing     LifecycleAssignment = "trialing"
)

// isOperatorAllowlisted returns true when the email is in cfg.MarketingAllowlist (Grant, John, and
// any other operator emails configured via MARKETING_ALLOWLIST). Allowlisted operators always land
// in free_lifetime regardless of seat count — they must never get silenced by the dispatcher gate.
func (s *Server) isOperatorAllowlisted(email string) bool {
	em := normalizeProfileEmail(email)
	if em == "" {
		return false
	}
	for _, allowed := range s.cfg.MarketingAllowlist {
		if normalizeProfileEmail(allowed) == em {
			return true
		}
	}
	return false
}

// AssignInitialLifecycleTier decides whether a fresh profile becomes free_lifetime or trialing
// and stamps it. Idempotent: if the profile already has free_lifetime=true or a non-zero
// trial_expires_at, returns LifecycleAssignmentUnchanged.
//
// Decision rule (matches #240/#325):
//   - email in operator allowlist → free_lifetime
//   - count of existing free_lifetime profiles < FreeLifetimeSeatCap → free_lifetime
//   - else → trialing, trial_expires_at = now + FreeTrialDuration
//
// Called from SyncSlackUserIndexFromWorkspaceUsers (canonical "we noticed you in the Slack
// workspace" point) and handleBillingFreeTrialInvite (lander email-capture path).
func (s *Server) AssignInitialLifecycleTier(ctx context.Context, email string) (LifecycleAssignment, error) {
	if s == nil || s.store == nil {
		return LifecycleAssignmentUnchanged, fmt.Errorf("nil server/store")
	}
	em := normalizeProfileEmail(email)
	if em == "" {
		return LifecycleAssignmentUnchanged, fmt.Errorf("missing email")
	}
	row, err := s.store.UserProfileRowByEmail(ctx, em)
	if err != nil {
		return LifecycleAssignmentUnchanged, fmt.Errorf("load profile: %w", err)
	}
	if row.FreeLifetime || row.TrialExpiresAt > 0 {
		return LifecycleAssignmentUnchanged, nil
	}
	// A live Stripe subscription is its own answer — don't stamp a trial deadline on a paying user.
	if status := strings.ToLower(strings.TrimSpace(row.StripeSubscriptionStatus)); status == "active" || status == "trialing" {
		return LifecycleAssignmentUnchanged, nil
	}
	if s.isOperatorAllowlisted(em) {
		if err := s.store.MarkProfileFreeLifetime(ctx, em); err != nil {
			return LifecycleAssignmentUnchanged, fmt.Errorf("mark free_lifetime (allowlist): %w", err)
		}
		return LifecycleAssignmentFreeLifetime, nil
	}
	count, err := s.store.CountFreeLifetimeProfiles(ctx)
	if err != nil {
		return LifecycleAssignmentUnchanged, fmt.Errorf("count free_lifetime: %w", err)
	}
	if count < FreeLifetimeSeatCap {
		if err := s.store.MarkProfileFreeLifetime(ctx, em); err != nil {
			return LifecycleAssignmentUnchanged, fmt.Errorf("mark free_lifetime: %w", err)
		}
		return LifecycleAssignmentFreeLifetime, nil
	}
	deadline := time.Now().UTC().Add(FreeTrialDuration).Unix()
	if err := s.store.UpsertUserProfileFreeTrialInvite(ctx, em, row.AttributedTo, deadline); err != nil {
		return LifecycleAssignmentUnchanged, fmt.Errorf("mark trialing: %w", err)
	}
	trialStartTotal.WithLabelValues(strings.TrimSpace(row.AttributedTo)).Inc()
	return LifecycleAssignmentTrialing, nil
}

// assignLifecycleTiersForWorkspaceUsers runs AssignInitialLifecycleTier for every non-bot,
// non-deleted Slack member with a visible email. Called from the snapshot-warm path so a fresh
// Slack join lands as free_lifetime or trialing within one sync tick. Errors per-user are logged
// and skipped — one bad row should not block the rest of the sweep.
func (s *Server) assignLifecycleTiersForWorkspaceUsers(ctx context.Context, users []SlackWorkspaceUser) (freeLifetime, trialing int) {
	if s == nil {
		return 0, 0
	}
	for _, u := range users {
		if u.IsBot || u.IsDeleted {
			continue
		}
		em := normalizeProfileEmail(u.Email)
		if em == "" || !strings.Contains(em, "@") {
			continue
		}
		result, err := s.AssignInitialLifecycleTier(ctx, em)
		if err != nil {
			s.log.Printf("assign lifecycle tier %s: %v", em, err)
			continue
		}
		switch result {
		case LifecycleAssignmentFreeLifetime:
			freeLifetime++
		case LifecycleAssignmentTrialing:
			trialing++
		}
	}
	return freeLifetime, trialing
}
