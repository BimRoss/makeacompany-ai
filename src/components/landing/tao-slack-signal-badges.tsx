"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

interface Props {
  onHoverChange?: (agent: "joanne" | "ross" | null) => void;
  forcedActive?: "joanne" | "ross" | null;
}

export function TaoSlackSignalBadges({ onHoverChange, forcedActive }: Props) {
  const [activeBadge, setActiveBadge] = useState<"joanne" | "ross" | null>(null);
  const [hoveredBadge, setHoveredBadge] = useState<"joanne" | "ross" | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const effectiveActive = hoveredBadge ?? forcedActive ?? activeBadge;

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (wrapRef.current?.contains(target)) return;
      setActiveBadge(null);
      onHoverChange?.(null);
    };

    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [onHoverChange]);

  return (
    <div
      ref={wrapRef}
      className="tao-slack-signal-wrap"
      aria-label="Meet Joanne and Ross — your AI team in Slack"
      data-active={effectiveActive ?? undefined}
      onMouseLeave={() => {
        setHoveredBadge(null);
        onHoverChange?.(null);
      }}
    >
      <div className="tao-slack-signal-stack">
        <button
          type="button"
          className="tao-slack-signal-button tao-slack-signal-button--joanne"
          aria-label="Select Joanne, your AI Chief of Staff"
          aria-pressed={effectiveActive === "joanne"}
          onMouseEnter={() => {
            setHoveredBadge("joanne");
            onHoverChange?.("joanne");
          }}
          onClick={() => {
            setActiveBadge("joanne");
            onHoverChange?.("joanne");
          }}
        >
          <Image
            src="/headshots/joanne.png"
            alt="Joanne"
            width={1024}
            height={1024}
            className="tao-slack-signal-image"
            priority={false}
          />
        </button>
        <button
          type="button"
          className="tao-slack-signal-button tao-slack-signal-button--ross"
          aria-label="Select Ross, your AI Software Developer"
          aria-pressed={effectiveActive === "ross"}
          onMouseEnter={() => {
            setHoveredBadge("ross");
            onHoverChange?.("ross");
          }}
          onClick={() => {
            setActiveBadge("ross");
            onHoverChange?.("ross");
          }}
        >
          <Image
            src="/headshots/ross.png"
            alt="Ross"
            width={1024}
            height={1024}
            className="tao-slack-signal-image"
            priority={false}
          />
        </button>
      </div>
    </div>
  );
}
