import { Brain, Lock, RefreshCw, TrendingUp } from "lucide-react";

const POINTS: { icon: typeof Brain; title: string; body: string }[] = [
  {
    icon: Brain,
    title: "What the harness is",
    body: "The memory, the tools, the guardrails, and the routines that run on their own. The system around the engine that turns rented intelligence into real work and keeps it working. None of it comes from the model. All of it is engineering we own.",
  },
  {
    icon: Lock,
    title: "Why it's a moat",
    body: "A competitor can switch to our exact model tomorrow morning and still not have what we have: the accumulated decisions about how it behaves, what it remembers, who it knows, and what it's allowed to touch. You can't buy that. You build it by running the system with real customers doing real work.",
  },
  {
    icon: TrendingUp,
    title: "It compounds while you sleep",
    body: "Every day MaC runs, the harness gets deeper. More memory, more tools wired in, more workflows hardened, more edge cases that bit us once and never will again. It grows faster the more customers we have, because every customer teaches it something. A rival starting today isn't a few features behind. They're behind by the whole distance we've traveled.",
  },
  {
    icon: RefreshCw,
    title: "The engine is interchangeable",
    body: "When the harness is good, the model underneath is swappable. The day a cheaper one is good enough, we drop it in and margins jump, and nothing else about the product changes. The value was never in the engine, so we're never at one vendor's mercy.",
  },
];

/**
 * The business case for the harness, from John's harness overview note
 * (2026-06-30). Complements HarnessVsAgent (what the harness does) with why
 * it's defensible and compounds. Brand voice: no em dashes, no inflated vocab.
 */
export function IncubatorHarnessMoat() {
  return (
    <section
      id="moat"
      className="border-y border-border bg-muted/20 py-10 sm:py-14"
    >
      <div className="mx-auto w-full max-w-5xl px-6">
        <div className="mb-12 text-center">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Why this is defensible
          </p>
          <h2 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">
            The model is rented. The harness is ours.
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-pretty text-lg text-muted-foreground">
            Everyone building with AI rents the same engine. We use Claude, the
            next company uses Claude, someone else uses GPT, and all of us pay
            the same vendor by the token for the same intelligence. When the
            model gets smarter, it gets smarter for everyone at once. A smart
            model isn&apos;t an advantage. It&apos;s something you buy off the
            shelf for pennies.
          </p>
        </div>

        <ul className="grid gap-4 sm:grid-cols-2">
          {POINTS.map(({ icon: Icon, title, body }) => (
            <li
              key={title}
              className="flex gap-4 rounded-2xl border border-border bg-card p-6 shadow-sm"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-foreground/5 text-foreground">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h3 className="mb-1.5 text-base font-semibold tracking-tight">
                  {title}
                </h3>
                <p className="text-pretty text-sm text-muted-foreground">
                  {body}
                </p>
              </div>
            </li>
          ))}
        </ul>

        <div className="mx-auto mt-10 max-w-3xl rounded-2xl bg-foreground p-8 text-background sm:p-10">
          <p className="text-balance text-center text-xl font-semibold leading-snug tracking-tight sm:text-2xl">
            MaC isn&apos;t an AI company selling access to a smart model.
            It&apos;s a harness company. We sell the body that turns rented
            intelligence into a co-worker that knows your business and gets more
            valuable the longer you keep it.
          </p>
        </div>

        <p className="mx-auto mt-8 max-w-2xl text-balance text-center text-sm text-muted-foreground">
          Ross is the live example. Same model anyone can rent, plus the memory
          of this channel, the tools to build and ship, and the guardrails to do
          it safely. Swap his model for a better one tomorrow and he gets
          sharper. Everything that makes him yours stays. That&apos;s the
          harness, and the harness is the company.
        </p>
      </div>
    </section>
  );
}
