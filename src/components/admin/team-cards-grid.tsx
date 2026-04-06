"use client";

import { useEffect, useMemo, useState } from "react";
import { useTheme } from "next-themes";

import type { TeamMember } from "@/lib/admin/team";
import { TeamMemberCard, type TeamMemberMetricEmbed } from "@/components/admin/team-member-card";

type GrafanaEmbed = {
  key: string;
  panelId: string;
  title: string;
  dashboardUrl: string | null;
};

type HealthPayload = {
  grafanaEmbeds?: GrafanaEmbed[];
};

type TeamCardsGridProps = {
  members: TeamMember[];
};

const DEFAULT_AGENT_PANEL_COUNT = 3;

type PanelIntent = "requests" | "latency" | "goroutines" | "memory" | "inbound" | "outbound";

const lanePanelPreferences: Record<TeamMember["lane"], PanelIntent[]> = {
  automation: ["goroutines", "latency", "requests"],
  sales: ["inbound", "outbound", "requests"],
  strategy: ["latency", "requests", "memory"],
  operations: ["requests", "latency", "memory"],
  internship: ["inbound", "requests", "goroutines"],
  general: ["requests", "latency", "goroutines"],
};

function intentMatchesPanel(intent: PanelIntent, panelTitle: string): boolean {
  const title = panelTitle.toLowerCase();
  switch (intent) {
    case "requests":
      return /request|req\/|rpm|rps/.test(title);
    case "latency":
      return /latency|p95|duration|response time/.test(title);
    case "goroutines":
      return /goroutine/.test(title);
    case "memory":
      return /memory|rss|heap/.test(title);
    case "inbound":
      return /inbound|ingress|events\/min|events per min/.test(title);
    case "outbound":
      return /outbound|egress|posts\/min|posts per min/.test(title);
    default:
      return false;
  }
}

function pickPanelsForMember(member: TeamMember, embeds: GrafanaEmbed[]): GrafanaEmbed[] {
  if (embeds.length <= DEFAULT_AGENT_PANEL_COUNT) {
    return embeds;
  }

  const selected: GrafanaEmbed[] = [];
  const usedKeys = new Set<string>();
  const preferences = lanePanelPreferences[member.lane] ?? lanePanelPreferences.general;

  for (const intent of preferences) {
    const match = embeds.find((embed) => !usedKeys.has(embed.key) && intentMatchesPanel(intent, embed.title));
    if (!match) {
      continue;
    }
    selected.push(match);
    usedKeys.add(match.key);
    if (selected.length === DEFAULT_AGENT_PANEL_COUNT) {
      return selected;
    }
  }

  for (const embed of embeds) {
    if (usedKeys.has(embed.key)) {
      continue;
    }
    selected.push(embed);
    usedKeys.add(embed.key);
    if (selected.length === DEFAULT_AGENT_PANEL_COUNT) {
      break;
    }
  }

  return selected;
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
    url.searchParams.set("refresh", "30s");
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

export function TeamCardsGrid({ members }: TeamCardsGridProps) {
  const { resolvedTheme } = useTheme();
  const [healthPayload, setHealthPayload] = useState<HealthPayload | null>(null);

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
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {members.map((member) => {
        const selectedEmbeds = pickPanelsForMember(member, baseEmbeds);
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

        return <TeamMemberCard key={member.id} member={member} metricEmbeds={metricEmbeds} />;
      })}
    </div>
  );
}
