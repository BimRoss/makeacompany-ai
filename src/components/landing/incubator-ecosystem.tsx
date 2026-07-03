import { ChevronDown } from "lucide-react";

/**
 * "Where Slack fits" — the moat, drawn as a stack. Slack is the interface
 * (swappable for Discord/WhatsApp), the model is swappable (Claude/Fable/next),
 * and the harness in the middle is the constant we own: memory, wired tools,
 * loops, guardrails. Reinforces the HarnessVsAgent + moat sections with a
 * picture. Concept from John (2026-07-03). Brand: black/white, one blue accent
 * on the connector chevrons ("blue points, black acts"). No em dashes.
 */
const INTERFACES = [
  { label: "Slack", active: true },
  { label: "Discord", active: false },
  { label: "WhatsApp", active: false },
  { label: "your choice", active: false },
];

const MODELS = [
  { label: "Claude", active: true },
  { label: "Fable", active: true },
  { label: "whatever's best", active: false },
];

const TOOLS = [
  "GitHub",
  "Jira",
  "Gemini",
  "Veo",
  "GA4",
  "audio",
  "visual",
  "analytics",
  "deploy",
];

function Chip({ label, active }: { label: string; active: boolean }) {
  return (
    <span
      className={
        active
          ? "rounded-full border border-foreground px-3 py-1 text-sm font-medium text-foreground"
          : "rounded-full border border-dashed border-border px-3 py-1 text-sm text-muted-foreground"
      }
    >
      {label}
    </span>
  );
}

export function IncubatorEcosystem() {
  return (
    <section id="ecosystem" className="py-10 sm:py-14">
      <div className="mx-auto w-full max-w-3xl px-6 text-center">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Where Slack fits
        </p>
        <h2 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">
          Slack is just the window.
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-pretty text-lg text-muted-foreground">
          Slack is where you talk to your MaC agents today. It&apos;s the
          interface, not the product. The product is the harness underneath: the
          memory, the wired tools, the loops, the guardrails we own. Swap Slack
          for Discord or WhatsApp. Swap Claude for whatever model is best that
          week. The harness stays, and it&apos;s the part that compounds.
        </p>

        <div className="mx-auto mt-10 flex max-w-lg flex-col items-stretch gap-2">
          {/* Interface layer */}
          <div className="rounded-2xl border border-border bg-card px-5 py-5">
            <div className="mb-3 flex items-baseline justify-between">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Interface
              </span>
              <span className="text-xs text-muted-foreground">
                swap freely
              </span>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              {INTERFACES.map((i) => (
                <Chip key={i.label} label={i.label} active={i.active} />
              ))}
            </div>
          </div>

          <ChevronDown
            className="mx-auto h-5 w-5 text-[#2563eb]"
            aria-hidden
          />

          {/* Harness layer — the constant, inverted */}
          <div className="rounded-2xl bg-foreground px-5 py-6 text-background">
            <div className="mb-3 flex items-baseline justify-between">
              <span className="text-sm font-bold tracking-tight">
                The harness
              </span>
              <span className="text-xs text-background/70">
                yours. the constant.
              </span>
            </div>
            <div className="mb-4 flex flex-wrap items-center justify-center gap-2">
              {["memory", "wired tools", "loops", "guardrails"].map((t) => (
                <span
                  key={t}
                  className="rounded-full bg-background/15 px-3 py-1 text-sm font-medium"
                >
                  {t}
                </span>
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-center gap-1.5 border-t border-background/15 pt-3">
              {TOOLS.map((t) => (
                <span
                  key={t}
                  className="rounded-md border border-background/25 px-2 py-0.5 text-xs text-background/85"
                >
                  {t}
                </span>
              ))}
            </div>
          </div>

          <ChevronDown
            className="mx-auto h-5 w-5 text-[#2563eb]"
            aria-hidden
          />

          {/* Model layer */}
          <div className="rounded-2xl border border-border bg-card px-5 py-5">
            <div className="mb-3 flex items-baseline justify-between">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Model
              </span>
              <span className="text-xs text-muted-foreground">
                swap freely
              </span>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              {MODELS.map((m) => (
                <Chip key={m.label} label={m.label} active={m.active} />
              ))}
            </div>
          </div>
        </div>

        <p className="mx-auto mt-8 max-w-2xl text-balance text-lg font-medium text-foreground">
          One North Star: maximum founder leverage. Everything else is a
          swappable part.
        </p>
      </div>
    </section>
  );
}
