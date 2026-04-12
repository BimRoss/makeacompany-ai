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
};

type HealthPayload = {
  grafanaEmbeds?: GrafanaEmbed[];
};

type TeamMemberMetricEmbed = {
  key: string;
  title: string;
  url: string;
};

function selectCanonicalPanels(embeds: GrafanaEmbed[]): GrafanaEmbed[] {
  const byId = (id: string) => embeds.find((embed) => embed.panelId === id);
  const byTitle = (pattern: RegExp) =>
    embeds.find((embed) => pattern.test(embed.title.toLowerCase()));

  const goroutines =
    byTitle(/activities|go goroutines|goroutine/) ??
    byId("4");
  const requestsPerMinute =
    byTitle(/requests per minute|requests\s*\/min|requests\/min|request/) ??
    byId("1");
  const eventsCombined =
    byTitle(/events\s*\/min|combined events|events combined|events total/) ??
    byId("7") ??
    byTitle(/inbound events|outbound posts|events\/min|events per min/) ??
    byId("3") ??
    byId("6");

  const selected = [goroutines, requestsPerMinute, eventsCombined].filter(
    (panel): panel is GrafanaEmbed => Boolean(panel)
  );

  const deduped: GrafanaEmbed[] = [];
  const seen = new Set<string>();
  for (const panel of selected) {
    if (seen.has(panel.key)) {
      continue;
    }
    seen.add(panel.key);
    deduped.push(panel);
  }
  return deduped;
}

function asGrafanaEmbedUrl(
  value?: string | null,
  panelId: string = "1",
  grafanaTheme: "light" | "dark" = "light",
  agentName?: string,
  agentId?: string
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
    if (agentName) {
      url.searchParams.set("var-agent", agentName);
    }
    if (agentId) {
      url.searchParams.set("var-agent_id", agentId);
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
    const intervalID = setInterval(() => {
      void load();
    }, 15_000);

    return () => {
      cancelled = true;
      clearInterval(intervalID);
    };
  }, []);

  const baseEmbeds = useMemo(() => healthPayload?.grafanaEmbeds ?? [], [healthPayload?.grafanaEmbeds]);

  return (
    <div className="space-y-4">
      {members.map((member) => {
        const selectedEmbeds = selectCanonicalPanels(baseEmbeds);
        const metricEmbeds: TeamMemberMetricEmbed[] = selectedEmbeds
          .map((embed) => ({
            key: `${member.id}-${embed.key}`,
            title: embed.title,
            url: asGrafanaEmbedUrl(
              embed.dashboardUrl,
              embed.panelId,
              resolvedTheme === "dark" ? "dark" : "light",
              member.displayName,
              member.id
            ),
          }))
          .filter((embed): embed is TeamMemberMetricEmbed => Boolean(embed.url));

        return (
          <section key={member.id} className="rounded-2xl border border-border bg-card px-3 py-2 sm:px-4 sm:py-3">
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(340px,380px)_repeat(3,minmax(0,1fr))]">
              <TeamMemberCard
                member={member}
                skillsById={skillsById}
                className="h-full border-none bg-transparent p-2 shadow-none sm:p-3 md:hover:translate-y-0 md:hover:shadow-none"
              />
              {metricEmbeds.length > 0 ? (
                metricEmbeds.map((embed) => (
                  <div key={embed.key} className="motion-colors">
                    <iframe
                      title={`${member.displayName} - ${embed.title}`}
                      src={embed.url}
                      loading="lazy"
                      className="h-44 w-full rounded-md border-0 bg-transparent"
                    />
                  </div>
                ))
              ) : (
                <article className="rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground xl:col-span-3">
                  <p>No recent Slack metrics for {member.displayName} in the last hour.</p>
                  <p className="mt-1 text-xs">
                    These charts use `employee-factory` runtime counters (Slack events/posts), not Cursor or IDE activity.
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
