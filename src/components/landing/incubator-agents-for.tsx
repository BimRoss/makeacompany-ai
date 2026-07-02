"use client";

import { useState } from "react";
import {
  BarChart3,
  ChevronDown,
  Hammer,
  Megaphone,
  Search,
  Settings,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";

/**
 * "Whatever the job, there's a MaC Agent." The offer as a drumbeat: every role
 * a founder would hire for, answered by the same line. Each row is clickable
 * and expands to reveal what that agent actually does, with a role icon for a
 * visual (brand default-to-closed disclosure, same as the FAQ). Copy locked
 * with John (2026-07-02). Monochrome with the single blue accent on the
 * chevron. Placed high on the page for immediate impact.
 */
type Role = {
  question: string;
  icon: LucideIcon;
  detail: string;
};

const ROLES: Role[] = [
  {
    question: "Need marketing expertise?",
    icon: Megaphone,
    detail:
      "Writes the launch posts, the landing copy, the email sequences. Watches what lands and adjusts. Brandlete's whole marketing site was built this way.",
  },
  {
    question: "Need sales firepower?",
    icon: TrendingUp,
    detail:
      "Drafts the outreach, tracks the pipeline, and preps you before every call. Books demos and follows up while you're focused elsewhere.",
  },
  {
    question: "Need operational support?",
    icon: Settings,
    detail:
      "Runs the standing work on a schedule: inbox triage, health checks, weekly digests. The stuff that eats your Monday, done before you wake up.",
  },
  {
    question: "Need research pulled?",
    icon: Search,
    detail:
      "Pulls the sources, reads them, and hands you a cited answer. Competitive scans, market sizing, a quick read on the founder you're about to meet.",
  },
  {
    question: "Need something built?",
    icon: Hammer,
    detail:
      "Ships real code: websites, tools, fixes, the whole deploy. Tag a release and it watches the rollout itself until it's live.",
  },
  {
    question: "Need the numbers run?",
    icon: BarChart3,
    detail:
      "Pulls your metrics, builds the chart, and tells you what moved. Traffic, revenue, burn, break-even, on demand.",
  },
];

export function IncubatorAgentsFor() {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <section id="agents-for" className="py-10 sm:py-14">
      <div className="mx-auto w-full max-w-3xl px-6 text-center">
        <h2 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">
          Whatever the job, there&apos;s a MaC Agent.
        </h2>
        <p className="mx-auto mt-3 text-sm text-muted-foreground">
          Tap any job to see what that agent does.
        </p>

        <div className="mx-auto mt-8 overflow-hidden rounded-2xl border border-border bg-card">
          {ROLES.map((role, i) => {
            const isOpen = open === i;
            const Icon = role.icon;
            return (
              <div
                key={role.question}
                className="border-b border-border last:border-b-0"
              >
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="flex w-full items-center justify-between gap-4 px-5 py-5 text-left transition-colors hover:bg-foreground/[0.03] sm:px-8"
                >
                  <span className="flex items-center gap-3">
                    <Icon
                      className="h-5 w-5 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                    <span className="text-base font-medium sm:text-lg">
                      {role.question}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="hidden text-base font-semibold tracking-tight sm:inline">
                      A MaC Agent
                    </span>
                    <ChevronDown
                      className={`h-5 w-5 text-[#2563eb] transition-transform duration-200 ${
                        isOpen ? "rotate-180" : ""
                      }`}
                      aria-hidden
                    />
                  </span>
                </button>
                <div
                  className={`grid transition-all duration-200 ease-out ${
                    isOpen
                      ? "grid-rows-[1fr] opacity-100"
                      : "grid-rows-[0fr] opacity-0"
                  }`}
                >
                  <div className="overflow-hidden">
                    <p className="px-5 pb-5 text-left text-sm text-muted-foreground sm:px-8 sm:pl-16">
                      {role.detail}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <p className="mx-auto mt-8 max-w-2xl text-pretty text-lg text-muted-foreground">
          MaC is your entire team, in Slack. Real work, done by AI agents running
          in our proprietary harness.
        </p>
      </div>
    </section>
  );
}
