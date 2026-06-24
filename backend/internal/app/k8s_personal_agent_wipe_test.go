package app

import (
	"context"
	"testing"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
)

func TestWipeAgentWorkspace_CreatesJobPinnedToHostNode(t *testing.T) {
	cs := fake.NewSimpleClientset()
	w := newPersonalAgentWriterWithClient(cs, "personal-agents", "", "")
	ctx := context.Background()

	if err := w.WipeAgentWorkspace(ctx, "agent-abc"); err != nil {
		t.Fatalf("WipeAgentWorkspace: %v", err)
	}
	jobs, err := cs.BatchV1().Jobs("personal-agents").List(ctx, metav1.ListOptions{})
	if err != nil {
		t.Fatalf("list jobs: %v", err)
	}
	if len(jobs.Items) != 1 {
		t.Fatalf("expected 1 job, got %d", len(jobs.Items))
	}
	job := jobs.Items[0]
	if job.Spec.Template.Spec.NodeSelector["kubernetes.io/hostname"] != personalAgentHostNode {
		t.Errorf("job not pinned to %s: %+v", personalAgentHostNode, job.Spec.Template.Spec.NodeSelector)
	}
	if len(job.Spec.Template.Spec.Volumes) != 1 ||
		job.Spec.Template.Spec.Volumes[0].HostPath == nil ||
		job.Spec.Template.Spec.Volumes[0].HostPath.Path != personalAgentHostPathBase {
		t.Errorf("hostPath volume wrong: %+v", job.Spec.Template.Spec.Volumes)
	}
	if job.Spec.TTLSecondsAfterFinished == nil || *job.Spec.TTLSecondsAfterFinished != 300 {
		t.Errorf("expected ttl=300, got %+v", job.Spec.TTLSecondsAfterFinished)
	}
	c := job.Spec.Template.Spec.Containers[0]
	expectedSubPath := personalAgentResourceName("agent-abc")
	if len(c.Args) != 1 || !contains(c.Args[0], expectedSubPath) {
		t.Errorf("args don't target subpath %q: %+v", expectedSubPath, c.Args)
	}
	if job.Spec.Template.Spec.SecurityContext == nil ||
		job.Spec.Template.Spec.SecurityContext.RunAsUser == nil ||
		*job.Spec.Template.Spec.SecurityContext.RunAsUser != 0 {
		t.Errorf("expected runAsUser=0 so wipe can rm fsGroup=1000 files, got %+v", job.Spec.Template.Spec.SecurityContext)
	}
}

func TestWipeAgentWorkspace_RejectsEmpty(t *testing.T) {
	cs := fake.NewSimpleClientset()
	w := newPersonalAgentWriterWithClient(cs, "personal-agents", "", "")
	if err := w.WipeAgentWorkspace(context.Background(), ""); err == nil {
		t.Fatal("expected error on empty slack user id")
	}
}

func contains(haystack, needle string) bool {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return true
		}
	}
	return false
}
