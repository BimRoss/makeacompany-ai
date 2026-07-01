import { ImageResponse } from "next/og";

export const alt =
  "makeacompany.ai the builders' incubator — Multiply yourself. Your best work, in a fraction of the time and cost.";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

export default async function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          padding: "48px 80px 52px",
          // Subtle blue glow instead of flat black so the card has depth.
          backgroundColor: "#000000",
          backgroundImage:
            "radial-gradient(1000px 620px at 50% 44%, rgba(59,130,246,0.18), rgba(0,0,0,0) 62%)",
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
            the builders&apos; incubator
          </div>
        </div>

        {/* CENTERED CONTENT BLOCK: fills the remaining height so there's no
            dead black space at the bottom. */}
        <div
          style={{
            display: "flex",
            flex: 1,
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: 15,
              fontWeight: 700,
              letterSpacing: "0.32em",
              color: "#3b82f6",
              textTransform: "uppercase",
            }}
          >
            By introduction only
          </div>

          <div
            style={{
              display: "flex",
              marginTop: "20px",
              fontSize: 84,
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
              marginTop: "20px",
              fontSize: 37,
              fontWeight: 500,
              color: "#cfcfcf",
            }}
          >
            Your best work, in a fraction of the time and cost.
          </div>

          {/* "One becomes many" cube motif — one blue cube (you) multiplying
              into a row of white cubes (the output of a team). Ties to the MaC
              logo and the hero graphic; renders crisp at unfurl size. */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              marginTop: "34px",
            }}
          >
            <div
              style={{
                display: "flex",
                width: "46px",
                height: "46px",
                borderRadius: "10px",
                background: "#3b82f6",
                boxShadow: "0 0 26px rgba(59,130,246,0.65)",
              }}
            />
            <div
              style={{
                display: "flex",
                margin: "0 20px",
                fontSize: 34,
                fontWeight: 700,
                color: "#6b7280",
              }}
            >
              →
            </div>
            <div style={{ display: "flex" }}>
              {[0, 1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    width: "42px",
                    height: "42px",
                    borderRadius: "9px",
                    marginLeft: i === 0 ? "0" : "12px",
                    background: "#ffffff",
                  }}
                />
              ))}
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              marginTop: "34px",
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
