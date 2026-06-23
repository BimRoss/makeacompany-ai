import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fetchPublicAgent } from "@/lib/public-agent";
import { siteUrl } from "@/lib/site";
import { AgentShowcaseIntelligence } from "@/components/agent-showcase-intelligence";

export const dynamic = "force-dynamic";

type RouteParams = { id: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<RouteParams>;
}): Promise<Metadata> {
  const { id } = await params;
  const agent = await fetchPublicAgent(id);
  if (!agent) return {};
  const title = `${agent.displayName} — built on makeacompany`;
  const description = agent.description || "An AI agent built on makeacompany.";
  const url = `${siteUrl}/a/${agent.id}`;
  const images = agent.avatarUrl ? [{ url: agent.avatarUrl, alt: agent.displayName }] : undefined;
  return {
    title,
    description,
    alternates: { canonical: `/a/${agent.id}` },
    openGraph: { title, description, url, images },
    twitter: { card: "summary_large_image", title, description, images },
  };
}

export default async function AgentShowcasePage({
  params,
}: {
  params: Promise<RouteParams>;
}) {
  const { id } = await params;
  const agent = await fetchPublicAgent(id);
  if (!agent) notFound();

  const initials = agent.displayName
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-12 px-6 py-16">
      {/* Hero */}
      <section className="flex flex-col items-center text-center">
        {agent.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={agent.avatarUrl}
            alt={agent.displayName}
            className="h-24 w-24 rounded-2xl object-cover shadow-sm"
          />
        ) : (
          <div className="flex h-24 w-24 items-center justify-center rounded-2xl bg-muted text-2xl font-semibold text-foreground/70">
            {initials || "AI"}
          </div>
        )}
        <h1 className="mt-6 text-3xl font-semibold tracking-tight text-foreground">
          {agent.displayName}
        </h1>
        {agent.description ? (
          <p className="mt-3 max-w-prose text-lg text-muted-foreground">{agent.description}</p>
        ) : null}
        {agent.builtBy ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Built by {agent.builtBy} on makeacompany
          </p>
        ) : null}
      </section>

      {/* What it knows */}
      {agent.intelligence && agent.intelligence.length > 0 ? (
        <AgentShowcaseIntelligence blocks={agent.intelligence} />
      ) : null}

      {/* What it does */}
      {agent.longDescription ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            What it does
          </h2>
          <p className="whitespace-pre-line text-base leading-relaxed text-foreground/90">
            {agent.longDescription}
          </p>
        </section>
      ) : null}

      {/* The stack behind it */}
      <section className="rounded-2xl bg-muted/40 p-6 text-center">
        <p className="text-base text-foreground/90">
          {agent.displayName} is an agent, a site, and the infrastructure under it.
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          One person and a Slack channel. That&apos;s makeacompany.
        </p>
      </section>

      {/* CTA */}
      <section className="flex flex-col items-center gap-4">
        <a
          href={agent.inviteUrl}
          className="inline-flex min-h-12 items-center justify-center rounded-full bg-foreground px-8 text-base font-semibold text-background transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground/40"
        >
          Build your agent
        </a>
        <p className="text-xs text-muted-foreground">Free for the first 100. No credit card.</p>
      </section>
    </main>
  );
}
