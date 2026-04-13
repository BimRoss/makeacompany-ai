import Link from "next/link";
import type { AdminSkill, TeamMember } from "@/lib/admin/catalog";

type SkillsCardsGridProps = {
  skills: AdminSkill[];
  members: TeamMember[];
};

export function SkillsCardsGrid({ skills, members }: SkillsCardsGridProps) {
  const memberNameById = new Map(members.map((member) => [member.id, member.displayName]));

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {skills.map((skill) => {
        const assignedNames = skill.employeeIds
          .map((employeeId) => memberNameById.get(employeeId))
          .filter((name): name is string => Boolean(name));

        return (
          <article
            key={skill.id}
            className="employees-card-motion rounded-xl border border-border bg-card px-3 pb-1.5 pt-3 shadow-sm motion-colors sm:px-4 sm:pb-2 sm:pt-4 md:cursor-pointer md:hover:shadow-md"
          >
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2
                  className={
                    skill.comingSoon
                      ? "text-base font-semibold tracking-tight text-foreground opacity-50"
                      : "text-base font-semibold tracking-tight text-foreground"
                  }
                >
                  {skill.label}
                </h2>
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
              <p className={skill.comingSoon ? "text-xs text-muted-foreground opacity-50" : "text-xs text-muted-foreground"}>
                {skill.id}
              </p>
            </div>

            <p className={skill.comingSoon ? "mt-1 text-sm leading-6 text-muted-foreground opacity-50" : "mt-1 text-sm leading-6 text-muted-foreground"}>
              {skill.description}
            </p>

            {!skill.comingSoon ? (
              <div className="mt-2 space-y-2 text-xs text-muted-foreground">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium uppercase tracking-wide text-foreground/80">Required</p>
                  {(skill.requiredParams ?? []).length > 0 ? (
                    (skill.requiredParams ?? []).map((param) => (
                      <span key={`${skill.id}-required-${param}`} className="rounded-full border border-border bg-background px-2 py-0.5">
                        {param}
                      </span>
                    ))
                  ) : (
                    <span className="text-muted-foreground">None</span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 opacity-50">
                  <p className="font-medium uppercase tracking-wide text-foreground/80">Optional</p>
                  {(skill.optionalParams ?? []).length > 0 ? (
                    (skill.optionalParams ?? []).map((param) => (
                      <span key={`${skill.id}-optional-${param}`} className="rounded-full border border-border bg-background px-2 py-0.5">
                        {param}
                      </span>
                    ))
                  ) : (
                    <span className="text-muted-foreground">None</span>
                  )}
                </div>
              </div>
            ) : null}

            {!skill.comingSoon && assignedNames.length === 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">No employees assigned yet.</p>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
