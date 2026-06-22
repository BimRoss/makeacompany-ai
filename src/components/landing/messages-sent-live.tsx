"use client";

import { useEffect, useState } from "react";

import type { LanderMessagesSent, LanderMessagesSentPoint } from "@/lib/lander-messages-sent";

const POLL_INTERVAL_MS = 60_000;

const compactFormatter = new Intl.NumberFormat("en-US", { notation: "standard" });

function formatTotal(n: number | null): string {
  if (n === null) return "—";
  return compactFormatter.format(n);
}

/**
 * Wide in-brand sparkline. Inherits the section colors; the line uses
 * --chart-accent (the single brand blue), the dot sits at the trailing
 * point. Pure SVG so the section can sit anywhere on the lander without
 * pulling in a chart library.
 */
function Sparkline({ points }: { points: LanderMessagesSentPoint[] }) {
  if (points.length < 2) {
    return <div className="mt-6 h-20 sm:h-24" aria-hidden="true" />;
  }
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const p of points) {
    if (p.messages < yMin) yMin = p.messages;
    if (p.messages > yMax) yMax = p.messages;
  }
  const yPad = yMax === yMin ? Math.max(1, Math.abs(yMax) * 0.1) : (yMax - yMin) * 0.12;
  const yLo = Math.max(0, yMin - yPad);
  const yHi = yMax + yPad;
  const yRange = yHi - yLo || 1;
  const W = 600;
  const H = 80;
  const projectX = (i: number) => (i / (points.length - 1)) * W;
  const projectY = (v: number) => H - 4 - ((v - yLo) / yRange) * (H - 8);
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${projectX(i).toFixed(2)},${projectY(p.messages).toFixed(2)}`)
    .join(" ");
  const fill = `${path} L${W},${H} L0,${H} Z`;
  const last = points[points.length - 1];
  const lastX = projectX(points.length - 1);
  const lastY = projectY(last.messages);
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="mt-6 h-20 w-full sm:h-24"
      role="img"
      aria-label={`Daily messages over the last ${points.length} days`}
    >
      <defs>
        <linearGradient id="lander-messages-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--chart-accent)" stopOpacity="0.18" />
          <stop offset="100%" stopColor="var(--chart-accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fill} fill="url(#lander-messages-fill)" />
      <path d={path} fill="none" stroke="var(--chart-accent)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lastX} cy={lastY} r={4} fill="var(--chart-accent)" />
    </svg>
  );
}

export function MessagesSentLive({ initial }: { initial: LanderMessagesSent }) {
  const [data, setData] = useState<LanderMessagesSent>(initial);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/lander/messages-sent", { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as {
          total?: number;
          daily?: LanderMessagesSentPoint[];
        };
        if (cancelled) return;
        const total = typeof body.total === "number" && body.total >= 0 ? body.total : null;
        const daily = Array.isArray(body.daily)
          ? body.daily.filter(
              (p): p is LanderMessagesSentPoint =>
                !!p && typeof p.day === "string" && typeof p.messages === "number",
            )
          : [];
        setData({ total, daily });
      } catch {
        // Tile keeps showing the last good value on transient failures.
      }
    };
    if (initial.total === null) void load();
    const id = window.setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [initial.total]);

  if (data.total === null && data.daily.length === 0) {
    // No data and no fallback — skip the section rather than render a zeroed tile.
    return null;
  }

  return (
    <section aria-label="Real messages sent" className="pb-14 sm:pb-20">
      <div className="mx-auto max-w-6xl px-6">
        <div className="rounded-2xl border border-border bg-card p-6 sm:p-10">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Real messages sent
            </p>
            <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <span
                className="relative inline-flex h-2 w-2"
                aria-hidden="true"
              >
                <span
                  className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60"
                  style={{ backgroundColor: "var(--chart-accent)" }}
                />
                <span
                  className="relative inline-flex h-2 w-2 rounded-full"
                  style={{ backgroundColor: "var(--chart-accent)" }}
                />
              </span>
              Live
            </span>
          </div>
          <div className="mt-4 flex items-baseline gap-3">
            <p className="font-display text-5xl font-bold tracking-tight tabular-nums sm:text-6xl">
              {formatTotal(data.total)}
            </p>
            <p className="text-sm text-muted-foreground">across every channel, all-time</p>
          </div>
          <Sparkline points={data.daily} />
          <p className="mt-3 text-xs text-muted-foreground">
            Last {data.daily.length || 30} days. Counted once per Slack message, deduped across our agents.
          </p>
        </div>
      </div>
    </section>
  );
}
