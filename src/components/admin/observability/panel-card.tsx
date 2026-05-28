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
    <article className="group/panel relative overflow-hidden rounded-none border border-emerald-500/20 bg-gradient-to-br from-emerald-500/5 via-background to-emerald-500/0 shadow-[0_8px_32px_rgba(16,185,129,0.08)] transition-all duration-300 hover:border-emerald-500/30 hover:shadow-[0_16px_48px_rgba(16,185,129,0.12)] hover:from-emerald-500/10 sm:rounded-xl">
      <div className="absolute inset-0 bg-gradient-to-br from-emerald-400/0 via-transparent to-emerald-500/0 opacity-0 transition-opacity duration-300 group-hover/panel:opacity-40 pointer-events-none" />
      <iframe
        title={title}
        src={iframeSrc}
        loading="lazy"
        className={`w-full border-0 bg-card relative z-10 ${iframeHeight}`}
      />
      {deepLink ? (
        <a
          href={deepLink}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={`Open ${title} in Grafana`}
          className="absolute right-3 top-3 z-20 inline-flex items-center justify-center rounded-lg border border-emerald-500/30 bg-gradient-to-br from-emerald-500/15 to-emerald-500/5 p-2 text-emerald-600 dark:text-emerald-400 opacity-0 shadow-md backdrop-blur-sm transition-all duration-200 hover:border-emerald-500/50 hover:from-emerald-500/25 hover:to-emerald-500/10 hover:text-emerald-500 dark:hover:text-emerald-300 group-hover/panel:opacity-100 focus:opacity-100"
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
    <article className="overflow-hidden rounded-none border border-emerald-500/10 bg-gradient-to-br from-emerald-500/3 via-background to-emerald-500/0 shadow-[0_8px_32px_rgba(16,185,129,0.04)] sm:rounded-xl">
      <div className={`relative w-full overflow-hidden bg-card ${iframeHeight}`}>
        <div className="absolute inset-0 animate-pulse bg-gradient-to-r from-transparent via-emerald-500/20 to-transparent" />
      </div>
    </article>
  );
}
