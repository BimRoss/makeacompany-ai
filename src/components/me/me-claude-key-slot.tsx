"use client";

import { useEffect, useState } from "react";

type KeyStatus = {
  hasKey: boolean;
  last4?: string;
  updatedAt?: string;
  configured?: boolean;
};

const inputClass =
  "h-9 w-full rounded-xl border-2 border-foreground/15 bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground/30 dark:border-white/20 dark:bg-zinc-950";

const buttonClass =
  "inline-flex h-9 items-center justify-center rounded-xl border-2 border-foreground/15 bg-background px-4 text-sm font-semibold text-foreground shadow-sm transition hover:border-foreground/25 hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/20 dark:bg-zinc-950 dark:hover:bg-zinc-900";

export function MeClaudeKeySlot() {
  const [status, setStatus] = useState<KeyStatus | null>(null);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/me/claude-key", { cache: "no-store" });
        const data = (await res.json()) as KeyStatus;
        if (!cancelled) setStatus(data);
      } catch {
        if (!cancelled) setStatus({ hasKey: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/me/claude-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: value.trim() }),
      });
      const data = (await res.json()) as KeyStatus & { error?: string };
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Could not save key");
        return;
      }
      setValue("");
      setEditing(false);
      setStatus(data);
    } catch {
      setError("Could not save key");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/me/claude-key", { method: "DELETE" });
      const data = (await res.json()) as KeyStatus & { error?: string };
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Could not remove key");
        return;
      }
      setStatus(data);
    } catch {
      setError("Could not remove key");
    } finally {
      setBusy(false);
    }
  }

  const showForm = editing || !status?.hasKey;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-foreground">Your Claude key</span>
        {status?.hasKey ? (
          <span className="text-xs text-muted-foreground">saved ····{status.last4}</span>
        ) : (
          <span className="text-xs text-muted-foreground">not set</span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Bring your own Claude key and your agents run on it instead of the shared pool. It is stored encrypted;
        we only ever show the last four characters.
      </p>

      {showForm ? (
        <div className="flex flex-col gap-2">
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-ant-…"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className={inputClass}
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={busy || value.trim() === ""}
              className={buttonClass}
            >
              {busy ? "Saving…" : "Save key"}
            </button>
            {status?.hasKey ? (
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setValue("");
                  setError(null);
                }}
                disabled={busy}
                className={buttonClass}
              >
                Cancel
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button type="button" onClick={() => setEditing(true)} disabled={busy} className={buttonClass}>
            Replace
          </button>
          <button type="button" onClick={remove} disabled={busy} className={buttonClass}>
            {busy ? "Removing…" : "Remove"}
          </button>
        </div>
      )}

      {status && status.configured === false ? (
        <p className="text-xs text-amber-600">Key storage isn’t configured on the server yet.</p>
      ) : null}
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

export default MeClaudeKeySlot;
