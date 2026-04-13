"use client";

import { useMemo, useState } from "react";
import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { AdminShell } from "@/components/admin/admin-shell";

export function AdminLoginClient() {
  const searchParams = useSearchParams();
  const authState = useMemo(() => searchParams.get("auth")?.trim() || "", [searchParams]);
  const [checkingExistingSession, setCheckingExistingSession] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function checkExistingSession() {
      try {
        const response = await fetch("/api/admin/auth/me", { cache: "no-store" });
        const payload = (await response.json().catch(() => null)) as { authenticated?: boolean } | null;
        if (!cancelled && response.ok && payload?.authenticated) {
          window.location.href = "/admin";
          return;
        }
      } catch {
        // Ignore and allow normal sign-in UX.
      }
      if (!cancelled) {
        setCheckingExistingSession(false);
      }
    }
    void checkExistingSession();
    return () => {
      cancelled = true;
    };
  }, []);

  async function startStripeAuth() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/auth/start", { method: "POST" });
      const payload = (await response.json().catch(() => null)) as { url?: string; error?: string } | null;
      if (!response.ok || !payload?.url) {
        setError(payload?.error || "Unable to start Stripe sign-in.");
        setLoading(false);
        return;
      }
      window.location.href = payload.url;
    } catch {
      setError("Unable to start Stripe sign-in.");
      setLoading(false);
    }
  }

  return (
    <AdminShell>
      <section className="mx-auto max-w-xl space-y-4 rounded-2xl border border-border bg-card p-6 sm:p-8">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Admin sign in</h1>
        <p className="text-sm text-muted-foreground">
          Continue through Stripe to verify access, then we will return you to the admin portal.
        </p>
        {checkingExistingSession ? (
          <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
            Checking for an existing admin session...
          </p>
        ) : null}
        {authState === "failed" ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Stripe verification failed. Try again.
          </p>
        ) : null}
        {authState === "cancel" ? (
          <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
            Sign-in was canceled.
          </p>
        ) : null}
        {authState === "expired" ? (
          <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
            Your admin session expired. Sign in again to continue.
          </p>
        ) : null}
        {error ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Stripe can take a few seconds to confirm details before redirecting you back.
        </p>
        <button
          type="button"
          onClick={() => void startStripeAuth()}
          disabled={loading || checkingExistingSession}
          className="inline-flex h-11 items-center justify-center rounded-md bg-foreground px-5 text-sm font-semibold text-background hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Redirecting to Stripe..." : "Sign in with Stripe"}
        </button>
      </section>
    </AdminShell>
  );
}
