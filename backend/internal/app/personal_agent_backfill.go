package app

import (
	"net/http"
	"strings"
)

// handlePersonalAgentBackfillManifest pushes the current manifest template to
// every existing personal-agent Slack app via apps.manifest.update. Its reason
// to exist: agents created before a manifest change (e.g. subscribing to
// app_uninstalled) don't get the new config retroactively — apps.manifest.create
// stamps the manifest once at install. This re-stamps them all.
//
// Idempotent and safe to re-run: apps.manifest.update with an unchanged
// manifest is a no-op at Slack. Gated on the internal-service-token header
// (same one /v1/internal/* uses) so it's callable from a curl-with-the-secret
// but not the public surface. Mirrors handlePersonalAgentRolloutAll.
func (s *Server) handlePersonalAgentBackfillManifest(w http.ResponseWriter, r *http.Request) {
	want := strings.TrimSpace(s.cfg.BackendInternalServiceToken)
	got := strings.TrimSpace(r.Header.Get("X-Backend-Internal-Token"))
	if want == "" || got == "" || want != got {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if s.slackManifest == nil || s.slackManifest.Disabled() {
		http.Error(w, "manifest client disabled", http.StatusServiceUnavailable)
		return
	}

	recs, err := s.store.ListPersonalAgents(r.Context())
	if err != nil {
		http.Error(w, "list agents: "+err.Error(), http.StatusInternalServerError)
		return
	}

	type backfillResult struct {
		Total   int      `json:"total"`
		Updated int      `json:"updated"`
		Skipped int      `json:"skipped"`
		Failed  int      `json:"failed"`
		Errors  []string `json:"errors,omitempty"`
	}
	result := backfillResult{Total: len(recs)}

	for _, rec := range recs {
		appID := strings.TrimSpace(rec.SlackAppID)
		if appID == "" {
			// Pending-install agent that never got an app id — nothing to update.
			result.Skipped++
			continue
		}
		manifest, err := RenderPersonalAgentManifest(PersonalAgentManifestSubstitutions{
			DisplayName:        rec.DisplayName,
			Description:        rec.Description,
			LongDescription:    rec.LongDescription,
			EventsRequestURL:   s.cfg.EventsGatewayRequestURL,
			InstallRedirectURL: s.personalAgentInstallRedirectFor(rec.ID),
		})
		if err != nil {
			result.Failed++
			result.Errors = append(result.Errors, rec.ID+" ("+appID+"): render: "+err.Error())
			continue
		}
		if err := s.slackManifest.UpdateManifest(r.Context(), appID, manifest); err != nil {
			result.Failed++
			result.Errors = append(result.Errors, rec.ID+" ("+appID+"): update: "+err.Error())
			continue
		}
		result.Updated++
		s.log.Printf("personal-agent manifest backfill: updated agent=%s app_id=%s", rec.ID, appID)
	}

	s.log.Printf("personal-agent manifest backfill: total=%d updated=%d skipped=%d failed=%d",
		result.Total, result.Updated, result.Skipped, result.Failed)
	writeJSON(w, http.StatusOK, result)
}
