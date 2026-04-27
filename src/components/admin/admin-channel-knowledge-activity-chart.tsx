"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";

import {
  buildKnowledgeActivityHistogram,
  type ActivityGranularity,
  type KnowledgeActivityTimeBin,
} from "@/lib/channel-knowledge-activity";

const PLOT_HEIGHT_MOBILE_PX = 128;
const PLOT_HEIGHT_MD_MIN = 128;
const PLOT_HEIGHT_MD_MAX = 420;

function formatTimeAxisTick(tsSec: number, granularity: ActivityGranularity, innerW: number): string {
  const d = new Date(tsSec * 1000);
  if (Number.isNaN(d.getTime())) {
    return "";
  }
  const compact = innerW < 440;
  if (granularity === "second") {
    if (compact) {
      return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" });
    }
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    });
  }
  if (granularity === "minute") {
    if (compact) {
      return d.toLocaleString(undefined, { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });
    }
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }
  if (granularity === "hour") {
    if (compact) {
      return d.toLocaleString(undefined, { month: "numeric", day: "numeric", hour: "numeric" });
    }
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
  onBinHover?: (bin: KnowledgeActivityTimeBin | null) => void;
  pinnedBin?: KnowledgeActivityTimeBin | null;
  onPinnedBinChange?: (bin: KnowledgeActivityTimeBin | null) => void;
};

export function AdminChannelKnowledgeActivityChart({
  markdown,
  onBinHover,
  pinnedBin = null,
  onPinnedBinChange,
}: AdminChannelKnowledgeActivityChartProps) {
  const plotWrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const hoverClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [plotSize, setPlotSize] = useState({ width: 320, height: PLOT_HEIGHT_MOBILE_PX });

  const histogram = useMemo(() => buildKnowledgeActivityHistogram(markdown), [markdown]);
  const total = useMemo(() => histogram?.bins.reduce((a, b) => a + b.count, 0) ?? 0, [histogram]);

  const interactive = Boolean(onBinHover || onPinnedBinChange);

  useLayoutEffect(() => {
    const el = plotWrapRef.current;
    if (!el) {
      return;
    }
    const mdMq = window.matchMedia("(min-width: 768px)");
    let raf = 0;
    const applyFromRect = () => {
      const r = el.getBoundingClientRect();
      const w = r.width;
      const h = r.height;
      const desktop = mdMq.matches;
      const nextW = typeof w === "number" && Number.isFinite(w) && w > 0 ? Math.floor(w) : 320;
      let nextH = PLOT_HEIGHT_MOBILE_PX;
      if (desktop) {
        nextH =
          typeof h === "number" && Number.isFinite(h) && h > 0
            ? Math.min(PLOT_HEIGHT_MD_MAX, Math.max(PLOT_HEIGHT_MD_MIN, Math.floor(h)))
            : PLOT_HEIGHT_MD_MIN;
      }
      setPlotSize((prev) =>
        prev.width === nextW && prev.height === nextH ? prev : { width: nextW, height: nextH },
      );
    };
    const scheduleApply = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => applyFromRect());
    };
    const ro = new ResizeObserver(() => {
      scheduleApply();
    });
    ro.observe(el);
    const onMq = () => scheduleApply();
    mdMq.addEventListener("change", onMq);
    scheduleApply();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mdMq.removeEventListener("change", onMq);
    };
  }, []);

  useLayoutEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl || !histogram || total === 0) {
      return;
    }

    const { width, height } = plotSize;

    const isWideChart = width >= 768;
    // Keep room for x tick text + tick line; tighter than d3 defaults need so the card does not look padded under the axis.
    const bottomAxis = isWideChart ? (height >= 200 ? 26 : 22) : height >= 160 ? 22 : 18;
    const margin = { top: height >= 200 ? 10 : 8, right: 4, bottom: bottomAxis, left: 18 };
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
    root.attr("viewBox", `0 0 ${width} ${height}`).attr("preserveAspectRatio", "none");
    root.selectAll("*").remove();

    const g = root.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    const yAxis = d3.axisLeft(y).ticks(5).tickSize(4).tickPadding(2).tickFormat(d3.format("~s"));

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
      const [d0, d1] = x.domain();
      let tickValues: number[];
      if (Math.abs(d1 - d0) < 1e-9) {
        tickValues = [d0];
      } else if (isWideChart) {
        const approxCount = Math.min(8, Math.max(4, Math.floor(innerW / 76)));
        tickValues = d3.ticks(d0, d1, approxCount);
        if (tickValues.length === 0) {
          tickValues = [d0, d1];
        }
      } else {
        tickValues = [d0, d1];
      }
      const xAxis = d3
        .axisBottom(x)
        .tickValues(tickValues)
        .tickFormat((d) => formatTimeAxisTick(Number(d), histogram.granularity, innerW))
        .tickSize(3)
        .tickSizeOuter(0);
      const xAxisG = g.append("g").attr("transform", `translate(0,${innerH})`).call(xAxis);
      xAxisG.call((sel) => sel.select(".domain").remove());
      xAxisG.call((sel) => sel.selectAll(".tick line").attr("stroke", "var(--border)"));
      xAxisG.call((sel) => {
        const texts = sel.selectAll<SVGTextElement, number>(".tick text");
        const fs = isWideChart ? 8 : 9;
        texts.attr("fill", "var(--muted-foreground)").attr("font-size", fs).attr("dy", "0.71em").attr("transform", null);
        const n = tickValues.length;
        texts.each(function (_, i) {
          const t = d3.select(this);
          if (n <= 1) {
            t.attr("text-anchor", "middle").attr("dx", "0");
          } else if (i === 0) {
            t.attr("text-anchor", "start").attr("dx", "0");
          } else if (i === n - 1) {
            t.attr("text-anchor", "end").attr("dx", "0");
          } else {
            t.attr("text-anchor", "middle").attr("dx", "0");
          }
        });
      });
    } else {
      g.append("g")
        .attr("transform", `translate(0,${innerH})`)
        .call(
          d3
            .axisBottom(x)
            .tickValues([histogram.tStart, histogram.tEnd])
            .tickFormat((_, i) => (i === 0 ? "older" : "newer"))
            .tickSize(3)
            .tickSizeOuter(0),
        )
        .call((sel) => sel.select(".domain").remove())
        .call((sel) => sel.selectAll(".tick line").attr("stroke", "var(--border)"))
        .call((sel) => sel.selectAll("text").attr("fill", "var(--muted-foreground)").attr("font-size", 9));
    }

    g.append("g")
      .call(yAxis)
      .call((sel) => sel.select(".domain").attr("stroke", "var(--border)"))
      .call((sel) => sel.selectAll(".tick line").attr("stroke", "var(--border)"))
      .call((sel) =>
        sel.selectAll("text").attr("fill", "var(--muted-foreground)").attr("font-size", 8).attr("font-weight", "500"),
      );

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
        });
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
  }, [histogram, total, plotSize, onBinHover, pinnedBin, onPinnedBinChange, interactive]);

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
    <div className="flex min-h-0 min-w-0 flex-col space-y-2 overflow-x-clip overflow-y-visible max-md:shrink-0 md:flex-1">
      <p className="w-full shrink-0 text-center text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground md:text-left">
        Activity
      </p>
      <div
        ref={plotWrapRef}
        className="h-32 w-full min-w-0 shrink-0 md:h-auto md:min-h-32 md:flex-1"
      >
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          className="block h-full w-full overflow-visible text-foreground"
          role="img"
          aria-label={summary}
        />
      </div>
    </div>
  );
}
