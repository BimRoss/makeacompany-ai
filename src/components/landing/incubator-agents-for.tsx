import { ArrowRight } from "lucide-react";

/**
 * "Whatever the job, there's a MaC Agent" — the offer, stated as a drumbeat.
 * Every role a founder would hire for, answered by the same line: a MaC Agent.
 * The repetition is the point. Copy locked with John (2026-07-02). Placed high
 * on the page for immediate impact. Brand voice: no em dashes, no inflated
 * vocab. Monochrome with the single blue accent used only as the pointer arrow.
 */
const ROLES = [
  "Need marketing expertise?",
  "Need sales firepower?",
  "Need operational support?",
  "Need research pulled?",
  "Need something built?",
  "Need the numbers run?",
] as const;

export function IncubatorAgentsFor() {
  return (
    <section id="agents-for" className="py-14 sm:py-20">
      <div className="mx-auto w-full max-w-3xl px-6 text-center">
        <h2 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">
          Whatever the job, there&apos;s a MaC Agent.
        </h2>

        <div className="mx-auto mt-10 overflow-hidden rounded-2xl border border-border bg-card">
          {ROLES.map((role) => (
            <div
              key={role}
              className="flex items-center justify-between gap-4 border-b border-border px-5 py-5 text-left last:border-b-0 sm:px-8"
            >
              <span className="text-base font-medium sm:text-lg">{role}</span>
              <span className="flex shrink-0 items-center gap-2">
                <ArrowRight
                  className="h-4 w-4 text-[#2563eb] sm:h-5 sm:w-5"
                  aria-hidden
                />
                <span className="text-base font-semibold tracking-tight sm:text-lg">
                  A MaC Agent
                </span>
              </span>
            </div>
          ))}
        </div>

        <p className="mx-auto mt-8 max-w-2xl text-pretty text-lg text-muted-foreground">
          MaC is your entire team, in Slack. Real work, done by AI agents running
          in our proprietary harness.
        </p>
      </div>
    </section>
  );
}
