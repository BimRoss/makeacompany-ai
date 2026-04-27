import type { MetadataRoute } from "next";
import { siteDescription, siteDomainLabel, siteUrl } from "@/lib/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: siteDomainLabel,
    short_name: siteDomainLabel,
    description: siteDescription,
    start_url: "/",
    display: "standalone",
    background_color: "#09090b",
    theme_color: "#09090b",
    icons: [
      {
        src: "/logo.png",
        sizes: "900x900",
        type: "image/png",
      },
    ],
    id: siteUrl,
  };
}
