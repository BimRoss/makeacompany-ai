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
  className?: string;
};

export function TeamMemberCard({ member, className }: TeamMemberCardProps) {
  const [headshotFailed, setHeadshotFailed] = useState(false);
  const headshotUrl = headshotFailed ? getAdminHeadshotGeneratedUrl(member) : getAdminHeadshotUrl(member);
  const articleClassName = [
    "surface-card-motion group relative overflow-hidden rounded-2xl border border-border bg-card p-4 shadow-sm motion-colors sm:p-5 md:hover:-translate-y-1 md:hover:shadow-lg",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article className={articleClassName}>
      <div className="relative flex items-start justify-between gap-2.5">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-3">
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
          <p className="text-sm text-muted-foreground">{member.roleTitle}</p>
        </div>
        <TeamStatusBadge status={member.status} />
      </div>

      <div className="relative mt-3 space-y-2">
        <p className="line-clamp-3 text-sm leading-relaxed text-muted-foreground">{member.longDescription}</p>
      </div>
    </article>
  );
}
