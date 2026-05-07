import type { TeamStatus } from "@/lib/admin/team";

type TeamStatusBadgeProps = {
  status: TeamStatus;
};

const LABEL_BY_STATUS: Record<TeamStatus, string> = {
  active: "Active",
  inactive: "Inactive",
};

export function TeamStatusBadge({ status }: TeamStatusBadgeProps) {
  const isActive = status === "active";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] ${
        isActive
          ? "border-border bg-card text-foreground"
          : "border-border bg-muted text-muted-foreground"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${isActive ? "status-dot-live bg-emerald-500 dark:bg-emerald-400" : "bg-muted-foreground"}`}
        aria-hidden
      />
      {LABEL_BY_STATUS[status]}
    </span>
  );
}
