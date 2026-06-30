import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";

import { Footer } from "@/components/landing/footer";
import { Header } from "@/components/landing/header";

const CONTACT_HREF = `mailto:john@makeacompany.ai?subject=${encodeURIComponent(
  "Multiply with MaC",
)}&bcc=grant@makeacompany.ai`;

export type AgentCapability = { title: string; body: string };

/**
 * Shared detail-page layout for a single MaC agent (Ross, Joanne). Linked from
 * the incubator team tiles. Brand voice: no em dashes, no inflated vocab.
 */
export function IncubatorAgentDetail({
  name,
  role,
  headshot,
  intro,
  capabilities,
}: {
  name: string;
  role: string;
  headshot: string;
  intro: string;
  capabilities: AgentCapability[];
}) {
  return (
    <main className="flex min-h-screen flex-col bg-background">
      <Header />

      <section className="px-6 pb-10 pt-12 sm:pt-16">
        <div className="mx-auto w-full max-w-3xl">
          <Link
            href="/incubator"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back to the incubator
          </Link>

          <div className="mt-8 flex flex-col items-center text-center sm:flex-row sm:items-center sm:gap-6 sm:text-left">
            <Image
              src={headshot}
              alt={`${name}, ${role}`}
              width={160}
              height={160}
              priority
              className="h-28 w-28 shrink-0 rounded-full object-cover sm:h-36 sm:w-36"
            />
            <div className="mt-4 sm:mt-0">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {role}
              </p>
              <h1 className="mt-1 text-4xl font-bold tracking-tight sm:text-5xl">
                {name}
              </h1>
            </div>
          </div>

          <p className="mt-8 text-pretty text-lg leading-relaxed text-muted-foreground">
            {intro}
          </p>
        </div>
      </section>

      <section className="px-6 py-6 sm:py-10">
        <div className="mx-auto grid w-full max-w-3xl gap-4 sm:grid-cols-2">
          {capabilities.map(({ title, body }) => (
            <div
              key={title}
              className="rounded-2xl border border-border bg-card p-6 shadow-sm"
            >
              <h2 className="mb-1.5 text-base font-semibold tracking-tight">
                {title}
              </h2>
              <p className="text-pretty text-sm text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="px-6 pb-16 pt-8 sm:pb-24">
        <div className="mx-auto w-full max-w-3xl text-center">
          <p className="mb-6 text-pretty text-lg text-muted-foreground">
            {name} is one of the agents that would run in your company.
          </p>
          <div className="mx-auto flex w-full max-w-sm justify-center">
            <a
              href={CONTACT_HREF}
              className="group inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 text-base font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5 sm:h-14 sm:w-auto sm:px-10 sm:text-lg"
            >
              Multiply with MaC
              <ArrowRight
                className="h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5 sm:h-5 sm:w-5"
                aria-hidden
              />
            </a>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
