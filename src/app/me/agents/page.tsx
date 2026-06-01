import type { Metadata } from "next";

import { Footer } from "@/components/landing/footer";
import { Header } from "@/components/landing/header";
import { PersonalAgentsPanel } from "@/components/portal/personal-agents-panel";

// /me/agents — the user-level dashboard for personal-agent management
// (issue #183 / #186 PR5). Requires a portal session cookie; the
// backend resolves owner identity from the session email →
// user_profile.slack_user_id, and 401s / 403s if either link is missing.
// The panel renders the unavailable-state in those cases so users see
// "sign in first" instead of an empty list.

export const metadata: Metadata = {
  title: "Personal agents · makeacompany.ai",
  description: "Slack agents that respond only to you.",
  robots: { index: false, follow: false },
};

export default function PersonalAgentsPage() {
  return (
    <main className="flex min-h-dvh flex-col bg-background">
      <Header />
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-start gap-8 px-6 py-12 text-center">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
            Personal agents
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Each personal agent is its own Slack app + bot user, owned by your Slack identity.
            They respond to you in DMs and only to you in channels both of you are in.
          </p>
        </div>
        <PersonalAgentsPanel />
        <div className="mx-auto max-w-2xl text-left text-xs text-muted-foreground">
          <p className="mb-2 font-medium uppercase tracking-wide">Setup notes</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Create an agent above, then create a matching Slack app via the manifest in{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-[10px]">docs/personal-agents/slack-app-manifest.md</code>.
            </li>
            <li>
              Paste the bot token (<code className="text-[10px]">xoxb-…</code>),
              app-level token (<code className="text-[10px]">xapp-…</code>),
              and bot user id (<code className="text-[10px]">U…</code>) using the &quot;Paste Slack tokens&quot; button.
            </li>
            <li>
              Google connect ships in the next release; for now, agents respond using your local user identity only.
            </li>
          </ul>
        </div>
      </div>
      <Footer />
    </main>
  );
}
