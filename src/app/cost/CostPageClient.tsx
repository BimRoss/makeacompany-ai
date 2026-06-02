"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";

const COST_BREAKDOWN = [
  { label: "Base salary", value: 300_000, opacity: 1.0 },
  { label: "Benefits + healthcare", value: 51_600, opacity: 0.82 },
  { label: "Payroll taxes + insurance", value: 27_850, opacity: 0.66 },
  { label: "Equipment + office", value: 28_000, opacity: 0.52 },
  { label: "Recruiting + onboarding", value: 67_500, opacity: 0.40 },
  { label: "Bonus + L&D", value: 51_000, opacity: 0.28 },
  { label: "Ramp + tenure cost", value: 17_400, opacity: 0.18 },
];
const HIRES_TOTAL = COST_BREAKDOWN.reduce((sum, b) => sum + b.value, 0);
const MAC_TOTAL = 1_188;
const MULTIPLIER = Math.round(HIRES_TOTAL / MAC_TOTAL);

function useReveal<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    io.observe(node);
    return () => io.disconnect();
  }, []);
  return { ref, visible };
}

function AnimatedNumber({
  target,
  duration = 1400,
  prefix = "",
  suffix = "",
  format = "comma",
  active,
}: {
  target: number;
  duration?: number;
  prefix?: string;
  suffix?: string;
  format?: "comma" | "k" | "raw";
  active: boolean;
}) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const start = performance.now();
    const step = (now: number) => {
      const elapsed = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - elapsed, 3);
      setValue(target * eased);
      if (elapsed < 1) raf = requestAnimationFrame(step);
      else setValue(target);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, active]);

  let display: string;
  if (format === "k") {
    display = `$${Math.round(value / 1000)}K`;
  } else if (format === "raw") {
    display = `${Math.round(value)}`;
  } else {
    display = value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }
  return (
    <span>
      {prefix}
      {display}
      {suffix}
    </span>
  );
}

function ScarcityBar({
  label,
  fillPct,
  active,
  opacity,
  delay = 0,
}: {
  label: string;
  fillPct: number;
  active: boolean;
  opacity: number;
  delay?: number;
}) {
  return (
    <div className="w-full">
      <div className="mb-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className="h-4 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-foreground transition-[width] ease-out"
          style={{
            width: active ? `${fillPct}%` : "0%",
            opacity,
            transitionDuration: "1400ms",
            transitionDelay: `${delay}ms`,
          }}
        />
      </div>
    </div>
  );
}

const PILLARS_TOP = [
  { title: "24/7", sub: "always on" },
  { title: "Never out", sub: "no PTO, no sick days" },
  { title: "Doesn't quit", sub: "zero churn" },
  { title: "Ramps instantly", sub: "no onboarding" },
];
const PILLARS_BOTTOM = [
  { title: "Scales in minutes", sub: "no hiring pipeline" },
  { title: "Always learning", sub: "never stale" },
  { title: "Every language", sub: "every market" },
  { title: "Fully audited", sub: "every action logged" },
];

export default function CostPageClient() {
  const hero = useReveal<HTMLDivElement>();
  const math = useReveal<HTMLDivElement>();
  const multiplier = useReveal<HTMLDivElement>();
  const pillars = useReveal<HTMLDivElement>();

  return (
    <div className="relative isolate overflow-x-hidden bg-background text-foreground">
      {/* gradient backdrop */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[1100px] bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_55%,#eef2f7_100%)] dark:bg-[linear-gradient(180deg,#000000_0%,#0a0f1a_55%,#0b1220_100%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[260px] -z-10 h-[700px] w-[900px] -translate-x-1/2 rounded-full opacity-60 blur-3xl bg-[radial-gradient(closest-side,#dbeafe,transparent)] dark:bg-[radial-gradient(closest-side,rgba(59,130,246,0.25),transparent)] dark:opacity-50"
      />

      {/* HERO */}
      <section
        ref={hero.ref}
        className="mx-auto flex max-w-5xl flex-col items-center px-5 pb-8 pt-16 text-center sm:px-6 sm:pb-12 sm:pt-32 lg:pt-40"
      >
        <Image
          src="/cost-og.png"
          alt="Your next hire is a $543,000 bet. With us, it's $1,188."
          width={1080}
          height={1080}
          priority
          className={`mb-8 w-full max-w-xs rounded-2xl border border-border shadow-sm transition-all duration-700 sm:mb-14 sm:max-w-md lg:max-w-lg ${
            hero.visible ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
          }`}
        />
        <span className="mb-4 text-[10px] font-semibold uppercase tracking-[0.3em] text-muted-foreground/70 sm:mb-6 sm:text-[11px] sm:tracking-[0.35em]">
          For leaders
        </span>
        <h1
          className={`font-[var(--font-syne)] text-[2rem] font-bold leading-[1.08] tracking-tight sm:text-6xl md:text-7xl lg:tracking-tighter transition-all duration-700 ${
            hero.visible ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"
          }`}
        >
          <span className="block">Your team doesn&apos;t shrink.</span>
          <span className="mt-2 block text-blue-500">The work it ships does.</span>
        </h1>
      </section>

      {/* VALUE PROP */}
      <section className="mx-auto max-w-3xl px-5 pb-16 text-center sm:px-6 sm:pb-24">
        <p
          className={`font-[var(--font-dm-sans)] text-base font-semibold leading-relaxed text-neutral-800 sm:text-2xl transition-all duration-700 delay-150 ${
            hero.visible ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"
          }`}
        >
          What used to take 5 hires now takes the team you already have.
        </p>
        <span className="mt-8 block text-[10px] font-semibold uppercase tracking-[0.3em] text-muted-foreground/70 sm:mt-10 sm:text-[11px] sm:tracking-[0.35em]">
          For your team
        </span>
        <p
          className={`mt-3 text-base font-medium leading-relaxed text-blue-500 sm:mt-4 sm:text-2xl transition-all duration-700 delay-300 ${
            hero.visible ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"
          }`}
        >
          Nobody gets laid off.
          <br />
          The people you already have stop drowning.
        </p>
      </section>

      {/* THE MATH */}
      <section
        ref={math.ref}
        className="mx-auto max-w-6xl px-5 pb-20 sm:px-6 sm:pb-28"
      >
        <div className="mb-8 text-center sm:mb-12">
          <span className="text-[10px] font-semibold uppercase tracking-[0.3em] text-muted-foreground/70 sm:text-[11px] sm:tracking-[0.35em]">
            The math
          </span>
          <h2 className="mt-3 text-2xl font-bold leading-tight sm:text-4xl lg:text-5xl lg:tracking-tight">
            NYC. Fully loaded. No spin.
          </h2>
        </div>

        <div className="grid items-start gap-6 sm:gap-10 md:grid-cols-2 lg:gap-14">
          {/* LEFT: 2 hires */}
          <div className="rounded-2xl border border-border bg-card/70 dark:bg-card/50 p-6 shadow-sm backdrop-blur transition duration-300 sm:rounded-3xl sm:p-8 lg:p-10 hover:-translate-y-0.5 hover:shadow-md">
            <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              2 New Mid/Senior Hires
            </div>
            <div className="text-5xl font-extrabold tracking-tight text-foreground sm:text-7xl">
              <AnimatedNumber
                target={HIRES_TOTAL}
                active={math.visible}
                format="k"
              />
            </div>
            <div className="mt-2 text-sm text-muted-foreground">/ year, fully loaded</div>

            <div className="mt-6 space-y-3 sm:mt-8 sm:space-y-4">
              {COST_BREAKDOWN.map((b, i) => (
                <ScarcityBar
                  key={b.label}
                  label={b.label}
                  fillPct={(b.value / HIRES_TOTAL) * 100}
                  active={math.visible}
                  opacity={b.opacity}
                  delay={i * 90}
                />
              ))}
            </div>
            <div className="mt-6 text-xs text-muted-foreground">
              Salary · Benefits · Taxes · Office · Recruiting · Bonus · Ramp
            </div>
          </div>

          {/* RIGHT: MaC */}
          <div className="rounded-2xl border border-blue-100 bg-gradient-to-br from-white via-blue-50/40 to-white p-6 shadow-sm transition duration-300 dark:border-blue-500/20 dark:from-blue-950/30 dark:via-blue-900/20 dark:to-blue-950/30 sm:rounded-3xl sm:p-8 lg:p-10 hover:-translate-y-0.5 hover:shadow-md hover:shadow-blue-100 dark:hover:shadow-blue-900/40">
            <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-blue-500">
              makeacompany
            </div>
            <div className="text-5xl font-extrabold tracking-tight text-blue-500 sm:text-7xl">
              <AnimatedNumber
                target={MAC_TOTAL}
                active={math.visible}
                prefix="$"
                format="comma"
              />
            </div>
            <div className="mt-2 text-sm text-muted-foreground">/ year, all-in</div>
            <div className="mt-1 text-xs text-muted-foreground">
              $99/mo · no taxes · no turnover
            </div>

            <div className="mt-8 rounded-2xl border border-blue-100 bg-card/70 p-5 dark:border-blue-500/20 dark:bg-card/50 sm:mt-10 sm:p-6">
              <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Visual reality
              </div>
              <div className="mt-3 text-sm text-foreground/80">
                That blue sliver is MaC. The rest is what you&apos;d spend instead.
              </div>
              <div className="mt-4 h-2 w-full rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-blue-500 transition-[width] duration-[1400ms] ease-out"
                  style={{
                    width: math.visible
                      ? `${(MAC_TOTAL / HIRES_TOTAL) * 100}%`
                      : "0%",
                    minWidth: math.visible ? "2px" : "0",
                  }}
                />
              </div>
              <div className="mt-2 text-[11px] uppercase tracking-widest text-muted-foreground/70">
                $1,188 vs $543K — to scale.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* MULTIPLIER */}
      <section
        ref={multiplier.ref}
        className="mx-auto max-w-5xl px-5 pb-20 text-center sm:px-6 sm:pb-32"
      >
        <span className="text-[10px] font-semibold uppercase tracking-[0.3em] text-muted-foreground/70 sm:text-[11px] sm:tracking-[0.35em]">
          The leverage
        </span>
        <div className="mt-4 text-[96px] font-extrabold leading-none tracking-tighter text-foreground sm:mt-6 sm:text-[200px] lg:text-[240px]">
          <AnimatedNumber
            target={MULTIPLIER}
            active={multiplier.visible}
            suffix="×"
            format="raw"
            duration={1800}
          />
        </div>
        <p className="mt-4 text-base font-medium text-muted-foreground sm:mt-6 sm:text-2xl">
          more leverage per dollar
        </p>
      </section>

      {/* PILLARS */}
      <section
        ref={pillars.ref}
        className="mx-auto max-w-6xl px-5 pb-20 sm:px-6 sm:pb-32"
      >
        <div className="mb-8 text-center sm:mb-12">
          <span className="text-[10px] font-semibold uppercase tracking-[0.3em] text-muted-foreground/70 sm:text-[11px] sm:tracking-[0.35em]">
            What you get
          </span>
        </div>
        {[PILLARS_TOP, PILLARS_BOTTOM].map((row, rIdx) => (
          <div
            key={rIdx}
            className="mb-4 grid grid-cols-2 gap-3 sm:mb-6 sm:gap-6 md:grid-cols-4"
          >
            {row.map((p, i) => (
              <div
                key={p.title}
                className={`rounded-xl border border-border bg-card/60 dark:bg-card/40 p-4 text-center backdrop-blur transition-all duration-700 sm:rounded-2xl sm:p-6 lg:p-7 hover:-translate-y-0.5 hover:border-border/80 hover:bg-card hover:shadow-md ${
                  pillars.visible
                    ? "translate-y-0 opacity-100"
                    : "translate-y-4 opacity-0"
                }`}
                style={{ transitionDelay: `${(rIdx * 4 + i) * 80}ms` }}
              >
                <div className="text-base font-bold text-foreground sm:text-lg lg:text-xl">{p.title}</div>
                <div className="mt-1 text-xs text-muted-foreground sm:text-sm">{p.sub}</div>
              </div>
            ))}
          </div>
        ))}
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-3xl px-5 pb-20 text-center sm:px-6 sm:pb-32">
        <Link
          href="/cost.pdf"
          className="inline-flex items-center gap-2 rounded-full bg-foreground px-6 py-3 text-sm font-semibold text-background shadow-sm transition hover:-translate-y-0.5 hover:bg-foreground/85 hover:shadow-md sm:px-8 sm:py-4 sm:text-base"
        >
          Download the one-pager (PDF)
        </Link>
        <div className="mt-6">
          <Link
            href="/"
            className="text-sm font-semibold text-blue-500 underline-offset-4 hover:underline"
          >
            makeacompany.ai →
          </Link>
        </div>
      </section>
    </div>
  );
}
