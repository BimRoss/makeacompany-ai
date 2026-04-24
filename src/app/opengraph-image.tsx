import { ImageResponse } from "next/og";
import { siteTagline, siteTaglineLine1, siteTaglineLine2 } from "@/lib/site";

export const alt = siteTagline;
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
          padding: "64px",
          background:
            "radial-gradient(circle at 10% 20%, #27272a 0%, #0a0a0a 45%, #09090b 100%)",
          color: "#fafafa",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            border: "1px solid rgba(255,255,255,0.22)",
            borderRadius: "9999px",
            padding: "10px 18px",
            fontSize: 26,
            letterSpacing: "-0.01em",
            color: "#d4d4d8",
          }}
        >
          makeacompany.ai
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: "86%" }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
              fontSize: 64,
              lineHeight: 1.04,
              fontWeight: 700,
              letterSpacing: "-0.03em",
            }}
          >
            <div>{siteTaglineLine1}</div>
            <div>{siteTaglineLine2}</div>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            width: "100%",
            fontSize: 28,
            color: "#a1a1aa",
          }}
        >
          <span>Join waitlist · $1 refundable</span>
          <span>BimRoss</span>
        </div>
      </div>
    ),
    size,
  );
}
