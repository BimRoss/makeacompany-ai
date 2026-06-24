"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  normalizeLanderPersonalAgents,
  type LanderPersonalAgents,
} from "@/lib/lander-personal-agents";

const POLL_INTERVAL_MS = 60_000;
// Cap the visible circles; anything beyond rolls into a "+N" pill so a busy
// row stays one tidy line on mobile.
const MAX_VISIBLE = 12;
const TYPE_MS = 42;
const ERASE_MS = 22;
// Each circle overlaps its left neighbor by this fraction of its own diameter.
const OVERLAP = 0.28;
// Circles never grow past this on wide screens; they only shrink to fit.
const MAX_DIAMETER = 96;
const MIN_DIAMETER = 40;

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Types a name into the title line above the circles, erasing whatever is
// there first. Writes straight to a DOM ref so a hover storm doesn't trigger a
// re-render per character.
function useTypingTitle() {
  const elRef = useRef<HTMLSpanElement | null>(null);
  const currentRef = useRef("");
  const cancelRef = useRef<(() => void) | null>(null);
  const [caret, setCaret] = useState(false);

  const set = useCallback((v: string) => {
    currentRef.current = v;
    if (elRef.current) elRef.current.textContent = v || " ";
  }, []);

  const typeTo = useCallback(
    (next: string) => {
      cancelRef.current?.();
      const current = currentRef.current;
      if (current === next) return;

      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      if (mq.matches) {
        set(next);
        setCaret(false);
        return;
      }

      let cancelled = false;
      const timers: ReturnType<typeof setTimeout>[] = [];
      cancelRef.current = () => {
        cancelled = true;
        timers.forEach(clearTimeout);
        setCaret(false);
      };

      let prefix = 0;
      while (
        prefix < current.length &&
        prefix < next.length &&
        current[prefix] === next[prefix]
      ) {
        prefix++;
      }

      const tick = (fn: () => void, delay: number) => {
        timers.push(
          setTimeout(() => {
            if (!cancelled) fn();
          }, delay),
        );
      };

      setCaret(true);
      let delay = 0;
      for (let i = current.length - 1; i >= prefix; i--) {
        const val = current.slice(0, i);
        tick(() => set(val), delay);
        delay += ERASE_MS;
      }
      for (let i = prefix + 1; i <= next.length; i++) {
        const val = next.slice(0, i);
        tick(() => set(val), delay);
        delay += TYPE_MS;
      }
      tick(() => setCaret(false), delay);
    },
    [set],
  );

  useEffect(() => () => cancelRef.current?.(), []);

  return { elRef, caret, typeTo };
}

export function PersonalAgentsRow({ initial }: { initial: LanderPersonalAgents }) {
  const [data, setData] = useState<LanderPersonalAgents>(initial);
  const [active, setActive] = useState<number | null>(null);
  const { elRef, caret, typeTo } = useTypingTitle();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [diameter, setDiameter] = useState(MAX_DIAMETER);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/lander/personal-agents", { cache: "no-store" });
        if (!res.ok) return;
        const body = await res.json();
        if (cancelled) return;
        setData(normalizeLanderPersonalAgents(body));
      } catch {
        // Row keeps showing the last good value on transient failures.
      }
    };
    if (initial.agents.length === 0) void load();
    const id = window.setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [initial.agents.length]);

  const visible = data.agents.slice(0, MAX_VISIBLE);
  const count = visible.length;

  // Size the circles to fill the available row width, then keep them square so
  // they stay perfect circles instead of getting squished by flexbox overflow.
  // Width = d + (n-1)*d*(1-OVERLAP)  →  solve for d, cap at MAX_DIAMETER.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || count === 0) return;
    const compute = () => {
      const span = 1 + (count - 1) * (1 - OVERLAP);
      const raw = Math.floor(el.clientWidth / span);
      setDiameter(Math.max(MIN_DIAMETER, Math.min(MAX_DIAMETER, raw)));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [count]);

  const overlapPx = Math.round(diameter * OVERLAP);

  const focus = useCallback(
    (i: number | null, name: string) => {
      setActive(i);
      typeTo(name);
    },
    [typeTo],
  );

  // Tap outside the row on mobile clears the selection.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && wrapRef.current?.contains(target)) return;
      focus(null, "");
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [focus]);

  if (data.agents.length === 0) {
    // Nothing built yet — skip the section rather than render an empty row.
    return null;
  }

  return (
    <section aria-label="Agents our users have built" className="pb-10 sm:pb-14">
      <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Agents our users have built
        </p>

        {/* Title line — types the focused agent's name, holds height when idle. */}
        <h3 className="mt-3 flex min-h-[1.75rem] items-center justify-center text-lg font-bold tracking-tight text-foreground sm:min-h-[2.25rem] sm:text-2xl">
          <span ref={elRef}>{" "}</span>
          {caret ? (
            <span className="ml-0.5 inline-block animate-pulse font-normal text-muted-foreground" aria-hidden>
              |
            </span>
          ) : null}
        </h3>

        <div
          ref={wrapRef}
          className="mt-5 flex items-center justify-center"
          onMouseLeave={() => focus(null, "")}
        >
          {visible.map((agent, i) => (
            <button
              type="button"
              key={`${agent.name}-${i}`}
              aria-label={agent.name}
              title={agent.name}
              onMouseEnter={() => focus(i, agent.name)}
              onClick={() => focus(i, agent.name)}
              style={{
                width: diameter,
                height: diameter,
                marginLeft: i === 0 ? 0 : -overlapPx,
                zIndex: active === i ? count + 1 : count - i,
                willChange: active === i ? "transform" : undefined,
              }}
              className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-background bg-card text-sm font-semibold text-muted-foreground shadow-md transition-transform duration-300 ease-out hover:-translate-y-1 hover:scale-105 ${
                active === i ? "-translate-y-1 scale-105" : ""
              }`}
            >
              {agent.imageUrl ? (
                <Image src={agent.imageUrl} alt={agent.name} fill sizes={`${diameter}px`} className="object-cover" />
              ) : (
                <span aria-hidden>{initialsOf(agent.name)}</span>
              )}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
