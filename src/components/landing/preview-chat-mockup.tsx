import Image from "next/image";
import type { ReactNode } from "react";

// Slack-style hero mockup (matches John's reference). A relatable, non-technical
// exchange: an operator asks for real business work in plain language, the agent
// does it end to end and reports back. Channel header, avatar rows with real
// Ross + Grant photos, sender + APP tag + timestamp, an outcome card, a thread
// reply, and a live typing indicator at the bottom so it reads as active.

function Avatar({ variant }: { variant: "ross" | "grant" }) {
  const src = variant === "ross" ? "/headshots/ross.webp" : "/founders/grant.jpg";
  const alt = variant === "ross" ? "Ross" : "Grant";
  return (
    <span className="h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-neutral-100">
      <Image
        src={src}
        alt={alt}
        width={36}
        height={36}
        className="h-9 w-9 object-cover"
      />
    </span>
  );
}

function TypingDot({ delay }: { delay: string }) {
  return (
    <span
      className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-400"
      style={{ animationDelay: delay }}
    />
  );
}

function Row({
  variant,
  name,
  app,
  time,
  children,
}: {
  variant: "ross" | "grant";
  name: string;
  app?: boolean;
  time: string;
  children: ReactNode;
}) {
  return (
    <div className="flex gap-2.5">
      <Avatar variant={variant} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 leading-none">
          <span className="text-sm font-bold text-neutral-900">{name}</span>
          {app ? (
            <span className="rounded bg-neutral-200 px-1 py-px text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
              App
            </span>
          ) : null}
          <span className="text-xs text-neutral-400">{time}</span>
        </p>
        <div className="mt-1 text-sm leading-snug text-neutral-800">
          {children}
        </div>
      </div>
    </div>
  );
}

export function PreviewChatMockup() {
  return (
    <div className="relative mx-auto w-full max-w-md">
      <div className="overflow-hidden rounded-2xl border border-black/10 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-black/5 px-4 py-3">
          <p className="text-sm font-bold text-neutral-900"># ross-grant</p>
          <p className="text-xs text-neutral-400">makeacompany Slack</p>
        </div>

        <div className="flex flex-col gap-4 px-4 py-4">
          <Row variant="grant" name="Grant" time="9:41 AM">
            Can you pull our top 20 leads from last week and draft a warm intro
            to each?
          </Row>

          <Row variant="ross" name="Ross" app time="9:42 AM">
            On it. Personalizing each one to what they&apos;re working on now.
          </Row>

          <Row variant="ross" name="Ross" app time="9:43 AM">
            <div className="rounded-lg border border-neutral-200 p-3">
              <p className="text-sm font-semibold text-neutral-900">
                Outreach ready
              </p>
              <p className="mt-0.5 text-xs text-neutral-500">
                20 personalized intros · 5 flagged warmest · queued for 8:00 AM
              </p>
            </div>
            <div className="mt-1.5 flex gap-1.5">
              <span className="rounded-full border border-neutral-200 px-1.5 py-0.5 text-xs text-neutral-600">
                👍 3
              </span>
              <span className="rounded-full border border-neutral-200 px-1.5 py-0.5 text-xs text-neutral-600">
                🔥 2
              </span>
            </div>
          </Row>

          <Row variant="ross" name="Ross" app time="10:06 AM">
            <p className="flex items-start gap-1.5">
              <span className="text-green-600">✅</span>
              <span>
                Sent. First replies are landing. Want me to book the meetings?
              </span>
            </p>
            <p className="mt-1.5 text-xs font-medium text-[#3B82F6]">
              3 replies · View thread
            </p>
          </Row>

          <div className="flex items-center gap-2.5">
            <Avatar variant="grant" />
            <span className="flex items-center gap-1 rounded-2xl bg-neutral-100 px-3 py-2.5">
              <TypingDot delay="0ms" />
              <TypingDot delay="150ms" />
              <TypingDot delay="300ms" />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
