export type AdminCatalogNavActive = "employees" | "skills" | null;

type AdminCatalogNavLabelsProps = {
  /** Which catalog route is active (channel pages pass null — both labels use inactive styling). */
  active: AdminCatalogNavActive;
  className?: string;
};

const labelBase =
  "rounded-full px-3 py-1.5 font-display text-sm font-semibold leading-snug tracking-[-0.02em] sm:text-base";

/** Plain title on `/employees` and `/skills` (no pill, single label). */
const catalogPageTitle =
  "font-display text-sm font-semibold leading-snug tracking-[-0.02em] sm:text-base text-foreground";

export function AdminCatalogNavLabels({ active, className }: AdminCatalogNavLabelsProps) {
  const wrapClass = ["flex min-w-0 shrink-0 items-center gap-1 sm:gap-1.5", className].filter(Boolean).join(" ");

  if (active === "employees") {
    return (
      <div className={wrapClass} aria-label="Employees">
        <span className={catalogPageTitle} aria-current="page">
          employees
        </span>
      </div>
    );
  }

  if (active === "skills") {
    return (
      <div className={wrapClass} aria-label="Skills">
        <span className={catalogPageTitle} aria-current="page">
          skills
        </span>
      </div>
    );
  }

  return (
    <div className={wrapClass} role="group" aria-label="Employees and skills">
      <span className={[labelBase, "text-muted-foreground"].join(" ")}>employees</span>
      <span className={[labelBase, "text-muted-foreground"].join(" ")}>skills</span>
    </div>
  );
}
