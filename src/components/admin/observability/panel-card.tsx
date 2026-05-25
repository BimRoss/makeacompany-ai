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
    <article className="group/panel relative overflow-hidden rounded-none border border-border bg-background/60 shadow-sm transition-shadow hover:shadow-md sm:rounded-xl">
      <iframe
        title={title}
        src={iframeSrc}
        loading="lazy"
        className={`w-full border-0 bg-card ${iframeHeight}`}
      />
      {deepLink ? (
        <a
          href={deepLink}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={`Open ${title} in Grafana`}
          className="absolute right-2 top-2 inline-flex items-center justify-center rounded-md border border-border bg-background/80 p-1 text-muted-foreground opacity-0 shadow-sm backdrop-blur transition hover:text-foreground group-hover/panel:opacity-100 focus:opacity-100"
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      ) : null}
    </article>
  );
}

export function PanelSkeleton({ height = "sm" }: { height?: "sm" | "md" }) {
  const iframeHeight = height === "md" ? "h-56 md:h-60" : "h-48";
  return (
    <article className="overflow-hidden rounded-none border border-border bg-background/60 shadow-sm sm:rounded-xl">
      <div className={`relative w-full overflow-hidden bg-card ${iframeHeight}`}>
        <div className="absolute inset-0 animate-pulse bg-gradient-to-r from-transparent via-muted/40 to-transparent" />
      </div>
    </article>
  );
}
