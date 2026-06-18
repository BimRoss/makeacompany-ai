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
          padding: "52px 80px 60px",
          background: "#ffffff",
          color: "#0a0a0a",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
        }}
      >
        {/* TOP ROW: wordmark (left) */}
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

        {/* Scarcity pill — centered, single line */}
        <div
          style={{
            display: "flex",
            alignSelf: "center",
            alignItems: "center",
            marginTop: "32px",
            border: "1px solid #e5e5e5",
            borderRadius: "9999px",
            padding: "10px 22px",
            fontSize: 17,
            color: "#404040",
            background: "#ffffff",
          }}
        >
          <span style={{ fontWeight: 600, color: "#0a0a0a" }}>20 of 100</span>
          <span style={{ marginLeft: 6 }}>
            free for life seats claimed. After: first week free, then $99/mo.
          </span>
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

        {/* HEADLINE — tagline, big, bold, black */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
            marginTop: "44px",
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

        {/* CTA — single black pill, centered, pushed to bottom */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            marginTop: "auto",
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
