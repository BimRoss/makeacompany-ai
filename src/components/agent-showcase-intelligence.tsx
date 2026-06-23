"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { PublicAgentKnowledge } from "@/lib/public-agent";

/**
 * Collapsible "What it knows" cards for the public showcase page (/a/[id]).
 * Mirrors the /me YouTube-ingest card look (chevron + grid-rows collapse,
 * numbered bullets). Cards start open here: the whole point of the showcase is
 * to show the harvested intelligence, so default-expanded, collapse on click.
 */
export function AgentShowcaseIntelligence({
  blocks,
}: {
  blocks: PublicAgentKnowledge[];
}) {
  const [closed, setClosed] = useState<Set<number>>(new Set());

  const toggle = (i: number) =>
    setClosed((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <section className="flex flex-col gap-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        What it knows
      </h2>
      <ul className="flex flex-col gap-2.5">
        {blocks.map((block, i) => {
          const bullets = block.bullets ?? [];
          const isOpen = !closed.has(i);
          const insightLabel = `${bullets.length} ${bullets.length === 1 ? "insight" : "insights"}`;
          return (
            <li
              key={i}
              className="overflow-hidden rounded-xl border border-border bg-card"
            >
              <button
                type="button"
                onClick={() => toggle(i)}
                aria-expanded={isOpen}
                aria-label={isOpen ? "Hide insights" : "Show insights"}
                className="flex w-full items-center gap-3 px-5 py-4 text-left"
              >
                <ChevronDown
                  className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150 ${isOpen ? "rotate-0" : "-rotate-90"}`}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-foreground">
                    {block.title || "What it learned"}
                  </span>
                  {bullets.length > 0 ? (
                    <span className="text-[11px] text-muted-foreground">{insightLabel}</span>
                  ) : null}
                </span>
              </button>
              {bullets.length > 0 ? (
                <div
                  className={`grid transition-[grid-template-rows] duration-300 ease-out ${
                    isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                  }`}
                >
                  <ol
                    className={`space-y-2 overflow-hidden border-t border-border/60 bg-muted/20 px-5 pl-12 transition-[padding] duration-300 ease-out ${
                      isOpen ? "py-4" : "py-0"
                    }`}
                  >
                    {bullets.map((bullet, j) => (
                      <li
                        key={j}
                        className="flex gap-2.5 text-sm leading-relaxed text-foreground/90"
                      >
                        <span
                          className="mt-[2px] inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold tabular-nums text-muted-foreground"
                          aria-hidden
                        >
                          {j + 1}
                        </span>
                        <span className="min-w-0 flex-1">{bullet}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
