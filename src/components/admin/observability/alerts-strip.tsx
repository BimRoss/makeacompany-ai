"use client";

import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { useAlerts, type AdminAlert } from "./alerts-provider";

function severityClasses(severity: string): string {
  switch (severity) {
    case "critical":
      return "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300";
    case "warning":
      return "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300";
    default:
      return "border-border bg-card text-foreground";
  }
}

function AlertChip({ alert }: { alert: AdminAlert }) {
  return (
    <li
      className={`inline-flex items-start gap-2 rounded-lg border px-3 py-2 text-xs shadow-sm ${severityClasses(
        alert.severity
      )}`}
      title={alert.description}
    >
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 space-y-0.5">
        <div className="flex items-center gap-1.5 font-semibold">
          <span className="truncate">{alert.summary}</span>
          <span className="rounded bg-background/40 px-1 py-px text-[10px] uppercase tracking-wide">
            {alert.severity}
          </span>
        </div>
        {alert.description ? (
          <div className="line-clamp-2 text-[11px] opacity-90">{alert.description}</div>
        ) : null}
      </div>
    </li>
  );
}

export function AlertsStrip() {
  const { fetched, firing } = useAlerts();

  if (!fetched) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-background/40 px-4 py-3 text-xs text-muted-foreground">
        Checking active alerts…
      </div>
    );
  }

  if (firing.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
        <span className="font-medium">All clear.</span>
        <span className="text-xs opacity-80">No alerts firing.</span>
      </div>
    );
  }

  return (
    <section aria-label="Active alerts">
      <ul className="flex flex-wrap gap-2">
        {firing.map((alert) => (
          <AlertChip key={`${alert.name}-${alert.activeAt ?? ""}`} alert={alert} />
        ))}
      </ul>
    </section>
  );
}
