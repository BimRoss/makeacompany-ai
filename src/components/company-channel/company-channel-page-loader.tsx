import { Loader2 } from "lucide-react";

type CompanyChannelPageLoaderProps = {
  srLabel: string;
};

export function CompanyChannelPageLoader({ srLabel }: CompanyChannelPageLoaderProps) {
  return (
    <div
      className="flex min-h-0 flex-1 flex-col items-center justify-center py-12"
      aria-busy="true"
      aria-live="polite"
    >
      <Loader2
        className="size-20 animate-spin text-black/25 sm:size-24"
        strokeWidth={0.55}
        aria-hidden
      />
      <p className="sr-only">{srLabel}</p>
    </div>
  );
}
