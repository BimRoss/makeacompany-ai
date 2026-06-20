"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

type ProvisionResult =
  | { ok: true; channel_id: string; channel_name: string; created: boolean }
  | { ok: false; error: string };

export function AdminProvisionChannelPanel() {
  const [email, setEmail] = useState("grant@bimross.com");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ProvisionResult | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    const trimmed = email.trim();
    if (!trimmed) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/provision-channel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ email: trimmed }),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<ProvisionResult> & {
        error?: string;
      };
      if (res.ok && data.ok && "channel_name" in data && data.channel_name) {
        setResult({
          ok: true,
          channel_id: data.channel_id ?? "",
          channel_name: data.channel_name,
          created: Boolean(data.created),
        });
      } else {
        setResult({
          ok: false,
          error: typeof data.error === "string" ? data.error : `HTTP ${res.status}`,
        });
      }
    } catch (err) {
      setResult({ ok: false, error: err instanceof Error ? err.message : "network error" });
    }
    setLoading(false);
  }

  return (
    <section
      className="space-y-3 rounded-2xl border border-border bg-card p-4"
      aria-labelledby="admin-provision-channel-heading"
    >
      <header className="space-y-1">
        <h2
          id="admin-provision-channel-heading"
          className="font-display text-lg font-semibold tracking-tight"
        >
          Provision -co channel
        </h2>
        <p className="text-sm text-muted-foreground">
          Fires Joanne&apos;s {`<slug>-co`} flow for an existing Slack member. Idempotent: re-runs
          land in the same channel and skip the kickoff post.
        </p>
      </header>
      <form onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          type="email"
          aria-label="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@bimross.com"
          required
          disabled={loading}
          className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-foreground/25 focus:ring-2 focus:ring-foreground/15"
        />
        <button
          type="submit"
          disabled={loading || !email.trim()}
          aria-busy={loading}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-foreground/15 bg-background px-4 text-sm font-semibold text-foreground transition hover:border-foreground/25 hover:bg-muted/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground/30 disabled:pointer-events-none disabled:opacity-65"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          {loading ? "Provisioning…" : "Provision channel"}
        </button>
      </form>
      {result ? (
        <div
          role="status"
          aria-live="polite"
          className={
            result.ok
              ? "rounded-lg border border-[var(--chart-pos)]/40 bg-[var(--chart-pos)]/10 px-3 py-2 text-xs text-[var(--chart-pos)]"
              : "rounded-lg border border-[var(--chart-neg)]/40 bg-[var(--chart-neg)]/10 px-3 py-2 text-xs text-[var(--chart-neg)]"
          }
        >
          {result.ok
            ? `${result.created ? "Created" : "Reused"} #${result.channel_name} (${result.channel_id})`
            : `Failed: ${result.error}`}
        </div>
      ) : null}
    </section>
  );
}
