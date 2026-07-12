"use client";

import { Check } from "lucide-react";
import { useState } from "react";

const SLACK_INVITE_URL =
  "https://join.slack.com/t/makeacompany/shared_invite/zt-3w432kf90-5B7IwfX2DNGfxLB1VGp6zA";

type CtaKind =
  | { kind: "link"; href: string }
  | { kind: "waitlist"; tier: string };

type Tier = {
  name: string;
  price: string;
  cadence: string;
  annual?: string;
  status: string;
  statusTone: "live" | "soon" | "future";
  pitch: string;
  features: string[];
  cta: { label: string } & CtaKind;
  emphasized?: boolean;
  dimmed?: boolean;
};

const TIERS: Tier[] = [
  {
    name: "Solo",
    price: "$49",
    cadence: "/mo",
    annual: "or $490/yr",
    status: "Available now",
    statusTone: "live",
    pitch: "One agent teammate to get you moving.",
    features: [
      "One agent in your Slack",
      "Ships code, deploys, and sites",
      "Remembers your company",
      "BYOK · 14-day free trial",
    ],
    cta: { kind: "link", href: SLACK_INVITE_URL, label: "Start free" },
  },
  {
    name: "Founder",
    price: "$149",
    cadence: "/mo",
    annual: "or $1,490/yr",
    status: "Available now",
    statusTone: "live",
    pitch: "The full agent team in Slack, running your company.",
    features: [
      "Full agent team in Slack",
      "Ships code, deploys, and sites",
      "Remembers your company",
      "Priority runtime",
      "BYOK · 14-day free trial",
    ],
    cta: { kind: "link", href: SLACK_INVITE_URL, label: "Start free" },
    emphasized: true,
  },
  {
    name: "Studio",
    price: "$499",
    cadence: "/mo",
    annual: "or $4,990/yr",
    status: "Available now",
    statusTone: "live",
    pitch: "Bring your whole team into the room.",
    features: [
      "Everything in Founder, plus…",
      "Seats for your whole team",
      "Priority builds & concurrency",
      "Shared memory + integrations",
      "Team onboarding support",
    ],
    cta: { kind: "link", href: SLACK_INVITE_URL, label: "Start free" },
  },
  {
    name: "Embedded",
    price: "Custom",
    cadence: "",
    annual: "from $24,000/yr",
    status: "By application",
    statusTone: "soon",
    pitch: "We build alongside you.",
    features: [
      "Everything in Studio, plus…",
      "We build alongside you",
      "Custom agents & workflows",
      "White-glove onboarding",
      "Roadmap input · SLA",
    ],
    cta: { kind: "waitlist", label: "Talk to us", tier: "embedded" },
  },
];

function StatusPill({ tone, children }: { tone: Tier["statusTone"]; children: string }) {
  const toneClass =
    tone === "live"
      ? "bg-foreground text-background"
      : tone === "soon"
      ? "border border-foreground/40 bg-background text-foreground"
      : "border border-border bg-background text-muted-foreground";
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${toneClass}`}>
      {children}
    </span>
  );
}

type WaitlistState = { status: "idle" } | { status: "sending" } | { status: "ok" } | { status: "error"; message: string };

function WaitlistForm({ tier, ctaLabel, ctaClass }: { tier: string; ctaLabel: string; ctaClass: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<WaitlistState>({ status: "idle" });

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed || !trimmed.includes("@")) {
      setState({ status: "error", message: "Enter a valid email." });
      return;
    }
    setState({ status: "sending" });
    try {
      const r = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier, email: trimmed }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}) as { error?: string });
        setState({ status: "error", message: body.error || `Server returned ${r.status}.` });
        return;
      }
      setState({ status: "ok" });
    } catch (err) {
      setState({ status: "error", message: err instanceof Error ? err.message : "Network error." });
    }
  };

  if (state.status === "ok") {
    return (
      <p className="rounded-lg border border-foreground/30 bg-background px-3 py-2.5 text-center text-sm text-foreground">
        You&apos;re on the list. We&apos;ll be in touch.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <input
        type="email"
        required
        autoComplete="email"
        placeholder="you@work.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={state.status === "sending"}
        className="w-full min-w-0 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-foreground/60 disabled:opacity-60"
      />
      <button
        type="submit"
        disabled={state.status === "sending"}
        className={ctaClass}
      >
        {state.status === "sending" ? "Adding…" : ctaLabel}
      </button>
      {state.status === "error" ? (
        <p className="text-xs text-red-600 dark:text-red-400">{state.message}</p>
      ) : null}
    </form>
  );
}

export function PricingTiers() {
  return (
    <section className="border-y border-border bg-muted/20 py-10 sm:py-14" id="pricing">
      <div className="mx-auto w-full max-w-6xl px-6">
        <div className="mb-12 text-center">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Pricing
          </p>
          <h2 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">
            Priced like leverage.
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-pretty text-lg text-muted-foreground">
            From $49/mo · 14-day free trial · BYOK. Start solo, bring your team, or have us build alongside you.
          </p>
        </div>

        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {TIERS.map((tier) => {
            const baseCard = tier.emphasized
              ? "relative flex flex-col rounded-2xl border-2 border-foreground bg-card p-6 shadow-lg"
              : "relative flex flex-col rounded-2xl border border-border bg-card p-6 shadow-sm";
            const mobileOrder = tier.emphasized
              ? "order-first sm:order-none"
              : "order-last sm:order-none";
            // Dimmed cards now keep their CTA interactive — only the rest of the
            // card body is visually dimmed. We split the dimming so the form/link
            // stays clickable.
            const cardClass = `${baseCard} ${mobileOrder}`;
            const bodyDimClass = tier.dimmed ? "opacity-60" : "";
            const ctaClass = tier.emphasized
              ? "inline-flex w-full items-center justify-center rounded-lg bg-foreground px-4 py-2.5 text-sm font-semibold text-background hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-60"
              : "inline-flex w-full items-center justify-center rounded-lg border border-foreground px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-foreground/5 disabled:cursor-not-allowed disabled:opacity-60";
            return (
              <li key={tier.name} className={cardClass} aria-disabled={tier.dimmed || undefined}>
                <div className={bodyDimClass}>
                  <div className="mb-4 flex items-center justify-between gap-2">
                    <h3 className="text-lg font-semibold tracking-tight">{tier.name}</h3>
                    <StatusPill tone={tier.statusTone}>{tier.status}</StatusPill>
                  </div>
                  <div className="mb-1 flex items-baseline gap-1">
                    <span className="text-4xl font-bold tracking-tight">{tier.price}</span>
                    <span className="text-sm text-muted-foreground">{tier.cadence}</span>
                  </div>
                  {tier.annual ? (
                    <p className="mb-3 text-xs text-muted-foreground">{tier.annual}</p>
                  ) : (
                    <div className="mb-3" />
                  )}
                  <p className="mb-5 text-pretty text-sm text-muted-foreground">{tier.pitch}</p>
                  <ul className="mb-6 space-y-2">
                    {tier.features.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-sm">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-foreground" aria-hidden="true" />
                        <span className="text-pretty text-foreground/80">{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="mt-auto">
                  {tier.cta.kind === "link" ? (
                    <a
                      href={tier.cta.href}
                      target="_blank"
                      rel="noopener"
                      className={ctaClass}
                    >
                      {tier.cta.label}
                    </a>
                  ) : (
                    <WaitlistForm tier={tier.cta.tier} ctaLabel={tier.cta.label} ctaClass={ctaClass} />
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        <p className="mx-auto mt-8 max-w-2xl text-pretty text-center text-sm text-muted-foreground">
          Every tier: 14-day free trial, no card. All tiers BYOK; Managed Keys add-on available.
        </p>
      </div>
    </section>
  );
}
