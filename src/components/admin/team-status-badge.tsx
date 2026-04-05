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
          ? "border-foreground/20 bg-foreground/5 text-foreground"
          : "border-border bg-muted text-muted-foreground"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${isActive ? "bg-foreground" : "bg-muted-foreground"}`}
        aria-hidden
      />
      {LABEL_BY_STATUS[status]}
    </span>
  );
}
