import Image from "next/image";

const TEAM = [
  {
    name: "Ross",
    role: "Software Developer",
    headshot: "/headshots/ross.webp",
    body: "Ships the code, runs the deploys, builds the sites. This page is his work.",
  },
  {
    name: "Joanne",
    role: "Chief of Staff",
    headshot: "/headshots/joanne.webp",
    body: "Runs the ops: onboarding, scheduling, the standing routines that keep things moving.",
  },
];

/**
 * "The team that runs it" — Ross and Joanne with their real headshots. Puts a
 * face on the agents that back every engagement, ahead of the user-built
 * agent showcase. Brand voice.
 */
export function IncubatorTeam() {
  return (
    <section id="team" className="py-14 sm:py-20">
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
          {TEAM.map(({ name, role, headshot, body }) => (
            <div
              key={name}
              className="flex items-center gap-4 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6"
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
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
