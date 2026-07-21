import type { MetadataRoute } from "next";
import { resolveBackendBaseURL } from "@/lib/resolve-backend-base-url";
import { PERSONA_SLUGS } from "@/lib/personas";
import { siteUrl } from "@/lib/site";

// Revalidate every hour so newly-public agents appear without a full redeploy.
export const revalidate = 3600;

// Pinned at module load (build time). Avoids the per-request `new Date()` pattern
// that made every route look "just updated" in Search Console on every recrawl.
const BUILD_TIME = new Date();

type SitemapAgent = { id: string; createdAt?: string };

async function fetchPublicAgentIds(): Promise<SitemapAgent[]> {
  try {
    const url = `${resolveBackendBaseURL().replace(/\/$/, "")}/v1/personal-agents/sitemap`;
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(3000) });
    if (!res.ok) return [];
    const body = (await res.json()) as { agents?: SitemapAgent[] };
    return Array.isArray(body.agents) ? body.agents : [];
  } catch {
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const personaRoutes: MetadataRoute.Sitemap = Object.values(PERSONA_SLUGS).map((slug) => ({
    url: `${siteUrl}/for/${slug}`,
    lastModified: BUILD_TIME,
    changeFrequency: "weekly" as const,
    priority: 0.8,
  }));

  const publicAgents = await fetchPublicAgentIds();
  const agentRoutes: MetadataRoute.Sitemap = publicAgents.map((a) => ({
    url: `${siteUrl}/a/${a.id}`,
    lastModified: a.createdAt ? new Date(a.createdAt) : BUILD_TIME,
    changeFrequency: "monthly" as const,
    priority: 0.5,
  }));

  return [
    {
      url: siteUrl,
      lastModified: BUILD_TIME,
      changeFrequency: "weekly",
      priority: 1,
    },
    ...personaRoutes,
    {
      url: `${siteUrl}/faq`,
      lastModified: BUILD_TIME,
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: `${siteUrl}/cost`,
      lastModified: BUILD_TIME,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${siteUrl}/claude-in-slack`,
      lastModified: BUILD_TIME,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${siteUrl}/architecture`,
      lastModified: BUILD_TIME,
      changeFrequency: "monthly",
      priority: 0.7,
    },
    ...agentRoutes,
  ];
}
// llms.txt and llms-full.txt are intentionally NOT in the sitemap. They exist
// for LLM crawlers, not Google SERPs — plaintext has no title/meta/structure
// to rank, so Google bucketed them "Crawled – not indexed" and "URL unknown
// to Google" respectively, polluting the GSC indexation report for URLs we
// actually want ranked. They're still served from the public root and
// referenced from .well-known for LLM agents.
