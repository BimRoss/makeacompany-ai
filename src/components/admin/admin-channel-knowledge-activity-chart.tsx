"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";

import { parseDigestBodyLines, splitDigestMarkdown } from "@/lib/channel-digest-parse";

const BIN_COUNT = 14;

type Histogram = {
  counts: number[];
  tStart: number;
  tEnd: number;
  hasRealTs: boolean;
};

function buildHistogram(markdown: string): Histogram | null {
  const { bodyLines } = splitDigestMarkdown(markdown);
  const lines = parseDigestBodyLines(bodyLines);
  if (lines.length === 0) {
    return null;
  }

  const ts = lines.map((l) => (l.msgTs ? parseFloat(l.msgTs) : NaN));
  const validTs = ts.filter((x) => !Number.isNaN(x));
  let tPerLine: number[];
  let tStart: number;
  let tEnd: number;
  const hasRealTs = validTs.length >= 2;

  if (hasRealTs) {
    const tMin = Math.min(...validTs);
    const tMax = Math.max(...validTs);
    const oMin = Math.min(...lines.map((l) => l.order));
    const oMax = Math.max(...lines.map((l) => l.order));
    tPerLine = lines.map((l, i) => {
      if (!Number.isNaN(ts[i]!)) {
        return ts[i]!;
      }
      if (oMax === oMin) {
        return tMin;
      }
      return tMin + (tMax - tMin) * ((l.order - oMin) / (oMax - oMin));
    });
    tStart = Math.min(...tPerLine);
    tEnd = Math.max(...tPerLine);
  } else {
    const oMin = Math.min(...lines.map((l) => l.order));
    const oMax = Math.max(...lines.map((l) => l.order));
    tPerLine = lines.map((l) => (oMax === oMin ? 0 : (l.order - oMin) / (oMax - oMin)));
    tStart = 0;
    tEnd = 1;
  }

  const counts = new Array(BIN_COUNT).fill(0);
  const span = tEnd - tStart || 1;
  for (const t of tPerLine) {
    const u = Math.min(1, Math.max(0, (t - tStart) / span));
    const idx = Math.min(BIN_COUNT - 1, Math.floor(u * BIN_COUNT));
    counts[idx] += 1;
  }

  return { counts, tStart, tEnd, hasRealTs };
}

function formatDigestTick(ts: number): string {
  const d = new Date(ts * 1000);
  if (Number.isNaN(d.getTime())) {
    return "";
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function AdminChannelKnowledgeActivityChart({ markdown }: { markdown: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(320);

  const histogram = useMemo(() => buildHistogram(markdown), [markdown]);
  const total = useMemo(() => histogram?.counts.reduce((a, b) => a + b, 0) ?? 0, [histogram]);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) {
      return;
    }
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (typeof w === "number" && w > 0) {
        setWidth(Math.floor(w));
      }
    });
    ro.observe(el);
    setWidth(Math.floor(el.getBoundingClientRect().width) || 320);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl || !histogram || total === 0) {
      return;
    }

    const margin = { top: 6, right: 6, bottom: 20, left: 2 };
    const height = 108;
    const innerW = Math.max(120, width - margin.left - margin.right);
    const innerH = height - margin.top - margin.bottom;

    const indices = d3.range(BIN_COUNT);
    const y = d3
      .scaleBand<string>()
      .domain(indices.map(String))
      .range([0, innerH])
      .paddingInner(0.22);
    const x = d3
      .scaleLinear()
      .domain([0, Math.max(1, d3.max(histogram.counts) ?? 1)])
      .range([0, innerW]);

    const root = d3.select(svgEl);
    root.attr("viewBox", `0 0 ${width} ${height}`).attr("preserveAspectRatio", "xMinYMid meet");
    root.selectAll("*").remove();

    const g = root.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    g.selectAll("rect")
      .data(histogram.counts)
      .join("rect")
      .attr("x", 0)
      .attr("y", (_, i) => y(String(i)) ?? 0)
      .attr("height", y.bandwidth())
      .attr("width", (d) => x(d))
      .attr("rx", 2)
      .attr("fill", (d) => (d === 0 ? "var(--muted-foreground)" : "var(--foreground)"))
      .attr("fill-opacity", (d) => (d === 0 ? 0.16 : 0.38))
      .append("title")
      .text((d, i) => `${d} message${d === 1 ? "" : "s"} in this slice`);

    const foot = root.append("g").attr("transform", `translate(${margin.left},${height - 10})`);

    if (histogram.hasRealTs) {
      foot
        .append("text")
        .attr("x", 0)
        .attr("fill", "var(--muted-foreground)")
        .attr("fill-opacity", 0.9)
        .attr("font-size", 10)
        .attr("font-family", "ui-sans-serif, system-ui, sans-serif")
        .text(formatDigestTick(histogram.tStart));
      foot
        .append("text")
        .attr("x", innerW)
        .attr("text-anchor", "end")
        .attr("fill", "var(--muted-foreground)")
        .attr("fill-opacity", 0.9)
        .attr("font-size", 10)
        .attr("font-family", "ui-sans-serif, system-ui, sans-serif")
        .text(formatDigestTick(histogram.tEnd));
    } else {
      foot
        .append("text")
        .attr("x", 0)
        .attr("fill", "var(--muted-foreground)")
        .attr("fill-opacity", 0.8)
        .attr("font-size", 10)
        .attr("font-family", "ui-sans-serif, system-ui, sans-serif")
        .text("By message order (timestamps sparse)");
    }
  }, [histogram, total, width]);

  if (!histogram || total === 0) {
    return (
      <div
        className="flex min-h-[5.5rem] items-center justify-center rounded-xl border border-dashed border-border/70 bg-muted/20 px-3 py-4 text-center text-xs text-muted-foreground"
        aria-hidden
      >
        No message rows in the digest yet.
      </div>
    );
  }

  const summary = `${total} message${total === 1 ? "" : "s"} across ${BIN_COUNT} time slices`;

  return (
    <div className="space-y-2" ref={wrapRef}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Activity</p>
      <svg
        ref={svgRef}
        width="100%"
        height={108}
        className="block overflow-visible text-foreground"
        role="img"
        aria-label={summary}
      />
    </div>
  );
}
