import Image from "next/image";
import { Linkedin } from "lucide-react";

const FOUNDERS = [
  {
    name: "Grant Foster",
    title: "Founder / Builder",
    photo: "/founders/grant.jpg",
    bio: "Twelve years shipping production software, from trading systems to real-time sports to point-cloud pipelines, now agent platforms. He built the unglamorous parts of MaC: the orchestration, the integrations, the infrastructure that keeps agents reliable at 3am. Ross, Joanne, and the deploy stack behind them are his.",
    linkedin: "https://www.linkedin.com/in/grantdfoster",
  },
  {
    name: "John Osberg",
    title: "Co-Founder / Head of Growth",
    photo: "/founders/john.jpg",
    bio: "Seventeen years building partnerships and revenue engines across the PGA of America, Bloomberg, Citigroup, DICK'S, and more, with over $11M generated in partnerships, funding, and sales. At MaC he turns the relationship-to-revenue playbook into AI, so founders compound trust at scale instead of trading hours for it.",
    linkedin: "https://www.linkedin.com/in/johnosberg",
  },
];

/**
 * "Built by founders, for founders" — the human founders behind MaC, with
 * bios distilled from their LinkedIn/portfolio (John supplied, 2026-06-30).
 * Each whole tile is a single link to that founder's LinkedIn profile. Brand
 * voice: no em dashes, no inflated vocab.
 */
export function IncubatorFounders() {
  return (
    <section
      id="founders"
      className="border-y border-border bg-muted/20 py-10 sm:py-14"
    >
      <div className="mx-auto w-full max-w-5xl px-6">
        <div className="mb-12 text-center">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Built by founders, for founders
          </p>
          <h2 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">
            We built the leverage we wished we had.
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-pretty text-lg text-muted-foreground">
            We&apos;ve been the operators trading hours for output. MaC is the
            harness we built to stop, now opened to a few founders at a time.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {FOUNDERS.map(({ name, title, photo, bio, linkedin }) => (
            <a
              key={name}
              href={linkedin}
              target="_blank"
              rel="noopener"
              aria-label={`${name} on LinkedIn`}
              className="group/card flex flex-col rounded-2xl border border-border bg-card p-6 shadow-sm transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/25 sm:p-8"
            >
              <div className="mb-4 flex items-center gap-4">
                <Image
                  src={photo}
                  alt={`${name}, ${title}`}
                  width={112}
                  height={112}
                  className="h-20 w-20 shrink-0 rounded-full object-cover sm:h-24 sm:w-24"
                />
                <div className="min-w-0">
                  <h3 className="text-xl font-semibold tracking-tight">{name}</h3>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    {title}
                  </p>
                  <span className="mt-1.5 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors group-hover/card:text-foreground">
                    <Linkedin className="h-4 w-4" aria-hidden />
                    View on LinkedIn
                  </span>
                </div>
              </div>
              <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
                {bio}
              </p>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
