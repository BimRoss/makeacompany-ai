import Link from "next/link";
import type { AdminSkill, TeamMember } from "@/lib/admin/catalog";

type SkillsCardsGridProps = {
  skills: AdminSkill[];
  members: TeamMember[];
};

export function SkillsCardsGrid({ skills, members }: SkillsCardsGridProps) {
  const memberNameById = new Map(members.map((member) => [member.id, member.displayName]));

  return (
    <div className="grid grid-cols-1 items-start gap-x-4 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
      {skills.map((skill) => {
        const assignedNames = skill.employeeIds
          .map((employeeId) => memberNameById.get(employeeId))
          .filter((name): name is string => Boolean(name));

        return (
          <article
            key={skill.id}
            className="employees-card-motion flex w-full flex-col gap-2.5 rounded-xl border border-border bg-card p-4 shadow-sm motion-colors md:cursor-pointer md:hover:shadow-md"
          >
            <div className="flex min-w-0 flex-col gap-1.5">
              <h2
                className={
                  skill.comingSoon
                    ? "text-base font-semibold tracking-tight text-foreground/50"
                    : "text-base font-semibold tracking-tight text-foreground"
                }
              >
                {skill.label}
              </h2>
              <div className="flex flex-wrap gap-1.5">
                {skill.comingSoon ? (
                  <span className="shrink-0 rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Coming soon
                  </span>
                ) : (
                  assignedNames.map((name) => (
                    <Link
                      key={`${skill.id}-${name}`}
                      href="/employees"
                      className="inline-flex rounded-full border border-foreground/20 bg-foreground px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-background motion-all ease-in-out hover:scale-[1.03] hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/25 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    >
                      {name}
                    </Link>
                  ))
                )}
              </div>
            </div>

            <p
              className={
                skill.comingSoon
                  ? "line-clamp-2 text-sm leading-snug text-muted-foreground/80"
                  : "line-clamp-2 text-sm leading-snug text-muted-foreground"
              }
            >
              {skill.description}
            </p>

            {!skill.comingSoon && assignedNames.length === 0 ? (
              <p className="text-xs leading-snug text-muted-foreground">No employees assigned yet.</p>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}