import { Sparkles } from "lucide-react";

const FALLBACK_CLAIMED = 20;
const FALLBACK_CAP = 100;

export type PricingCliffLineProps = {
  /** Live seats claimed from the backend; null/undefined falls back to the static constant. */
  claimed?: number | null;
  /** Seat cap; defaults to 100. */
  cap?: number | null;
};

export function PricingCliffLine({ claimed, cap }: PricingCliffLineProps = {}) {
  const shownClaimed = typeof claimed === "number" && claimed > 0 ? claimed : FALLBACK_CLAIMED;
  const shownCap = typeof cap === "number" && cap > 0 ? cap : FALLBACK_CAP;
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-foreground bg-background px-3 py-1.5 text-xs text-foreground sm:px-4 sm:py-2 sm:text-sm">
      <Sparkles className="h-3.5 w-3.5 text-foreground sm:h-4 sm:w-4" />
      <span>
        <span className="font-semibold">{shownClaimed} of {shownCap}</span> <span className="font-semibold">free for life</span> seats claimed. Then $99/mo to join.
      </span>
    </div>
  );
}
