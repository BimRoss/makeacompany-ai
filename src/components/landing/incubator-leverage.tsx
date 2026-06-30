/**
 * "Defining leverage" — makes the hero's promise concrete. Leverage = output
 * you direct but don't have to produce yourself. Ties to the "humans direct,
 * the machine produces" framing. Brand voice: no em dashes, no inflated vocab.
 */
export function IncubatorLeverage() {
  return (
    <section id="leverage" className="py-14 sm:py-20">
      <div className="mx-auto w-full max-w-4xl px-6 text-center">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          What we mean by leverage
        </p>
        <h2 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">
          Leverage is output you don&apos;t have to produce yourself.
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-pretty text-lg text-muted-foreground">
          A founder&apos;s day has a hard ceiling. Same hours, same focus, one
          set of hands. Leverage is what lets one operator produce the output of
          a team without hiring one. You set the direction. The harness does the
          work: writing the code, sending the notes, watching the deploys,
          running the routines. Your hours go to deciding what matters, not
          typing it out.
        </p>

        <div className="mx-auto mt-10 grid max-w-2xl grid-cols-2 divide-x divide-border overflow-hidden rounded-2xl border border-border bg-card">
          <div className="flex flex-col items-center justify-center px-4 py-8">
            <span className="text-2xl font-bold tracking-tight sm:text-3xl">
              You direct
            </span>
            <span className="mt-2 text-sm text-muted-foreground">
              a few lines of judgment
            </span>
          </div>
          <div className="flex flex-col items-center justify-center px-4 py-8">
            <span className="text-2xl font-bold tracking-tight sm:text-3xl">
              It produces
            </span>
            <span className="mt-2 text-sm text-muted-foreground">
              a day of finished work
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
