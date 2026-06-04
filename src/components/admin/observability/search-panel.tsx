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

function shortenGSCPage(raw: string): string {
  const trimmed = raw.replace(/^https?:\/\//, "");
  if (trimmed.length <= 56) return trimmed;
  return `${trimmed.slice(0, 53)}…`;
}

function titleCaseDevice(d: string): string {
  if (!d) return "Unknown";
  if (d === "desktop") return "Desktop";
  if (d === "mobile") return "Mobile";
  if (d === "tablet") return "Tablet";
  return d.charAt(0).toUpperCase() + d.slice(1);
}

export function SearchPagesPanel() {
  const gsc = useGscSummary();
  const rows = gsc?.topPages ?? [];
  const asOf = gsc?.endDate;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-baseline justify-between border-b border-border/60 px-4 py-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          Top pages · 7d
        </h3>
        {asOf ? (
          <span className="text-[10px] text-muted-foreground">as of {asOf}</span>
        ) : null}
      </div>
      {gsc === null ? (
        <div className="px-4 py-6 text-xs text-muted-foreground">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="px-4 py-6 text-xs text-muted-foreground">No indexed pages yet.</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left font-semibold">Page</th>
              <th className="px-4 py-2 text-right font-semibold">Impr.</th>
              <th className="px-4 py-2 text-right font-semibold">Clicks</th>
              <th className="px-4 py-2 text-right font-semibold">CTR</th>
              <th className="px-4 py-2 text-right font-semibold">Pos.</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.page} className="border-t border-border/60 text-foreground">
                <td className="truncate px-4 py-2.5 font-mono text-xs">
                  <a
                    href={row.page}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="hover:underline"
                    title={row.page}
                  >
                    {shortenGSCPage(row.page)}
                  </a>
                </td>
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

export function SearchHostsPanel() {
  const gsc = useGscSummary();
  const rows = gsc?.topHosts ?? [];
  const asOf = gsc?.endDate;
  const totalImpr = rows.reduce((acc, r) => acc + (r.impressions ?? 0), 0);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-baseline justify-between border-b border-border/60 px-4 py-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          Top hosts · 7d
        </h3>
        {asOf ? (
          <span className="text-[10px] text-muted-foreground">as of {asOf}</span>
        ) : null}
      </div>
      {gsc === null ? (
        <div className="px-4 py-6 text-xs text-muted-foreground">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="px-4 py-6 text-xs text-muted-foreground">
          No host-level data yet. Persona subdomains will appear once Google indexes them.
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left font-semibold">Host</th>
              <th className="px-4 py-2 text-right font-semibold">Impr.</th>
              <th className="px-4 py-2 text-right font-semibold">Clicks</th>
              <th className="px-4 py-2 text-right font-semibold">Share</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const share = totalImpr > 0 ? row.impressions / totalImpr : 0;
              return (
                <tr key={row.host} className="border-t border-border/60 text-foreground">
                  <td className="truncate px-4 py-2.5 font-mono text-xs">{row.host}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatCount(row.impressions)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatCount(row.clicks)}</td>
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

export function SearchDeviceStrip() {
  const gsc = useGscSummary();
  const rows = gsc?.deviceSplit ?? [];
  if (gsc === null || rows.length === 0) return null;
  const total = rows.reduce((acc, r) => acc + (r.impressions ?? 0), 0);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-baseline justify-between border-b border-border/60 px-4 py-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          Device split · 7d
        </h3>
        {gsc.endDate ? (
          <span className="text-[10px] text-muted-foreground">as of {gsc.endDate}</span>
        ) : null}
      </div>
      <div className="grid grid-cols-1 gap-px bg-border/60 sm:grid-cols-3">
        {rows.map((row) => {
          const share = total > 0 ? row.impressions / total : 0;
          return (
            <div key={row.device || "unknown"} className="bg-card px-4 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                {titleCaseDevice(row.device)}
              </div>
              <div className="mt-1 font-display text-xl font-semibold tabular-nums text-foreground">
                {formatPercent(share)}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground tabular-nums">
                {formatCount(row.impressions)} impr · {formatCount(row.clicks)} clicks · CTR {formatPercent(row.ctr)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
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

