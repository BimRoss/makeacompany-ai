"use client";

import { UserRound } from "lucide-react";

export function SlackPersonChip({
  displayName,
  portraitUrl,
}: {
  displayName: string;
  portraitUrl?: string;
}) {
  const url = portraitUrl?.trim();
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full border border-border bg-muted/30 py-px pl-px pr-1.5">
      <span className="relative size-3 shrink-0 overflow-hidden rounded-full border border-border bg-muted">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" className="size-full object-cover" />
        ) : (
          <span className="flex size-full items-center justify-center text-muted-foreground" aria-hidden>
            <UserRound className="size-2" />
          </span>
        )}
      </span>
      <span className="truncate text-[10px] font-medium leading-none text-foreground">{displayName}</span>
    </span>
  );
}

export function SlackMetadataIdPill({ children, title }: { children: string; title?: string }) {
  return (
    <span
      className="inline-flex max-w-full shrink-0 items-center rounded-full border border-border bg-muted/50 px-2 py-0.5 font-mono text-[11px] font-medium tabular-nums leading-none text-muted-foreground"
      title={title}
    >
      <span className="truncate">{children}</span>
    </span>
  );
}
