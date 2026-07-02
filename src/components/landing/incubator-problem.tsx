const POINTS = [
  {
    label: "The ceiling",
    body: "Your day is fixed. Same hours, same focus, one set of hands. Past a point, working harder stops adding output, and the things only you can do start slipping.",
  },
  {
    label: "The gap",
    body: "Off-the-shelf AI hands you a smart chat box, not a team that ships. The memory, the tools, the guardrails, the part that does real work in your real systems, you're left to wire yourself.",
  },
  {
    label: "The need",
    body: "Leverage that compounds. A system that takes your direction and produces finished work, in your own tools, and gets sharper the longer it runs.",
  },
];

/**
 * "The problem" — sets the stage at the top of the lander before the offering.
 * Maps to John's framing: the problem, the gap, the need. Brand voice: no em
 * dashes, no inflated vocab.
 */
export function IncubatorProblem() {
  return (
    <section id="problem" className="border-b border-border py-10 sm:py-14">
      <div className="mx-auto w-full max-w-5xl px-6">
        <div className="mb-12 text-center">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            The problem
          </p>
          <h2 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">
            You can&apos;t scale yourself by working more hours.
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-pretty text-lg text-muted-foreground">
            Every founder hits the same wall. Here&apos;s the gap, and what it
            actually takes to get past it.
          </p>
        </div>

        <ol className="grid gap-4 sm:grid-cols-3">
          {POINTS.map(({ label, body }, i) => (
            <li
              key={label}
              className="flex flex-col rounded-2xl border border-border bg-card p-6 shadow-sm"
            >
              <span className="mb-3 text-2xl font-bold tracking-tight text-muted-foreground/50">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="mb-1.5 text-base font-semibold tracking-tight">
                {label}
              </h3>
              <p className="text-pretty text-sm text-muted-foreground">{body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
