"use client";

import { AlertTriangle } from "lucide-react";

import type { KpiSelfCheckEntry } from "./kpi-scorecard";

export function SelfCheckBanner({ entries }: { entries: KpiSelfCheckEntry[] }) {
  const uncovered = entries.filter(
    (e) => (e.color === "red" || e.color === "amber") && !e.hasAlertCoverage
  );
  if (uncovered.length === 0) return null;
  const labels = uncovered.map((e) => e.label).join(", ");
  return (
    <div
      className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-800 dark:text-amber-200"
      role="status"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="space-y-0.5">
        <div className="font-semibold">
          Dashboard self-check: {uncovered.length} red/amber tile
          {uncovered.length === 1 ? "" : "s"} not backed by a firing alert.
        </div>
        <div className="opacity-90">
          {labels}. Either add a PrometheusRule, or fix the underlying metric so the tile clears.
          See <code className="text-[11px]">BimRoss/makeacompany-ai#78</code>.
        </div>
      </div>
    </div>
  );
}
