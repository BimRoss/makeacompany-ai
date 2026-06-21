import { Smartphone, Users, Wrench } from "lucide-react";

const STATS = [
  { value: "10 min", label: "first project scoped" },
  { value: "same day", label: "shipped to prod" },
  { value: "$99/mo", label: "vs. $3–5K/mo in contractors" },
];

const PILLARS = [
  {
    icon: Wrench,
    title: "The harness, not the agent.",
    body: "Claude is commodity. We ship the orchestration: persistent workspaces per channel, baked-in skills, GitOps and intake wired up out of the box.",
  },
  {
    icon: Smartphone,
    title: "Ship from your phone, in Slack.",
    body: "We were built that way. This site, the Slack bot, the onboarding flow. This company runs on itself.",
  },
  {
    icon: Users,
    title: "A curated room of builders and operators.",
    body: "It's a room, not a CLI. 10 days free, then $99/mo. No card to start.",
  },
];

export function ValueStack() {
  return (
    <section id="why" className="py-20">
      <div className="mx-auto w-full max-w-5xl px-6">
        <div className="mb-12 text-center">
          <h2 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">
            Why this, instead of a $100/mo Claude sub.
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-pretty text-lg text-muted-foreground">
            Three legs the raw CLI doesn&apos;t give you.
          </p>
        </div>

        <div className="mb-12 grid grid-cols-3 divide-x divide-border rounded-2xl border border-border bg-card">
          {STATS.map(({ value, label }) => (
            <div key={label} className="flex flex-col items-center px-4 py-6 text-center sm:px-8">
              <span className="text-2xl font-bold tracking-tight sm:text-3xl">{value}</span>
              <span className="mt-1 text-xs text-muted-foreground sm:text-sm">{label}</span>
            </div>
          ))}
        </div>

        <ul className="grid gap-6 sm:grid-cols-3">
          {PILLARS.map(({ icon: Icon, title, body }) => (
            <li
              key={title}
              className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6"
            >
              <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-foreground sm:mb-4">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </div>
              <h3 className="mb-2 text-balance text-lg font-semibold tracking-tight">{title}</h3>
              <p className="text-pretty text-sm text-muted-foreground">{body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
