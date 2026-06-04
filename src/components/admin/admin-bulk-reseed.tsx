"use client";

import { useCallback, useState } from "react";

type ReseedChange = {
  kind: string;
  name?: string;
  summary?: string;
};

type ReseedRow = {
  channelId: string;
  name?: string;
  status: "applied" | "noop" | "dry_run" | "missing" | "error";
  dryRun: boolean;
  noOp?: boolean;
  changes?: ReseedChange[];
  error?: string;
  stampedTo?: string;
  durationMs: number;
};

type ReseedSummary = {
  total: number;
  applied: number;
  noop: number;
  dryRun: number;
  missing: number;
  errored: number;
};

type ReseedAllResponse = {
  summary?: ReseedSummary;
  results?: ReseedRow[];
  error?: string;
};

const STATUS_LABEL: Record<ReseedRow["status"], string> = {
  applied: "Applied",
  noop: "No-op",
  dry_run: "Dry-run",
  missing: "No workspace",
  error: "Error",
};

const STATUS_DOT: Record<ReseedRow["status"], string> = {
  applied: "bg-emerald-500",
  noop: "bg-slate-400",
  dry_run: "bg-sky-500",
  missing: "bg-amber-400",
  error: "bg-rose-500",
};

export function AdminBulkReseed() {
  const [busy, setBusy] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<"dry" | "apply" | null>(null);
  const [results, setResults] = useState<ReseedRow[] | null>(null);
  const [summary, setSummary] = useState<ReseedSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const [lastRunMode, setLastRunMode] = useState<"dry" | "apply" | null>(null);

  const run = useCallback(async (dryRun: boolean) => {
    setBusy(true);
    setError(null);
    setConfirmTarget(null);
    try {
      const res = await fetch("/api/admin/reseed-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dry_run: dryRun }),
        cache: "no-store",
      });
      const body = (await res.json()) as ReseedAllResponse;
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`);
        setResults(null);
        setSummary(null);
        return;
      }
      setResults(body.results ?? []);
      setSummary(body.summary ?? null);
      setLastRunAt(new Date().toISOString());
      setLastRunMode(dryRun ? "dry" : "apply");
    } catch (err) {
      setError(err instanceof Error ? err.message : "request failed");
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <header className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Channel reseed</h2>
          <p className="mt-1 text-sm text-slate-600">
            Refresh every channel workspace to the latest scaffold defaults. Operator content
            (Company context, Notes, custom sections) is preserved; only the auto-managed
            scaffold and placeholder bodies are touched.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => setConfirmTarget("dry")}
            disabled={busy}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
          >
            Dry-run
          </button>
          <button
            type="button"
            onClick={() => setConfirmTarget("apply")}
            disabled={busy}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
          >
            Reseed all
          </button>
        </div>
      </header>

      {confirmTarget && (
        <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
          <p className="font-medium text-amber-900">
            {confirmTarget === "apply"
              ? "Reseed every channel workspace? This writes to every channel's CLAUDE.md (with snapshot)."
              : "Run a dry-run across every channel? No files will be written."}
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => run(confirmTarget === "dry")}
              className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
            >
              {confirmTarget === "apply" ? "Yes, reseed all" : "Yes, dry-run"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmTarget(null)}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {busy && <p className="text-sm text-slate-500">Running…</p>}

      {error && (
        <p className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800">
          {error}
        </p>
      )}

      {summary && (
        <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
          <span>
            {lastRunMode === "dry" ? "Dry-run" : "Applied"}
            {lastRunAt ? ` at ${new Date(lastRunAt).toLocaleTimeString()}` : null}
          </span>
          <span>Total: {summary.total}</span>
          <span>Applied: {summary.applied}</span>
          <span>No-op: {summary.noop}</span>
          {summary.dryRun > 0 && <span>Dry-run rows: {summary.dryRun}</span>}
          <span>No workspace: {summary.missing}</span>
          <span>Errors: {summary.errored}</span>
        </div>
      )}

      {results && results.length > 0 && (
        <div className="max-h-96 overflow-auto rounded-md border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Channel</th>
                <th className="px-3 py-2">Detail</th>
                <th className="px-3 py-2 text-right">Ms</th>
              </tr>
            </thead>
            <tbody>
              {results.map((row) => (
                <tr key={row.channelId} className="border-t border-slate-100">
                  <td className="px-3 py-1.5">
                    <span className={`inline-block h-2 w-2 rounded-full ${STATUS_DOT[row.status]}`} />
                    <span className="ml-2">{STATUS_LABEL[row.status]}</span>
                  </td>
                  <td className="px-3 py-1.5 font-mono text-xs text-slate-700">
                    {row.name ? `#${row.name}` : row.channelId}
                  </td>
                  <td className="px-3 py-1.5 text-xs text-slate-600">
                    {row.error
                      ? row.error
                      : row.changes && row.changes.length > 0
                        ? row.changes.map((c) => c.name ?? c.summary ?? c.kind).join(", ")
                        : row.noOp
                          ? "already current"
                          : ""}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-xs text-slate-500">
                    {row.durationMs}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
