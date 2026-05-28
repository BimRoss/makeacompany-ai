"use client";

import { useEffect, useState } from "react";
import { TIME_RANGE_OPTIONS, useTimeRange, type TimeRangeKey } from "./time-range";

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
  const { range, setRange } = useTimeRange();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span
          aria-hidden="true"
          className={`relative inline-flex h-2 w-2 items-center justify-center rounded-full ${
            loading ? "bg-amber-500" : lastUpdatedAt ? "bg-emerald-500" : "bg-muted-foreground/40"
          }`}
        >
          {loading || lastUpdatedAt ? (
            <span
              className={`absolute inline-flex h-full w-full rounded-full opacity-60 ${
                loading ? "animate-ping bg-amber-500" : "animate-ping bg-emerald-500"
              }`}
            />
          ) : null}
        </span>
        <span className="whitespace-nowrap">
          {loading ? "Refreshing…" : `Updated ${formatRelative(lastUpdatedAt, now)}`}
        </span>
      </div>
      <div
        role="radiogroup"
        aria-label="Time range"
        className="inline-flex items-center gap-1 rounded-lg border border-border bg-card p-0.5 text-xs"
      >
        {TIME_RANGE_OPTIONS.map((option) => {
          const active = range === option.key;
          return (
            <button
              key={option.key}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setRange(option.key as TimeRangeKey)}
              className={`rounded-md px-2.5 py-1 transition ${
                active
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
