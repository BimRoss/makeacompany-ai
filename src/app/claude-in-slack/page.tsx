import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "@/components/landing/footer";
import { Header } from "@/components/landing/header";

export const metadata: Metadata = {
  title: "Claude in Slack — make Claude a teammate, not a tab",
  description:
    "Run Claude as a persistent teammate inside Slack. Channel-scoped memory, real GitHub + Google access, no copy-paste. Built and dogfooded by the MaC team.",
  alternates: { canonical: "/claude-in-slack" },
  openGraph: {
    title: "Claude in Slack — make Claude a teammate, not a tab",
    description:
      "Persistent Claude agents that live in your Slack channels. Real tool access, channel memory, no browser tab.",
    url: "/claude-in-slack",
  },
  twitter: {
    card: "summary_large_image",
    title: "Claude in Slack — make Claude a teammate, not a tab",
    description:
      "Persistent Claude agents that live in your Slack channels. Real tool access, channel memory, no browser tab.",
  },
};

export default function ClaudeInSlackPage() {
  return (
    <main className="min-h-screen bg-background">
      <Header />

      <article className="mx-auto max-w-3xl px-6 py-16 prose prose-neutral dark:prose-invert lg:prose-lg">
        <h1>Claude in Slack — make Claude a teammate, not a tab</h1>

        <p className="lead">
          Most people use Claude in a browser tab. They paste in code, paste in
          a thread, ask a question, copy the answer back. That works, but it
          costs a context switch every time. <strong>Make a Company (MaC)</strong>{" "}
          puts Claude directly inside Slack as a persistent teammate — with its
          own identity, channel memory, and real access to GitHub, Google
          Workspace, Kubernetes, and your other tools.
        </p>

        <h2>What &ldquo;Claude in Slack&rdquo; actually means with MaC</h2>

        <p>
          A MaC agent isn&apos;t a Slackbot wrapper around the chat API. Each
          channel gets a long-running Claude pod with:
        </p>

        <ul>
          <li>
            <strong>A real Slack identity</strong> — Ross, Joanne, or whatever
            personas your team needs. They show up in the member list, get
            mentioned with <code>@</code>, and post in-thread like a person.
          </li>
          <li>
            <strong>Channel-scoped memory</strong> — every channel has its own
            durable workspace on disk. Decisions, conventions, repo allowlists,
            and recurring preferences persist across messages and across days.
          </li>
          <li>
            <strong>Real tool access</strong> — Google Workspace via a per-pod
            OAuth sidecar, GitHub via the <code>gh</code> CLI, Kubernetes via{" "}
            <code>kubectl</code> against your cluster, custom MCP servers for
            anything else.
          </li>
          <li>
            <strong>Background work</strong> — recurring loops (daily SEO
            reports, hourly health checks, deploy watchers) tick outside any
            single conversation and post their results to the channel root.
          </li>
        </ul>

        <h2>Why a Slack-native agent beats a browser tab</h2>

        <h3>The work already lives in Slack</h3>
        <p>
          Engineering threads, customer questions, deploy chatter, weekly
          planning — for most teams using Slack, that&apos;s where the actual
          work happens. Pulling Claude out of that flow means losing context
          every time you ask it something. A Slack-native agent reads the
          thread it&apos;s spawned in, sees prior decisions, and replies inline.
        </p>

        <h3>One identity, many threads, one shared brain</h3>
        <p>
          A MaC agent maintains a single workspace per channel — files on disk
          persist between every message. Anything written there is available
          next time, in any thread. Conversation memory is scoped to the
          current thread, but the durable knowledge (conventions, decisions,
          past project context) survives across all of them.
        </p>

        <h3>Real tools, not toy tools</h3>
        <p>
          Asking Claude in a browser tab to &quot;deploy the latest tag of our
          frontend&quot; gets you a markdown explanation. Asking a MaC agent in
          Slack gets you the actual deploy — tag pushed, image built, GitOps PR
          opened and merged, rollout watched, confirmation posted back when
          it&apos;s live. Same model, real hands.
        </p>

        <h2>What we use it for ourselves</h2>

        <p>
          We dogfood MaC for everything. Our own Slack workspace runs Ross
          (engineering / automation) and Joanne (ops / scheduling / comms). A
          normal day in the team channel looks like:
        </p>

        <ul>
          <li>
            <em>&quot;Russ, what tickets are related to MaC right now?&quot;</em> —
            Ross queries GitHub across the org, returns an emoji-formatted
            roundup with repo/title pairs.
          </li>
          <li>
            <em>&quot;Deploy v0.1.108 to prod&quot;</em> — Ross fires the
            workflow, hands off to a background deploy-watcher that survives
            its own pod rollout, and posts a single anchor message that
            advances 🏗️ → 📦 → 🔀 → 🚀 → ✅ as the deploy moves through stages.
          </li>
          <li>
            <em>&quot;🤝 Joanne, send the calendar invite for the partner
            walkthrough&quot;</em> — Ross hands off to Joanne via the
            handshake-emoji convention; Joanne picks up in-thread.
          </li>
          <li>
            <em>Daily SEO check</em> — a recurring loop pulls Search Console
            data, renders a bar chart, posts a snapshot to the channel root
            with a delta vs the prior period.
          </li>
        </ul>

        <h2>How it&apos;s built</h2>

        <p>
          MaC agents run as Kubernetes pods. Each Slack message spawns a fresh
          Claude Code process with the channel workspace mounted as the working
          directory. A Go harness manages session resume, channel-context
          injection, the recurring-loops scheduler, and the per-pod OAuth
          sidecar for Google. Source of truth for the persistent state lives in
          the channel&apos;s workspace files — including a CLAUDE.md that gets
          auto-loaded into every spawn.
        </p>

        <p>
          The browser-tab pattern asks Claude to do more work each time you
          start over. MaC inverts that: the agent gets smarter about your
          channel the longer it&apos;s there. Today&apos;s decisions become
          tomorrow&apos;s context, without anyone copying anything anywhere.
        </p>

        <h2>Try it</h2>

        <p>
          MaC is in active development with a small set of design-partner
          teams. If you want Claude as a real teammate in your Slack — with
          real tool access and real memory, not another browser tab —{" "}
          <Link href="/">start here</Link>. First 100 users are free for life.
        </p>
      </article>

      <Footer />
    </main>
  );
}
