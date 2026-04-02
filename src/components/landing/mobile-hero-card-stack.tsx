"use client";

import Image from "next/image";
import clsx from "clsx";
import { useState } from "react";
import styles from "./mobile-hero-card-stack.module.css";

type Front = 0 | 1;

type MobileHeroCardStackProps = {
  /** Merged onto the outer wrapper; use for overlay layout (e.g. `max-w-none w-full`). */
  className?: string;
  /** Passed to both `Image` `sizes` for correct resolution in narrow vs wide layouts. */
  imageSizes?: string;
};

export function MobileHeroCardStack({
  className,
  imageSizes = "300px",
}: MobileHeroCardStackProps) {
  const [front, setFront] = useState<Front>(0);

  function bringToFront(next: Front) {
    if (next === front) return;
    setFront(next);
  }

  return (
    <div
      className={clsx(
        "mx-auto w-full max-w-[min(300px,92vw)] px-4 pb-6 pt-4",
        className,
      )}
    >
      <div className={styles.stage}>
        {/* #general card */}
        <button
          type="button"
          aria-label="Show #general channel screenshot"
          aria-pressed={front === 0}
          className={clsx(
            styles.cardButton,
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            front === 0 ? styles.front : styles.back,
          )}
          onClick={() => bringToFront(0)}
        >
          <Image
            src="/hero-mobile-chat.png"
            alt="BimRoss AI employees in Slack #general"
            fill
            sizes={imageSizes}
            className={styles.cardImage}
            priority
            draggable={false}
          />
        </button>

        {/* Thread card */}
        <button
          type="button"
          aria-label="Show thread screenshot"
          aria-pressed={front === 1}
          className={clsx(
            styles.cardButton,
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            front === 1 ? styles.front : styles.back,
          )}
          onClick={() => bringToFront(1)}
        >
          <Image
            src="/hero-mobile-thread.png"
            alt="Slack thread with Ross and replies"
            fill
            sizes={imageSizes}
            className={styles.cardImage}
            draggable={false}
          />
        </button>
      </div>
    </div>
  );
}
