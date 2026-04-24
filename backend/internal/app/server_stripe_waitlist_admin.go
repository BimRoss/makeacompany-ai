package app

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"
)

func (s *Server) internalServiceBearerAuthorized(r *http.Request) bool {
	want := strings.TrimSpace(s.cfg.BackendInternalServiceToken)
	if want == "" {
		return false
	}
	got := strings.TrimSpace(tokenFromAuthHeader(r))
	return got != "" && constantTimeEqual(got, want)
}

// internalRefreshAuthorized gates POST /v1/internal/* snapshot refresh routes.
// Prefer Authorization: Bearer BACKEND_INTERNAL_SERVICE_TOKEN (Kubernetes CronJobs, compose one-shots).
// If BACKEND_INTERNAL_SERVICE_TOKEN is unset, the same routes accept an authenticated admin session
// (same checks as /v1/admin/*) so local dev is not forced to carry a second secret next to Google OAuth.
// In production, set BACKEND_INTERNAL_SERVICE_TOKEN so unattended jobs keep working without a browser session.
func (s *Server) internalRefreshAuthorized(r *http.Request) bool {
	if s.internalServiceBearerAuthorized(r) {
		return true
	}
	if strings.TrimSpace(s.cfg.BackendInternalServiceToken) != "" {
		return false
	}
	ok, _ := s.adminReadAuthorized(r)
	return ok
}

// handleInternalRefreshStripeWaitlistSnapshot rebuilds the Redis snapshot from Stripe.
func (s *Server) handleInternalRefreshStripeWaitlistSnapshot(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !s.internalRefreshAuthorized(r) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if strings.TrimSpace(s.cfg.StripeSecretKey) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "stripe is not configured"})
		return
	}
	priceID, err := s.waitlistPriceID()
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
		return
	}
	purchasers, err := FetchStripeWaitlistPurchasers(r.Context(), priceID)
	if err != nil {
		s.log.Printf("refresh stripe waitlist snapshot: %v", err)
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}
	blob, err := MarshalStripeWaitlistSnapshot(priceID, purchasers)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	if err := s.store.SaveStripeWaitlistSnapshot(r.Context(), blob); err != nil {
		s.log.Printf("save stripe waitlist snapshot: %v", err)
		http.Error(w, "redis error", http.StatusInternalServerError)
		return
	}
	profN, profErr := s.store.UpsertUserProfilesFromStripeWaitlistPurchasers(r.Context(), purchasers)
	if profErr != nil {
		s.log.Printf("refresh stripe waitlist profile upserts: %v", profErr)
	}
	fetchedAt := time.Now().UTC().Format(time.RFC3339)
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":                 true,
		"rowCount":           len(purchasers),
		"priceId":            priceID,
		"fetchedAt":          fetchedAt,
		"profileUpserts":     profN,
		"profileUpsertError": errStringOrNil(profErr),
	})
}

// tryWarmStripeWaitlistSnapshotWhenMissing fetches Stripe and writes Redis when the snapshot key is absent (mirrors
// admin slack-member-channels cold fill so /admin first load is useful before the first CronJob).
func (s *Server) tryWarmStripeWaitlistSnapshotWhenMissing(ctx context.Context) map[string]any {
	if strings.TrimSpace(s.cfg.StripeSecretKey) == "" {
		return nil
	}
	priceID, err := s.waitlistPriceID()
	if err != nil {
		s.log.Printf("admin stripe waitlist snapshot warm (missing): price id: %v", err)
		return nil
	}
	purchasers, err := FetchStripeWaitlistPurchasers(ctx, priceID)
	if err != nil {
		s.log.Printf("admin stripe waitlist snapshot warm (missing): stripe: %v", err)
		return nil
	}
	blob, mErr := MarshalStripeWaitlistSnapshot(priceID, purchasers)
	if mErr != nil {
		s.log.Printf("admin stripe waitlist snapshot warm (missing): marshal: %v", mErr)
		return nil
	}
	if svErr := s.store.SaveStripeWaitlistSnapshot(ctx, blob); svErr != nil {
		s.log.Printf("admin stripe waitlist snapshot warm (missing): save: %v", svErr)
		return nil
	}
	profN, profErr := s.store.UpsertUserProfilesFromStripeWaitlistPurchasers(ctx, purchasers)
	if profErr != nil {
		s.log.Printf("admin stripe waitlist snapshot warm (missing): profile upserts: %v", profErr)
	}
	fetchedAt := time.Now().UTC().Format(time.RFC3339)
	return map[string]any{
		"source":             "snapshot",
		"fetchedAt":          fetchedAt,
		"priceId":            priceID,
		"purchasers":         purchasers,
		"snapshotNote":       "Filled from Stripe (Redis waitlist snapshot was missing).",
		"profileUpserts":     profN,
		"profileUpsertError": errStringOrNil(profErr),
	}
}

// handleAdminStripeWaitlistPurchasers returns cached Stripe waitlist purchasers or a live Stripe query when source=live.
func (s *Server) handleAdminStripeWaitlistPurchasers(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	ok, svcUnavail := s.adminReadAuthorized(r)
	if !ok {
		if svcUnavail {
			http.Error(w, "admin auth disabled", http.StatusServiceUnavailable)
		} else {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
		}
		return
	}
	live := strings.EqualFold(strings.TrimSpace(r.URL.Query().Get("source")), "live")
	if live {
		if strings.TrimSpace(s.cfg.StripeSecretKey) == "" {
			writeJSONNoStore(w, http.StatusBadRequest, map[string]any{"error": "stripe is not configured"})
			return
		}
		priceID, err := s.waitlistPriceID()
		if err != nil {
			writeJSONNoStore(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
			return
		}
		purchasers, err := FetchStripeWaitlistPurchasers(r.Context(), priceID)
		if err != nil {
			s.log.Printf("admin stripe waitlist live: %v", err)
			writeJSONNoStore(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
			return
		}
		resp := map[string]any{
			"source":       "live",
			"fetchedAt":    time.Now().UTC().Format(time.RFC3339),
			"priceId":      priceID,
			"purchasers":   purchasers,
			"snapshotNote": "Queried Stripe API; snapshot and user_profile hashes written to Redis (same data paths as internal refresh).",
		}
		if blob, mErr := MarshalStripeWaitlistSnapshot(priceID, purchasers); mErr != nil {
			s.log.Printf("admin stripe waitlist live marshal: %v", mErr)
			resp["redisSaveError"] = mErr.Error()
		} else if svErr := s.store.SaveStripeWaitlistSnapshot(r.Context(), blob); svErr != nil {
			s.log.Printf("admin stripe waitlist live save snapshot: %v", svErr)
			resp["redisSaveError"] = svErr.Error()
		} else {
			profN, profErr := s.store.UpsertUserProfilesFromStripeWaitlistPurchasers(r.Context(), purchasers)
			resp["profileUpserts"] = profN
			resp["profileUpsertError"] = errStringOrNil(profErr)
			if profErr != nil {
				s.log.Printf("admin stripe waitlist live profile upserts: %v", profErr)
			}
		}
		writeJSONNoStore(w, http.StatusOK, resp)
		return
	}

	raw, err := s.store.GetStripeWaitlistSnapshotBytes(r.Context())
	if err != nil {
		if errors.Is(err, ErrStripeWaitlistSnapshotMissing) {
			if warm := s.tryWarmStripeWaitlistSnapshotWhenMissing(r.Context()); warm != nil {
				writeJSONNoStore(w, http.StatusOK, warm)
				return
			}
			writeJSONNoStore(w, http.StatusOK, map[string]any{
				"source":       "snapshot",
				"fetchedAt":    nil,
				"priceId":      nil,
				"purchasers":   []StripeWaitlistPurchaser{},
				"snapshotNote": "No snapshot yet. CronJob POST /v1/internal/refresh-stripe-waitlist-snapshot or use ?source=live once.",
			})
			return
		}
		s.log.Printf("admin stripe waitlist snapshot get: %v", err)
		http.Error(w, "redis error", http.StatusInternalServerError)
		return
	}
	env, err := ParseStripeWaitlistSnapshotEnvelope(raw)
	if err != nil {
		s.log.Printf("admin stripe waitlist snapshot parse: %v", err)
		http.Error(w, "corrupt snapshot", http.StatusInternalServerError)
		return
	}
	writeJSONNoStore(w, http.StatusOK, map[string]any{
		"source":       "snapshot",
		"fetchedAt":    env.FetchedAt,
		"priceId":      env.PriceID,
		"purchasers":   env.Purchasers,
		"snapshotNote": env.SnapshotNote,
	})
}
