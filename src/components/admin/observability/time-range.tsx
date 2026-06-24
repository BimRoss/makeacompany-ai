"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export type TimeRangeKey = "1h" | "6h" | "24h" | "7d";

export const TIME_RANGE_OPTIONS: { key: TimeRangeKey; label: string; from: string }[] = [
  { key: "1h", label: "1h", from: "now-1h" },
  { key: "6h", label: "6h", from: "now-6h" },
  { key: "24h", label: "24h", from: "now-24h" },
  { key: "7d", label: "7d", from: "now-7d" },
];

const DEFAULT_RANGE: TimeRangeKey = "6h";

type TimeRangeContextValue = {
  range: TimeRangeKey;
  from: string;
  setRange: (next: TimeRangeKey) => void;
};

const TimeRangeContext = createContext<TimeRangeContextValue | null>(null);

function isTimeRangeKey(value: string | null): value is TimeRangeKey {
  return value === "1h" || value === "6h" || value === "24h" || value === "7d";
}

export function TimeRangeProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const initial = searchParams.get("range");
  const [range, setRangeState] = useState<TimeRangeKey>(
    isTimeRangeKey(initial) ? initial : DEFAULT_RANGE
  );

  useEffect(() => {
    const current = searchParams.get("range");
    if (isTimeRangeKey(current) && current !== range) {
      setRangeState(current);
    }
  }, [searchParams, range]);

  const setRange = useCallback(
    (next: TimeRangeKey) => {
      setRangeState(next);
      const params = new URLSearchParams(searchParams.toString());
      if (next === DEFAULT_RANGE) {
        params.delete("range");
      } else {
        params.set("range", next);
      }
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const value = useMemo<TimeRangeContextValue>(() => {
    const from = TIME_RANGE_OPTIONS.find((o) => o.key === range)?.from ?? "now-6h";
    return { range, from, setRange };
  }, [range, setRange]);

  return <TimeRangeContext.Provider value={value}>{children}</TimeRangeContext.Provider>;
}

export function useTimeRange(): TimeRangeContextValue {
  const ctx = useContext(TimeRangeContext);
  if (!ctx) {
    return { range: DEFAULT_RANGE, from: "now-6h", setRange: () => {} };
  }
  return ctx;
}

/**
 * Compact range selector that lives inline on a section header, not at the top
 * of the page. It binds to the shared TimeRangeProvider, so toggling it on one
 * Prometheus-backed section moves every other section that shows it too — the
 * control only appears next to panels it actually drives. Sections with their
 * own native window (GA4, Search, the scorecard) don't render it.
 */
export function TimeRangeChip() {
  const { range, setRange } = useTimeRange();
  return (
    <div
      role="radiogroup"
      aria-label="Time range"
      className="inline-flex items-center gap-1 rounded-lg border border-border bg-card p-0.5 text-xs"
    >
      {TIME_RANGE_OPTIONS.map((option) => {
        const active = range === option.key;
        return (
          <button
            key={option.key}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setRange(option.key)}
            className={`rounded-md px-2.5 py-1 transition ${
              active
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
