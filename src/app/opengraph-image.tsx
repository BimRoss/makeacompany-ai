import { ImageResponse } from "next/og";
import { PERSONAS, PERSONA_LABELS, type Persona } from "@/lib/personas";

export const alt = "makeacompany.ai — The future of work, where it already happens.";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

export default function OpenGraphImage() {
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
        {/* TOP GROUP: wordmark + persona pill row */}
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
          </div>

          {/* 4-pill persona tab row (none active on the home image) */}
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
            {PERSONAS.map((p: Persona) => (
              <div
                key={p}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "9px 26px",
                  borderRadius: "9999px",
                  background: "transparent",
                  color: "#737373",
                  fontSize: 18,
                  fontWeight: 600,
                }}
              >
                {PERSONA_LABELS[p]}
              </div>
            ))}
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
            The future of work.
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
            Where it already happens.
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
            Start your company →
          </div>
        </div>
      </div>
    ),
    size,
  );
}
