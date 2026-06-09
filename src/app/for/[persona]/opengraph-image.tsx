import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";
import {
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

export function generateImageMetadata({
  params,
}: {
  params: { persona: string };
}) {
  const persona: Persona | undefined = PERSONA_BY_SLUG[params.persona];
  if (!persona) return [];
  return [
    {
      id: persona,
      alt: PERSONA_COPY[persona].heroLine1 + " " + PERSONA_COPY[persona].heroLine2,
      contentType,
      size,
    },
  ];
}

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

  const { heroLine1, heroLine2, subhead, ctaButtonLabel } = PERSONA_COPY[persona];
  const personaLabel = PERSONA_LABELS[persona];

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          padding: "56px 72px",
          background:
            "linear-gradient(180deg, #ffffff 0%, #f8fafc 60%, #eef2f7 100%)",
          color: "#0a0a0a",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
          position: "relative",
        }}
      >
        {/* faint blue glow behind hero */}
        <div
          style={{
            position: "absolute",
            top: "120px",
            left: "50%",
            transform: "translateX(-50%)",
            width: "700px",
            height: "300px",
            background: "radial-gradient(closest-side, #dbeafe, transparent)",
            opacity: 0.7,
            display: "flex",
          }}
        />

        {/* top row: wordmark + persona chip */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            zIndex: 1,
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: 28,
              fontWeight: 800,
              letterSpacing: "-0.02em",
              color: "#0a0a0a",
            }}
          >
            makeacompany
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              border: "1px solid #0a0a0a",
              borderRadius: "9999px",
              padding: "8px 18px",
              fontSize: 18,
              fontWeight: 600,
              color: "#0a0a0a",
            }}
          >
            For {personaLabel.toLowerCase()}s
          </div>
        </div>

        {/* scarcity pill */}
        <div
          style={{
            display: "flex",
            alignSelf: "center",
            alignItems: "center",
            marginTop: "40px",
            border: "1px solid #0a0a0a",
            borderRadius: "9999px",
            padding: "8px 18px",
            fontSize: 16,
            color: "#0a0a0a",
            background: "rgba(255,255,255,0.6)",
            zIndex: 1,
          }}
        >
          <span style={{ fontWeight: 600 }}>100 free-for-life seats, then a free week, then $99/mo.</span>
        </div>

        {/* hero headline */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
            marginTop: "36px",
            zIndex: 1,
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: 72,
              fontWeight: 800,
              letterSpacing: "-0.03em",
              lineHeight: 1.05,
              color: "#0a0a0a",
            }}
          >
            {heroLine1}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 72,
              fontWeight: 800,
              letterSpacing: "-0.03em",
              lineHeight: 1.05,
              color: "#0a0a0a",
              marginTop: "8px",
            }}
          >
            {heroLine2}
          </div>
        </div>

        {/* subhead */}
        <div
          style={{
            display: "flex",
            textAlign: "center",
            alignSelf: "center",
            marginTop: "24px",
            maxWidth: "920px",
            fontSize: 22,
            lineHeight: 1.4,
            color: "#374151",
            zIndex: 1,
          }}
        >
          {subhead}
        </div>

        {/* footer: CTA button + url */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: "auto",
            zIndex: 1,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              background: "#2563eb",
              color: "#ffffff",
              borderRadius: "9999px",
              padding: "14px 28px",
              fontSize: 20,
              fontWeight: 700,
            }}
          >
            {ctaButtonLabel} →
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 18,
              fontWeight: 600,
              color: "#0a0a0a",
              textDecoration: "underline",
              textUnderlineOffset: "4px",
            }}
          >
            makeacompany.ai/for/{slug}
          </div>
        </div>
      </div>
    ),
    {
      ...size,
    },
  );
}
