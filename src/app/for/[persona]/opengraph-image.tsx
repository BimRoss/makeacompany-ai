import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";
import {
  PERSONAS,
  PERSONA_BY_SLUG,
  PERSONA_COPY,
  PERSONA_LABELS,
  PERSONA_SLUGS,
  type Persona,
} from "@/lib/personas";

export const alt = "makeacompany.ai";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

// Per-persona `og:image:alt` is set in the page's generateMetadata via
// `openGraph.images: [{ url, alt }]`. We deliberately do NOT export
// `generateImageMetadata` here: in Next 15, returning `[{ id }]` makes the
// emitted `og:image` URL include `/<id>` while the route is still registered
// at `/opengraph-image` (no id) — the resulting URL 404s.

export function generateStaticParams() {
  return Object.values(PERSONA_SLUGS).map((slug) => ({ persona: slug }));
}

export default async function PersonaOpenGraphImage({
  params,
}: {
  params: Promise<{ persona: string }>;
}) {
  const { persona: slug } = await params;
  const persona: Persona | undefined = PERSONA_BY_SLUG[slug];
  if (!persona) notFound();

  const { heroLine1, heroLine2, ctaButtonLabel } = PERSONA_COPY[persona];

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "52px 80px 60px",
          background: "#ffffff",
          color: "#0a0a0a",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
        }}
      >
        {/* TOP GROUP: wordmark + slug + persona pill row */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div
              style={{
                display: "flex",
                fontSize: 26,
                fontWeight: 800,
                letterSpacing: "-0.02em",
                color: "#0a0a0a",
              }}
            >
              makeacompany.ai
            </div>
            <div
              style={{
                display: "flex",
                fontSize: 18,
                fontWeight: 600,
                color: "#737373",
              }}
            >
              /for/{slug}
            </div>
          </div>

          {/* 4-pill persona tab row (active = filled black) */}
          <div
            style={{
              display: "flex",
              alignSelf: "center",
              marginTop: "20px",
              border: "1px solid #e5e5e5",
              borderRadius: "9999px",
              padding: "5px",
              background: "#ffffff",
            }}
          >
            {PERSONAS.map((p: Persona) => {
              const active = p === persona;
              return (
                <div
                  key={p}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "9px 26px",
                    borderRadius: "9999px",
                    background: active ? "#0a0a0a" : "transparent",
                    color: active ? "#ffffff" : "#737373",
                    fontSize: 18,
                    fontWeight: 600,
                  }}
                >
                  {PERSONA_LABELS[p]}
                </div>
              );
            })}
          </div>
        </div>

        {/* HEADLINE — vertically centered between top group and CTA */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: 80,
              fontWeight: 800,
              letterSpacing: "-0.035em",
              lineHeight: 1.02,
              color: "#0a0a0a",
            }}
          >
            {heroLine1}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 80,
              fontWeight: 800,
              letterSpacing: "-0.035em",
              lineHeight: 1.02,
              color: "#0a0a0a",
              marginTop: "8px",
            }}
          >
            {heroLine2}
          </div>
        </div>

        {/* CTA — single black pill, centered at bottom */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              background: "#0a0a0a",
              color: "#ffffff",
              borderRadius: "9999px",
              padding: "16px 32px",
              fontSize: 22,
              fontWeight: 700,
            }}
          >
            {ctaButtonLabel} →
          </div>
        </div>
      </div>
    ),
    {
      ...size,
    },
  );
}
