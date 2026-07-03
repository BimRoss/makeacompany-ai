import { ImageResponse } from "next/og";

export const alt =
  "makeacompany.ai — Multiply yourself. Your best work, in a fraction of the time and cost.";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

// Boardy-clean unfurl card: mirrors the site hero. Warm background, a small
// black logo mark, one headline, one subline, one black pill. No kicker, no
// glyph row, no dark gradient — the simplest version that still reads as us.
export default async function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "flex-start",
          padding: "0 88px",
          backgroundColor: "#f5f4ef",
          color: "#0a0a0a",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
        }}
      >
        {/* Logo + wordmark */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            marginBottom: "34px",
          }}
        >
          <div
            style={{
              display: "flex",
              width: "60px",
              height: "60px",
              borderRadius: "16px",
              background: "#0a0a0a",
            }}
          />
          <div
            style={{
              display: "flex",
              marginLeft: "20px",
              fontSize: 30,
              fontWeight: 700,
              letterSpacing: "-0.02em",
            }}
          >
            makeacompany.ai
          </div>
        </div>

        {/* Headline */}
        <div
          style={{
            display: "flex",
            fontSize: 92,
            fontWeight: 800,
            letterSpacing: "-0.035em",
            lineHeight: 1.0,
          }}
        >
          Multiply yourself.
        </div>

        {/* Subline */}
        <div
          style={{
            display: "flex",
            marginTop: "22px",
            maxWidth: "860px",
            fontSize: 34,
            fontWeight: 500,
            color: "#52525b",
          }}
        >
          Your best work, in a fraction of the time and cost.
        </div>

        {/* CTA */}
        <div
          style={{
            display: "flex",
            marginTop: "40px",
            background: "#0a0a0a",
            color: "#ffffff",
            borderRadius: "9999px",
            padding: "16px 36px",
            fontSize: 24,
            fontWeight: 600,
          }}
        >
          Multiply with MaC →
        </div>
      </div>
    ),
    {
      ...size,
    },
  );
}
