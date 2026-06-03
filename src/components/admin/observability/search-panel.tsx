"use client";

import { useGscSummary } from "./kpi-scorecard";

function formatCount(n: number | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US").format(n);
}

function formatPercent(n: number | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

function formatPosition(n: number | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n) || n === 0) return "—";
  return n.toFixed(1);
}

export function SearchQueriesPanel() {
  const gsc = useGscSummary();
  const rows = gsc?.topQueries ?? [];
  const asOf = gsc?.endDate;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-baseline justify-between border-b border-border/60 px-4 py-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          Top queries · 7d
        </h3>
        {asOf ? (
          <span className="text-[10px] text-muted-foreground">as of {asOf}</span>
        ) : null}
      </div>
      {gsc === null ? (
        <div className="px-4 py-6 text-xs text-muted-foreground">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="px-4 py-6 text-xs text-muted-foreground">
          No indexed queries yet. Google needs a few weeks to start serving impressions.
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left font-semibold">Query</th>
              <th className="px-4 py-2 text-right font-semibold">Impr.</th>
              <th className="px-4 py-2 text-right font-semibold">Clicks</th>
              <th className="px-4 py-2 text-right font-semibold">CTR</th>
              <th className="px-4 py-2 text-right font-semibold">Pos.</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.query} className="border-t border-border/60 text-foreground">
                <td className="truncate px-4 py-2.5 font-mono text-xs">{row.query}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatCount(row.impressions)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatCount(row.clicks)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatPercent(row.ctr)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatPosition(row.position)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

