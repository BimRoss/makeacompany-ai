"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, Sparkles } from "lucide-react";
import { apiBase } from "@/lib/site";

const INVITE_URL = "https://join.slack.com/t/bimrossllc/shared_invite/zt-3wux8vlv8-3OlZ8G4DGo0VNMiVpNoTPA";

type CheckoutStatusResponse = {
  registered?: boolean;
  paymentStatus?: string;
  email?: string;
  error?: string;
  waitlistFull?: boolean;
};

type Props = {
  sessionID: string;
};

export function SuccessOnboardingCard({ sessionID }: Props) {
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("Finalizing your workspace...");
  const [error, setError] = useState<string | null>(null);

  const normalizedSessionID = useMemo(() => sessionID.trim(), [sessionID]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!normalizedSessionID) {
        setLoading(false);
        setError("Missing checkout session. Please return to the homepage and try checkout again.");
        return;
      }
      try {
        const res = await fetch(
          `${apiBase()}/v1/billing/checkout-status?session_id=${encodeURIComponent(normalizedSessionID)}`,
          { method: "GET", cache: "no-store" },
        );
        const data = (await res.json()) as CheckoutStatusResponse;
        if (!res.ok) {
          throw new Error(data.error ?? "Unable to confirm checkout");
        }
        if (cancelled) {
          return;
        }
        if (data.registered) {
          setLoading(false);
          return;
        }
        if (data.waitlistFull) {
          setError("We could not save your signup because capacity filled. If you were charged, contact us for a refund.");
          setLoading(false);
          return;
        }
        setError("Checkout is still processing. Refresh this page in a few seconds.");
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unable to confirm checkout");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [normalizedSessionID]);

  return (
    <div className="mx-auto w-full max-w-xl rounded-2xl border border-border bg-card/80 p-6 text-center shadow-lg sm:p-8">
      <h1 className="text-balance text-3xl font-bold tracking-tight text-foreground sm:text-4xl">Welcome!</h1>
      <div className="mt-6">
        {loading ? (
          <p className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {message}
          </p>
        ) : error ? (
          <p className="rounded-lg border border-border bg-background px-4 py-3 text-sm text-muted-foreground">{error}</p>
        ) : (
          <div className="rounded-xl border border-border bg-background px-4 py-4 text-left shadow-sm">
            <div className="flex items-start gap-3">
              {/* Same asset as /employees (public/headshots/joanne.png). */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/headshots/joanne.png"
                alt="Joanne"
                className="h-10 w-10 shrink-0 rounded-full border border-border object-cover"
              />
              <div className="min-w-0">
                <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground">
                  Joanne
                  <Sparkles className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">I just emailed you an invite link...</span> or, you can
                  click below!
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      <a
        href={INVITE_URL}
        className="mt-6 inline-flex h-12 items-center justify-center rounded-lg bg-primary px-6 text-base font-semibold text-primary-foreground hover:opacity-95"
      >
        Join our Company
      </a>

      <div className="mt-4">
        <Link href="/" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          Back to homepage
        </Link>
      </div>
    </div>
  );
}
