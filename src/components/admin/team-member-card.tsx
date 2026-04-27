"use client";

import Link from "next/link";
import { useState } from "react";
import clsx from "clsx";

import type { AdminSkill, TeamMember } from "@/lib/admin/catalog";
import {
  getAdminHeadshotFallback,
  getAdminHeadshotGeneratedUrl,
  getAdminHeadshotUrl,
} from "@/lib/admin/headshots";
import { TeamStatusBadge } from "@/components/admin/team-status-badge";

type TeamMemberCardProps = {
  member: TeamMember;
  skillsById: Map<string, AdminSkill>;
  className?: string;
  /** When true, do not resolve `/headshots/{id}.png`; use generated initials only (e.g. public /employees). */
  skipLocalPortraits?: boolean;
  /** Flat profile block inside a parent card (e.g. /employees grid); no outer border, radius, or shadow. */
  embedded?: boolean;
};

export function TeamMemberCard({
  member,
  skillsById,
  className,
  skipLocalPortraits,
  embedded = false,
}: TeamMemberCardProps) {
  const [headshotFailed, setHeadshotFailed] = useState(false);
  const headshotUrl = headshotFailed
    ? getAdminHeadshotGeneratedUrl(member)
    : getAdminHeadshotUrl(member, skipLocalPortraits ? { skipLocalPortraits: true } : undefined);
  const mappedSkills = member.skillIds
    .map((skillId) => skillsById.get(skillId))
    .filter((skill): skill is AdminSkill => Boolean(skill));
  const articleClassName = clsx(
    "employees-card-motion group relative overflow-hidden motion-colors",
    embedded
      ? "rounded-none border-0 bg-transparent p-0 shadow-none md:cursor-default md:hover:translate-y-0 md:hover:shadow-none"
      : "rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-5 md:cursor-pointer md:hover:shadow-lg",
    className
  );

  return (
    <article className={articleClassName}>
      <div className="relative flex items-start justify-between gap-2.5">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-3">
            <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-full border border-border bg-muted">
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
              <p className="truncate text-sm text-muted-foreground">{member.roleTitle}</p>
            </div>
          </div>
        </div>
        <TeamStatusBadge status={member.status} />
      </div>

      <div className="relative mt-3 space-y-2">
        <p className="line-clamp-3 text-sm leading-relaxed text-muted-foreground">{member.longDescription}</p>
        {mappedSkills.length > 0 ? (
          <div className="pt-1">
            <ul className="flex flex-wrap gap-1.5">
              {mappedSkills.map((skill) => (
                <li key={`${member.id}-${skill.id}`}>
                  <Link
                    href="/skills"
                    className="inline-flex rounded-full border border-foreground/20 bg-foreground px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-background motion-all ease-in-out hover:scale-[1.03] hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/25 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    {skill.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </article>
  );
}
