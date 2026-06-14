"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";

export function MeCancelSubscriptionButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    if (loading) return;
    const ok = window.confirm(
      "Cancel your MakeaCompany subscription? You'll keep access until the end of the current billing period.",
    );
    if (!ok) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/me/billing/cancel-subscription", {
        method: "POST",
        cache: "no-store",
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Could not cancel subscription");
        setLoading(false);
        return;
      }
      // router.refresh() is fire-and-forget — it kicks an RSC refetch but doesn't return a
      // promise we can await. Clear loading immediately so the spinner doesn't hang if the
      // backend's profile sync happens to lag behind. When the refresh lands and canCancel
      // flips to false, the parent unmounts this button entirely; until then the button
      // re-enables on "Cancel subscription" rather than stuck on "Canceling…".
      router.refresh();
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        aria-busy={loading}
        className="inline-flex h-10 items-center justify-center rounded-xl border border-border bg-background px-4 text-sm font-semibold text-foreground shadow-sm transition hover:bg-muted/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground/30 disabled:pointer-events-none disabled:opacity-65 dark:bg-zinc-950 dark:hover:bg-zinc-900"
      >
        {loading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 shrink-0 animate-spin" aria-hidden />
            Canceling…
          </>
        ) : (
          "Cancel subscription"
        )}
      </button>
      {error ? (
        <p className="max-w-[16rem] text-right text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
