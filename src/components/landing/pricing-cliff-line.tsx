import { Sparkles } from "lucide-react";

export function PricingCliffLine() {
  return (
    <div className="relative inline-flex max-w-full items-center gap-2 overflow-hidden whitespace-nowrap rounded-full border border-foreground bg-background px-3 py-1.5 text-[11px] text-foreground sm:px-4 sm:py-2 sm:text-sm">
      <Sparkles className="relative h-3.5 w-3.5 text-foreground sm:h-4 sm:w-4" />
      <span className="relative">
        <span className="font-semibold">Free for a week.</span> No card required.
      </span>
    </div>
  );
}
