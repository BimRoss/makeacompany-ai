import { ImageResponse } from "next/og";

export const alt = "$250K/yr vs $1,200/yr — the math on your next senior hire vs. running MaC.";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

export default async function CostOpenGraphImage() {
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
        {/* TOP ROW: wordmark (left) + url (right) */}
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
            /cost
          </div>
        </div>

        {/* Eyebrow */}
        <div
          style={{
            display: "flex",
            alignSelf: "center",
            marginTop: "26px",
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: "0.32em",
            color: "#737373",
            textTransform: "uppercase",
          }}
        >
          For leaders
        </div>

        {/* HEADLINE STACK */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
            marginTop: "14px",
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: 38,
              fontWeight: 600,
              color: "#0a0a0a",
              letterSpacing: "-0.02em",
            }}
          >
            Your next hire is
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              fontSize: 104,
              fontWeight: 800,
              letterSpacing: "-0.04em",
              color: "#0a0a0a",
              lineHeight: 1.0,
              marginTop: "4px",
            }}
          >
            $250,000
            <span
              style={{
                fontSize: 40,
                fontWeight: 600,
                color: "#737373",
                marginLeft: "4px",
              }}
            >
              /yr.
            </span>
          </div>

          <div
            style={{
              display: "flex",
              fontSize: 32,
              fontWeight: 500,
              color: "#737373",
              marginTop: "18px",
            }}
          >
            With us, it&apos;s
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              fontSize: 104,
              fontWeight: 800,
              letterSpacing: "-0.04em",
              color: "#3b82f6",
              lineHeight: 1.0,
              marginTop: "4px",
            }}
          >
            $1,200
            <span
              style={{
                fontSize: 40,
                fontWeight: 600,
                color: "#93c5fd",
                marginLeft: "4px",
              }}
            >
              /yr.
            </span>
          </div>
        </div>

        {/* CTA pill at bottom */}
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
              padding: "14px 30px",
              fontSize: 20,
              fontWeight: 700,
            }}
          >
            cost.makeacompany.ai →
          </div>
        </div>
      </div>
    ),
    {
      ...size,
    },
  );
}
