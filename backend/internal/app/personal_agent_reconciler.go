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
	Inspected     int `json:"inspected"`
	ImageBumped   int `json:"imageBumped"`
	Restarted     int `json:"restarted"`
	InitContainer int `json:"initContainerPatched"`
	EnvReconciled int `json:"envReconciled"`
	ResReconciled int `json:"resourceReconciled"`
	// SidecarReconciled counts agents whose per-owner slack-mcp sidecar was
	// attached or detached this pass to match the desired enabled state (#665 WS2).
	SidecarReconciled int      `json:"sidecarReconciled"`
	Errors            []string `json:"errors,omitempty"`
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
	// Desired spawn-model env (interactive DEFAULT_* + background-tier LOOP_*).
	// The reconciler converges live pods onto these so a model/tier change in
	// backend config reaches every existing agent — the image-bump path alone
	// never touches env, so without this an env change only lands on freshly
	// provisioned or full-rebuilt pods. See claude-code-personal-agent#35.
	desiredSpawnEnv := map[string]string{
		// PERSONAL_AGENT_DEFAULT_MODEL is intentionally absent — core/spawnsettings
		// owns the interactive default (claude-opus-4-8). It is actively removed
		// from live pods via personalAgentStaleEnvKeys below.
		"PERSONAL_AGENT_DEFAULT_EFFORT": personalAgentDefaultEffort(),
		"PERSONAL_AGENT_LOOP_MODEL":     personalAgentLoopModel(),
		"PERSONAL_AGENT_LOOP_EFFORT":    personalAgentLoopEffort(),
		// Engagement reporting (parity with Ross/Joanne, mac-ai#498): the PA
		// recorder POSTs observed DM messages to mac-ai so /admin lights up
		// per-bot + owner message counts. Converged here — not just stamped at
		// provision — so the existing fleet picks it up on the next reconcile.
		// An empty token (dev) is skipped by spawnEnvDrift, leaving the
		// recorder nil and reporting off.
		//
		// PA_ENGAGEMENT_TOKEN — NOT the master BackendInternalServiceToken — is
		// the only credential we inject here: a PA owner can read their pod's
		// env, and the scoped token authorizes only the engagement ingest
		// endpoint (paEngagementAuthorized), so it can't reach shopify-token,
		// admin-read PII, the trial reaper, or PA rollout.
		"MAC_BACKEND_URL":     personalAgentMacBackendURL(),
		"PA_ENGAGEMENT_TOKEN": strings.TrimSpace(s.cfg.PAEngagementToken),
	}
	// Desired pod resources (the 2026-06-20 right-sizing). Converged onto live
	// agents the same way as spawn env: the image-bump patch never touches
	// resources, so without this a backend-side request/limit change only lands
	// on freshly provisioned pods and the existing fleet stays over-reserved.
	desiredResources := personalAgentResources()

	for i := range deps.Items {
		dep := &deps.Items[i]
		current := containerImage(dep)
		needsImagePatch := current != desired
		needsInitContainer := !hasPersonalAgentInitContainer(dep)
		needsRestart := force
		// The retrofit path rebuilds the pod template wholesale via
		// WriteAgentDeployment, which already stamps the current spawn env, so
		// env drift only needs an explicit patch on the non-retrofit path.
		driftEnv := spawnEnvDrift(dep, desiredSpawnEnv)
		// Stale env we actively delete from live pods (not just stop managing) —
		// chiefly the legacy MAC_INTERNAL_SERVICE_TOKEN (the master internal
		// token the pre-scoped-token recorder carried). Leaving it on existing
		// pods would keep that token readable in every PA owner's env, so the
		// reconcile must emit a $patch:delete for any pod that still has it.
		staleEnv := spawnEnvStale(dep, personalAgentStaleEnvKeys)
		needsEnvReconcile := len(driftEnv) > 0 || len(staleEnv) > 0
		needsResReconcile := resourceDrift(dep, desiredResources)
		// Slack MCP sidecar convergence (#665 WS2): attach or detach the
		// per-owner slack-mcp sidecar so the live pod matches the desired
		// enabled state (PERSONAL_AGENT_SLACK_MCP_SIDECAR[_USERS]). A container
		// add/remove can't be a strategic-merge env patch, so this routes to the
		// full WriteAgentDeployment rebuild path below (same as the init-container
		// retrofit). slackUser is the owner id the writer stamps as an annotation;
		// an empty annotation means we can't tell whose agent this is, so leave it.
		slackUser := strings.TrimSpace(dep.Annotations[personalAgentAnnoSlackUserID])
		wantSidecar := slackUser != "" && personalAgentSlackMcpEnabled(slackUser)
		needsSidecarReconcile := slackUser != "" && wantSidecar != hasSlackMcpSidecar(dep)

		if !needsImagePatch && !needsRestart && !needsInitContainer && !needsEnvReconcile && !needsResReconcile && !needsSidecarReconcile {
			continue
		}

		// Retrofit path: pre-fix deployments name their workspace volume
		// something other than "data", so strategic-merge-patching in the
		// new chown init container (whose volumeMount references "data")
		// fails K8s validation. For those, rebuild the spec authoritatively
		// via WriteAgentDeployment instead of patching, which replaces the
		// pod template wholesale (new volume name, init container, image).
		if needsInitContainer || needsSidecarReconcile {
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
			if needsInitContainer {
				result.InitContainer++
			}
			if needsSidecarReconcile {
				result.SidecarReconciled++
			}
			s.log.Printf("personal-agent reconciler rebuilt %s/%s via full Update (initContainer=%v slackSidecar=%v wantSidecar=%v)", ns, dep.Name, needsInitContainer, needsSidecarReconcile, wantSidecar)
			if needsImagePatch {
				result.ImageBumped++
			}
			if needsRestart {
				result.Restarted++
			}
			continue
		}

		templateSpec := map[string]any{}
		if needsImagePatch || needsEnvReconcile || needsResReconcile {
			container := map[string]any{"name": "personal-agent"}
			if needsImagePatch {
				container["image"] = desired
			}
			if needsEnvReconcile {
				// env has patchMergeKey "name", so a strategic-merge patch adds
				// or updates only the drifted vars and leaves the rest intact.
				// Stale keys are removed in the same patch via the $patch:delete
				// directive (a typed EnvVar would only set the value empty, which
				// for the master token is not good enough — it must be gone).
				envPatch := make([]any, 0, len(driftEnv)+len(staleEnv))
				for _, e := range driftEnv {
					envPatch = append(envPatch, e)
				}
				for _, name := range staleEnv {
					envPatch = append(envPatch, map[string]any{"name": name, "$patch": "delete"})
				}
				container["env"] = envPatch
			}
			if needsResReconcile {
				// resources is a plain struct (no merge key), so patching the
				// full desired requests+limits authoritatively overwrites the
				// four cpu/memory quantities on the live container.
				container["resources"] = desiredResources
			}
			templateSpec["containers"] = []any{container}
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
		if needsEnvReconcile {
			result.EnvReconciled++
			names := make([]string, 0, len(driftEnv))
			for _, e := range driftEnv {
				names = append(names, e.Name)
			}
			s.log.Printf("personal-agent reconciler converged spawn env on %s/%s: set=[%s] removed=[%s]",
				ns, dep.Name, strings.Join(names, ","), strings.Join(staleEnv, ","))
		}
		if needsResReconcile {
			result.ResReconciled++
			s.log.Printf("personal-agent reconciler converged resources on %s/%s -> req %s/%s lim %s/%s",
				ns, dep.Name,
				desiredResources.Requests.Cpu(), desiredResources.Requests.Memory(),
				desiredResources.Limits.Cpu(), desiredResources.Limits.Memory())
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

// spawnEnvDrift returns the spawn-model env vars whose desired value is
// non-empty and differs from (or is missing on) dep's first container. The
// reconciler strategic-merge-patches these by name, so other env vars are
// untouched. Empty desired values are skipped — we never churn a pod just to
// add a blank var (e.g. LOOP_EFFORT, which defaults empty so ticks keep their
// per-loop / inherited effort). Order is fixed for deterministic patches/tests.
func spawnEnvDrift(dep interface{}, desired map[string]string) []corev1.EnvVar {
	buf, err := json.Marshal(dep)
	if err != nil {
		return nil // fail-closed: don't churn on a marshal error
	}
	var s struct {
		Spec struct {
			Template struct {
				Spec struct {
					Containers []corev1.Container `json:"containers"`
				} `json:"spec"`
			} `json:"template"`
		} `json:"spec"`
	}
	if err := json.Unmarshal(buf, &s); err != nil {
		return nil
	}
	current := map[string]string{}
	if len(s.Spec.Template.Spec.Containers) > 0 {
		for _, e := range s.Spec.Template.Spec.Containers[0].Env {
			current[e.Name] = e.Value
		}
	}
	var drift []corev1.EnvVar
	for _, k := range []string{
		"PERSONAL_AGENT_DEFAULT_EFFORT",
		"PERSONAL_AGENT_LOOP_MODEL",
		"PERSONAL_AGENT_LOOP_EFFORT",
		"MAC_BACKEND_URL",
		"PA_ENGAGEMENT_TOKEN",
	} {
		want := desired[k]
		if want == "" {
			continue
		}
		if cur, ok := current[k]; !ok || cur != want {
			drift = append(drift, corev1.EnvVar{Name: k, Value: want})
		}
	}
	return drift
}

// personalAgentStaleEnvKeys are env vars the reconciler actively REMOVES from
// live PA pods (via $patch:delete), not merely stops managing. Stopping
// injection isn't enough: a value persists across image bumps (which roll the
// image without resetting env), so it must be explicitly deleted.
//
//   - MAC_INTERNAL_SERVICE_TOKEN: the master-token→PA_ENGAGEMENT_TOKEN migration
//     left this (== BACKEND_INTERNAL_SERVICE_TOKEN) in every existing pod's env,
//     where the agent's owner could read it.
//   - PERSONAL_AGENT_DEFAULT_MODEL: previously stamped as opus-4-7[1m]; now owned
//     by core/spawnsettings (claude-opus-4-8). Deleting it from live pods drops
//     the stale 1M pin so the harness falls through to the core default — and so
//     a future PERSONAL_AGENT_ALLOW_1M_CONTEXT=true can't resurrect a hanging
//     opus-4-7[1m] from a lingering env.
var personalAgentStaleEnvKeys = []string{"MAC_INTERNAL_SERVICE_TOKEN", "PERSONAL_AGENT_DEFAULT_MODEL"}

// spawnEnvStale returns the subset of keys that are actually present on dep's
// first container, so the reconciler only emits a delete (and the pod restart
// it triggers) for pods that still carry a stale var. Fail-closed: a marshal or
// parse error returns nil so a read glitch never churns the fleet.
func spawnEnvStale(dep interface{}, keys []string) []string {
	buf, err := json.Marshal(dep)
	if err != nil {
		return nil
	}
	var s struct {
		Spec struct {
			Template struct {
				Spec struct {
					Containers []corev1.Container `json:"containers"`
				} `json:"spec"`
			} `json:"template"`
		} `json:"spec"`
	}
	if err := json.Unmarshal(buf, &s); err != nil {
		return nil
	}
	if len(s.Spec.Template.Spec.Containers) == 0 {
		return nil
	}
	present := map[string]bool{}
	for _, e := range s.Spec.Template.Spec.Containers[0].Env {
		present[e.Name] = true
	}
	var out []string
	for _, k := range keys {
		if present[k] {
			out = append(out, k)
		}
	}
	return out
}

// resourceDrift reports whether dep's first container has resource requests or
// limits that differ from desired. Like spawnEnvDrift, this lets the reconciler
// converge live agents onto a backend-side resource change (the 2026-06-20
// right-sizing) rather than only stamping it on freshly provisioned pods — the
// image-bump patch never touches resources. Fail-closed: a marshal/parse error
// or a container with no resources block returns false so we never churn the
// fleet on a read glitch. Compares the four cpu/memory request+limit quantities
// by value (resource.Quantity.Cmp), so "1" vs "1000m" is correctly equal.
func resourceDrift(dep interface{}, desired corev1.ResourceRequirements) bool {
	buf, err := json.Marshal(dep)
	if err != nil {
		return false
	}
	var s struct {
		Spec struct {
			Template struct {
				Spec struct {
					Containers []corev1.Container `json:"containers"`
				} `json:"spec"`
			} `json:"template"`
		} `json:"spec"`
	}
	if err := json.Unmarshal(buf, &s); err != nil {
		return false
	}
	if len(s.Spec.Template.Spec.Containers) == 0 {
		return false
	}
	cur := s.Spec.Template.Spec.Containers[0].Resources
	checks := []struct {
		want, have corev1.ResourceList
		key        corev1.ResourceName
	}{
		{desired.Requests, cur.Requests, corev1.ResourceCPU},
		{desired.Requests, cur.Requests, corev1.ResourceMemory},
		{desired.Limits, cur.Limits, corev1.ResourceCPU},
		{desired.Limits, cur.Limits, corev1.ResourceMemory},
	}
	for _, c := range checks {
		want := c.want[c.key]
		have, ok := c.have[c.key]
		if !ok || want.Cmp(have) != 0 {
			return true
		}
	}
	return false
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

// hasSlackMcpSidecar reports whether dep's pod template already carries the
// per-owner slack-mcp sidecar container (#665 WS2). Fail-closed on a marshal
// error (returns true) so a transient read glitch never churns the fleet.
func hasSlackMcpSidecar(dep interface{}) bool {
	buf, err := json.Marshal(dep)
	if err != nil {
		return true
	}
	var s struct {
		Spec struct {
			Template struct {
				Spec struct {
					Containers []corev1.Container `json:"containers"`
				} `json:"spec"`
			} `json:"template"`
		} `json:"spec"`
	}
	if err := json.Unmarshal(buf, &s); err != nil {
		return true
	}
	for _, c := range s.Spec.Template.Spec.Containers {
		if c.Name == personalAgentSlackMcpContainerName {
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
	// Agent id is the authoritative resource key (#651). Prefer the annotation,
	// falling back to the label (which has carried the id since before #651) so
	// a pre-migration deployment that only ever got the label still rebuilds
	// under the correct agent-id-hashed name.
	agentID := strings.TrimSpace(d.Metadata.Annotations[personalAgentAnnoAgentID])
	if agentID == "" {
		agentID = strings.TrimSpace(d.Metadata.Labels[personalAgentLabelAgentID])
	}
	if agentID == "" {
		return PersonalAgentDeploymentRequest{}, fmt.Errorf("annotation/label %s missing", personalAgentAnnoAgentID)
	}
	slackUserID := strings.TrimSpace(d.Metadata.Annotations[personalAgentAnnoSlackUserID])
	if slackUserID == "" {
		return PersonalAgentDeploymentRequest{}, fmt.Errorf("annotation %s missing", personalAgentAnnoSlackUserID)
	}
	var owner, display, googleEmail string
	googleConnected := false
	for _, c := range d.Spec.Template.Spec.Containers {
		// Preserve the Google sidecar across a retrofit rebuild: if the live
		// pod already carries it, the owner is connected, so the rebuilt spec
		// must keep it (else the reconcile would silently strip Google access).
		// Add/remove on connect/disconnect is the credential writer's job.
		if c.Name == personalAgentGwsSidecarContainerName {
			googleConnected = true
		}
		if c.Name != "personal-agent" {
			continue
		}
		for _, e := range c.Env {
			switch e.Name {
			case "AGENT_OWNER_USER_ID":
				owner = e.Value
			case "AGENT_DISPLAY_NAME":
				display = e.Value
			case "AGENT_GOOGLE_EMAIL":
				googleEmail = e.Value
			}
		}
	}
	return PersonalAgentDeploymentRequest{
		SlackUserID:              slackUserID,
		OwnerSlackUserID:         owner,
		DisplayName:              display,
		AgentID:                  agentID,
		Image:                    desiredImage,
		GoogleWorkspaceConnected: googleConnected,
		GoogleEmail:              googleEmail,
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
		// deadStreak carries the per-agent definitive-dead-token streak across
		// liveness passes (see reconcilePersonalAgentLiveness). Owned solely by
		// this goroutine, so no locking needed.
		deadStreak := map[string]int{}

		// Boot-time pass with a small delay so the rest of NewServer finishes
		// wiring before we start patching things.
		select {
		case <-ctx.Done():
			return
		case <-time.After(30 * time.Second):
		}
		// Rekey migration (#651) runs BEFORE the image reconcile so the latter
		// operates on the new agent-id-hashed resources. Idempotent + self-healing:
		// a no-op once every agent is migrated.
		if m := s.migratePersonalAgentResourceNames(ctx); m.Migrated > 0 || len(m.Errors) > 0 {
			s.log.Printf("personal-agent rekey boot pass: inspected=%d migrated=%d errors=%d",
				m.Inspected, m.Migrated, len(m.Errors))
		}
		r := s.reconcilePersonalAgentImages(ctx, false)
		s.log.Printf("personal-agent reconciler boot pass: inspected=%d image_bumped=%d restarted=%d init_container=%d res_reconciled=%d errors=%d",
			r.Inspected, r.ImageBumped, r.Restarted, r.InitContainer, r.ResReconciled, len(r.Errors))
		if p := s.reconcilePersonalAgentLiveness(ctx, deadStreak); p.Pruned > 0 || len(p.Errors) > 0 {
			s.log.Printf("personal-agent liveness boot pass: checked=%d dead_observed=%d pruned=%d errors=%d",
				p.Checked, p.DeadObserved, p.Pruned, len(p.Errors))
		}

		t := time.NewTicker(reconcileInterval)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				if m := s.migratePersonalAgentResourceNames(ctx); m.Migrated > 0 || len(m.Errors) > 0 {
					s.log.Printf("personal-agent rekey tick: inspected=%d migrated=%d errors=%d",
						m.Inspected, m.Migrated, len(m.Errors))
				}
				r := s.reconcilePersonalAgentImages(ctx, false)
				if r.ImageBumped > 0 || r.InitContainer > 0 || r.ResReconciled > 0 || len(r.Errors) > 0 {
					s.log.Printf("personal-agent reconciler tick: inspected=%d image_bumped=%d restarted=%d init_container=%d res_reconciled=%d errors=%d",
						r.Inspected, r.ImageBumped, r.Restarted, r.InitContainer, r.ResReconciled, len(r.Errors))
				}
				if p := s.reconcilePersonalAgentLiveness(ctx, deadStreak); p.Pruned > 0 || len(p.Errors) > 0 {
					s.log.Printf("personal-agent liveness tick: checked=%d dead_observed=%d pruned=%d errors=%d",
						p.Checked, p.DeadObserved, p.Pruned, len(p.Errors))
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
