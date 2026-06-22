"use client";

import { useEffect, useState } from "react";

import type { LanderMessagesSent, LanderMessagesSentPoint } from "@/lib/lander-messages-sent";

const POLL_INTERVAL_MS = 60_000;

const compactFormatter = new Intl.NumberFormat("en-US", { notation: "standard" });

function formatTotal(n: number | null): string {
  if (n === null) return "—";
  return compactFormatter.format(n);
}

function Sparkline({ points }: { points: LanderMessagesSentPoint[] }) {
  if (points.length < 2) {
    return <div className="mt-4 h-10 sm:h-12" aria-hidden="true" />;
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
  const H = 60;
  const projectX = (i: number) => (i / (points.length - 1)) * W;
  const projectY = (v: number) => H - 3 - ((v - yLo) / yRange) * (H - 6);
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${projectX(i).toFixed(2)},${projectY(p.messages).toFixed(2)}`)
    .join(" ");
  const fill = `${path} L${W},${H} L0,${H} Z`;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="mt-4 h-10 w-full text-foreground sm:h-12"
      role="img"
      aria-label={`Daily messages, all-time (${points.length} days)`}
    >
      <defs>
        <linearGradient id="lander-messages-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.12" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fill} fill="url(#lander-messages-fill)" />
      <path d={path} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
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
    <section aria-label="Real messages sent" className="pb-10 sm:pb-14">
      <div className="mx-auto max-w-3xl px-6">
        <div className="rounded-xl border border-border bg-card px-5 py-4 sm:px-6 sm:py-5">
          <div className="flex items-baseline justify-between gap-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Real messages sent
            </p>
            <p className="text-[11px] text-muted-foreground">all-time</p>
          </div>
          <p className="mt-1 font-display text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl">
            {formatTotal(data.total)}
          </p>
          <Sparkline points={data.daily} />
        </div>
      </div>
    </section>
  );
}
