"use client";

import { useEffect, useState } from "react";

type ToolbarProps = {
  /** ISO timestamp of last successful /api/admin/health fetch — drives the pulse and "updated" label. */
  lastUpdatedAt: string | null;
  /** True while a fetch is in-flight (drives the pulsing dot). */
  loading: boolean;
};

function formatRelative(iso: string | null, now: number): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const delta = Math.max(0, Math.round((now - t) / 1000));
  if (delta < 5) return "just now";
  if (delta < 60) return `${delta}s ago`;
  const minutes = Math.floor(delta / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export function ObservabilityToolbar({ lastUpdatedAt, loading }: ToolbarProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span
          aria-hidden="true"
          className="relative inline-flex h-2 w-2 items-center justify-center rounded-full"
          style={{
            backgroundColor: loading
              ? "#f59e0b"
              : lastUpdatedAt
                ? "var(--chart-pos)"
                : "var(--chart-muted)",
          }}
        >
          {loading || lastUpdatedAt ? (
            <span
              className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60"
              style={{ backgroundColor: loading ? "#f59e0b" : "var(--chart-pos)" }}
            />
          ) : null}
        </span>
        <span className="whitespace-nowrap">
          {loading ? "Refreshing…" : `Updated ${formatRelative(lastUpdatedAt, now)}`}
        </span>
      </div>
    </div>
  );
}
