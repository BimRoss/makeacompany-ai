"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const ANIMATION_MS = 1600;

type Stat = {
  label: string;
  value: number;
  prefix?: string;
  suffix?: string;
  formatter?: (n: number) => string;
};

const STATS: Stat[] = [
  {
    label: "2 mid/senior NYC hires",
    value: 543000,
    prefix: "$",
    formatter: (n) => `${Math.round(n / 1000)}K`,
  },
  {
    label: "makeacompany / year",
    value: 1188,
    prefix: "$",
    formatter: (n) => Math.round(n).toLocaleString(),
  },
  {
    label: "more leverage per dollar",
    value: 457,
    suffix: "×",
    formatter: (n) => Math.round(n).toLocaleString(),
  },
];

function useCountUp(target: number) {
  const [n, setN] = useState(0);
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setN(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ANIMATION_MS);
      const eased = 1 - Math.pow(1 - t, 3);
      setN(target * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return n;
}

function StatCell({ stat }: { stat: Stat }) {
  const n = useCountUp(stat.value);
  const formatted = stat.formatter ? stat.formatter(n) : Math.round(n).toLocaleString();
  return (
    <div className="flex flex-col items-center text-center">
      <span className="text-3xl font-semibold tabular-nums tracking-tight text-foreground sm:text-4xl md:text-5xl">
        {stat.prefix}
        {formatted}
        {stat.suffix}
      </span>
      <span className="mt-1 text-xs uppercase tracking-wide text-foreground/60 sm:text-sm">
        {stat.label}
      </span>
    </div>
  );
}

export function CostStatStrip() {
  return (
    <section className="border-y border-foreground/10 bg-background/60 py-10 sm:py-14">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-4">
        <p className="text-center text-xs uppercase tracking-[0.2em] text-foreground/50">
          Your team doesn&rsquo;t shrink. Your output multiplies.
        </p>
        <div className="grid w-full grid-cols-1 items-end gap-8 sm:grid-cols-3 sm:gap-4">
          {STATS.map((s) => (
            <StatCell key={s.label} stat={s} />
          ))}
        </div>
        <Link
          href="/cost"
          className="text-sm font-medium text-foreground/70 underline-offset-4 hover:text-foreground hover:underline"
        >
          See the full breakdown &rarr;
        </Link>
      </div>
    </section>
  );
}
