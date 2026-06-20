"use client";

import { ArrowRight } from "lucide-react";

const SLACK_INVITE_URL =
  "https://join.slack.com/t/makeacompany/shared_invite/zt-3w432kf90-5B7IwfX2DNGfxLB1VGp6zA";

export function JoinSlackCta({ label = "Start your company" }: { label?: string } = {}) {
  return (
    <div className="mx-auto mb-3 flex w-full max-w-sm justify-center">
      <a
        href={SLACK_INVITE_URL}
        target="_blank"
        rel="noopener"
        className="waitlist-cta group inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 text-base font-semibold text-primary-foreground sm:h-12 sm:w-auto sm:px-10 sm:text-lg md:h-14"
      >
        <span className="inline-block w-4 shrink-0 sm:w-5" aria-hidden />
        {label}
        <ArrowRight className="waitlist-cta-arrow h-4 w-4 shrink-0 sm:h-5 sm:w-5" aria-hidden />
      </a>
    </div>
  );
}
