import { AdminShell } from "@/components/admin/admin-shell";
import { TeamMemberCard } from "@/components/admin/team-member-card";
import { getAdminTeamMembers } from "@/lib/admin/team";

export default function AdminTeamPage() {
  const members = getAdminTeamMembers();

  return (
    <AdminShell>
      <section className="space-y-4">
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
