const FAQS: { q: string; a: string }[] = [
  {
    q: "Is this open to the public?",
    a: "No. The incubator is private and inbound only. You come in through an introduction.",
  },
  {
    q: "How do I get in?",
    a: "Send a note to john@makeacompany.ai. Our team reviews every request and starts the fit conversation from there.",
  },
  {
    q: "What does it cost?",
    a: "We work that out in the fit conversation, once we both know it's a match. The fit comes first, the terms follow.",
  },
  {
    q: "What is the harness?",
    a: "The system we build around the AI model: memory, tools, guardrails, and the routines that run on their own. The model is rented and the same for everyone. The harness is ours, and it compounds every day we run.",
  },
  {
    q: "Who owns what I build?",
    a: "The builders own what they build. You're building your own company, and it stays yours. The specifics of any engagement are part of the fit conversation.",
  },
  {
    q: "What's already in the portfolio?",
    a: "Brandlete, Inc. is the flagship, with Nexus alongside. Brandlete's new site and marketing materials were built inside MaC, and its agents are booking demos and landing new customers. Nexus was built in the platform end to end. The same team would back yours.",
  },
  {
    q: "Can the agents use my own tools and accounts?",
    a: "Yes. The harness wires into your calendar, email, files, website, and deploy pipeline with scoped access, so the work happens in your real systems.",
  },
];

/**
 * Incubator FAQ. Closed-by-default disclosure (native details/summary) per the
 * brand default-to-closed preference. Reuses real-site substance (harness,
 * portfolio, tools) with incubator-specific answers. Brand voice.
 */
export function IncubatorFaq() {
  return (
    <section id="faq" className="py-10 sm:py-14">
      <div className="mx-auto w-full max-w-3xl px-6">
        <div className="mb-10 text-center">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            FAQ
          </p>
          <h2 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">
            The questions founders ask first.
          </h2>
        </div>

        <div className="divide-y divide-border rounded-2xl border border-border bg-card">
          {FAQS.map(({ q, a }) => (
            <details key={q} open className="group px-5 py-4 sm:px-6">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-semibold tracking-tight [&::-webkit-details-marker]:hidden">
                {q}
                <span
                  className="shrink-0 text-muted-foreground transition-transform group-open:rotate-45"
                  aria-hidden
                >
                  +
                </span>
              </summary>
              <p className="mt-3 text-pretty text-sm leading-relaxed text-muted-foreground">
                {a}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
