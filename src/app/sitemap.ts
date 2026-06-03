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
      url: `${siteUrl}/privacy`,
      lastModified: BUILD_TIME,
      changeFrequency: "yearly",
      priority: 0.4,
    },
    {
      url: `${siteUrl}/terms`,
      lastModified: BUILD_TIME,
      changeFrequency: "yearly",
      priority: 0.4,
    },
    {
      url: `${siteUrl}/llms.txt`,
      lastModified: BUILD_TIME,
      changeFrequency: "monthly",
      priority: 0.2,
    },
    {
      url: `${siteUrl}/llms-full.txt`,
      lastModified: BUILD_TIME,
      changeFrequency: "monthly",
      priority: 0.2,
    },
  ];
}
