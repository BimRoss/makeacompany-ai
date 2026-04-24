"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";

import {
  buildKnowledgeActivityHistogram,
  type ActivityGranularity,
  type KnowledgeActivityTimeBin,
} from "@/lib/channel-knowledge-activity";

function formatTimeAxisTick(tsSec: number, granularity: ActivityGranularity): string {
  const d = new Date(tsSec * 1000);
  if (Number.isNaN(d.getTime())) {
    return "";
  }
  if (granularity === "second") {
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    });
  }
  if (granularity === "minute") {
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }
  if (granularity === "hour") {
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric" });
  }
  if (granularity === "day" || granularity === "week") {
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function granularityCaption(g: ActivityGranularity): string {
  switch (g) {
    case "second":
      return "sub-minute buckets";
    case "minute":
      return "per minute";
    case "hour":
      return "per hour";
    case "day":
      return "per day";
    case "week":
      return "per week";
    default:
      return "by message order";
  }
}

export type { KnowledgeActivityTimeBin } from "@/lib/channel-knowledge-activity";

function binKey(b: KnowledgeActivityTimeBin): string {
  return `${b.t0}\u0000${b.t1}`;
}

type AdminChannelKnowledgeActivityChartProps = {
  markdown: string;
  /** While a bar is hovered (and nothing is pinned), parent can filter the Knowledge Base to this bucket. */
  onBinHover?: (bin: KnowledgeActivityTimeBin | null) => void;
  /** When set, this bucket stays selected for the Knowledge Base until cleared (click bar again or Escape from parent). */
  pinnedBin?: KnowledgeActivityTimeBin | null;
  /** Toggle pin on the clicked bucket; pass `null` to clear. */
  onPinnedBinChange?: (bin: KnowledgeActivityTimeBin | null) => void;
};

export function AdminChannelKnowledgeActivityChart({
  markdown,
  onBinHover,
  pinnedBin = null,
  onPinnedBinChange,
}: AdminChannelKnowledgeActivityChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const hoverClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [width, setWidth] = useState(320);

  const histogram = useMemo(() => buildKnowledgeActivityHistogram(markdown), [markdown]);
  const total = useMemo(() => histogram?.bins.reduce((a, b) => a + b.count, 0) ?? 0, [histogram]);

  const interactive = Boolean(onBinHover || onPinnedBinChange);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) {
      return;
    }
    let raf = 0;
    const apply = (w: number) => {
      if (typeof w !== "number" || !Number.isFinite(w) || w <= 0) {
        return;
      }
      const next = Math.floor(w);
      setWidth((prev) => (prev === next ? prev : next));
    };
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => apply(w));
    });
    ro.observe(el);
    apply(el.getBoundingClientRect().width || 320);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  useLayoutEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl || !histogram || total === 0) {
      return;
    }

    const margin = { top: 8, right: 8, bottom: 26, left: 34 };
    const height = 120;
    const innerW = Math.max(120, width - margin.left - margin.right);
    const innerH = height - margin.top - margin.bottom;

    const maxCount = Math.max(1, d3.max(histogram.bins, (b) => b.count) ?? 1);
    const x = d3.scaleLinear().domain([histogram.tStart, histogram.tEnd]).range([0, innerW]);
    if (histogram.hasRealTs) {
      x.nice();
    }
    const y = d3
      .scaleLinear()
      .domain([0, maxCount])
      .range([innerH, 0])
      .nice();

    const root = d3.select(svgEl);
    root.attr("viewBox", `0 0 ${width} ${height}`).attr("preserveAspectRatio", "xMinYMid meet");
    root.selectAll("*").remove();

    const g = root.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    const yAxis = d3.axisLeft(y).ticks(5).tickFormat(d3.format("~s"));

    const gridClearOfBaselinePx = Math.max(5, Math.min(10, innerH * 0.07));
    const yGridTicks = y
      .ticks(6)
      .filter((v) => v > 0)
      .filter((v) => innerH - y(v) >= gridClearOfBaselinePx);
    g.append("g")
      .attr("class", "activity-chart-y-grid")
      .selectAll("line.activity-chart-y-gridline")
      .data(yGridTicks)
      .join("line")
      .attr("class", "activity-chart-y-gridline")
      .attr("x1", 0)
      .attr("x2", innerW)
      .attr("y1", (d) => y(d))
      .attr("y2", (d) => y(d))
      .attr("stroke", "var(--border)")
      .attr("stroke-opacity", 0.55)
      .attr("stroke-dasharray", "2 4");

    if (histogram.hasRealTs) {
      const xAxis = d3
        .axisBottom(x)
        .ticks(Math.min(6, histogram.bins.length))
        .tickFormat((d) => formatTimeAxisTick(Number(d), histogram.granularity));
      g.append("g")
        .attr("transform", `translate(0,${innerH})`)
        .call(xAxis)
        .call((sel) => sel.select(".domain").remove())
        .call((sel) => sel.selectAll(".tick line").attr("stroke", "var(--border)"))
        .call((sel) => sel.selectAll("text").attr("fill", "var(--muted-foreground)").attr("font-size", 9));
    } else {
      g.append("g")
        .attr("transform", `translate(0,${innerH})`)
        .call(
          d3
            .axisBottom(x)
            .tickValues([histogram.tStart, histogram.tEnd])
            .tickFormat((_, i) => (i === 0 ? "older" : "newer")),
        )
        .call((sel) => sel.select(".domain").remove())
        .call((sel) => sel.selectAll(".tick line").attr("stroke", "var(--border)"))
        .call((sel) => sel.selectAll("text").attr("fill", "var(--muted-foreground)").attr("font-size", 9));
    }

    g.append("g")
      .call(yAxis)
      .call((sel) => sel.select(".domain").attr("stroke", "var(--border)"))
      .call((sel) => sel.selectAll(".tick line").attr("stroke", "var(--border)"))
      .call((sel) => sel.selectAll("text").attr("fill", "var(--muted-foreground)").attr("font-size", 9));

    g.append("line")
      .attr("class", "activity-chart-x-baseline")
      .attr("x1", 0)
      .attr("x2", innerW)
      .attr("y1", innerH)
      .attr("y2", innerH)
      .attr("stroke", "var(--border)")
      .attr("stroke-opacity", 0.85)
      .attr("stroke-width", 1.5)
      .attr("stroke-dasharray", "none");

    const gap = Math.min(4, innerW / Math.max(histogram.bins.length * 2, 1));

    const cancelHoverClearTimer = () => {
      if (hoverClearTimerRef.current) {
        clearTimeout(hoverClearTimerRef.current);
        hoverClearTimerRef.current = null;
      }
    };

    const pinK = pinnedBin ? binKey(pinnedBin) : null;

    const barTooltip = (b: KnowledgeActivityTimeBin) => {
      const pinHint = onPinnedBinChange
        ? "\nClick to pin this range for the Knowledge Base (× on the bar, click the bar again, or Escape to clear)."
        : "";
      if (!histogram.hasRealTs) {
        return `${b.count} message${b.count === 1 ? "" : "s"} in this slice${pinHint}`;
      }
      const a = formatTimeAxisTick(b.t0, histogram.granularity);
      const z = formatTimeAxisTick(Math.min(b.t1, histogram.tEnd), histogram.granularity);
      return `${b.count} message${b.count === 1 ? "" : "s"} — ${a} → ${z}${pinHint}`;
    };

    const bars = g
      .selectAll("rect.bar")
      .data(histogram.bins)
      .join("rect")
      .attr("class", "bar")
      .attr("pointer-events", interactive ? "none" : "auto")
      .attr("x", (b) => {
        const x0 = x(b.t0);
        return x0 + gap / 2;
      })
      .attr("width", (b) => {
        const x0 = x(b.t0);
        const x1 = x(Math.min(b.t1, histogram.tEnd));
        return Math.max(1, x1 - x0 - gap);
      })
      .attr("y", (b) => (b.count === 0 ? innerH - 1 : y(b.count)))
      .attr("height", (b) => (b.count === 0 ? 1 : innerH - y(b.count)))
      .attr("rx", 2)
      .attr("fill", (b) => (b.count === 0 ? "var(--muted-foreground)" : "var(--foreground)"))
      .attr("fill-opacity", (b) => (b.count === 0 ? 0.08 : 0.28));

    const updateBarOpacity = (hovered: KnowledgeActivityTimeBin | null) => {
      const hovK = hovered ? binKey(hovered) : null;
      bars.attr("fill-opacity", (b) => {
        const k = binKey(b);
        if (pinK) {
          if (k === pinK) {
            return b.count === 0 ? 0.18 : 0.56;
          }
          if (hovK && k === hovK) {
            return b.count === 0 ? 0.12 : 0.34;
          }
          return b.count === 0 ? 0.06 : 0.14;
        }
        if (hovK && k === hovK) {
          return b.count === 0 ? 0.15 : 0.5;
        }
        return b.count === 0 ? 0.08 : 0.28;
      });
    };

    const scheduleHoverClear = () => {
      if (pinK) {
        cancelHoverClearTimer();
        updateBarOpacity(null);
        return;
      }
      if (!onBinHover) {
        return;
      }
      cancelHoverClearTimer();
      hoverClearTimerRef.current = setTimeout(() => {
        hoverClearTimerRef.current = null;
        updateBarOpacity(null);
        onBinHover(null);
      }, 45);
    };

    updateBarOpacity(null);

    if (interactive) {
      const hitLayer = g.insert("g", "rect.bar").attr("class", "activity-hit-layer");
      hitLayer
        .selectAll("rect.hit")
        .data(histogram.bins)
        .join("rect")
        .attr("class", "hit")
        .attr("x", (b) => x(b.t0))
        .attr("width", (b) => Math.max(1, x(Math.min(b.t1, histogram.tEnd)) - x(b.t0)))
        .attr("y", 0)
        .attr("height", innerH)
        .attr("fill", "transparent")
        .style("cursor", onPinnedBinChange ? "pointer" : "default")
        .on("pointerenter", (_ev, d) => {
          cancelHoverClearTimer();
          if (!pinK) {
            onBinHover?.(d);
          }
          updateBarOpacity(d);
        })
        .on("pointerleave", scheduleHoverClear)
        .on("click", (ev, d) => {
          if (!onPinnedBinChange) {
            return;
          }
          ev.preventDefault();
          const dk = binKey(d);
          if (pinK && pinK === dk) {
            onPinnedBinChange(null);
            onBinHover?.(null);
            cancelHoverClearTimer();
            updateBarOpacity(null);
            return;
          }
          onPinnedBinChange(d);
        })
        .append("title")
        .text((b) => barTooltip(b));
    }

    bars.select("title").remove();
    if (!interactive) {
      bars.append("title").text((b) => barTooltip(b));
    }

    if (pinK && onPinnedBinChange) {
      const pb = histogram.bins.find((b) => binKey(b) === pinK);
      if (pb) {
        const bx0 = x(pb.t0);
        const bx1 = x(Math.min(pb.t1, histogram.tEnd));
        const barX = bx0 + gap / 2;
        const barW = Math.max(1, bx1 - bx0 - gap);
        const barTop = pb.count === 0 ? innerH - 1 : y(pb.count);
        const cx = barX + barW / 2;
        const cy = Math.max(8, barTop - 10);

        const dismiss = g
          .append("g")
          .attr("class", "activity-pinned-dismiss")
          .attr("transform", `translate(${cx},${cy})`)
          .style("cursor", "pointer")
          .attr("role", "button")
          .attr("tabindex", "0")
          .attr("aria-label", "Clear pinned time range")
          .on("click", (ev) => {
            ev.stopPropagation();
            ev.preventDefault();
            onPinnedBinChange(null);
            onBinHover?.(null);
            cancelHoverClearTimer();
            updateBarOpacity(null);
          })
          .on("keydown", (ev) => {
            if (ev.key === "Enter" || ev.key === " ") {
              ev.preventDefault();
              ev.stopPropagation();
              onPinnedBinChange(null);
              onBinHover?.(null);
              cancelHoverClearTimer();
              updateBarOpacity(null);
            }
          });

        dismiss
          .append("circle")
          .attr("r", 12)
          .attr("fill", "transparent")
          .attr("pointer-events", "all");
        dismiss
          .append("circle")
          .attr("r", 9)
          .attr("fill", "var(--background)")
          .attr("stroke", "var(--border)")
          .attr("stroke-width", 1)
          .attr("pointer-events", "none");
        const xr = 3.25;
        dismiss
          .append("path")
          .attr(
            "d",
            `M ${-xr},${-xr} L ${xr},${xr} M ${xr},${-xr} L ${-xr},${xr}`,
          )
          .attr("stroke", "var(--foreground)")
          .attr("stroke-opacity", 0.72)
          .attr("stroke-width", 1.65)
          .attr("stroke-linecap", "round")
          .attr("pointer-events", "none");
        dismiss.append("title").text("Clear pinned time range");
      }
    }

    if (!histogram.hasRealTs) {
      g.append("text")
        .attr("x", innerW / 2)
        .attr("y", -2)
        .attr("text-anchor", "middle")
        .attr("fill", "var(--muted-foreground)")
        .attr("fill-opacity", 0.85)
        .attr("font-size", 10)
        .attr("font-family", "ui-sans-serif, system-ui, sans-serif")
        .text("Timestamps sparse — spread by message order");
    }

    return () => {
      cancelHoverClearTimer();
      if (interactive) {
        updateBarOpacity(null);
      }
    };
  }, [histogram, total, width, onBinHover, pinnedBin, onPinnedBinChange, interactive]);

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

  const binLabel = histogram.hasRealTs ? `${histogram.bins.length} time buckets (${granularityCaption(histogram.granularity)})` : "synthetic timeline";
  const summary = `${total} message${total === 1 ? "" : "s"}, ${binLabel}`;

  return (
    <div className="min-w-0 space-y-2 overflow-hidden" ref={wrapRef}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Activity</p>
      <svg
        ref={svgRef}
        width="100%"
        height={120}
        className="block overflow-visible text-foreground"
        role="img"
        aria-label={summary}
      />
    </div>
  );
}
