"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

export function TaoSlackSignalBadges() {
  const [activeBadge, setActiveBadge] = useState<"slack" | "tao" | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (wrapRef.current?.contains(target)) return;
      setActiveBadge(null);
    };

    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);

  return (
    <div
      ref={wrapRef}
      className="tao-slack-signal-wrap"
      aria-label="Bittensor and Slack signal badges"
      data-active={activeBadge ?? undefined}
    >
      <div className="tao-slack-signal-stack">
        <button
          type="button"
          className="tao-slack-signal-button tao-slack-signal-button--slack"
          aria-label="Select Slack badge"
          aria-pressed={activeBadge === "slack"}
          onClick={() => setActiveBadge("slack")}
        >
          <Image
            src="/tao-slack/slack-pilled.png"
            alt="Slack"
            width={1024}
            height={1024}
            className="tao-slack-signal-image"
            priority={false}
          />
        </button>
        <button
          type="button"
          className="tao-slack-signal-button tao-slack-signal-button--tao"
          aria-label="Select Bittensor TAO badge"
          aria-pressed={activeBadge === "tao"}
          onClick={() => setActiveBadge("tao")}
        >
          <Image
            src="/tao-slack/tao-pilled.png"
            alt="Bittensor TAO"
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
