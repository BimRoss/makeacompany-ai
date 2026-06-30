import { Check, X } from "lucide-react";

const FIT = [
  "You're building a real company or product, not experimenting.",
  "You'd rather direct the work than do every task yourself.",
  "You want leverage over headcount.",
  "You move when you see the path, you don't wait for permission.",
];

const NOT_FIT = [
  "You're looking for a cheap AI chatbot.",
  "You want a tool to play with on the weekend.",
  "You're not building anything in particular yet.",
  "You want us to hand you a finished business.",
];

/**
 * "Who we work with" — qualifies the ICP and reinforces selectivity with a
 * good-fit / not-a-fit split. Brand voice: no em dashes.
 */
export function IncubatorWho() {
  return (
    <section id="who" className="py-14 sm:py-20">
      <div className="mx-auto w-full max-w-5xl px-6">
        <div className="mb-12 text-center">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Who we work with
          </p>
          <h2 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">
            Founders and operators who&apos;d rather direct than do.
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-pretty text-lg text-muted-foreground">
            We take on a small number of people at a time. You bring the
            judgment and the direction. We bring the harness and the team that
            executes.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
            <h3 className="mb-4 text-base font-semibold tracking-tight">
              A fit
            </h3>
            <ul className="space-y-3">
              {FIT.map((line) => (
                <li key={line} className="flex gap-3 text-sm text-muted-foreground">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-foreground" aria-hidden />
                  <span className="text-pretty">{line}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
            <h3 className="mb-4 text-base font-semibold tracking-tight">
              Not a fit
            </h3>
            <ul className="space-y-3">
              {NOT_FIT.map((line) => (
                <li key={line} className="flex gap-3 text-sm text-muted-foreground">
                  <X className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden />
                  <span className="text-pretty">{line}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
