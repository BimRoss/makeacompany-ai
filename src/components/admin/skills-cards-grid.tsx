import Link from "next/link";
import type { AdminSkill, TeamMember } from "@/lib/admin/catalog";

const employeePillClass =
  "inline-flex rounded-full border border-foreground/20 bg-foreground px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-background";

const employeePillInteractiveClass = `${employeePillClass} motion-all ease-in-out hover:scale-[1.03] hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/25 focus-visible:ring-offset-2 focus-visible:ring-offset-background`;

type SkillsCardsGridProps = {
  skills: AdminSkill[];
  members: TeamMember[];
  /** No links or hover affordances — for operator views like /admin. */
  readOnly?: boolean;
  /** Show required vs optional tool parameters from the capability catalog. */
  showToolParams?: boolean;
};

export function SkillsCardsGrid({
  skills,
  members,
  readOnly = false,
  showToolParams = false,
}: SkillsCardsGridProps) {
  const memberNameById = new Map(members.map((member) => [member.id, member.displayName]));

  return (
    <div className="columns-1 gap-x-4 sm:columns-2 xl:columns-3 [column-fill:balance]">
      {skills.map((skill) => {
        const assignedNames = skill.employeeIds
          .map((employeeId) => memberNameById.get(employeeId))
          .filter((name): name is string => Boolean(name));

        const required = skill.requiredParams ?? [];
        const optional = skill.optionalParams ?? [];
        const cardMotion = readOnly
          ? "employees-card-motion mb-4 flex w-full flex-col gap-2.5 break-inside-avoid rounded-xl border border-border bg-card p-4 shadow-sm motion-colors"
          : "employees-card-motion mb-4 flex w-full flex-col gap-2.5 break-inside-avoid rounded-xl border border-border bg-card p-4 shadow-sm motion-colors md:cursor-pointer md:hover:shadow-md";

        return (
          <article key={skill.id} className={cardMotion}>
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
                ) : readOnly ? (
                  assignedNames.map((name) => (
                    <span key={`${skill.id}-${name}`} className={employeePillClass}>
                      {name}
                    </span>
                  ))
                ) : (
                  assignedNames.map((name) => (
                    <Link
                      key={`${skill.id}-${name}`}
                      href="/employees"
                      className={employeePillInteractiveClass}
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
                  ? "min-w-0 text-sm leading-snug text-muted-foreground/80"
                  : "min-w-0 text-sm leading-snug text-muted-foreground"
              }
            >
              {skill.description}
            </p>

            {showToolParams && (required.length > 0 || optional.length > 0) ? (
              <div className="flex min-w-0 flex-wrap gap-1.5 border-t border-border/80 pt-2.5">
                {required.map((param) => (
                  <code
                    key={`${skill.id}-req-${param}`}
                    className="rounded-md border border-border bg-muted/60 px-2 py-0.5 font-mono text-[11px] text-foreground"
                  >
                    {param}
                  </code>
                ))}
                {optional.map((param) => (
                  <code
                    key={`${skill.id}-opt-${param}`}
                    className="rounded-md border border-border bg-muted/60 px-2 py-0.5 font-mono text-[11px] text-foreground opacity-50"
                  >
                    {param}
                  </code>
                ))}
              </div>
            ) : null}

            {!skill.comingSoon && assignedNames.length === 0 ? (
              <p className="text-xs leading-snug text-muted-foreground">No employees assigned yet.</p>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}