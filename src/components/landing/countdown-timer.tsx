"use client";

import { useEffect, useState } from "react";

const LAUNCH_DATE = new Date("2026-05-01T12:00:00Z");

type TimeLeft = {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
};

function calculateTimeLeft(): TimeLeft {
  const diff = LAUNCH_DATE.getTime() - Date.now();
  if (diff <= 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0 };
  }
  return {
    days: Math.floor(diff / (1000 * 60 * 60 * 24)),
    hours: Math.floor((diff / (1000 * 60 * 60)) % 24),
    minutes: Math.floor((diff / (1000 * 60)) % 60),
    seconds: Math.floor((diff / 1000) % 60),
  };
}

export function CountdownTimer() {
  const [mounted, setMounted] = useState(false);
  const [timeLeft, setTimeLeft] = useState<TimeLeft>({
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0,
  });

  useEffect(() => {
    setMounted(true);
    setTimeLeft(calculateTimeLeft());
    const timer = setInterval(() => setTimeLeft(calculateTimeLeft()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!mounted) {
    return (
      <section className="bg-muted/30 py-16">
        <div className="mx-auto h-24 max-w-4xl px-8 sm:px-6" />
      </section>
    );
  }

  return (
    <section className="bg-muted/30 py-16">
      <div className="mx-auto max-w-4xl px-8 text-center sm:px-6">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-widest text-primary">
          Launching May 1st, 2026
        </h2>
        <p className="mb-8 text-lg text-muted-foreground">
          Lock in your free month before time runs out
        </p>
        <div className="flex items-center justify-center gap-3 sm:gap-6">
          <TimeBox value={timeLeft.days} label="Days" />
          <TimeBox value={timeLeft.hours} label="Hours" />
          <TimeBox value={timeLeft.minutes} label="Minutes" />
          <TimeBox value={timeLeft.seconds} label="Seconds" />
        </div>
      </div>
    </section>
  );
}

function TimeBox({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col items-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-border bg-card text-xl font-bold tabular-nums shadow-sm sm:h-24 sm:w-24 sm:text-4xl">
        {value.toString().padStart(2, "0")}
      </div>
      <span className="mt-2 text-xs font-medium uppercase tracking-wider text-muted-foreground sm:text-sm">
        {label}
      </span>
    </div>
  );
}
