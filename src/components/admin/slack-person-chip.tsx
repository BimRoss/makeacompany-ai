"use client";

import { UserRound } from "lucide-react";

const sizeClasses = {
  compact: {
    wrap: "gap-1 rounded-full py-px pl-px pr-1.5",
    avatar: "size-3",
    icon: "size-2",
    label: "text-[10px] font-medium leading-none",
  },
  comfortable: {
    wrap: "gap-2 rounded-full border-border/80 py-1 pl-1 pr-3 shadow-sm",
    avatar: "size-8 ring-1 ring-border/40",
    icon: "size-4",
    label: "text-xs font-medium leading-tight tracking-tight",
  },
} as const;

export function SlackPersonChip({
  displayName,
  portraitUrl,
  size = "compact",
}: {
  displayName: string;
  portraitUrl?: string;
  /** `comfortable`: larger avatar and type for prominent surfaces (e.g. workspace header). */
  size?: keyof typeof sizeClasses;
}) {
  const url = portraitUrl?.trim();
  const s = sizeClasses[size];
  return (
    <span
      className={[
        "inline-flex min-w-0 max-w-full items-center rounded-full border border-border bg-muted/30",
        s.wrap,
      ].join(" ")}
    >
      <span className={["relative shrink-0 overflow-hidden rounded-full border border-border bg-muted", s.avatar].join(" ")}>
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" className="size-full object-cover" />
        ) : (
          <span className="flex size-full items-center justify-center text-muted-foreground" aria-hidden>
            <UserRound className={s.icon} />
          </span>
        )}
      </span>
      <span className={["min-w-0 truncate text-foreground", s.label].join(" ")}>{displayName}</span>
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
