import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

const TEAM = [
  {
    name: "Ross",
    role: "Software Developer",
    headshot: "/headshots/ross.webp",
    body: "Ships the code, runs the deploys, builds the sites. This page is his work.",
    href: "/incubator/ross",
  },
  {
    name: "Joanne",
    role: "Chief of Staff",
    headshot: "/headshots/joanne.webp",
    body: "Runs the ops: onboarding, scheduling, the standing routines that keep things moving.",
    href: "/incubator/joanne",
  },
];

/**
 * "The team that runs it" — Ross and Joanne with their real headshots. Each
 * tile links to that agent's own page. Brand voice.
 */
export function IncubatorTeam() {
  return (
    <section id="team" className="py-10 sm:py-14">
      <div className="mx-auto w-full max-w-4xl px-6">
        <div className="mb-12 text-center">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            The team that runs it
          </p>
          <h2 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">
            Two agents back every build.
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-pretty text-lg text-muted-foreground">
            Ross and Joanne are running this company in Slack right now. The same
            two would be in yours.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {TEAM.map(({ name, role, headshot, body, href }) => (
            <Link
              key={name}
              href={href}
              aria-label={`More about ${name}`}
              className="group/card flex items-center gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/25 sm:p-6"
            >
              <Image
                src={headshot}
                alt={`${name}, ${role}`}
                width={96}
                height={96}
                className="h-16 w-16 shrink-0 rounded-full object-cover sm:h-20 sm:w-20"
              />
              <div className="min-w-0">
                <h3 className="text-lg font-semibold tracking-tight">{name}</h3>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  {role}
                </p>
                <p className="text-pretty text-sm text-muted-foreground">{body}</p>
                <span className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-muted-foreground transition-colors group-hover/card:text-foreground">
                  More about {name}
                  <ArrowRight
                    className="h-3.5 w-3.5 transition-transform group-hover/card:translate-x-0.5"
                    aria-hidden
                  />
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
