"use client";

import { useGa4Summary } from "./kpi-scorecard";

function formatCount(n: number | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US").format(n);
}

function formatPercent(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

function shortenPath(p: string): string {
  if (p.length <= 60) return p;
  return `${p.slice(0, 57)}…`;
}

function titleCaseDevice(d: string): string {
  if (!d) return "Unknown";
  return d.charAt(0).toUpperCase() + d.slice(1);
}

export function Ga4TopPagesPanel() {
  const ga4 = useGa4Summary();
  const rows = ga4?.topPages ?? [];
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-baseline justify-between border-b border-border/60 px-4 py-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          Top pages · 7d
        </h3>
        <span className="text-[10px] text-muted-foreground">GA4</span>
      </div>
      {ga4 === null ? (
        <div className="px-4 py-6 text-xs text-muted-foreground">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="px-4 py-6 text-xs text-muted-foreground">No page data yet.</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left font-semibold">Path</th>
              <th className="px-4 py-2 text-right font-semibold">Views</th>
              <th className="px-4 py-2 text-right font-semibold">Users</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.path} className="border-t border-border/60 text-foreground">
                <td className="truncate px-4 py-2.5 font-mono text-xs" title={row.path}>
                  {shortenPath(row.path)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatCount(row.views)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatCount(row.users)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function Ga4SourcesPanel() {
  const ga4 = useGa4Summary();
  const rows = ga4?.sources ?? [];
  const total = rows.reduce((acc, r) => acc + (r.sessions ?? 0), 0);
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-baseline justify-between border-b border-border/60 px-4 py-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          Traffic sources · 7d
        </h3>
        <span className="text-[10px] text-muted-foreground">GA4</span>
      </div>
      {ga4 === null ? (
        <div className="px-4 py-6 text-xs text-muted-foreground">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="px-4 py-6 text-xs text-muted-foreground">No channel data yet.</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left font-semibold">Channel</th>
              <th className="px-4 py-2 text-right font-semibold">Sessions</th>
              <th className="px-4 py-2 text-right font-semibold">Users</th>
              <th className="px-4 py-2 text-right font-semibold">Share</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const share = total > 0 ? row.sessions / total : 0;
              return (
                <tr key={row.channel || "unknown"} className="border-t border-border/60 text-foreground">
                  <td className="px-4 py-2.5 text-xs">{row.channel || "Unknown"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatCount(row.sessions)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatCount(row.users)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatPercent(share)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function Ga4CountriesPanel() {
  const ga4 = useGa4Summary();
  const rows = ga4?.countries ?? [];
  const total = rows.reduce((acc, r) => acc + (r.users ?? 0), 0);
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-baseline justify-between border-b border-border/60 px-4 py-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          Top countries · 7d
        </h3>
        <span className="text-[10px] text-muted-foreground">GA4</span>
      </div>
      {ga4 === null ? (
        <div className="px-4 py-6 text-xs text-muted-foreground">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="px-4 py-6 text-xs text-muted-foreground">No country data yet.</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left font-semibold">Country</th>
              <th className="px-4 py-2 text-right font-semibold">Users</th>
              <th className="px-4 py-2 text-right font-semibold">Share</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const share = total > 0 ? row.users / total : 0;
              return (
                <tr key={row.country || "unknown"} className="border-t border-border/60 text-foreground">
                  <td className="px-4 py-2.5 text-xs">{row.country || "Unknown"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatCount(row.users)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatPercent(share)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function Ga4DevicesPanel() {
  const ga4 = useGa4Summary();
  const rows = ga4?.devices ?? [];
  const total = rows.reduce((acc, r) => acc + (r.sessions ?? 0), 0);
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-baseline justify-between border-b border-border/60 px-4 py-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          Device split · 7d
        </h3>
        <span className="text-[10px] text-muted-foreground">GA4</span>
      </div>
      {ga4 === null ? (
        <div className="px-4 py-6 text-xs text-muted-foreground">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="px-4 py-6 text-xs text-muted-foreground">No device data yet.</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left font-semibold">Device</th>
              <th className="px-4 py-2 text-right font-semibold">Sessions</th>
              <th className="px-4 py-2 text-right font-semibold">Users</th>
              <th className="px-4 py-2 text-right font-semibold">Share</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const share = total > 0 ? row.sessions / total : 0;
              return (
                <tr key={row.device || "unknown"} className="border-t border-border/60 text-foreground">
                  <td className="px-4 py-2.5 text-xs">{titleCaseDevice(row.device)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatCount(row.sessions)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatCount(row.users)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatPercent(share)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
