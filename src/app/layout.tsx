import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { DM_Sans, Syne } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { WorkspaceNavbarTrailProvider } from "@/components/workspace-navbar-trail-provider";
import {
  siteDescription,
  siteName,
  siteSocialDescription,
  siteTagline,
  siteTitle,
  siteUrl,
} from "@/lib/site";

const dmSans = DM_Sans({
  variable: "--font-dm-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const syne = Syne({
  variable: "--font-syne",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});

// Rendered as <meta name="x-build-version"> below so the deploy-watcher
// single-probe kind can confirm a tagged version is actually serving without
// standing up a /api/version endpoint. Threaded from CI as a build arg.
const buildVersion = process.env.NEXT_PUBLIC_BUILD_VERSION ?? "dev";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: siteTitle, template: `%s · makeacompany.ai` },
  description: siteDescription,
  manifest: "/manifest.webmanifest",
  alternates: {
    canonical: "/",
  },
  robots: {
    index: true,
    follow: true,
  },
  category: "technology",
  other: {
    "x-build-version": buildVersion,
  },
  verification: {
    ...(process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION
      ? { google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION }
      : {}),
    ...(process.env.NEXT_PUBLIC_BING_SITE_VERIFICATION
      ? { other: { "msvalidate.01": process.env.NEXT_PUBLIC_BING_SITE_VERIFICATION } }
      : {}),
  },
  openGraph: {
    title: siteTitle,
    description: siteSocialDescription,
    url: siteUrl,
    siteName: "makeacompany.ai",
    locale: "en_US",
    type: "website",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: `${siteTagline} — ${siteSocialDescription}`,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: siteTitle,
    description: siteSocialDescription,
    images: ["/twitter-image"],
  },
};

// Tints mobile browser chrome on first paint. Colors mirror the --background
// CSS vars in globals.css so the chrome blends with the page edge in both modes.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const gaMeasurementID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
  const shouldLoadGA = process.env.NODE_ENV === "production" && Boolean(gaMeasurementID);
  const linkedInPartnerID = process.env.NEXT_PUBLIC_LINKEDIN_PARTNER_ID;
  const shouldLoadLinkedIn = process.env.NODE_ENV === "production" && Boolean(linkedInPartnerID);
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        name: "MakeaCompany",
        url: siteUrl,
        logo: `${siteUrl}/logo.png`,
      },
      {
        "@type": "WebSite",
        name: siteName,
        url: siteUrl,
        description: siteDescription,
        publisher: {
          "@type": "Organization",
          name: "MakeaCompany",
          url: siteUrl,
        },
      },
      {
        "@type": "SoftwareApplication",
        name: "makeacompany.ai",
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web, Slack",
        description: siteDescription,
        url: siteUrl,
        offers: {
          "@type": "Offer",
          price: "99",
          priceCurrency: "USD",
          priceSpecification: {
            "@type": "UnitPriceSpecification",
            price: "99",
            priceCurrency: "USD",
            billingIncrement: 1,
            unitCode: "MON",
          },
        },
        publisher: {
          "@type": "Organization",
          name: "MakeaCompany",
          url: siteUrl,
        },
      },
    ],
  };

  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${dmSans.variable} ${syne.variable} min-h-dvh antialiased`}
        suppressHydrationWarning
      >
        {/*
         * JSON-LD must be in the SSR HTML so first-crawl Googlebot sees it.
         * `next/script` with `afterInteractive` injects post-hydration and is
         * routinely missed by initial indexing — render it as a plain inline
         * <script> instead.
         */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
        <ThemeProvider>
          <WorkspaceNavbarTrailProvider>{children}</WorkspaceNavbarTrailProvider>
        </ThemeProvider>
        {shouldLoadGA ? (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${gaMeasurementID}`}
              strategy="afterInteractive"
            />
            <Script id="google-analytics" strategy="afterInteractive">
              {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${gaMeasurementID}');

// Synthetic health event: one non-interaction ping per browser session.
try {
  var gaHealthKey = 'ga_health_ping_sent';
  if (!sessionStorage.getItem(gaHealthKey)) {
    var gaDebug = window.location.search.indexOf('ga_debug=1') !== -1;
    gtag('event', 'ga_health_ping', {
      event_category: 'observability',
      event_label: 'frontend_boot',
      non_interaction: true,
      debug_mode: gaDebug
    });
    sessionStorage.setItem(gaHealthKey, '1');
  }
} catch (err) {
  // Ignore storage restrictions in private/locked-down browser contexts.
}`}
            </Script>
          </>
        ) : null}
        {shouldLoadLinkedIn ? (
          <>
            <Script id="linkedin-insight-partner-id" strategy="afterInteractive">
              {`_linkedin_partner_id = "${linkedInPartnerID}";
window._linkedin_data_partner_ids = window._linkedin_data_partner_ids || [];
window._linkedin_data_partner_ids.push(_linkedin_partner_id);`}
            </Script>
            <Script id="linkedin-insight-loader" strategy="afterInteractive">
              {`(function(l) {
if (!l){window.lintrk = function(a,b){window.lintrk.q.push([a,b])};
window.lintrk.q=[]}
var s = document.getElementsByTagName("script")[0];
var b = document.createElement("script");
b.type = "text/javascript";b.async = true;
b.src = "https://snap.licdn.com/li.lms-analytics/insight.min.js";
s.parentNode.insertBefore(b, s);})(window.lintrk);`}
            </Script>
            <noscript>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                height="1"
                width="1"
                style={{ display: "none" }}
                alt=""
                src={`https://px.ads.linkedin.com/collect/?pid=${linkedInPartnerID}&fmt=gif`}
              />
            </noscript>
          </>
        ) : null}
      </body>
    </html>
  );
}
