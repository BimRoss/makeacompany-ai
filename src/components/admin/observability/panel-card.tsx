"use client";

import { ExternalLink } from "lucide-react";

type PanelCardProps = {
  title: string;
  iframeSrc: string;
  deepLink: string | null;
  height?: "sm" | "md";
};

export function PanelCard({ title, iframeSrc, deepLink, height = "sm" }: PanelCardProps) {
  const iframeHeight = height === "md" ? "h-56 md:h-60" : "h-48";
  return (
    <article className="group/panel overflow-hidden rounded-none border border-border bg-background/60 shadow-sm transition-shadow hover:shadow-md sm:rounded-xl">
      <header className="flex items-center justify-between gap-2 px-3 pb-1.5 pt-2">
        <h3 className="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
        {deepLink ? (
          <a
            href={deepLink}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={`Open ${title} in Grafana`}
            className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground opacity-0 transition hover:bg-muted hover:text-foreground group-hover/panel:opacity-100 focus:opacity-100"
          >
            <span>Grafana</span>
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        ) : null}
      </header>
      <iframe
        title={title}
        src={iframeSrc}
        loading="lazy"
        className={`w-full border-0 bg-card ${iframeHeight}`}
      />
    </article>
  );
}

export function PanelSkeleton({ height = "sm" }: { height?: "sm" | "md" }) {
  const iframeHeight = height === "md" ? "h-56 md:h-60" : "h-48";
  return (
    <article className="overflow-hidden rounded-none border border-border bg-background/60 shadow-sm sm:rounded-xl">
      <header className="flex items-center justify-between gap-2 px-3 pb-1.5 pt-2">
        <div className="h-3 w-32 animate-pulse rounded bg-muted" />
      </header>
      <div className={`relative w-full overflow-hidden bg-card ${iframeHeight}`}>
        <div className="absolute inset-0 animate-pulse bg-gradient-to-r from-transparent via-muted/40 to-transparent" />
      </div>
    </article>
  );
}
