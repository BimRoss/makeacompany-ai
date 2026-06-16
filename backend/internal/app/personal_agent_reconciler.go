package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
)

// reconcilePersonalAgentImages walks every personal-agent Deployment and:
//   - if its container image disagrees with cfg.PersonalAgentImage, patches
//     the spec to swap the image (which triggers the Deployment controller
//     to roll a new ReplicaSet).
//   - emits a "restart-trigger" annotation when force=true even if the image
//     hasn't changed, so an operator can mass-rollout same-tag agents
//     (typically for `:latest` where the underlying digest moved).
//
// Returns counts so callers (boot-time goroutine, admin endpoint) can log
// what they did. Non-fatal on per-Deployment failures — one bad pod
// shouldn't stop the rest of the fleet from rolling.
type reconcileAgentImagesResult struct {
	Inspected   int      `json:"inspected"`
	ImageBumped int      `json:"imageBumped"`
	Restarted   int      `json:"restarted"`
	Errors      []string `json:"errors,omitempty"`
}

func (s *Server) reconcilePersonalAgentImages(ctx context.Context, force bool) reconcileAgentImagesResult {
	var result reconcileAgentImagesResult
	if s.personalAgent == nil || s.personalAgent.Disabled() {
		return result
	}
	desired := strings.TrimSpace(s.cfg.PersonalAgentImage)
	if desired == "" {
		// No desired image configured; nothing to enforce.
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
	result.Inspected = len(deps.Items)
	now := time.Now().UTC().Format(time.RFC3339)

	for i := range deps.Items {
		dep := &deps.Items[i]
		current := containerImage(dep)
		needsImagePatch := current != desired
		needsRestart := force

		if !needsImagePatch && !needsRestart {
			continue
		}

		patchObj := map[string]any{
			"spec": map[string]any{
				"template": map[string]any{
					"metadata": map[string]any{
						"annotations": map[string]any{
							"bimross.com/last-reconciled-at": now,
						},
					},
				},
			},
		}
		if needsImagePatch {
			patchObj["spec"].(map[string]any)["template"].(map[string]any)["spec"] = map[string]any{
				"containers": []any{
					map[string]any{
						"name":  "personal-agent",
						"image": desired,
					},
				},
			}
		}
		patchBytes, err := json.Marshal(patchObj)
		if err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("marshal patch for %s: %v", dep.Name, err))
			continue
		}
		_, err = s.personalAgent.cs.AppsV1().Deployments(ns).Patch(ctx, dep.Name, types.StrategicMergePatchType, patchBytes, metav1.PatchOptions{})
		if err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("patch %s: %v", dep.Name, err))
			continue
		}
		if needsImagePatch {
			result.ImageBumped++
			s.log.Printf("personal-agent reconciler bumped %s/%s: %s -> %s", ns, dep.Name, current, desired)
		}
		if needsRestart {
			result.Restarted++
			s.log.Printf("personal-agent reconciler restarted %s/%s", ns, dep.Name)
		}
	}
	return result
}

func containerImage(dep interface{}) string {
	type podSpec struct {
		Template struct {
			Spec struct {
				Containers []corev1.Container `json:"containers"`
			} `json:"spec"`
		} `json:"template"`
	}
	// Reflect through json round-trip — simpler than depending on appsv1.Deployment
	// being passed by pointer at this call site.
	buf, err := json.Marshal(dep)
	if err != nil {
		return ""
	}
	var s struct {
		Spec podSpec `json:"spec"`
	}
	if err := json.Unmarshal(buf, &s); err != nil {
		return ""
	}
	for _, c := range s.Spec.Template.Spec.Containers {
		if c.Name == "personal-agent" {
			return c.Image
		}
	}
	return ""
}

// StartPersonalAgentReconciler runs the reconciler once at boot (so a tag bump
// on the mac-ai backend rolls every per-agent pod automatically) and then
// every reconcileInterval to catch out-of-band image config drift.
func (s *Server) StartPersonalAgentReconciler(ctx context.Context) {
	const reconcileInterval = 5 * time.Minute
	if s.personalAgent == nil || s.personalAgent.Disabled() {
		s.log.Printf("personal-agent reconciler skipped (writer disabled)")
		return
	}
	go func() {
		// Boot-time pass with a small delay so the rest of NewServer finishes
		// wiring before we start patching things.
		select {
		case <-ctx.Done():
			return
		case <-time.After(30 * time.Second):
		}
		r := s.reconcilePersonalAgentImages(ctx, false)
		s.log.Printf("personal-agent reconciler boot pass: inspected=%d image_bumped=%d restarted=%d errors=%d",
			r.Inspected, r.ImageBumped, r.Restarted, len(r.Errors))

		t := time.NewTicker(reconcileInterval)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				r := s.reconcilePersonalAgentImages(ctx, false)
				if r.ImageBumped > 0 || len(r.Errors) > 0 {
					s.log.Printf("personal-agent reconciler tick: inspected=%d image_bumped=%d restarted=%d errors=%d",
						r.Inspected, r.ImageBumped, r.Restarted, len(r.Errors))
				}
			}
		}
	}()
}

// handlePersonalAgentRolloutAll is the admin trigger that forces a rolling
// restart of every per-agent Deployment, regardless of whether the image
// changed. Useful when PA's :latest tag moved underneath us and we want
// every agent to pick it up without bumping mac-ai's config.
//
// Gated on the internal-service-token header (same one /v1/internal/* uses)
// so it's callable from joanne / cron / a curl-on-laptop with the right
// shared secret but NOT from the public surface.
func (s *Server) handlePersonalAgentRolloutAll(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	want := strings.TrimSpace(s.cfg.BackendInternalServiceToken)
	got := strings.TrimSpace(r.Header.Get("X-Backend-Internal-Token"))
	if want == "" || got == "" || want != got {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	result := s.reconcilePersonalAgentImages(r.Context(), true)
	writeJSON(w, http.StatusOK, result)
}
