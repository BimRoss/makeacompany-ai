"use client";

import { useEffect, useMemo, useState } from "react";
import { useTheme } from "next-themes";

import type { AdminSkill, TeamMember } from "@/lib/admin/catalog";
import { TeamMemberCard } from "@/components/admin/team-member-card";

type TeamCardsGridProps = {
  members: TeamMember[];
  skills: AdminSkill[];
};

type GrafanaEmbed = {
  key: string;
  panelId: string;
  title: string;
  dashboardUrl: string | null;
  source?: "twitter" | "app";
};

type HealthPayload = {
  grafanaEmbeds?: GrafanaEmbed[];
  adminGrafanaEmbeds?: GrafanaEmbed[];
  /** Per-agent Grafana dashboard (MakeACompany “agents”); uses `var-employee` on the dashboard. */
  agentsGrafanaEmbeds?: GrafanaEmbed[];
};

type TeamMemberMetricEmbed = {
  key: string;
  title: string;
  url: string;
};

/** Panel 1 from the “agents” dashboard: selected agent’s goroutines (panel 2 is squad-wide; not repeated per card). */
function selectAgentMetricPanels(embeds: GrafanaEmbed[]): GrafanaEmbed[] {
  const byId = (id: string) => embeds.find((embed) => embed.panelId === id);
  return ["1"].map((id) => byId(id)).filter((panel): panel is GrafanaEmbed => Boolean(panel));
}

function asGrafanaEmbedUrl(
  value?: string | null,
  panelId: string = "1",
  grafanaTheme: "light" | "dark" = "light",
  employeeId?: string
): string | null {
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value);
    if (url.pathname.startsWith("/grafana/d/")) {
      url.pathname = url.pathname.replace(/^\/grafana\/d\//, "/grafana/d-solo/");
    } else if (url.pathname.startsWith("/d/")) {
      url.pathname = url.pathname.replace(/^\/d\//, "/d-solo/");
    }
    url.searchParams.set("orgId", url.searchParams.get("orgId") ?? "1");
    url.searchParams.set("theme", grafanaTheme);
    url.searchParams.set("from", "now-1h");
    url.searchParams.set("to", "now");
    url.searchParams.set("refresh", "2m");
    url.searchParams.set("panelId", panelId);
    url.searchParams.set("kiosk", "1");
    if (employeeId) {
      url.searchParams.set("var-employee", employeeId);
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function TeamCardsGrid({ members, skills }: TeamCardsGridProps) {
  const { resolvedTheme } = useTheme();
  const [healthPayload, setHealthPayload] = useState<HealthPayload | null>(null);
  const skillsById = useMemo(() => new Map(skills.map((skill) => [skill.id, skill])), [skills]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch("/api/admin/health", { cache: "no-store" });
        const payload = (await response.json()) as HealthPayload;
        if (!cancelled) {
          setHealthPayload(payload);
        }
      } catch {
        if (!cancelled) {
          setHealthPayload({ grafanaEmbeds: [] });
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  // Employee cards: dedicated “agents” dashboard (per-employee template var), not the mixed /admin overview.
  const allEmbeds = useMemo(
    () => [...(healthPayload?.agentsGrafanaEmbeds ?? healthPayload?.adminGrafanaEmbeds ?? [])],
    [healthPayload?.adminGrafanaEmbeds, healthPayload?.agentsGrafanaEmbeds]
  );

  return (
    <div className="space-y-4">
      {members.map((member) => {
        const selectedEmbeds = selectAgentMetricPanels(allEmbeds);
        const metricEmbeds: TeamMemberMetricEmbed[] = selectedEmbeds
          .map((embed) => ({
            key: `${member.id}-${embed.key}`,
            title: embed.title,
            url: asGrafanaEmbedUrl(
              embed.dashboardUrl,
              embed.panelId,
              resolvedTheme === "dark" ? "dark" : "light",
              member.id
            ),
          }))
          .filter((embed): embed is TeamMemberMetricEmbed => Boolean(embed.url));

        return (
          <section key={member.id} className="rounded-2xl border border-border bg-card p-3 sm:p-4">
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(340px,380px)_minmax(0,1fr)]">
              <TeamMemberCard
                member={member}
                skillsById={skillsById}
                className="h-full border-none bg-transparent p-2 shadow-none sm:p-3 md:hover:translate-y-0 md:hover:shadow-none"
              />
              {metricEmbeds.length > 0 ? (
                metricEmbeds.map((embed) => (
                  <article
                    key={embed.key}
                    className="overflow-hidden rounded-xl border border-border/70 bg-background/50 p-1 motion-colors"
                  >
                    <iframe
                      title={`${member.displayName} — ${embed.title}`}
                      src={embed.url}
                      loading="lazy"
                      className="h-44 w-full rounded-md border-0 bg-transparent"
                    />
                  </article>
                ))
              ) : (
                <article className="rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground xl:col-span-1">
                  <p>No Grafana activities chart for {member.displayName}.</p>
                  <p className="mt-1 text-xs">
                    Configure <code className="text-xs">HEALTH_GRAFANA_AGENTS_*</code> so panel 1 (per-agent goroutines) can load.
                  </p>
                </article>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
