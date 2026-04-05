import { AdminShell } from "@/components/admin/admin-shell";
import { TeamMemberCard } from "@/components/admin/team-member-card";
import { getAdminTeamMembers, getAdminTeamSnapshot } from "@/lib/admin/team";

export default function AdminTeamPage() {
  const snapshot = getAdminTeamSnapshot();
  const members = getAdminTeamMembers();
  const updatedAt = new Date(snapshot.generatedAt).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <AdminShell updatedAt={updatedAt} source={snapshot.source} activeTab="team">
      <section className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-foreground">Team</h2>
            <p className="text-sm text-muted-foreground sm:text-base">
              Agent roster synced from Slack manifests and optimized for operator visibility.
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            {members.length} {members.length === 1 ? "employee" : "employees"}
          </p>
        </div>

        {members.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
            <p className="text-base font-medium text-foreground">No team cards found yet.</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Run <code className="rounded bg-muted px-1.5 py-0.5">npm run sync:team</code> to import
              agents from <code className="rounded bg-muted px-1.5 py-0.5">slack-factory</code>.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {members.map((member) => (
              <TeamMemberCard key={member.id} member={member} />
            ))}
          </div>
        )}
      </section>
    </AdminShell>
  );
}
