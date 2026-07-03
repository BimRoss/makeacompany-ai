import Image from "next/image";
import type { ReactNode } from "react";

// Slack-style hero mockup (matches John's reference: a real makeacompany Slack
// thread). Channel header, avatar rows with sender + APP tag + timestamp, a
// GitHub PR unfurl, and a shipped-release line. This IS the product: an
// operator asks in Slack, the agent opens a PR, ships it, and reports back.

function Avatar({ variant }: { variant: "ross" | "grant" }) {
  if (variant === "ross") {
    return (
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-black">
        <Image
          src="/logo-navbar-white.png"
          alt=""
          width={20}
          height={20}
          className="h-5 w-5 object-contain"
        />
      </span>
    );
  }
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#3B82F6] text-sm font-semibold text-white">
      G
    </span>
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
          <Row variant="grant" name="Grant" time="9:47 AM">
            Ross, can we ship the activation funnel today? Tomorrow&apos;s sales
            briefing needs the install → OAuth → first-message → persona chart.
          </Row>

          <Row variant="ross" name="Ross" app time="9:48 AM">
            On it. Opening the PR now.
          </Row>

          <Row variant="ross" name="Ross" app time="9:49 AM">
            <div className="rounded-lg border border-neutral-200 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-medium text-neutral-500">
                  BimRoss/makeacompany-ai
                </span>
                <span className="shrink-0 text-xs font-semibold text-[#3B82F6]">
                  Pull request #512
                </span>
              </div>
              <p className="mt-1 text-sm font-semibold text-neutral-900">
                feat(admin): daily activation funnel
              </p>
              <p className="mt-0.5 text-xs text-neutral-500">
                install → OAuth → first message → persona, in one chart
              </p>
              <div className="mt-2 flex items-center gap-3 text-xs text-neutral-500">
                <span className="font-semibold text-green-600">+382</span>
                <span className="font-semibold text-red-500">−47</span>
                <span>14 files</span>
              </div>
            </div>
            <div className="mt-1.5 flex gap-1.5">
              <span className="rounded-full border border-neutral-200 px-1.5 py-0.5 text-xs text-neutral-600">
                👍 2
              </span>
              <span className="rounded-full border border-neutral-200 px-1.5 py-0.5 text-xs text-neutral-600">
                ⚡ 1
              </span>
            </div>
          </Row>

          <Row variant="ross" name="Ross" app time="10:18 AM">
            <p className="flex items-start gap-1.5">
              <span className="text-green-600">✅</span>
              <span>
                <span className="font-semibold">makeacompany-ai v0.315.0</span> is
                live. Activation funnel (#512) shipped.
              </span>
            </p>
            <p className="mt-1.5 text-xs font-medium text-[#3B82F6]">
              2 replies · View thread
            </p>
          </Row>
        </div>
      </div>
    </div>
  );
}
