import { Box, GitBranch, Globe, Repeat, Wrench } from "lucide-react";

const ROWS: { icon: typeof Wrench; title: string; body: string }[] = [
  {
    icon: Box,
    title: "Remembers your company.",
    body: "Files, memory, and decisions live on disk across every message — not stuffed into a 200K-token context window.",
  },
  {
    icon: Wrench,
    title: "Comes with the tools your team already uses.",
    body: "Deploys, DNS, GA4, Search Console, ship-it, verify, SVG render — pre-wired with scoped credentials. Not \"install this MCP and configure it yourself.\"",
  },
  {
    icon: GitBranch,
    title: "Ships code on its own.",
    body: "Tag a release and the rollout watches itself: image build → gitops PR → ArgoCD → confirmation. New channels onboard via a structured intake flow.",
  },
  {
    icon: Repeat,
    title: "Runs your standing tasks on a schedule.",
    body: "Scheduler lives outside the spawn, so loops survive pod restarts. Daily inbox cleanup, hourly health checks, on-call nudges — all just JSON.",
  },
  {
    icon: Globe,
    title: "Lives in Slack, where your team already works.",
    body: "No new tool to learn, no new terminal to keep open, no context switch.",
  },
];

export function HarnessVsAgent() {
  return (
    <section id="how" className="border-y border-border bg-muted/20 py-10 sm:py-14">
      <div className="mx-auto w-full max-w-5xl px-6">
        <div className="mb-12 text-center">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            What you&apos;re actually buying
          </p>
          <h2 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">
            Claude is the car&apos;s engine. Our harness is the car&apos;s body.
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-pretty text-lg text-muted-foreground">
            A $100 Claude sub gets you the engine, sitting on the floor. Our proprietary harness is the body around it: the chassis, the wiring, the dashboard, everything that turns it into something your team can actually drive.
          </p>
        </div>

        <ul className="grid gap-4 sm:grid-cols-2 sm:[&>li:last-child:nth-child(odd)]:col-span-2 sm:[&>li:last-child:nth-child(odd)]:mx-auto sm:[&>li:last-child:nth-child(odd)]:w-[calc(50%-0.5rem)]">
          {ROWS.map(({ icon: Icon, title, body }) => (
            <li
              key={title}
              className="flex gap-4 rounded-2xl border border-border bg-card p-6 shadow-sm"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-foreground/5 text-foreground">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h3 className="mb-1.5 text-base font-semibold tracking-tight">{title}</h3>
                <p className="text-pretty text-sm text-muted-foreground">{body}</p>
              </div>
            </li>
          ))}
        </ul>

        <p className="mx-auto mt-10 max-w-2xl text-balance text-center text-sm text-muted-foreground">
          None of this comes with a Claude subscription. We built it because we needed it ourselves.
        </p>
      </div>
    </section>
  );
}
