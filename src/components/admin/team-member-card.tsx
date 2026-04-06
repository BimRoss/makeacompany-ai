"use client";

import { useState } from "react";

import type { TeamMember } from "@/lib/admin/team";
import {
  getAdminHeadshotFallback,
  getAdminHeadshotGeneratedUrl,
  getAdminHeadshotUrl,
} from "@/lib/admin/headshots";
import { TeamStatusBadge } from "@/components/admin/team-status-badge";

type TeamMemberCardProps = {
  member: TeamMember;
  metricEmbeds?: TeamMemberMetricEmbed[];
};

export type TeamMemberMetricEmbed = {
  key: string;
  title: string;
  url: string;
};

function laneLabel(lane: TeamMember["lane"]): string {
  switch (lane) {
    case "automation":
      return "Automation";
    case "sales":
      return "Sales";
    case "strategy":
      return "Strategy";
    case "operations":
      return "Operations";
    case "internship":
      return "Internship";
    default:
      return "General";
  }
}

export function TeamMemberCard({ member, metricEmbeds = [] }: TeamMemberCardProps) {
  const [headshotFailed, setHeadshotFailed] = useState(false);
  const headshotUrl = headshotFailed ? getAdminHeadshotGeneratedUrl(member) : getAdminHeadshotUrl(member);

  return (
    <article className="surface-card-motion group relative overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-sm motion-colors sm:p-6 md:hover:-translate-y-1 md:hover:shadow-lg">
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {laneLabel(member.lane)}
          </p>
          <div className="mt-1 flex items-center gap-3 pl-1">
            <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full border border-border bg-muted">
              {/* Using a native img avoids next/image remote-host checks in local dev. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={headshotUrl}
                alt={`${member.displayName} headshot`}
                className="h-full w-full object-cover"
                onError={() => setHeadshotFailed(true)}
              />
              <span className="sr-only">{getAdminHeadshotFallback(member)}</span>
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-xl font-semibold tracking-tight text-foreground">
                {member.displayName}
              </h2>
              <p className="truncate text-sm text-muted-foreground">@{member.botDisplayName}</p>
            </div>
          </div>
          <p className="pl-1 text-sm text-muted-foreground">{member.roleTitle}</p>
        </div>
        <TeamStatusBadge status={member.status} />
      </div>

      <div className="relative mt-4 space-y-2">
        <p className="line-clamp-3 text-sm leading-relaxed text-muted-foreground">{member.longDescription}</p>
      </div>

      {metricEmbeds.length > 0 ? (
        <div className="relative mt-4 space-y-2 border-t border-border/80 pt-3">
          {metricEmbeds.map((embed) => (
            <section key={embed.key} className="space-y-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {embed.title}
              </p>
              <iframe
                title={`${member.displayName} - ${embed.title}`}
                src={embed.url}
                loading="lazy"
                className="h-36 w-full rounded-lg border border-border bg-card"
              />
            </section>
          ))}
        </div>
      ) : null}
    </article>
  );
}
