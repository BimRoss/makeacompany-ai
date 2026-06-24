"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, Loader2, Trash2, Youtube } from "lucide-react";

export type YtSource = {
  url: string;
  title: string;
  bullets: string[];
  ingestedAt: string;
};

type Stage = "idle" | "fetching" | "transcribing" | "harvesting" | "done" | "error";

const STAGE_LABEL: Record<Stage, string> = {
  idle: "",
  fetching: "Fetching video…",
  transcribing: "Transcript captured",
  harvesting: "Harvesting intelligence…",
  done: "Added",
  error: "Failed",
};

type Props = {
  /** Target agent for the ingest/remove calls (#651). Empty = single-agent back-compat. */
  agentId: string;
  sources: YtSource[];
  onSourcesChange: (next: YtSource[]) => void;
};

/**
 * Drops a YouTube URL into the personal agent's knowledge. The flow:
 *   1. POST /api/me/personal-agents/youtube/ingest with the URL.
 *   2. SSE events tick: fetching → transcribing → harvesting → done.
 *   3. On done, the parent's sources prop updates (via onSourcesChange).
 *   4. The previous input collapses into the list and a fresh empty input
 *      appears below, matching the "infinite ingest" UX Grant sketched.
 *
 * The harvested bullets live separately from the personality (#605/#608) —
 * the agent reaches them via a lazy-load skill (#607), not via system prompt.
 */
export function MePersonalAgentYouTubeIngest({ agentId, sources, onSourcesChange }: Props) {
  const [url, setUrl] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingDeleteUrl, setPendingDeleteUrl] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const toggleExpanded = useCallback((sourceUrl: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(sourceUrl)) next.delete(sourceUrl);
      else next.add(sourceUrl);
      return next;
    });
  }, []);

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = url.trim();
      if (!trimmed || stage === "fetching" || stage === "transcribing" || stage === "harvesting") {
        return;
      }
      setStage("fetching");
      setErrorMessage(null);

      try {
        const res = await fetch("/api/me/personal-agents/youtube/ingest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: trimmed, ...(agentId ? { agentId } : {}) }),
        });
        if (!res.ok || !res.body) {
          const text = await res.text().catch(() => "");
          setStage("error");
          setErrorMessage(text || `HTTP ${res.status}`);
          return;
        }
        // Hand-rolled SSE parser. EventSource would work too but doesn't
        // support POST bodies on most browsers, and the ingest needs the
        // URL in the body (don't want it leaking through GET query logs).
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let lastDoneEvent: { source?: YtSource; sources?: YtSource[] } | null = null;

        // eslint-disable-next-line no-constant-condition -- loop bound by reader.read() done.
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let sepIdx: number;
          // SSE frames are separated by blank lines (\n\n). Process whole
          // frames in order and leave any trailing partial in `buf`.
          while ((sepIdx = buf.indexOf("\n\n")) !== -1) {
            const frame = buf.slice(0, sepIdx);
            buf = buf.slice(sepIdx + 2);
            const eventLine = frame.split("\n").find((l) => l.startsWith("event:"));
            const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
            const event = eventLine?.slice("event:".length).trim() ?? "message";
            const dataRaw = dataLine?.slice("data:".length).trim() ?? "{}";
            let payload: Record<string, unknown> = {};
            try {
              payload = JSON.parse(dataRaw) as Record<string, unknown>;
            } catch {
              continue;
            }
            if (event === "stage") {
              const next = String(payload.stage ?? "");
              if (next === "fetching" || next === "transcribing" || next === "harvesting") {
                setStage(next);
              }
            } else if (event === "done") {
              lastDoneEvent = payload as { source?: YtSource; sources?: YtSource[] };
              setStage("done");
            } else if (event === "error") {
              setStage("error");
              setErrorMessage(String(payload.message ?? "ingest failed"));
            }
          }
        }

        if (lastDoneEvent?.sources) {
          onSourcesChange(lastDoneEvent.sources);
          setUrl(""); // Fresh input for the next URL.
          setToast("Added — your agent will reference this on its next reply.");
        }
      } catch (err) {
        setStage("error");
        setErrorMessage(err instanceof Error ? err.message : "ingest failed");
      }
    },
    [url, stage, onSourcesChange, agentId],
  );

  const deleteSource = useCallback(
    async (sourceUrl: string) => {
      setPendingDeleteUrl(sourceUrl);
      try {
        const res = await fetch("/api/me/personal-agents/youtube/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: sourceUrl, ...(agentId ? { agentId } : {}) }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          setErrorMessage(text || `delete failed (${res.status})`);
          return;
        }
        const payload = (await res.json()) as { sources?: YtSource[] };
        if (payload.sources) {
          onSourcesChange(payload.sources);
        }
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : "delete failed");
      } finally {
        setPendingDeleteUrl(null);
      }
    },
    [onSourcesChange, agentId],
  );

  const busy = stage === "fetching" || stage === "transcribing" || stage === "harvesting";

  return (
    <div className="space-y-3 border-t border-border/60 px-4 py-4 sm:px-5">
      <div className="flex items-center gap-2">
        <Youtube className="h-4 w-4 text-foreground/70" aria-hidden />
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Learn from a video
        </span>
      </div>

      {sources.length > 0 ? (
        <ul className="space-y-1.5">
          {sources.map((s) => {
            const isOpen = expanded.has(s.url);
            const insightLabel = `${s.bullets.length} ${s.bullets.length === 1 ? "insight" : "insights"}`;
            return (
              <li
                key={s.url}
                className="overflow-hidden rounded-lg border border-border bg-card"
              >
                <div className="flex items-center gap-3 px-3 py-2">
                  <button
                    type="button"
                    onClick={() => toggleExpanded(s.url)}
                    aria-expanded={isOpen}
                    aria-label={isOpen ? "Hide insights" : "Show insights"}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <ChevronDown
                      className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-150 ${isOpen ? "rotate-0" : "-rotate-90"}`}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span
                        className="block truncate text-sm font-medium text-foreground"
                        title={s.title || s.url}
                      >
                        {s.title || s.url}
                      </span>
                      <span className="text-[11px] text-muted-foreground">{insightLabel}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void deleteSource(s.url)}
                    disabled={pendingDeleteUrl === s.url}
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition hover:border-foreground/30 hover:text-foreground disabled:opacity-50"
                    aria-label={`Remove ${s.title || s.url}`}
                  >
                    {pendingDeleteUrl === s.url ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    )}
                  </button>
                </div>
                {s.bullets.length > 0 ? (
                  <div
                    className={`grid transition-[grid-template-rows] duration-300 ease-out ${
                      isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                    }`}
                  >
                    <ol
                      className={`space-y-1.5 overflow-hidden border-t border-border/60 bg-muted/20 px-4 pl-9 transition-[padding] duration-300 ease-out ${
                        isOpen ? "py-3" : "py-0"
                      }`}
                    >
                      {s.bullets.map((bullet, idx) => (
                        <li
                          key={idx}
                          className="flex gap-2.5 text-[13px] leading-relaxed text-foreground/90"
                        >
                          <span
                            className="mt-[2px] inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold tabular-nums text-muted-foreground"
                            aria-hidden
                          >
                            {idx + 1}
                          </span>
                          <span className="min-w-0 flex-1">{bullet}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="url"
          inputMode="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://youtube.com/watch?v=…"
          disabled={busy}
          className="h-11 min-h-11 flex-1 appearance-none rounded-lg border border-border bg-background px-3 text-base text-foreground placeholder:text-muted-foreground focus:border-foreground/40 focus:outline-none disabled:opacity-60 sm:h-10 sm:min-h-0 sm:text-sm"
        />
        <button
          type="submit"
          disabled={busy || !url.trim()}
          className="inline-flex h-11 min-h-11 appearance-none items-center justify-center gap-1.5 rounded-lg bg-foreground px-4 text-sm font-semibold text-background transition hover:bg-foreground/90 disabled:opacity-50 sm:h-10 sm:min-h-0"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
          <span>{busy ? STAGE_LABEL[stage] : "Add"}</span>
        </button>
      </form>

      {stage === "error" && errorMessage ? (
        <p className="text-xs text-rose-700 dark:text-rose-300">{errorMessage}</p>
      ) : null}

      {toast ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[70] flex justify-center px-4">
          <p
            role="status"
            className="pointer-events-auto rounded-full border border-foreground bg-background px-5 py-2 text-sm font-medium text-foreground shadow-lg"
          >
            {toast}
          </p>
        </div>
      ) : null}
    </div>
  );
}

