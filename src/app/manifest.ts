import type { MetadataRoute } from "next";
import { siteDescription, siteName, siteUrl } from "@/lib/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: siteName,
    short_name: "makeacompany.ai",
    description: siteDescription,
    start_url: "/",
    display: "standalone",
    background_color: "#09090b",
    theme_color: "#09090b",
    icons: [
      {
        src: "/logo.png",
        sizes: "840x900",
        type: "image/png",
      },
    ],
    id: siteUrl,
  };
}
