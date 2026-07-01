const STEPS = [
  {
    n: "01",
    title: "Introduction",
    body: "You send us a note. Every request gets a real read from our team.",
  },
  {
    n: "02",
    title: "Fit",
    body: "A short conversation to see if what you're building and how we work line up. Terms are part of this conversation, not a price on a page.",
  },
  {
    n: "03",
    title: "Setup",
    body: "We stand up your agents and wire the harness into your tools: your Slack, your email, your files, your deploy pipeline.",
  },
  {
    n: "04",
    title: "Build",
    body: "You direct, the team executes, and you build alongside the rest of the portfolio. The harness gets deeper every day you run.",
  },
];

/**
 * "Our process" — how an engagement goes, introduction to building. Keeps
 * pricing pinned (terms live in the fit conversation). Brand voice.
 */
export function IncubatorProcess() {
  return (
    <section id="process" className="py-14 sm:py-20">
      <div className="mx-auto w-full max-w-5xl px-6">
        <div className="mb-12 text-center">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            How it works
          </p>
          <h2 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">
            From introduction to building, in four steps.
          </h2>
        </div>

        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(({ n, title, body }) => (
            <li
              key={n}
              className="flex flex-col rounded-2xl border border-border bg-card p-6 shadow-sm"
            >
              <span className="mb-3 text-2xl font-bold tracking-tight text-muted-foreground/50">
                {n}
              </span>
              <h3 className="mb-1.5 text-base font-semibold tracking-tight">
                {title}
              </h3>
              <p className="text-pretty text-sm text-muted-foreground">{body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
