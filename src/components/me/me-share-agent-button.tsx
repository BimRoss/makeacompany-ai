"use client";

import { useCallback, useState } from "react";
import { Check, Share2 } from "lucide-react";

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to legacy path
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function isShareable(visibility?: string): boolean {
  return visibility === "unlisted" || visibility === "public";
}

type Props = {
  agentId: string;
  displayName: string;
  visibility?: string;
  /** Called after a successful private→unlisted flip so the parent can update. */
  onShared?: (visibility: string) => void;
  /**
   * Render as a bare full-width button (no section wrapper) so it can sit in a
   * 50/50 grid cell beside Edit. The confirm popover breaks out above the row
   * via absolute positioning — requires a `relative` ancestor on the row.
   */
  bare?: boolean;
};

// "Share my agent" (#657). Copies the public showcase link, or natively shares
// it. If the agent is still private, it asks to flip it to unlisted first so
// the link actually resolves — no silent 404 handed to a friend.
export function MeShareAgentButton({ agentId, displayName, visibility, onShared, bare }: Props) {
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const publicUrl =
    typeof window !== "undefined" ? `${window.location.origin}/a/${agentId}` : `/a/${agentId}`;

  const deliver = useCallback(async () => {
    const shareText = `I built ${displayName} on makeacompany. Here's what it knows: ${publicUrl}`;
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: displayName, text: shareText, url: publicUrl });
        setDone("Shared");
        return;
      } catch {
        // user cancelled or share unsupported — fall back to copy
      }
    }
    const ok = await copyToClipboard(publicUrl);
    setDone(ok ? "Link copied" : null);
    if (!ok) setError("Could not copy. Long-press the link to copy it.");
  }, [displayName, publicUrl]);

  const makeShareableThenDeliver = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/me/personal-agents/${encodeURIComponent(agentId)}/visibility`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ visibility: "unlisted" }),
      });
      if (!res.ok) {
        setError("Could not make your agent shareable. Try again.");
        return;
      }
      onShared?.("unlisted");
      setNeedsConfirm(false);
      await deliver();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }, [agentId, deliver, onShared]);

  const onClick = useCallback(() => {
    setDone(null);
    setError(null);
    if (isShareable(visibility)) {
      void deliver();
      return;
    }
    setNeedsConfirm(true);
  }, [visibility, deliver]);

  const confirmCard = (
    <div className="space-y-3 rounded-xl border border-border bg-muted/30 p-4">
      <p className="text-sm text-foreground">
        Make {displayName} shareable? This creates a public page at{" "}
        <span className="font-mono text-xs text-muted-foreground">/a/{agentId}</span>{" "}
        that anyone with the link can see. It won&apos;t be listed or indexed.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={makeShareableThenDeliver}
          disabled={busy}
          className="inline-flex h-10 items-center justify-center rounded-xl bg-foreground px-5 text-sm font-semibold text-background transition hover:bg-foreground/90 disabled:opacity-60"
        >
          {busy ? "Working…" : "Make shareable & copy link"}
        </button>
        <button
          type="button"
          onClick={() => setNeedsConfirm(false)}
          disabled={busy}
          className="inline-flex h-10 items-center justify-center rounded-xl border border-border px-5 text-sm font-medium text-foreground transition hover:bg-muted/40 disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </div>
  );

  // Bare mode: a full-width button matching the Edit button, for the 50/50
  // footer row. The confirm card pops out above the row at full footer width.
  if (bare) {
    return (
      <>
        {needsConfirm ? (
          <div className="absolute inset-x-4 bottom-full z-20 mb-2 rounded-xl bg-background shadow-lg ring-1 ring-black/[0.06] sm:inset-x-5 dark:bg-zinc-950 dark:ring-white/[0.08]">
            {confirmCard}
          </div>
        ) : null}
        <button
          type="button"
          onClick={onClick}
          className="inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-full border border-border bg-background px-3.5 text-sm font-medium text-foreground transition hover:border-foreground/30 hover:bg-muted/50 sm:h-9 sm:text-xs dark:bg-zinc-950 dark:hover:bg-zinc-900"
        >
          {done ? (
            <Check className="h-4 w-4 shrink-0" aria-hidden />
          ) : (
            <Share2 className="h-4 w-4 shrink-0" aria-hidden />
          )}
          {done ?? "Share"}
        </button>
        {error ? (
          <p
            className="absolute inset-x-4 top-full mt-1 text-xs text-rose-700 sm:inset-x-5 dark:text-rose-300"
            role="alert"
          >
            {error}
          </p>
        ) : null}
      </>
    );
  }

  return (
    <div className="space-y-2 border-t border-border/60 px-4 py-4 sm:px-5">
      {needsConfirm ? (
        confirmCard
      ) : (
        <button
          type="button"
          onClick={onClick}
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-border px-4 text-sm font-medium text-foreground transition hover:bg-muted/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground/30"
        >
          {done ? (
            <Check className="h-4 w-4 shrink-0" aria-hidden />
          ) : (
            <Share2 className="h-4 w-4 shrink-0" aria-hidden />
          )}
          {done ?? "Share my agent"}
        </button>
      )}
      {error ? (
        <p className="text-xs text-rose-700 dark:text-rose-300" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
