/**
 * Animated hero graphic: one blue cube multiplying into six white cubes in a
 * 3/2/1 pyramid ("one becomes many"). Inline SVG so it sits directly on the
 * page with no card/border, condensed, and alive: the blue cube pulses, the
 * white cubes breathe in a staggered wave, the arrow throbs. Cubes stroke with
 * currentColor so they read on light and dark. Respects reduced-motion.
 * Replaces the static /incubator/hero.png (John, 2026-07-02).
 */

// Cube centers in the SVG viewBox (0 0 180 128). Local cube box is 24x24, so we
// translate each by (cx-12, cy-12) to place its center.
const WHITE_CUBES: { x: number; y: number; delay: string }[] = [
  { x: 92, y: 39, delay: "0s" },
  { x: 118, y: 39, delay: "0.5s" },
  { x: 144, y: 39, delay: "1s" },
  { x: 105, y: 64, delay: "0.25s" },
  { x: 131, y: 64, delay: "0.75s" },
  { x: 118, y: 89, delay: "0.5s" },
];

export function IncubatorHeroGraphic() {
  return (
    <div className="mx-auto mt-4 w-full max-w-md sm:mt-6">
      <svg
        viewBox="0 22 180 84"
        role="img"
        aria-label="One glowing cube multiplied into six, one operator multiplied into the output of a team"
        className="mac-hero-svg h-auto w-full text-foreground"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        <defs>
          <g id="mac-cube">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
            <path d="M3.29 7 12 12l8.71-5" />
            <path d="M12 22V12" />
          </g>
        </defs>

        {/* blue source cube */}
        <g transform="translate(14 52)">
          <g className="mac-blue" style={{ transformBox: "fill-box", transformOrigin: "center" }}>
            <use href="#mac-cube" stroke="#2563eb" />
          </g>
        </g>

        {/* arrow */}
        <g className="mac-arrow" stroke="currentColor">
          <path d="M42 64H64" />
          <path d="M58 59l6 5-6 5" />
        </g>

        {/* six white cubes */}
        {WHITE_CUBES.map((c, i) => (
          <g key={i} transform={`translate(${c.x - 12} ${c.y - 12})`}>
            <g
              className="mac-cube"
              style={{
                transformBox: "fill-box",
                transformOrigin: "center",
                animationDelay: c.delay,
              }}
            >
              <use href="#mac-cube" />
            </g>
          </g>
        ))}
      </svg>

      <style>{`
        @keyframes macBreathe {
          0%, 100% { opacity: 0.5; transform: translateY(0); }
          50% { opacity: 1; transform: translateY(-2px); }
        }
        @keyframes macPulse {
          0%, 100% { opacity: 0.92; filter: drop-shadow(0 0 2px rgba(37,99,235,0.45)); }
          50% { opacity: 1; filter: drop-shadow(0 0 8px rgba(37,99,235,0.85)); }
        }
        @keyframes macArrow {
          0%, 100% { opacity: 0.35; }
          50% { opacity: 0.9; }
        }
        .mac-hero-svg .mac-cube { animation: macBreathe 3.6s ease-in-out infinite; }
        .mac-hero-svg .mac-blue { animation: macPulse 2.8s ease-in-out infinite; }
        .mac-hero-svg .mac-arrow { animation: macArrow 2.8s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .mac-hero-svg .mac-cube,
          .mac-hero-svg .mac-blue,
          .mac-hero-svg .mac-arrow { animation: none; opacity: 1; }
        }
      `}</style>
    </div>
  );
}
