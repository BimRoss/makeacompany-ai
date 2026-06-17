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
	Inspected     int      `json:"inspected"`
	ImageBumped   int      `json:"imageBumped"`
	Restarted     int      `json:"restarted"`
	InitContainer int      `json:"initContainerPatched"`
	Errors        []string `json:"errors,omitempty"`
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
		needsInitContainer := !hasPersonalAgentInitContainer(dep)
		needsRestart := force

		if !needsImagePatch && !needsRestart && !needsInitContainer {
			continue
		}

		// Retrofit path: pre-fix deployments name their workspace volume
		// something other than "data", so strategic-merge-patching in the
		// new chown init container (whose volumeMount references "data")
		// fails K8s validation. For those, rebuild the spec authoritatively
		// via WriteAgentDeployment instead of patching, which replaces the
		// pod template wholesale (new volume name, init container, image).
		if needsInitContainer {
			req, err := personalAgentReqFromDeployment(dep, desired)
			if err != nil {
				result.Errors = append(result.Errors, fmt.Sprintf("rebuild req for %s: %v", dep.Name, err))
				continue
			}
			if err := s.personalAgent.WriteAgentDeployment(ctx, req); err != nil {
				result.Errors = append(result.Errors, fmt.Sprintf("rewrite deployment %s: %v", dep.Name, err))
				continue
			}
			// Stamp the audit annotation on the pod template so a future
			// reconcile (or operator) can tell when we last touched this
			// deployment. WriteAgentDeployment builds the Deployment from
			// scratch and doesn't carry pod-template annotations, so do a
			// second annotation-only patch.
			annoPatch := map[string]any{
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
			annoBytes, _ := json.Marshal(annoPatch)
			if _, err := s.personalAgent.cs.AppsV1().Deployments(ns).Patch(ctx, dep.Name, types.StrategicMergePatchType, annoBytes, metav1.PatchOptions{}); err != nil {
				result.Errors = append(result.Errors, fmt.Sprintf("stamp reconciled-at on %s: %v", dep.Name, err))
				// non-fatal: deployment is already rewritten correctly.
			}
			result.InitContainer++
			s.log.Printf("personal-agent reconciler retrofit %s/%s via full Update (init container + canonical volume)", ns, dep.Name)
			if needsImagePatch {
				result.ImageBumped++
			}
			if needsRestart {
				result.Restarted++
			}
			continue
		}

		templateSpec := map[string]any{}
		if needsImagePatch {
			templateSpec["containers"] = []any{
				map[string]any{
					"name":  "personal-agent",
					"image": desired,
				},
			}
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
		if len(templateSpec) > 0 {
			patchObj["spec"].(map[string]any)["template"].(map[string]any)["spec"] = templateSpec
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
		if needsInitContainer {
			result.InitContainer++
			s.log.Printf("personal-agent reconciler added chown init container to %s/%s", ns, dep.Name)
		}
		if needsRestart {
			result.Restarted++
			s.log.Printf("personal-agent reconciler restarted %s/%s", ns, dep.Name)
		}
	}
	return result
}

// hasPersonalAgentInitContainer reports whether dep already carries the
// chown-workspace init container. Older Deployments provisioned before that
// fix shipped won't, and the reconciler patches it in.
func hasPersonalAgentInitContainer(dep interface{}) bool {
	type podSpec struct {
		Template struct {
			Spec struct {
				InitContainers []corev1.Container `json:"initContainers"`
			} `json:"spec"`
		} `json:"template"`
	}
	buf, err := json.Marshal(dep)
	if err != nil {
		return true // fail-closed: don't churn deployments on a marshal error
	}
	var s struct {
		Spec podSpec `json:"spec"`
	}
	if err := json.Unmarshal(buf, &s); err != nil {
		return true
	}
	for _, c := range s.Spec.Template.Spec.InitContainers {
		if c.Name == personalAgentInitContainerName {
			return true
		}
	}
	return false
}

// personalAgentReqFromDeployment reconstructs the WriteAgentDeployment
// request from an existing Deployment's labels/annotations/env, so the
// reconciler can retrofit pre-fix deployments by replaying the writer
// without a DB round-trip. desiredImage overrides the in-spec image so
// the rebuild also picks up any image bump in the same pass.
func personalAgentReqFromDeployment(dep interface{}, desiredImage string) (PersonalAgentDeploymentRequest, error) {
	type podSpec struct {
		Template struct {
			Spec struct {
				Containers []corev1.Container `json:"containers"`
			} `json:"spec"`
		} `json:"template"`
	}
	type depShape struct {
		Metadata struct {
			Labels      map[string]string `json:"labels"`
			Annotations map[string]string `json:"annotations"`
		} `json:"metadata"`
		Spec podSpec `json:"spec"`
	}
	buf, err := json.Marshal(dep)
	if err != nil {
		return PersonalAgentDeploymentRequest{}, fmt.Errorf("marshal: %w", err)
	}
	var d depShape
	if err := json.Unmarshal(buf, &d); err != nil {
		return PersonalAgentDeploymentRequest{}, fmt.Errorf("unmarshal: %w", err)
	}
	slackUserID := strings.TrimSpace(d.Metadata.Annotations[personalAgentAnnoSlackUserID])
	if slackUserID == "" {
		return PersonalAgentDeploymentRequest{}, fmt.Errorf("annotation %s missing", personalAgentAnnoSlackUserID)
	}
	var owner, display string
	for _, c := range d.Spec.Template.Spec.Containers {
		if c.Name != "personal-agent" {
			continue
		}
		for _, e := range c.Env {
			switch e.Name {
			case "AGENT_OWNER_USER_ID":
				owner = e.Value
			case "AGENT_DISPLAY_NAME":
				display = e.Value
			}
		}
	}
	return PersonalAgentDeploymentRequest{
		SlackUserID:      slackUserID,
		OwnerSlackUserID: owner,
		DisplayName:      display,
		AgentID:          strings.TrimSpace(d.Metadata.Labels["bimross.com/agent-id"]),
		Image:            desiredImage,
	}, nil
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
		s.log.Printf("personal-agent reconciler boot pass: inspected=%d image_bumped=%d restarted=%d init_container=%d errors=%d",
			r.Inspected, r.ImageBumped, r.Restarted, r.InitContainer, len(r.Errors))

		t := time.NewTicker(reconcileInterval)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				r := s.reconcilePersonalAgentImages(ctx, false)
				if r.ImageBumped > 0 || r.InitContainer > 0 || len(r.Errors) > 0 {
					s.log.Printf("personal-agent reconciler tick: inspected=%d image_bumped=%d restarted=%d init_container=%d errors=%d",
						r.Inspected, r.ImageBumped, r.Restarted, r.InitContainer, len(r.Errors))
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
