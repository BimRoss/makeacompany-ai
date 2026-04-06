import type { TeamMember } from "@/lib/admin/team";
import { TeamStatusBadge } from "@/components/admin/team-status-badge";

type TeamMemberCardProps = {
  member: TeamMember;
};

function laneLabel(lane: TeamMember["lane"]): string {
  switch (lane) {
    case "automation":
      return "Automation";
    case "sales":
      return "Sales";
    case "strategy":
      return "Strategy";
    case "operations":
      return "Operations";
    case "internship":
      return "Internship";
    default:
      return "General";
  }
}

export function TeamMemberCard({ member }: TeamMemberCardProps) {
  return (
    <article className="surface-card-motion group relative overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-sm motion-colors sm:p-6 md:hover:-translate-y-1 md:hover:shadow-lg">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-20 opacity-15"
        style={{
          background: `linear-gradient(180deg, ${member.backgroundColor} 0%, transparent 100%)`,
        }}
        aria-hidden
      />

      <div className="relative flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {laneLabel(member.lane)}
          </p>
          <h2 className="text-xl font-semibold tracking-tight text-foreground">{member.displayName}</h2>
          <p className="text-sm text-muted-foreground">{member.roleTitle}</p>
        </div>
        <TeamStatusBadge status={member.status} />
      </div>

      <div className="relative mt-4 space-y-2">
        <p className="line-clamp-3 text-sm leading-relaxed text-muted-foreground">{member.longDescription}</p>
      </div>

      <div className="relative mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-border/80 pt-3 text-xs text-muted-foreground">
        <span className="rounded-full bg-muted px-2 py-1 font-medium">@{member.botDisplayName}</span>
      </div>
    </article>
  );
}
