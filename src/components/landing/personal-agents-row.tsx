"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

import {
  normalizeLanderPersonalAgents,
  type LanderPersonalAgents,
} from "@/lib/lander-personal-agents";

const POLL_INTERVAL_MS = 60_000;
// Cap the visible circles; anything beyond rolls into a "+N" pill so a busy
// row stays one tidy line on mobile.
const MAX_VISIBLE = 14;

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function PersonalAgentsRow({ initial }: { initial: LanderPersonalAgents }) {
  const [data, setData] = useState<LanderPersonalAgents>(initial);

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

  if (data.agents.length === 0) {
    // Nothing built yet — skip the section rather than render an empty row.
    return null;
  }

  const visible = data.agents.slice(0, MAX_VISIBLE);
  const overflow = data.total - visible.length;

  return (
    <section aria-label="Agents our users have built" className="pb-10 sm:pb-14">
      <div className="mx-auto max-w-3xl px-6 text-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Agents our users have built
        </p>
        <div className="mt-4 flex flex-wrap items-start justify-center gap-x-3 gap-y-4 sm:gap-x-4">
          {visible.map((agent, i) => (
            <div key={`${agent.name}-${i}`} title={agent.name} className="flex w-14 flex-col items-center gap-1.5 sm:w-16">
              <div className="relative flex h-11 w-11 items-center justify-center overflow-hidden rounded-full border border-border bg-card text-xs font-semibold text-muted-foreground shadow-sm sm:h-12 sm:w-12">
                {agent.imageUrl ? (
                  <Image src={agent.imageUrl} alt={agent.name} fill sizes="48px" className="object-cover" />
                ) : (
                  <span aria-hidden>{initialsOf(agent.name)}</span>
                )}
              </div>
              <span className="w-full truncate text-center text-[11px] leading-tight text-muted-foreground">
                {agent.name}
              </span>
            </div>
          ))}
          {overflow > 0 ? (
            <div className="flex w-14 flex-col items-center gap-1.5 sm:w-16">
              <div className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-muted text-xs font-semibold text-muted-foreground sm:h-12 sm:w-12">
                +{overflow}
              </div>
              <span className="w-full truncate text-center text-[11px] leading-tight text-muted-foreground">more</span>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
