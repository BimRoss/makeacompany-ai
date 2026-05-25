import { Sparkles } from "lucide-react";

const CLAIMED = 20;
const TOTAL = 100;

export function PricingCliffLine() {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-foreground bg-background px-3 py-1.5 text-xs text-foreground sm:px-4 sm:py-2 sm:text-sm">
      <Sparkles className="h-3.5 w-3.5 text-foreground sm:h-4 sm:w-4" />
      <span>
        <span className="font-semibold">{CLAIMED} of {TOTAL}</span> free seats claimed. Then $99/mo.
      </span>
    </div>
  );
}
