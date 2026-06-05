package app

import (
	"errors"
	"net/http"
)

// handleInternalClusterHealth is the GET /v1/internal/cluster-health handler
// (makeacompany-ai#290). Gated by BACKEND_INTERNAL_SERVICE_TOKEN — same auth
// shape as the other /v1/internal/* routes.
//
// Returns 503 + {"error": "disabled"} when the backend has no in-cluster
// config (local dev). Returns 500 on any list failure. On success, returns
// the ClusterHealthSummary JSON shape documented in #290.
func (s *Server) handleInternalClusterHealth(w http.ResponseWriter, r *http.Request) {
	if !s.internalServiceBearerAuthorized(r) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	if s.clusterHealth.Disabled() {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{
			"error":  "disabled",
			"reason": "no in-cluster config — cluster-health endpoint is only meaningful when the backend runs inside k8s",
		})
		return
	}
	summary, err := s.clusterHealth.Summary(r.Context())
	if err != nil {
		if errors.Is(err, ErrClusterHealthDisabled) {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "disabled"})
			return
		}
		s.log.Printf("cluster-health summary: %v", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "list_failed"})
		return
	}
	writeJSON(w, http.StatusOK, summary)
}
