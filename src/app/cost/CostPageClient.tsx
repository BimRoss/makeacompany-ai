"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";

const COST_BREAKDOWN = [
  { label: "Base salary", value: 300_000, color: "#0a0a0a" },
  { label: "Benefits + healthcare", value: 51_600, color: "#1f2937" },
  { label: "Payroll taxes + insurance", value: 27_850, color: "#374151" },
  { label: "Equipment + office", value: 28_000, color: "#4b5563" },
  { label: "Recruiting + onboarding", value: 67_500, color: "#6b7280" },
  { label: "Bonus + L&D", value: 51_000, color: "#9ca3af" },
  { label: "Ramp + tenure cost", value: 17_400, color: "#d1d5db" },
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
  color,
  delay = 0,
}: {
  label: string;
  fillPct: number;
  active: boolean;
  color: string;
  delay?: number;
}) {
  return (
    <div className="w-full">
      <div className="mb-2 text-xs font-medium uppercase tracking-widest text-neutral-500">
        {label}
      </div>
      <div className="h-4 w-full overflow-hidden rounded-full bg-neutral-200/60">
        <div
          className="h-full rounded-full transition-[width] ease-out"
          style={{
            width: active ? `${fillPct}%` : "0%",
            background: color,
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
  { title: "No PTO", sub: "no sick days" },
  { title: "No churn", sub: "doesn't quit" },
  { title: "Instant ramp", sub: "zero onboarding" },
];
const PILLARS_BOTTOM = [
  { title: "Scales in minutes", sub: "no hiring pipeline" },
  { title: "Always learning", sub: "never stale" },
  { title: "Multilingual", sub: "every market" },
  { title: "Audit-trailed", sub: "every action logged" },
];

export default function CostPageClient() {
  const hero = useReveal<HTMLDivElement>();
  const math = useReveal<HTMLDivElement>();
  const multiplier = useReveal<HTMLDivElement>();
  const pillars = useReveal<HTMLDivElement>();

  return (
    <main className="relative isolate overflow-x-hidden bg-white text-neutral-900">
      {/* gradient backdrop */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[1100px]"
        style={{
          background:
            "linear-gradient(180deg, #ffffff 0%, #f8fafc 55%, #eef2f7 100%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[260px] -z-10 h-[700px] w-[900px] -translate-x-1/2 rounded-full opacity-60 blur-3xl"
        style={{ background: "radial-gradient(closest-side, #dbeafe, transparent)" }}
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
          className={`mb-8 w-full max-w-xs rounded-2xl border border-neutral-200 shadow-sm transition-all duration-700 sm:mb-14 sm:max-w-md lg:max-w-lg ${
            hero.visible ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
          }`}
        />
        <span className="mb-4 text-[10px] font-semibold uppercase tracking-[0.3em] text-neutral-400 sm:mb-6 sm:text-[11px] sm:tracking-[0.35em]">
          For leaders
        </span>
        <h1
          className={`font-[var(--font-syne)] text-[2rem] font-bold leading-[1.08] tracking-tight sm:text-6xl md:text-7xl lg:tracking-tighter transition-all duration-700 ${
            hero.visible ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"
          }`}
        >
          <span className="block">Your team doesn&apos;t shrink.</span>
          <span className="mt-2 block text-blue-500">Your output multiplies.</span>
        </h1>
      </section>

      {/* VALUE PROP */}
      <section className="mx-auto max-w-3xl px-5 pb-16 text-center sm:px-6 sm:pb-24">
        <p
          className={`font-[var(--font-dm-sans)] text-base font-semibold leading-relaxed text-neutral-800 sm:text-2xl transition-all duration-700 delay-150 ${
            hero.visible ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"
          }`}
        >
          Your best employees become 10× more effective.
          <br />
          Your team ships what used to need 5 hires.
        </p>
        <span className="mt-8 block text-[10px] font-semibold uppercase tracking-[0.3em] text-neutral-400 sm:mt-10 sm:text-[11px] sm:tracking-[0.35em]">
          For your team
        </span>
        <p
          className={`mt-3 text-base font-medium leading-relaxed text-blue-500 sm:mt-4 sm:text-2xl transition-all duration-700 delay-300 ${
            hero.visible ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"
          }`}
        >
          Nobody gets laid off.
          <br />
          The humans you already have just stop drowning.
        </p>
      </section>

      {/* THE MATH */}
      <section
        ref={math.ref}
        className="mx-auto max-w-6xl px-5 pb-20 sm:px-6 sm:pb-28"
      >
        <div className="mb-8 text-center sm:mb-12">
          <span className="text-[10px] font-semibold uppercase tracking-[0.3em] text-neutral-400 sm:text-[11px] sm:tracking-[0.35em]">
            The math
          </span>
          <h2 className="mt-3 text-2xl font-bold leading-tight sm:text-4xl lg:text-5xl lg:tracking-tight">
            New York City. Fully loaded. Honest numbers.
          </h2>
        </div>

        <div className="grid items-start gap-6 sm:gap-10 md:grid-cols-2 lg:gap-14">
          {/* LEFT: 2 hires */}
          <div className="rounded-2xl border border-neutral-200/70 bg-white/70 p-6 shadow-sm backdrop-blur transition duration-300 sm:rounded-3xl sm:p-8 lg:p-10 hover:-translate-y-0.5 hover:shadow-md">
            <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-neutral-500">
              2 New Mid/Senior Hires
            </div>
            <div className="text-5xl font-extrabold tracking-tight text-neutral-900 sm:text-7xl">
              <AnimatedNumber
                target={HIRES_TOTAL}
                active={math.visible}
                format="k"
              />
            </div>
            <div className="mt-2 text-sm text-neutral-600">/ year, fully loaded</div>

            <div className="mt-6 space-y-3 sm:mt-8 sm:space-y-4">
              {COST_BREAKDOWN.map((b, i) => (
                <ScarcityBar
                  key={b.label}
                  label={b.label}
                  fillPct={(b.value / HIRES_TOTAL) * 100}
                  active={math.visible}
                  color={b.color}
                  delay={i * 90}
                />
              ))}
            </div>
            <div className="mt-6 text-xs text-neutral-500">
              Salary · Benefits · Taxes · Office · Recruiting · Bonus · Ramp
            </div>
          </div>

          {/* RIGHT: MaC */}
          <div className="rounded-2xl border border-blue-100 bg-gradient-to-br from-white via-blue-50/40 to-white p-6 shadow-sm transition duration-300 sm:rounded-3xl sm:p-8 lg:p-10 hover:-translate-y-0.5 hover:shadow-md hover:shadow-blue-100">
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
            <div className="mt-2 text-sm text-neutral-600">/ year, all-in</div>
            <div className="mt-1 text-xs text-neutral-500">
              $99/mo · no taxes · no turnover
            </div>

            <div className="mt-8 rounded-2xl border border-blue-100 bg-white/70 p-5 sm:mt-10 sm:p-6">
              <div className="text-xs font-semibold uppercase tracking-widest text-neutral-500">
                Visual reality
              </div>
              <div className="mt-3 text-sm text-neutral-700">
                $1,188 next to $543K — to scale.
              </div>
              <div className="mt-4 h-2 w-full rounded-full bg-neutral-200">
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
              <div className="mt-2 text-[11px] uppercase tracking-widest text-neutral-400">
                That blue sliver is MaC.
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
        <span className="text-[10px] font-semibold uppercase tracking-[0.3em] text-neutral-400 sm:text-[11px] sm:tracking-[0.35em]">
          Up to
        </span>
        <div className="mt-4 text-[96px] font-extrabold leading-none tracking-tighter text-neutral-900 sm:mt-6 sm:text-[200px] lg:text-[240px]">
          <AnimatedNumber
            target={MULTIPLIER}
            active={multiplier.visible}
            suffix="×"
            format="raw"
            duration={1800}
          />
        </div>
        <p className="mt-4 text-base font-medium text-neutral-600 sm:mt-6 sm:text-2xl">
          more leverage per dollar
        </p>
      </section>

      {/* PILLARS */}
      <section
        ref={pillars.ref}
        className="mx-auto max-w-6xl px-5 pb-20 sm:px-6 sm:pb-32"
      >
        <div className="mb-8 text-center sm:mb-12">
          <span className="text-[10px] font-semibold uppercase tracking-[0.3em] text-neutral-400 sm:text-[11px] sm:tracking-[0.35em]">
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
                className={`rounded-xl border border-neutral-200 bg-white/60 p-4 text-center backdrop-blur transition-all duration-700 sm:rounded-2xl sm:p-6 lg:p-7 hover:-translate-y-0.5 hover:border-neutral-300 hover:bg-white hover:shadow-md ${
                  pillars.visible
                    ? "translate-y-0 opacity-100"
                    : "translate-y-4 opacity-0"
                }`}
                style={{ transitionDelay: `${(rIdx * 4 + i) * 80}ms` }}
              >
                <div className="text-base font-bold text-neutral-900 sm:text-lg lg:text-xl">{p.title}</div>
                <div className="mt-1 text-xs text-neutral-500 sm:text-sm">{p.sub}</div>
              </div>
            ))}
          </div>
        ))}
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-3xl px-5 pb-20 text-center sm:px-6 sm:pb-32">
        <Link
          href="/cost.pdf"
          className="inline-flex items-center gap-2 rounded-full bg-neutral-900 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-neutral-800 hover:shadow-md sm:px-8 sm:py-4 sm:text-base"
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
    </main>
  );
}
