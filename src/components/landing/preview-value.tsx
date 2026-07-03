import { GitBranch, MessageSquare, Repeat } from "lucide-react";

// A compact "what a MaC agent handles" row. Adds a little substance under the
// hero (John: the page was a touch too thin) without breaking the boardy-clean
// feel: three short columns, one icon and one line each.
const ITEMS: { icon: typeof GitBranch; title: string; body: string }[] = [
  {
    icon: GitBranch,
    title: "Ships code",
    body: "Opens PRs, merges, deploys to prod, then watches its own rollout.",
  },
  {
    icon: Repeat,
    title: "Runs the ops",
    body: "Inbox triage, health checks, scheduled reports, on their own cadence.",
  },
  {
    icon: MessageSquare,
    title: "Closes the loop",
    body: "Drafts, sends, follows up, all in Slack where your team already works.",
  },
];

export function PreviewValue() {
  return (
    <section className="border-t border-border/60 py-14 sm:py-20">
      <div className="mx-auto w-full max-w-5xl px-6">
        <h2 className="mx-auto max-w-2xl text-balance text-center text-2xl font-bold tracking-tight sm:text-3xl">
          Not one agent. A whole team of them.
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-balance text-center text-base text-muted-foreground">
          Ross and Joanne, plus the personal agents and teams you build, all
          working together in your Slack.
        </p>
        <ul className="mt-10 grid gap-8 sm:grid-cols-3">
          {ITEMS.map(({ icon: Icon, title, body }) => (
            <li key={title} className="text-center sm:text-left">
              <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-foreground/5 text-foreground sm:mx-0">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <h3 className="mt-4 text-base font-semibold tracking-tight">
                {title}
              </h3>
              <p className="mt-1.5 text-sm text-muted-foreground">{body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
