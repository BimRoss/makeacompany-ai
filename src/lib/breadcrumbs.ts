import { siteUrl } from "@/lib/site";

export type BreadcrumbCrumb = {
  name: string;
  path: string;
};

/**
 * BreadcrumbList JSON-LD per schema.org. Pass crumbs in display order
 * (root first). Each crumb's `path` is appended to `siteUrl` to form an
 * absolute URL, matching Google's expectation for canonical breadcrumb items.
 */
export function breadcrumbStructuredData(crumbs: BreadcrumbCrumb[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((crumb, idx) => ({
      "@type": "ListItem",
      position: idx + 1,
      name: crumb.name,
      item: `${siteUrl}${crumb.path}`,
    })),
  };
}
