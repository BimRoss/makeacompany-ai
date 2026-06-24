package app

import (
	"context"
	"fmt"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// Per-agent resource re-key migration (mac-ai #651).
//
// Before #651 every per-agent K8s resource was named off sha256(slack_user_id).
// #651 switches the key to sha256(agent_id) so one owner can hold multiple
// agents without resource-name collisions. K8s object names are immutable, so a
// "rename" is create-under-the-new-name + delete-the-old-name.
//
// Every existing managed Deployment already carries BOTH the slack-user-id
// annotation AND the agent-id (annotation since #651, label before it), so for
// any live resource we can compute the OLD name (sha256(slackUserID)) and the
// NEW name (sha256(agentID)) and move it.
//
// This pass is idempotent and self-healing — safe to run on every reconcile
// tick:
//   - if the new-named Deployment already exists, the agent is migrated; skip.
//   - it only acts on a Deployment whose current name equals the OLD slack-hash
//     name, so it never touches an already-new resource or an unrelated object.
//   - secret DATA (bot token, signing secret, Google creds) is carried over
//     verbatim — nothing that can't be regenerated is dropped.
//
// The Deployment + Service are rebuilt authoritatively via the writer (so the
// pod template's envFrom / SA / sidecar secret refs / hostPath subPath all
// resolve to the new agent-id-hashed names). The runtime Secret, the Google
// OAuth Secret, and the per-agent gws RBAC are copied directly because they
// hold data the writer cannot reproduce (the bot token, the refresh token).

type migrateRekeyResult struct {
	Inspected int      `json:"inspected"`
	Migrated  int      `json:"migrated"`
	Errors    []string `json:"errors,omitempty"`
}

// migratePersonalAgentResourceNames renames every per-agent resource still
// living under the legacy slack-user-id-hashed name to the agent-id-hashed name
// (#651). Returns counts so the boot/tick caller can log what it did. Non-fatal
// per-agent: one bad agent doesn't stop the rest.
func (s *Server) migratePersonalAgentResourceNames(ctx context.Context) migrateRekeyResult {
	var result migrateRekeyResult
	if s.personalAgent == nil || s.personalAgent.Disabled() {
		return result
	}
	ns := s.personalAgent.AgentNamespace()
	cs := s.personalAgent.cs

	deps, err := cs.AppsV1().Deployments(ns).List(ctx, metav1.ListOptions{
		LabelSelector: "app.kubernetes.io/managed-by=" + personalAgentManagedByLabelValue,
	})
	if err != nil {
		result.Errors = append(result.Errors, fmt.Sprintf("list deployments: %v", err))
		return result
	}

	for i := range deps.Items {
		dep := &deps.Items[i]
		result.Inspected++

		agentID := firstNonEmpty(
			dep.Annotations[personalAgentAnnoAgentID],
			dep.Labels[personalAgentLabelAgentID],
		)
		slackUserID := firstNonEmpty(dep.Annotations[personalAgentAnnoSlackUserID])
		if agentID == "" || slackUserID == "" {
			// Can't compute both names — leave it for the operator rather than
			// risk a partial move.
			result.Errors = append(result.Errors,
				fmt.Sprintf("skip %s: missing agent-id or slack-user-id annotation", dep.Name))
			continue
		}

		oldName := personalAgentResourceName(slackUserID)
		newName := personalAgentResourceName(agentID)
		if newName == oldName {
			// Degenerate (shouldn't happen with distinct id vs uid), already keyed
			// correctly — nothing to move.
			continue
		}
		if dep.Name == newName {
			// Already migrated.
			continue
		}
		if dep.Name != oldName {
			// Name matches neither the legacy nor the new hash. Provenance is
			// unexpected; don't guess — skip and surface it.
			result.Errors = append(result.Errors,
				fmt.Sprintf("skip %s: name matches neither old(%s) nor new(%s) hash", dep.Name, oldName, newName))
			continue
		}

		if err := s.migrateOnePersonalAgent(ctx, ns, dep, agentID, slackUserID, oldName, newName); err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("migrate %s: %v", dep.Name, err))
			continue
		}
		result.Migrated++
		s.log.Printf("personal-agent rekey: migrated %s/%s -> %s (agent=%s owner=%s)",
			ns, oldName, newName, agentID, slackUserID)
	}
	return result
}

// migrateOnePersonalAgent moves a single agent's resources from the old
// slack-hash names to the new agent-id-hash names. Order is deliberate:
//
//  1. copy the runtime Secret (so the new Deployment's envFrom resolves)
//  2. copy the Google OAuth Secret + gws RBAC if the agent had Google connected
//  3. rebuild Deployment + Service authoritatively under the new name
//  4. delete the old-named Deployment, Service, and Secrets (+ old RBAC)
//
// Each create is create-if-not-exists so a half-finished prior run resumes
// cleanly. Deletes tolerate NotFound.
func (s *Server) migrateOnePersonalAgent(ctx context.Context, ns string, dep *appsv1.Deployment, agentID, slackUserID, oldName, newName string) error {
	cs := s.personalAgent.cs

	// 1. Runtime Secret: carry over the data (bot token + signing secret etc.).
	oldSecretName := personalAgentSecretName(slackUserID)
	newSecretName := personalAgentSecretName(agentID)
	if err := s.copySecretRekeyed(ctx, ns, oldSecretName, newSecretName, agentID, slackUserID); err != nil {
		return fmt.Errorf("copy runtime secret: %w", err)
	}

	// 2. Google OAuth Secret + per-agent gws RBAC, only if the agent had Google
	//    connected (the old-named Secret exists).
	oldGoogleSecret := personalAgentGoogleSecretName(slackUserID)
	newGoogleSecret := personalAgentGoogleSecretName(agentID)
	oldRBACName := personalAgentGwsSidecarSAName(slackUserID)
	hadGoogle, err := s.migrateGoogleRekeyed(ctx, ns, oldGoogleSecret, newGoogleSecret, agentID, slackUserID)
	if err != nil {
		return fmt.Errorf("migrate google creds: %w", err)
	}

	// 3. Rebuild Deployment + Service under the new agent-id-hashed names. The
	//    writer derives every dependent name from agent id, so the new pod's
	//    envFrom, sidecar secret refs, SA name, and hostPath subPath all point at
	//    the new resources.
	req, err := personalAgentReqFromDeployment(dep, containerImage(dep))
	if err != nil {
		return fmt.Errorf("rebuild req: %w", err)
	}
	req.AgentID = agentID
	req.SlackUserID = slackUserID
	if req.OwnerSlackUserID == "" {
		req.OwnerSlackUserID = slackUserID
	}
	req.GoogleWorkspaceConnected = hadGoogle
	if err := s.personalAgent.WriteAgentService(ctx, agentID); err != nil {
		return fmt.Errorf("write new service: %w", err)
	}
	if err := s.personalAgent.WriteAgentDeployment(ctx, req); err != nil {
		return fmt.Errorf("write new deployment: %w", err)
	}

	// 4. Delete the old-named Deployment + Service + Secrets (+ old RBAC). Order:
	//    Deployment first so the old pod (which mounts the old SA / old Secrets)
	//    stops before we drop them. Tolerate NotFound throughout.
	if err := cs.AppsV1().Deployments(ns).Delete(ctx, oldName, metav1.DeleteOptions{}); err != nil && !apierrors.IsNotFound(err) {
		return fmt.Errorf("delete old deployment %s: %w", oldName, err)
	}
	if err := cs.CoreV1().Services(ns).Delete(ctx, oldName, metav1.DeleteOptions{}); err != nil && !apierrors.IsNotFound(err) {
		return fmt.Errorf("delete old service %s: %w", oldName, err)
	}
	if err := cs.CoreV1().Secrets(ns).Delete(ctx, oldSecretName, metav1.DeleteOptions{}); err != nil && !apierrors.IsNotFound(err) {
		return fmt.Errorf("delete old runtime secret %s: %w", oldSecretName, err)
	}
	if hadGoogle {
		if err := cs.CoreV1().Secrets(ns).Delete(ctx, oldGoogleSecret, metav1.DeleteOptions{}); err != nil && !apierrors.IsNotFound(err) {
			return fmt.Errorf("delete old google secret %s: %w", oldGoogleSecret, err)
		}
		if err := cs.RbacV1().RoleBindings(ns).Delete(ctx, oldRBACName, metav1.DeleteOptions{}); err != nil && !apierrors.IsNotFound(err) {
			return fmt.Errorf("delete old rolebinding %s: %w", oldRBACName, err)
		}
		if err := cs.RbacV1().Roles(ns).Delete(ctx, oldRBACName, metav1.DeleteOptions{}); err != nil && !apierrors.IsNotFound(err) {
			return fmt.Errorf("delete old role %s: %w", oldRBACName, err)
		}
		if err := cs.CoreV1().ServiceAccounts(ns).Delete(ctx, oldRBACName, metav1.DeleteOptions{}); err != nil && !apierrors.IsNotFound(err) {
			return fmt.Errorf("delete old serviceaccount %s: %w", oldRBACName, err)
		}
	}
	return nil
}

// copySecretRekeyed reads the old-named Secret and recreates it under newName
// with the same data, re-stamping the agent-id annotation/label. Create-if-not-
// exists: if the new Secret already exists (resumed run), it's a no-op. A
// missing old Secret is an error for the runtime Secret (the bot token must
// move) — callers that tolerate absence check existence first.
func (s *Server) copySecretRekeyed(ctx context.Context, ns, oldName, newName, agentID, slackUserID string) error {
	cs := s.personalAgent.cs
	// Already migrated?
	if _, err := cs.CoreV1().Secrets(ns).Get(ctx, newName, metav1.GetOptions{}); err == nil {
		return nil
	} else if !apierrors.IsNotFound(err) {
		return fmt.Errorf("get new secret %s: %w", newName, err)
	}
	old, err := cs.CoreV1().Secrets(ns).Get(ctx, oldName, metav1.GetOptions{})
	if err != nil {
		return fmt.Errorf("get old secret %s: %w", oldName, err)
	}
	newSecret := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:        newName,
			Namespace:   ns,
			Labels:      rekeyedLabels(old.Labels, agentID),
			Annotations: rekeyedAnnotations(old.Annotations, agentID, slackUserID),
		},
		Type:       old.Type,
		Data:       old.Data,
		StringData: old.StringData,
	}
	if _, err := cs.CoreV1().Secrets(ns).Create(ctx, newSecret, metav1.CreateOptions{}); err != nil && !apierrors.IsAlreadyExists(err) {
		return fmt.Errorf("create new secret %s: %w", newName, err)
	}
	return nil
}

// migrateGoogleRekeyed moves the per-agent Google OAuth Secret + gws RBAC to the
// new agent-id-hashed names IF the agent had Google connected. Reports whether
// Google was connected so the caller knows to delete the old RBAC and to flip
// the rebuilt Deployment to GoogleWorkspaceConnected. The Secret data (incl. the
// refresh_token) is carried over verbatim; the RBAC is regenerated via
// EnsureGoogleSidecarRBAC under the new agent id (scoped to the new Secret name).
func (s *Server) migrateGoogleRekeyed(ctx context.Context, ns, oldGoogleSecret, newGoogleSecret, agentID, slackUserID string) (bool, error) {
	cs := s.personalAgent.cs
	if _, err := cs.CoreV1().Secrets(ns).Get(ctx, oldGoogleSecret, metav1.GetOptions{}); err != nil {
		if apierrors.IsNotFound(err) {
			// Also check the new name in case a prior run already moved it.
			if _, nerr := cs.CoreV1().Secrets(ns).Get(ctx, newGoogleSecret, metav1.GetOptions{}); nerr == nil {
				return true, nil
			}
			return false, nil // Google was never connected for this agent.
		}
		return false, fmt.Errorf("get old google secret %s: %w", oldGoogleSecret, err)
	}

	// Copy the Google Secret data under the new name.
	if err := s.copySecretRekeyed(ctx, ns, oldGoogleSecret, newGoogleSecret, agentID, slackUserID); err != nil {
		return false, fmt.Errorf("copy google secret: %w", err)
	}
	// Regenerate the per-agent RBAC scoped to the NEW Google Secret name. Uses
	// the agent-id-keyed names (SA/Role/RoleBinding == newRBACName).
	if err := s.personalAgent.EnsureGoogleSidecarRBAC(ctx, agentID); err != nil {
		return false, fmt.Errorf("ensure new gws rbac: %w", err)
	}
	return true, nil
}

// rekeyedLabels returns a copy of src with the agent-id label stamped (and the
// managed-by/integration labels guaranteed present). Never mutates src.
func rekeyedLabels(src map[string]string, agentID string) map[string]string {
	out := map[string]string{
		"app.kubernetes.io/managed-by": personalAgentManagedByLabelValue,
		"bimross.com/integration":      personalAgentIntegrationLabel,
		personalAgentLabelAgentID:      agentID,
	}
	for k, v := range src {
		// app.kubernetes.io/name is name-derived; the writer re-stamps it on the
		// Deployment/Service, and the Secret never carried it — drop any stale
		// copy so the new Secret doesn't advertise the old name.
		if k == "app.kubernetes.io/name" {
			continue
		}
		out[k] = v
	}
	out[personalAgentLabelAgentID] = agentID
	return out
}

// rekeyedAnnotations returns a copy of src with the agent-id + slack-user-id
// annotations stamped. Never mutates src.
func rekeyedAnnotations(src map[string]string, agentID, slackUserID string) map[string]string {
	out := map[string]string{}
	for k, v := range src {
		out[k] = v
	}
	out[personalAgentAnnoAgentID] = agentID
	out[personalAgentAnnoSlackUserID] = slackUserID
	return out
}
