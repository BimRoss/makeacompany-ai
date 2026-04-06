import type { TeamMember } from "@/lib/admin/team";
import { TeamMemberCard } from "@/components/admin/team-member-card";

type TeamCardsGridProps = {
  members: TeamMember[];
};

export function TeamCardsGrid({ members }: TeamCardsGridProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {members.map((member) => (
        <TeamMemberCard key={member.id} member={member} />
      ))}
    </div>
  );
}
