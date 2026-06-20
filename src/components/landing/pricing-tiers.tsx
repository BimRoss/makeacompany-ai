"use client";

import { Check } from "lucide-react";
import { useEffect, useState } from "react";

const SLACK_INVITE_URL =
  "https://join.slack.com/t/makeacompany/shared_invite/zt-3w432kf90-5B7IwfX2DNGfxLB1VGp6zA";

type CtaKind = { kind: "link"; href: string } | { kind: "soon" };

type Tier = {
  name: string;
  price: string;
  cadence: string;
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
    name: "Personal Agent",
    price: "$499",
    cadence: "/mo",
    status: "In development",
    statusTone: "soon",
    pitch: "Your own agent that takes action on your behalf, not just the room's.",
    features: [
      "Everything in Starter",
      "A personal agent bound to you, with its own Google identity and tools",
      "Acts on your email, calendar, docs, and Slack when you ask",
      "Currently gated to creator-only while we validate in the wild",
    ],
    cta: { kind: "soon", label: "Get on the early access list" },
    dimmed: true,
  },
  {
    name: "Starter",
    price: "$99",
    cadence: "/mo",
    status: "Available now",
    statusTone: "live",
    pitch: "Joanne and Ross in your Slack, paid month-to-month.",
    features: [
      "Joanne (Chief of Staff) and Ross (Software Developer) in your channel",
      "Persistent workspace per channel, baked-in skills, GitOps and intake wired up",
      "10 days free, no card to start",
      "Cancel anytime",
    ],
    cta: { kind: "link", href: SLACK_INVITE_URL, label: "Start free" },
    emphasized: true,
  },
  {
    name: "Enterprise",
    price: "$999",
    cadence: "/mo",
    status: "August 2026",
    statusTone: "future",
    pitch: "Isolated infrastructure for accounts that need it.",
    features: [
      "Everything in Personal Agent",
      "Dedicated servers, your own slice of the harness",
      "Data residency and compliance posture",
      "Direct line to the team building it",
    ],
    cta: { kind: "soon", label: "Talk to us" },
    dimmed: true,
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

export function PricingTiers() {
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <section className="border-y border-border bg-muted/20 py-20" id="pricing">
      <div className="mx-auto w-full max-w-5xl px-6">
        <div className="mb-12 text-center">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Pricing
          </p>
          <h2 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">
            Pick the tier that fits your account.
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-pretty text-lg text-muted-foreground">
            One product, three depths. Start in the room, grow into a personal agent, land on isolated infra when you need it.
          </p>
        </div>

        <ul className="grid gap-4 sm:grid-cols-3">
          {TIERS.map((tier) => {
            const baseCard = tier.emphasized
              ? "relative flex flex-col rounded-2xl border-2 border-foreground bg-card p-6 shadow-lg"
              : "relative flex flex-col rounded-2xl border border-border bg-card p-6 shadow-sm";
            const cardClass = tier.dimmed
              ? `${baseCard} hidden sm:flex opacity-50 pointer-events-none select-none`
              : baseCard;
            const ctaClass = tier.emphasized
              ? "inline-flex items-center justify-center rounded-lg bg-foreground px-4 py-2.5 text-sm font-semibold text-background hover:bg-foreground/90"
              : "inline-flex items-center justify-center rounded-lg border border-foreground px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-foreground/5";
            return (
              <li key={tier.name} className={cardClass} aria-disabled={tier.dimmed || undefined}>
                <div className="mb-4 flex items-center justify-between gap-2">
                  <h3 className="text-lg font-semibold tracking-tight">{tier.name}</h3>
                  <StatusPill tone={tier.statusTone}>{tier.status}</StatusPill>
                </div>
                <div className="mb-3 flex items-baseline gap-1">
                  <span className="text-4xl font-bold tracking-tight">{tier.price}</span>
                  <span className="text-sm text-muted-foreground">{tier.cadence}</span>
                </div>
                <p className="mb-5 text-pretty text-sm text-muted-foreground">{tier.pitch}</p>
                <ul className="mb-6 flex-1 space-y-2">
                  {tier.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-foreground" aria-hidden="true" />
                      <span className="text-pretty text-foreground/80">{f}</span>
                    </li>
                  ))}
                </ul>
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
                  <button
                    type="button"
                    onClick={() => setToast("Coming soon")}
                    className={ctaClass}
                    disabled={tier.dimmed}
                  >
                    {tier.cta.label}
                  </button>
                )}
              </li>
            );
          })}
        </ul>

        <p className="mx-auto mt-8 max-w-2xl text-pretty text-center text-sm text-muted-foreground">
          First 100 seats are free for life. After that, the Starter trial is 10 days, no card required.
        </p>
      </div>

      {toast ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[70] flex justify-center px-4">
          <p
            role="status"
            className="pointer-events-auto rounded-full border border-foreground bg-background px-5 py-2 text-sm font-medium text-foreground shadow-lg"
          >
            {toast}
          </p>
        </div>
      ) : null}
    </section>
  );
}
