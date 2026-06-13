"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { area, curveMonotoneX, line, max, min, scaleLinear, scaleTime } from "d3";

export type ChartTone = "ink" | "accent" | "muted" | "pos" | "neg";

export type ChartSeries = {
  key: string;
  label: string;
  tone: ChartTone;
  /** [unixSeconds, value] pairs, ascending by time. */
  points: Array<[number, number]>;
};

const TONE_VAR: Record<ChartTone, string> = {
  ink: "var(--chart-ink)",
  accent: "var(--chart-accent)",
  muted: "var(--chart-muted)",
  pos: "var(--chart-pos)",
  neg: "var(--chart-neg)",
};

function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setWidth(w);
    });
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

function nearestIndex(times: number[], target: number): number {
  if (times.length === 0) return -1;
  let lo = 0;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(times[lo - 1] - target) <= Math.abs(times[lo] - target)) return lo - 1;
  return lo;
}

type TimeSeriesChartProps = {
  series: ChartSeries[];
  /** Formats y-axis ticks and tooltip values. */
  format: (n: number) => string;
  height?: number;
  /** Fill an area under the first series (best for single-metric panels). */
  area?: boolean;
  /** Force the y domain to start at 0 (true) vs. fit the data (false). */
  zeroBaseline?: boolean;
  /** Empty-state copy when no series have points. */
  emptyLabel?: string;
};

export function TimeSeriesChart({
  series,
  format,
  height = 188,
  area: showArea = false,
  zeroBaseline = true,
  emptyLabel = "No data in range",
}: TimeSeriesChartProps) {
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const [hoverX, setHoverX] = useState<number | null>(null);

  const margin = { top: 12, right: 14, bottom: 22, left: 44 };
  const innerW = Math.max(0, width - margin.left - margin.right);
  const innerH = Math.max(0, height - margin.top - margin.bottom);

  const withData = series.filter((s) => s.points.length > 0);
  const hasData = withData.length > 0;

  const { x, y, allTimes, spanSeconds } = useMemo(() => {
    const times: number[] = [];
    let lo = Infinity;
    let hi = -Infinity;
    let vMax = -Infinity;
    let vMin = Infinity;
    for (const s of withData) {
      for (const [t, v] of s.points) {
        if (t < lo) lo = t;
        if (t > hi) hi = t;
        if (v > vMax) vMax = v;
        if (v < vMin) vMin = v;
        times.push(t);
      }
    }
    if (!Number.isFinite(lo)) {
      lo = 0;
      hi = 1;
    }
    if (!Number.isFinite(vMax)) vMax = 1;
    if (!Number.isFinite(vMin)) vMin = 0;
    const yLo = zeroBaseline ? Math.min(0, vMin) : vMin;
    const yHi = vMax === yLo ? yLo + 1 : vMax;
    const xs = scaleTime()
      .domain([new Date(lo * 1000), new Date(hi * 1000)])
      .range([0, innerW]);
    const ys = scaleLinear()
      .domain([yLo, yHi * 1.08])
      .nice(4)
      .range([innerH, 0]);
    const uniqTimes = Array.from(new Set(times)).sort((a, b) => a - b);
    return { x: xs, y: ys, allTimes: uniqTimes, spanSeconds: Math.max(0, hi - lo) };
  }, [withData, innerW, innerH, zeroBaseline]);

  const lineGen = useMemo(
    () =>
      line<[number, number]>()
        .x((d) => x(new Date(d[0] * 1000)))
        .y((d) => y(d[1]))
        .curve(curveMonotoneX),
    [x, y]
  );

  const areaGen = useMemo(
    () =>
      area<[number, number]>()
        .x((d) => x(new Date(d[0] * 1000)))
        .y0(innerH)
        .y1((d) => y(d[1]))
        .curve(curveMonotoneX),
    [x, y, innerH]
  );

  const yTicks = y.ticks(4);
  const xTicks = x.ticks(Math.max(2, Math.min(6, Math.floor(innerW / 90))));

  const formatAxisTick = useMemo(() => makeAxisTickFormatter(spanSeconds), [spanSeconds]);
  const formatHoverTime = useMemo(() => makeHoverTimeFormatter(spanSeconds), [spanSeconds]);

  const hoverTime =
    hoverX !== null && allTimes.length > 0
      ? allTimes[nearestIndex(allTimes, x.invert(hoverX).getTime() / 1000)]
      : null;

  const gradientId = useMemo(() => `area-grad-${Math.random().toString(36).slice(2)}`, []);

  return (
    <div ref={ref} className="relative w-full select-none" style={{ height }}>
      {width > 0 ? (
        <svg
          width={width}
          height={height}
          role="img"
          className="overflow-visible"
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const px = e.clientX - rect.left - margin.left;
            setHoverX(px >= 0 && px <= innerW ? px : null);
          }}
          onMouseLeave={() => setHoverX(null)}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={TONE_VAR[withData[0]?.tone ?? "ink"]} stopOpacity="0.16" />
              <stop offset="100%" stopColor={TONE_VAR[withData[0]?.tone ?? "ink"]} stopOpacity="0" />
            </linearGradient>
          </defs>
          <g transform={`translate(${margin.left},${margin.top})`}>
            {/* horizontal gridlines + y labels */}
            {yTicks.map((t) => (
              <g key={`y-${t}`} transform={`translate(0,${y(t)})`}>
                <line x1={0} x2={innerW} stroke="var(--chart-grid)" strokeWidth={1} />
                <text
                  x={-8}
                  y={0}
                  dy="0.32em"
                  textAnchor="end"
                  className="fill-[var(--chart-muted)] tabular-nums"
                  style={{ fontSize: 10 }}
                >
                  {format(t)}
                </text>
              </g>
            ))}
            {/* x labels */}
            {xTicks.map((t, i) => (
              <text
                key={`x-${i}`}
                x={x(t)}
                y={innerH + 15}
                textAnchor="middle"
                className="fill-[var(--chart-muted)] tabular-nums"
                style={{ fontSize: 10 }}
              >
                {formatAxisTick(t)}
              </text>
            ))}

            {hasData ? (
              <>
                {showArea && withData[0] ? (
                  <path d={areaGen(withData[0].points) ?? ""} fill={`url(#${gradientId})`} />
                ) : null}
                {withData.map((s) => (
                  <path
                    key={s.key}
                    d={lineGen(s.points) ?? ""}
                    fill="none"
                    stroke={TONE_VAR[s.tone]}
                    strokeWidth={s.tone === "muted" ? 1.25 : 1.75}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    opacity={s.tone === "muted" ? 0.7 : 1}
                  />
                ))}

                {/* hover crosshair */}
                {hoverTime !== null ? (
                  <g>
                    <line
                      x1={x(new Date(hoverTime * 1000))}
                      x2={x(new Date(hoverTime * 1000))}
                      y1={0}
                      y2={innerH}
                      stroke="var(--chart-muted)"
                      strokeWidth={1}
                      strokeDasharray="3 3"
                      opacity={0.6}
                    />
                    {withData.map((s) => {
                      const pt = nearestPoint(s.points, hoverTime);
                      if (!pt) return null;
                      return (
                        <circle
                          key={`dot-${s.key}`}
                          cx={x(new Date(pt[0] * 1000))}
                          cy={y(pt[1])}
                          r={3}
                          fill="var(--background)"
                          stroke={TONE_VAR[s.tone]}
                          strokeWidth={1.75}
                        />
                      );
                    })}
                  </g>
                ) : null}
              </>
            ) : null}
          </g>
        </svg>
      ) : null}

      {!hasData && width > 0 ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
          {emptyLabel}
        </div>
      ) : null}

      {hoverTime !== null && hasData ? (
        <HoverCard
          time={hoverTime}
          series={withData}
          format={format}
          formatTime={formatHoverTime}
          xPx={margin.left + x(new Date(hoverTime * 1000))}
          width={width}
        />
      ) : null}
    </div>
  );
}

function nearestPoint(points: Array<[number, number]>, t: number): [number, number] | null {
  if (points.length === 0) return null;
  const idx = nearestIndex(
    points.map((p) => p[0]),
    t
  );
  return points[idx];
}

function HoverCard({
  time,
  series,
  format,
  formatTime,
  xPx,
  width,
}: {
  time: number;
  series: ChartSeries[];
  format: (n: number) => string;
  formatTime: (d: Date) => string;
  xPx: number;
  width: number;
}) {
  const flip = xPx > width * 0.6;
  return (
    <div
      className="pointer-events-none absolute top-1 z-10 min-w-[7rem] rounded-lg border border-border bg-card/95 px-2.5 py-1.5 text-[11px] shadow-lg backdrop-blur"
      style={flip ? { right: Math.max(4, width - xPx + 8) } : { left: Math.min(width - 120, xPx + 8) }}
    >
      <div className="mb-1 font-medium tabular-nums text-muted-foreground">
        {formatTime(new Date(time * 1000))}
      </div>
      <div className="space-y-0.5">
        {series.map((s) => {
          const pt = nearestPoint(s.points, time);
          return (
            <div key={s.key} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <span
                  className="inline-block h-1.5 w-3 rounded-full"
                  style={{ backgroundColor: TONE_VAR[s.tone] }}
                />
                {s.label}
              </span>
              <span className="font-semibold tabular-nums text-foreground">
                {pt ? format(pt[1]) : "—"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const HOUR = 3600;
const DAY = 24 * HOUR;

/**
 * Pick a tick label format based on the visible time span.
 * Past ~36h, d3's tick generator lands on daily midnights, so showing only
 * HH:mm makes every label read "12:00 AM"; switch to "MMM d" instead.
 */
function makeAxisTickFormatter(spanSeconds: number): (d: Date) => string {
  if (spanSeconds > 36 * HOUR) {
    const fmt = new Intl.DateTimeFormat([], { month: "short", day: "numeric" });
    return (d) => fmt.format(d);
  }
  return (d) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * For ranges wider than 24h, the hover tooltip needs the date too — otherwise
 * "12:00 AM" across multiple days is ambiguous.
 */
function makeHoverTimeFormatter(spanSeconds: number): (d: Date) => string {
  if (spanSeconds > DAY) {
    const fmt = new Intl.DateTimeFormat([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    return (d) => fmt.format(d);
  }
  return (d) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export { max as d3Max, min as d3Min };
