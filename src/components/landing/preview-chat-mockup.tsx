"use client";

import Image from "next/image";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

// Slack-style hero mockup. A relatable, non-technical exchange where a TEAM of
// agents (Ross + Joanne) handles the work, not one. Real Ross/Grant/Joanne
// photos. The thread reveals one message at a time on a loop with a typing
// indicator, so it reads as a live conversation. SSR renders the full thread
// (matches first client render, no hydration mismatch); the reveal loop kicks
// in on mount and is disabled under prefers-reduced-motion.

type Sender = "ross" | "grant" | "joanne";

const AVATAR: Record<Sender, { src: string; alt: string }> = {
  ross: { src: "/headshots/ross.webp", alt: "Ross" },
  joanne: { src: "/headshots/joanne.webp", alt: "Joanne" },
  grant: { src: "/founders/grant.jpg", alt: "Grant" },
};

function Avatar({ who }: { who: Sender }) {
  const { src, alt } = AVATAR[who];
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

type Message = {
  from: Sender;
  name: string;
  app?: boolean;
  time: string;
  body: ReactNode;
};

const THREAD: Message[] = [
  {
    from: "grant",
    name: "Grant",
    time: "9:41 AM",
    body: (
      <>Can you pull our top 20 leads from last week and draft a warm intro to each?</>
    ),
  },
  {
    from: "ross",
    name: "Ross",
    app: true,
    time: "9:42 AM",
    body: <>On it. Personalizing each one to what they&apos;re working on now.</>,
  },
  {
    from: "ross",
    name: "Ross",
    app: true,
    time: "9:43 AM",
    body: (
      <>
        <div className="rounded-lg border border-neutral-200 p-3">
          <p className="text-sm font-semibold text-neutral-900">Outreach ready</p>
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
      </>
    ),
  },
  {
    from: "joanne",
    name: "Joanne",
    app: true,
    time: "9:44 AM",
    body: <>I&apos;ll book the meetings as replies land and prep each follow-up.</>,
  },
  {
    from: "ross",
    name: "Ross",
    app: true,
    time: "10:06 AM",
    body: (
      <>
        <p className="flex items-start gap-1.5">
          <span className="text-green-600">✅</span>
          <span>Sent. First replies are landing. 3 meetings booked so far.</span>
        </p>
        <p className="mt-1.5 text-xs font-medium text-[#3B82F6]">
          6 replies · View thread
        </p>
      </>
    ),
  },
];

function TypingRow({ who }: { who: Sender }) {
  return (
    <div className="flex items-center gap-2.5">
      <Avatar who={who} />
      <span className="flex items-center gap-1 rounded-2xl bg-neutral-100 px-3 py-2.5">
        <TypingDot delay="0ms" />
        <TypingDot delay="150ms" />
        <TypingDot delay="300ms" />
      </span>
    </div>
  );
}

function Row({ message }: { message: Message }) {
  return (
    <div className="preview-msg-in flex gap-2.5">
      <Avatar who={message.from} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 leading-none">
          <span className="text-sm font-bold text-neutral-900">{message.name}</span>
          {message.app ? (
            <span className="rounded bg-neutral-200 px-1 py-px text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
              App
            </span>
          ) : null}
          <span className="text-xs text-neutral-400">{message.time}</span>
        </p>
        <div className="mt-1 text-sm leading-snug text-neutral-800">
          {message.body}
        </div>
      </div>
    </div>
  );
}

export function PreviewChatMockup() {
  const total = THREAD.length;
  // SSR + first client render: full thread visible (no hydration mismatch).
  const [step, setStep] = useState(total);

  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }
    const HOLD = 4; // ticks to hold the full thread before replaying
    let c = total; // start from fully shown
    const id = window.setInterval(() => {
      c = c > total + HOLD ? 0 : c + 1;
      setStep(Math.min(c, total));
    }, 1000);
    return () => window.clearInterval(id);
  }, [total]);

  const typingWho: Sender = step < total ? THREAD[step].from : "grant";

  return (
    <div className="relative mx-auto w-full max-w-md">
      <div className="overflow-hidden rounded-2xl border border-black/10 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-black/5 px-4 py-3">
          <p className="text-sm font-bold text-neutral-900"># ross-grant</p>
          <p className="text-xs text-neutral-400">makeacompany Slack</p>
        </div>

        {/* Fixed panel height: an invisible full-thread skeleton (all messages
            + one typing row) reserves the height, and the animated copy is
            overlaid on top with position:absolute so it can never resize the
            panel or shift the page as messages reveal. Height stays constant at
            every breakpoint because the skeleton, not a hardcoded px value,
            sets it. */}
        <div className="relative">
          <div
            className="invisible flex flex-col gap-4 px-4 py-4"
            aria-hidden="true"
          >
            {THREAD.map((message, i) => (
              <Row key={i} message={message} />
            ))}
            <TypingRow who="grant" />
          </div>

          <div className="absolute inset-0 flex flex-col gap-4 px-4 py-4">
            {THREAD.slice(0, step).map((message, i) => (
              <Row key={i} message={message} />
            ))}
            {step < total ? <TypingRow who={typingWho} /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
