import { ImageResponse } from "next/og";

export const alt =
  "makeacompany.ai private incubator — Multiply yourself. Your best work, in a fraction of the time.";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

export default async function IncubatorOpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          padding: "56px 80px 60px",
          background: "#000000",
          color: "#ffffff",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
        }}
      >
        {/* TOP ROW: wordmark (left) + label (right) */}
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
              color: "#ffffff",
            }}
          >
            makeacompany.ai
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 18,
              fontWeight: 600,
              color: "#8a8a8a",
            }}
          >
            private incubator
          </div>
        </div>

        {/* Eyebrow (the one blue accent) */}
        <div
          style={{
            display: "flex",
            alignSelf: "center",
            marginTop: "62px",
            fontSize: 15,
            fontWeight: 700,
            letterSpacing: "0.32em",
            color: "#3b82f6",
            textTransform: "uppercase",
          }}
        >
          By introduction only
        </div>

        {/* HEADLINE STACK */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
            marginTop: "20px",
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: 88,
              fontWeight: 800,
              color: "#ffffff",
              letterSpacing: "-0.03em",
              lineHeight: 1.0,
            }}
          >
            Multiply yourself.
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 38,
              fontWeight: 500,
              color: "#b5b5b5",
              marginTop: "22px",
            }}
          >
            Your best work, in a fraction of the time.
          </div>
        </div>

        {/* Single CTA pill at bottom */}
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
              background: "#ffffff",
              color: "#000000",
              borderRadius: "9999px",
              padding: "16px 34px",
              fontSize: 22,
              fontWeight: 700,
            }}
          >
            Multiply with MaC →
          </div>
        </div>
      </div>
    ),
    {
      ...size,
    },
  );
}
