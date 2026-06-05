import type { MetadataRoute } from "next";
import { PERSONA_SLUGS } from "@/lib/personas";
import { siteUrl } from "@/lib/site";

// Pinned at module load (build time). Avoids the per-request `new Date()` pattern
// that made every route look "just updated" in Search Console on every recrawl.
const BUILD_TIME = new Date();

export default function sitemap(): MetadataRoute.Sitemap {
  const personaRoutes: MetadataRoute.Sitemap = Object.values(PERSONA_SLUGS).map((slug) => ({
    url: `${siteUrl}/for/${slug}`,
    lastModified: BUILD_TIME,
    changeFrequency: "weekly",
    priority: 0.8,
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
  ];
}
// llms.txt and llms-full.txt are intentionally NOT in the sitemap. They exist
// for LLM crawlers, not Google SERPs — plaintext has no title/meta/structure
// to rank, so Google bucketed them "Crawled – not indexed" and "URL unknown
// to Google" respectively, polluting the GSC indexation report for URLs we
// actually want ranked. They're still served from the public root and
// referenced from .well-known for LLM agents.
