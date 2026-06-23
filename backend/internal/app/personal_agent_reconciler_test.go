package app

import (
	"context"
	"log"
	"testing"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
)

// seedDeployments creates two managed personal-agent Deployments + one
// unmanaged decoy in the same namespace so we can verify the label selector.
func seedDeployments(t *testing.T) (*fake.Clientset, *Server) {
	t.Helper()
	managedLabels := map[string]string{
		"app.kubernetes.io/managed-by": personalAgentManagedByLabelValue,
	}
	// Build deployments whose Name matches personalAgentResourceName(SlackUserID)
	// so the retrofit path's WriteAgentDeployment lands an Update on the
	// existing object (Create returns AlreadyExists, then Update replaces
	// the spec). If the names diverge, the writer would Create a fresh
	// deployment under a different name and the test seed would survive
	// unchanged — which would silently mask the bump.
	mk := func(slackUserID, image string, labels map[string]string) *appsv1.Deployment {
		name := personalAgentResourceName(slackUserID)
		annos := map[string]string{}
		fullLabels := map[string]string{}
		for k, v := range labels {
			fullLabels[k] = v
		}
		if labels["app.kubernetes.io/managed-by"] == personalAgentManagedByLabelValue {
			annos[personalAgentAnnoSlackUserID] = slackUserID
			fullLabels["bimross.com/agent-id"] = "agent-" + slackUserID
		}
		return &appsv1.Deployment{
			ObjectMeta: metav1.ObjectMeta{
				Name: name, Namespace: "personal-agents",
				Labels: fullLabels, Annotations: annos,
			},
			Spec: appsv1.DeploymentSpec{
				Template: corev1.PodTemplateSpec{
					Spec: corev1.PodSpec{
						Containers: []corev1.Container{{
							Name:  "personal-agent",
							Image: image,
							Env: []corev1.EnvVar{
								{Name: "AGENT_OWNER_USER_ID", Value: "U-owner-" + slackUserID},
								{Name: "AGENT_DISPLAY_NAME", Value: "Agent " + slackUserID},
							},
						}},
					},
				},
			},
		}
	}
	depA := mk("UA", "img:old", managedLabels)
	depB := mk("UB", "img:new", managedLabels)
	decoy := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Name: "unmanaged-decoy", Namespace: "personal-agents"},
		Spec: appsv1.DeploymentSpec{
			Template: corev1.PodTemplateSpec{
				Spec: corev1.PodSpec{Containers: []corev1.Container{{Name: "personal-agent", Image: "img:other"}}},
			},
		},
	}
	cs := fake.NewSimpleClientset(depA, depB, decoy)
	w := newPersonalAgentWriterWithClient(cs, "personal-agents", "", "")
	srv := &Server{
		log:           log.Default(),
		personalAgent: w,
		cfg:           Config{PersonalAgentImage: "img:new"},
	}
	return cs, srv
}

func TestReconcilePersonalAgentImages_BumpsDriftedImages(t *testing.T) {
	cs, srv := seedDeployments(t)
	result := srv.reconcilePersonalAgentImages(context.Background(), false)
	if result.Inspected != 2 {
		t.Errorf("Inspected = %d, want 2 (label selector should ignore decoy)", result.Inspected)
	}
	if result.ImageBumped != 1 {
		t.Errorf("ImageBumped = %d, want 1 (only A had drifted)", result.ImageBumped)
	}
	if result.Restarted != 0 {
		t.Errorf("Restarted = %d, want 0 (force=false)", result.Restarted)
	}
	got, _ := cs.AppsV1().Deployments("personal-agents").Get(context.Background(), personalAgentResourceName("UA"), metav1.GetOptions{})
	if got.Spec.Template.Spec.Containers[0].Image != "img:new" {
		t.Errorf("A image after reconcile = %q, want img:new", got.Spec.Template.Spec.Containers[0].Image)
	}
	if got.Spec.Template.Annotations["bimross.com/last-reconciled-at"] == "" {
		t.Errorf("expected last-reconciled-at annotation on patched pod template")
	}
}

func TestReconcilePersonalAgentImages_ForceRestartsEvenWhenImageMatches(t *testing.T) {
	cs, srv := seedDeployments(t)
	result := srv.reconcilePersonalAgentImages(context.Background(), true)
	if result.Restarted != 2 {
		t.Errorf("Restarted = %d, want 2 (force=true on both managed)", result.Restarted)
	}
	// B's image hasn't changed; force-restart annotation should still bump.
	got, _ := cs.AppsV1().Deployments("personal-agents").Get(context.Background(), personalAgentResourceName("UB"), metav1.GetOptions{})
	if got.Spec.Template.Annotations["bimross.com/last-reconciled-at"] == "" {
		t.Errorf("expected last-reconciled-at annotation on B even though image didn't change")
	}
}

// Pre-fix deployments lack the chown init container. The reconciler must
// patch it in on every tick (no force needed) so existing personal-agent
// pods get the chown step without operator intervention. Regression guard
// for the "first DM to Gino after #455 still fails with permission denied"
// failure mode.
func TestReconcilePersonalAgentImages_PatchesMissingInitContainer(t *testing.T) {
	cs, srv := seedDeployments(t)
	result := srv.reconcilePersonalAgentImages(context.Background(), false)
	if result.InitContainer != 2 {
		t.Errorf("InitContainer = %d, want 2 (both managed lacked it)", result.InitContainer)
	}
	for _, name := range []string{personalAgentResourceName("UA"), personalAgentResourceName("UB")} {
		got, err := cs.AppsV1().Deployments("personal-agents").Get(context.Background(), name, metav1.GetOptions{})
		if err != nil {
			t.Fatalf("get %s: %v", name, err)
		}
		if !hasPersonalAgentInitContainer(got) {
			t.Errorf("%s still missing %s init container after reconcile", name, personalAgentInitContainerName)
		}
	}
}

// Once the init container is present, the reconciler should NOT keep
// re-patching it every tick — otherwise the pod template annotation churns
// and rolls a fresh ReplicaSet on every reconcile interval.
func TestReconcilePersonalAgentImages_SkipsWhenInitContainerAlreadyPresent(t *testing.T) {
	cs, srv := seedDeployments(t)
	_ = srv.reconcilePersonalAgentImages(context.Background(), false)
	result := srv.reconcilePersonalAgentImages(context.Background(), false)
	if result.InitContainer != 0 {
		t.Errorf("second pass InitContainer = %d, want 0 (already patched)", result.InitContainer)
	}
	if result.ImageBumped != 0 {
		t.Errorf("second pass ImageBumped = %d, want 0 (already on desired image)", result.ImageBumped)
	}
	// Sanity: B should not have churned.
	got, _ := cs.AppsV1().Deployments("personal-agents").Get(context.Background(), personalAgentResourceName("UB"), metav1.GetOptions{})
	if !hasPersonalAgentInitContainer(got) {
		t.Errorf("B lost its init container between ticks")
	}
}

func TestSpawnEnvDrift(t *testing.T) {
	desired := map[string]string{
		// DEFAULT_MODEL is intentionally absent — core/spawnsettings owns it and
		// spawnEnvDrift no longer manages it (it's removed from live pods via
		// personalAgentStaleEnvKeys instead, see TestSpawnEnvStaleRemovesDefaultModel).
		"PERSONAL_AGENT_DEFAULT_EFFORT": "high",
		"PERSONAL_AGENT_LOOP_MODEL":     "claude-sonnet-4-6",
		"PERSONAL_AGENT_LOOP_EFFORT":    "", // empty desired → never patched
	}
	mkDep := func(env ...corev1.EnvVar) *appsv1.Deployment {
		return &appsv1.Deployment{Spec: appsv1.DeploymentSpec{Template: corev1.PodTemplateSpec{
			Spec: corev1.PodSpec{Containers: []corev1.Container{{Name: "personal-agent", Env: env}}},
		}}}
	}
	names := func(d []corev1.EnvVar) []string {
		out := make([]string, len(d))
		for i, e := range d {
			out[i] = e.Name
		}
		return out
	}
	eq := func(a, b []string) bool {
		if len(a) != len(b) {
			return false
		}
		for i := range a {
			if a[i] != b[i] {
				return false
			}
		}
		return true
	}

	// Missing all model env → the 2 non-empty desired vars, in fixed order,
	// LOOP_EFFORT excluded (empty desired), DEFAULT_MODEL excluded (core-owned).
	drift := spawnEnvDrift(mkDep(corev1.EnvVar{Name: "AGENT_DISPLAY_NAME", Value: "x"}), desired)
	want := []string{"PERSONAL_AGENT_DEFAULT_EFFORT", "PERSONAL_AGENT_LOOP_MODEL"}
	if !eq(names(drift), want) {
		t.Errorf("missing-all drift = %v, want %v", names(drift), want)
	}

	// Fully converged → no drift. A lingering DEFAULT_MODEL is ignored by
	// spawnEnvDrift (it's handled by the stale-removal path, not here).
	converged := spawnEnvDrift(mkDep(
		corev1.EnvVar{Name: "PERSONAL_AGENT_DEFAULT_MODEL", Value: "claude-opus-4-7[1m]"},
		corev1.EnvVar{Name: "PERSONAL_AGENT_DEFAULT_EFFORT", Value: "high"},
		corev1.EnvVar{Name: "PERSONAL_AGENT_LOOP_MODEL", Value: "claude-sonnet-4-6"},
	), desired)
	if len(converged) != 0 {
		t.Errorf("converged drift = %v, want none", names(converged))
	}

	// Only LOOP_MODEL wrong → patch just that one.
	one := spawnEnvDrift(mkDep(
		corev1.EnvVar{Name: "PERSONAL_AGENT_DEFAULT_EFFORT", Value: "high"},
		corev1.EnvVar{Name: "PERSONAL_AGENT_LOOP_MODEL", Value: "claude-opus-4-7[1m]"},
	), desired)
	if !eq(names(one), []string{"PERSONAL_AGENT_LOOP_MODEL"}) {
		t.Errorf("single-drift = %v, want [PERSONAL_AGENT_LOOP_MODEL]", names(one))
	}
	if len(one) == 1 && one[0].Value != "claude-sonnet-4-6" {
		t.Errorf("LOOP_MODEL drift value = %q, want claude-sonnet-4-6", one[0].Value)
	}
}

// A pod that already has the init container + desired image but is missing the
// background-tier env must get it stamped in via the env-reconcile path — this
// is how the 4 live PA pods pick up PERSONAL_AGENT_LOOP_MODEL without a
// full re-provision. See claude-code-personal-agent#35.
func TestReconcilePersonalAgentImages_ConvergesSpawnEnvDrift(t *testing.T) {
	name := personalAgentResourceName("UC")
	dep := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name: name, Namespace: "personal-agents",
			Labels: map[string]string{
				"app.kubernetes.io/managed-by": personalAgentManagedByLabelValue,
				"bimross.com/agent-id":         "agent-UC",
			},
			Annotations: map[string]string{personalAgentAnnoSlackUserID: "UC"},
		},
		Spec: appsv1.DeploymentSpec{Template: corev1.PodTemplateSpec{Spec: corev1.PodSpec{
			InitContainers: []corev1.Container{{Name: personalAgentInitContainerName}},
			Containers: []corev1.Container{{
				Name: "personal-agent", Image: "img:new",
				Env: []corev1.EnvVar{{Name: "AGENT_DISPLAY_NAME", Value: "Agent UC"}},
			}},
		}}},
	}
	cs := fake.NewSimpleClientset(dep)
	w := newPersonalAgentWriterWithClient(cs, "personal-agents", "", "")
	srv := &Server{log: log.Default(), personalAgent: w, cfg: Config{PersonalAgentImage: "img:new"}}

	result := srv.reconcilePersonalAgentImages(context.Background(), false)
	if result.EnvReconciled != 1 {
		t.Fatalf("EnvReconciled = %d, want 1", result.EnvReconciled)
	}
	if result.ImageBumped != 0 || result.InitContainer != 0 {
		t.Errorf("unexpected other work: %+v", result)
	}
	got, _ := cs.AppsV1().Deployments("personal-agents").Get(context.Background(), name, metav1.GetOptions{})
	env := map[string]string{}
	for _, e := range got.Spec.Template.Spec.Containers[0].Env {
		env[e.Name] = e.Value
	}
	if env["PERSONAL_AGENT_LOOP_MODEL"] != "claude-sonnet-4-6" {
		t.Errorf("LOOP_MODEL after reconcile = %q, want claude-sonnet-4-6", env["PERSONAL_AGENT_LOOP_MODEL"])
	}
	if env["AGENT_DISPLAY_NAME"] != "Agent UC" {
		t.Errorf("strategic merge clobbered existing env: AGENT_DISPLAY_NAME=%q", env["AGENT_DISPLAY_NAME"])
	}
	// Idempotent: second pass finds no drift.
	if r2 := srv.reconcilePersonalAgentImages(context.Background(), false); r2.EnvReconciled != 0 {
		t.Errorf("second pass EnvReconciled = %d, want 0 (already converged)", r2.EnvReconciled)
	}
}

func TestResourceDrift(t *testing.T) {
	desired := personalAgentResources()
	mkDep := func(r corev1.ResourceRequirements) *appsv1.Deployment {
		return &appsv1.Deployment{Spec: appsv1.DeploymentSpec{Template: corev1.PodTemplateSpec{
			Spec: corev1.PodSpec{Containers: []corev1.Container{{Name: "personal-agent", Resources: r}}},
		}}}
	}
	// No resources block at all → drift (this is the pre-right-sizing state).
	if !resourceDrift(mkDep(corev1.ResourceRequirements{}), desired) {
		t.Error("empty resources should drift against the desired template")
	}
	// Exactly desired → no drift.
	if resourceDrift(mkDep(desired), desired) {
		t.Error("desired resources should not drift")
	}
	// The old 250m/512Mi footprint → drift.
	old := corev1.ResourceRequirements{
		Requests: corev1.ResourceList{corev1.ResourceCPU: resource.MustParse("250m"), corev1.ResourceMemory: resource.MustParse("512Mi")},
		Limits:   corev1.ResourceList{corev1.ResourceCPU: resource.MustParse("1"), corev1.ResourceMemory: resource.MustParse("1Gi")},
	}
	if !resourceDrift(mkDep(old), desired) {
		t.Error("pre-audit 250m/512Mi should drift against the new template")
	}
	// Quantities compared by value: "1000m" must equal the desired "1" CPU limit,
	// so an equivalent-but-differently-written limit is NOT spurious drift.
	equiv := *desired.DeepCopy()
	equiv.Limits[corev1.ResourceCPU] = resource.MustParse("1000m")
	if resourceDrift(mkDep(equiv), desired) {
		t.Error(`"1000m" CPU limit should equal desired "1" — no drift`)
	}
}

// A live agent with the init container, desired image, and converged env but the
// old (or absent) resources block must get its requests/limits converged in via
// the resource-reconcile path — this is how the existing fleet sheds the
// over-reservation without a full re-provision.
func TestReconcilePersonalAgentImages_ConvergesResourceDrift(t *testing.T) {
	name := personalAgentResourceName("UD")
	dep := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name: name, Namespace: "personal-agents",
			Labels: map[string]string{
				"app.kubernetes.io/managed-by": personalAgentManagedByLabelValue,
				"bimross.com/agent-id":         "agent-UD",
			},
			Annotations: map[string]string{personalAgentAnnoSlackUserID: "UD"},
		},
		Spec: appsv1.DeploymentSpec{Template: corev1.PodTemplateSpec{Spec: corev1.PodSpec{
			InitContainers: []corev1.Container{{Name: personalAgentInitContainerName}},
			Containers: []corev1.Container{{
				Name: "personal-agent", Image: "img:new",
				Env: []corev1.EnvVar{
					// PERSONAL_AGENT_DEFAULT_MODEL intentionally omitted — core/spawnsettings owns it; reconciler scrubs it as stale.
					{Name: "PERSONAL_AGENT_DEFAULT_EFFORT", Value: personalAgentDefaultEffort()},
					{Name: "PERSONAL_AGENT_LOOP_MODEL", Value: personalAgentLoopModel()},
					// MAC_BACKEND_URL has a non-empty default, so it converges on
					// any pod missing it — stamp it here to isolate resource drift.
					{Name: "MAC_BACKEND_URL", Value: personalAgentMacBackendURL()},
				},
				// Old over-reserved footprint.
				Resources: corev1.ResourceRequirements{
					Requests: corev1.ResourceList{corev1.ResourceCPU: resource.MustParse("250m"), corev1.ResourceMemory: resource.MustParse("512Mi")},
					Limits:   corev1.ResourceList{corev1.ResourceCPU: resource.MustParse("1"), corev1.ResourceMemory: resource.MustParse("1Gi")},
				},
			}},
		}}},
	}
	cs := fake.NewSimpleClientset(dep)
	w := newPersonalAgentWriterWithClient(cs, "personal-agents", "", "")
	srv := &Server{log: log.Default(), personalAgent: w, cfg: Config{PersonalAgentImage: "img:new"}}

	result := srv.reconcilePersonalAgentImages(context.Background(), false)
	if result.ResReconciled != 1 {
		t.Fatalf("ResReconciled = %d, want 1", result.ResReconciled)
	}
	if result.ImageBumped != 0 || result.InitContainer != 0 || result.EnvReconciled != 0 {
		t.Errorf("unexpected other work: %+v", result)
	}
	got, _ := cs.AppsV1().Deployments("personal-agents").Get(context.Background(), name, metav1.GetOptions{})
	res := got.Spec.Template.Spec.Containers[0].Resources
	want := personalAgentResources()
	if res.Requests.Cpu().Cmp(*want.Requests.Cpu()) != 0 || res.Requests.Memory().Cmp(*want.Requests.Memory()) != 0 {
		t.Errorf("requests after reconcile = %v, want %v", res.Requests, want.Requests)
	}
	// Idempotent: second pass finds no drift.
	if r2 := srv.reconcilePersonalAgentImages(context.Background(), false); r2.ResReconciled != 0 {
		t.Errorf("second pass ResReconciled = %d, want 0 (already converged)", r2.ResReconciled)
	}
}

// A live agent provisioned by the pre-scoped-token reconciler carries the master
// MAC_INTERNAL_SERVICE_TOKEN in its env. The reconcile must actively delete it
// (not just stop managing it) so the master token stops being readable in the
// owner's pod env. Asserts the env key is gone after one pass and the pass is
// counted as an env reconcile.
func TestReconcilePersonalAgentImages_ScrubsMasterToken(t *testing.T) {
	name := personalAgentResourceName("UE")
	dep := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name: name, Namespace: "personal-agents",
			Labels: map[string]string{
				"app.kubernetes.io/managed-by": personalAgentManagedByLabelValue,
				"bimross.com/agent-id":         "agent-UE",
			},
			Annotations: map[string]string{personalAgentAnnoSlackUserID: "UE"},
		},
		Spec: appsv1.DeploymentSpec{Template: corev1.PodTemplateSpec{Spec: corev1.PodSpec{
			InitContainers: []corev1.Container{{Name: personalAgentInitContainerName}},
			Containers: []corev1.Container{{
				Name: "personal-agent", Image: "img:new",
				Env: []corev1.EnvVar{
					// PERSONAL_AGENT_DEFAULT_MODEL intentionally omitted — core/spawnsettings owns it; reconciler scrubs it as stale.
					{Name: "PERSONAL_AGENT_DEFAULT_EFFORT", Value: personalAgentDefaultEffort()},
					{Name: "PERSONAL_AGENT_LOOP_MODEL", Value: personalAgentLoopModel()},
					{Name: "MAC_BACKEND_URL", Value: personalAgentMacBackendURL()},
					// The exposure: the legacy master token, injected by the old reconciler.
					{Name: "MAC_INTERNAL_SERVICE_TOKEN", Value: "the-master-token"},
				},
				Resources: personalAgentResources(),
			}},
		}}},
	}
	cs := fake.NewSimpleClientset(dep)
	w := newPersonalAgentWriterWithClient(cs, "personal-agents", "", "")
	srv := &Server{log: log.Default(), personalAgent: w, cfg: Config{PersonalAgentImage: "img:new"}}

	result := srv.reconcilePersonalAgentImages(context.Background(), false)
	if result.EnvReconciled != 1 {
		t.Fatalf("EnvReconciled = %d, want 1", result.EnvReconciled)
	}
	got, _ := cs.AppsV1().Deployments("personal-agents").Get(context.Background(), name, metav1.GetOptions{})
	for _, e := range got.Spec.Template.Spec.Containers[0].Env {
		if e.Name == "MAC_INTERNAL_SERVICE_TOKEN" {
			t.Fatalf("MAC_INTERNAL_SERVICE_TOKEN still present after reconcile (value=%q)", e.Value)
		}
	}
	// Idempotent: a second pass finds nothing to scrub.
	if r2 := srv.reconcilePersonalAgentImages(context.Background(), false); r2.EnvReconciled != 0 {
		t.Errorf("second pass EnvReconciled = %d, want 0 (already scrubbed)", r2.EnvReconciled)
	}
}

// A live agent provisioned by the old reconciler carries the hardcoded
// PERSONAL_AGENT_DEFAULT_MODEL=claude-opus-4-7[1m] in its env. core/spawnsettings
// now owns the interactive default, so the reconcile must actively delete the
// stale var (not just stop stamping it) — otherwise it persists across image
// bumps and a future PERSONAL_AGENT_ALLOW_1M_CONTEXT=true could resurrect the
// hanging opus-4-7[1m]. Asserts the key is gone after one pass.
func TestReconcilePersonalAgentImages_ScrubsDefaultModel(t *testing.T) {
	name := personalAgentResourceName("UF")
	dep := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name: name, Namespace: "personal-agents",
			Labels: map[string]string{
				"app.kubernetes.io/managed-by": personalAgentManagedByLabelValue,
				"bimross.com/agent-id":         "agent-UF",
			},
			Annotations: map[string]string{personalAgentAnnoSlackUserID: "UF"},
		},
		Spec: appsv1.DeploymentSpec{Template: corev1.PodTemplateSpec{Spec: corev1.PodSpec{
			InitContainers: []corev1.Container{{Name: personalAgentInitContainerName}},
			Containers: []corev1.Container{{
				Name: "personal-agent", Image: "img:new",
				Env: []corev1.EnvVar{
					{Name: "PERSONAL_AGENT_DEFAULT_EFFORT", Value: personalAgentDefaultEffort()},
					{Name: "PERSONAL_AGENT_LOOP_MODEL", Value: personalAgentLoopModel()},
					{Name: "MAC_BACKEND_URL", Value: personalAgentMacBackendURL()},
					// The stale 1M pin left by the pre-spawnsettings reconciler.
					{Name: "PERSONAL_AGENT_DEFAULT_MODEL", Value: "claude-opus-4-7[1m]"},
				},
				Resources: personalAgentResources(),
			}},
		}}},
	}
	cs := fake.NewSimpleClientset(dep)
	w := newPersonalAgentWriterWithClient(cs, "personal-agents", "", "")
	srv := &Server{log: log.Default(), personalAgent: w, cfg: Config{PersonalAgentImage: "img:new"}}

	result := srv.reconcilePersonalAgentImages(context.Background(), false)
	if result.EnvReconciled != 1 {
		t.Fatalf("EnvReconciled = %d, want 1", result.EnvReconciled)
	}
	got, _ := cs.AppsV1().Deployments("personal-agents").Get(context.Background(), name, metav1.GetOptions{})
	for _, e := range got.Spec.Template.Spec.Containers[0].Env {
		if e.Name == "PERSONAL_AGENT_DEFAULT_MODEL" {
			t.Fatalf("PERSONAL_AGENT_DEFAULT_MODEL still present after reconcile (value=%q)", e.Value)
		}
	}
	// Idempotent: a second pass finds nothing to scrub.
	if r2 := srv.reconcilePersonalAgentImages(context.Background(), false); r2.EnvReconciled != 0 {
		t.Errorf("second pass EnvReconciled = %d, want 0 (already scrubbed)", r2.EnvReconciled)
	}
}

func TestReconcilePersonalAgentImages_NoopOnDisabledWriter(t *testing.T) {
	srv := &Server{log: log.Default(), personalAgent: nil, cfg: Config{PersonalAgentImage: "img:new"}}
	r := srv.reconcilePersonalAgentImages(context.Background(), true)
	if r.Inspected != 0 || r.ImageBumped != 0 || r.Restarted != 0 {
		t.Errorf("expected zero work when writer is disabled, got %+v", r)
	}
}
