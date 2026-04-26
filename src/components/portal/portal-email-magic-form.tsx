"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

type Props = {
  channelId: string;
};

export function PortalEmailMagicForm({ channelId }: Props) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<null | "sent" | "not_founder" | "legacy">(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError(null);
    setOutcome(null);
    try {
      const res = await fetch("/api/portal/auth/email/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ channelId, email: email.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; sent?: boolean; error?: string };
      if (res.status === 503 && typeof data.error === "string") {
        setError("Email sign-in is not configured for this site yet. Use Google or contact support.");
        setLoading(false);
        return;
      }
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Could not send sign-in email");
        setLoading(false);
        return;
      }
      setOutcome(
        data.sent === true ? "sent" : data.sent === false ? "not_founder" : "legacy",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    }
    setLoading(false);
  }

  return (
    <form onSubmit={onSubmit} className="flex w-full flex-col gap-3">
      <input
        type="email"
        name="email"
        autoComplete="email"
        aria-label="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@company.com"
        required
        className="w-full rounded-xl border border-border bg-background px-4 py-3 text-base text-foreground shadow-sm outline-none ring-0 transition focus:border-foreground/25 focus:ring-2 focus:ring-foreground/15"
      />
      <button
        type="submit"
        disabled={loading}
        aria-busy={loading}
        className="inline-flex h-12 w-full items-center justify-center rounded-xl border-2 border-foreground/15 bg-background px-8 text-base font-semibold text-foreground shadow-sm transition hover:border-foreground/25 hover:bg-muted/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground/30 disabled:pointer-events-none disabled:opacity-65 dark:border-white/20 dark:bg-zinc-950 dark:hover:bg-zinc-900"
      >
        {loading ? (
          <>
            <Loader2 className="mr-2 h-5 w-5 shrink-0 animate-spin" aria-hidden />
            Sending link…
          </>
        ) : (
          "Email me a sign-in link"
        )}
      </button>
      {outcome === "sent" ? (
        <p className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-center text-sm text-muted-foreground" role="status">
          Successfully sent email link
        </p>
      ) : null}
      {outcome === "not_founder" ? (
        <p className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-center text-sm text-muted-foreground" role="status">
          You are not a founder at this company
        </p>
      ) : null}
      {outcome === "legacy" ? (
        <p className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-center text-sm text-muted-foreground" role="status">
          If that address is registered as an owner for this company, we sent a sign-in link. Check your inbox (and
          spam).
        </p>
      ) : null}
      {error ? (
        <p className="rounded-lg border border-border bg-card px-4 py-3 text-center text-sm text-foreground" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
