"use client";

import { useRef, useState } from "react";

export type IconPickerValue = {
  base64: string;
  mimeType: string;
};

type Props = {
  /** Current preview source: a data URL (data:image/...;base64,...) */
  previewDataUrl: string | null;
  /** Called with new value when user picks a file or generates. null = clear. */
  onChange: (v: IconPickerValue | null) => void;
  /** Disable buttons during submit. */
  disabled?: boolean;
  /**
   * Generation context — `displayName` and `description` are sent so the
   * backend can fall back to a derived prompt if the user leaves the prompt
   * box empty (which the UI blocks, but the backend tolerates).
   */
  displayName: string;
  description: string;
};

type Candidate = { base64: string; mimeType: string };

export function MePersonalAgentIconPicker({ previewDataUrl, onChange, disabled, displayName, description }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [prompt, setPrompt] = useState("");
  const promptReady = prompt.trim().length > 0;

  async function onFile(file: File) {
    setError(null);
    setCandidates([]);
    if (!file.type.startsWith("image/")) {
      setError("Please pick an image file (PNG, JPEG, WebP).");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError("Image must be under 2 MiB.");
      return;
    }
    const buf = await file.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
    onChange({ base64, mimeType: file.type });
  }

  async function onGenerate() {
    if (!promptReady) return;
    setError(null);
    setGenerating(true);
    setCandidates([]);
    try {
      const res = await fetch("/api/me/personal-agents/icon-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName,
          description,
          prompt: prompt.trim(),
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        candidates?: { imageBase64: string; mimeType: string }[];
        error?: string;
      };
      if (!res.ok || !payload.candidates || payload.candidates.length === 0) {
        setError(payload.error || `Generate failed (${res.status})`);
        return;
      }
      const list = payload.candidates.map((c) => ({ base64: c.imageBase64, mimeType: c.mimeType || "image/png" }));
      if (list.length === 1) {
        onChange(list[0]);
      } else {
        setCandidates(list);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setGenerating(false);
    }
  }

  function pickCandidate(c: Candidate) {
    onChange(c);
    setCandidates([]);
  }

  return (
    <div className="space-y-3">
      <label className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Icon <span className="text-muted-foreground/60">(optional)</span>
      </label>
      <div className="flex items-start gap-4">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-border bg-muted/40">
          {previewDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- data URL preview, no need for next/image optimization
            <img src={previewDataUrl} alt="Agent icon preview" className="h-full w-full object-cover" />
          ) : (
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">no icon</span>
          )}
        </div>
        <div className="flex-1 space-y-3">
          <div>
            <label
              htmlFor="agent-icon-prompt"
              className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
            >
              Imagen prompt
            </label>
            <textarea
              id="agent-icon-prompt"
              rows={2}
              maxLength={500}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="A friendly robot mascot, flat vector, soft pastel palette…"
              disabled={disabled || generating}
              className="block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm focus:border-foreground/30 focus:outline-none focus:ring-2 focus:ring-foreground/10 disabled:cursor-not-allowed disabled:opacity-60"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Describe the look you want. Generate is enabled once you&apos;ve typed something.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled || generating}
              className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-background px-3 text-xs font-semibold text-foreground transition hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Upload PNG
            </button>
            <button
              type="button"
              onClick={onGenerate}
              disabled={disabled || generating || !promptReady}
              className="inline-flex h-9 items-center justify-center rounded-lg border border-foreground/30 bg-foreground px-3 text-xs font-semibold text-background transition hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {generating ? "Generating..." : "Generate profile picture"}
            </button>
            {previewDataUrl ? (
              <button
                type="button"
                onClick={() => onChange(null)}
                disabled={disabled || generating}
                className="inline-flex h-9 items-center justify-center rounded-lg px-2 text-xs font-medium text-muted-foreground transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                Clear
              </button>
            ) : null}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onFile(file);
              e.target.value = "";
            }}
          />
        </div>
      </div>
      {candidates.length > 0 ? (
        <div>
          <p className="mb-2 text-xs text-muted-foreground">Pick one — click to use, or Generate again for fresh options.</p>
          <div className="grid grid-cols-4 gap-2">
            {candidates.map((c, i) => (
              <button
                key={i}
                type="button"
                onClick={() => pickCandidate(c)}
                className="group relative aspect-square overflow-hidden rounded-xl border border-border bg-muted/40 transition hover:border-foreground/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground/30"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`data:${c.mimeType};base64,${c.base64}`}
                  alt={`Candidate ${i + 1}`}
                  className="h-full w-full object-cover transition group-hover:scale-105"
                />
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {error ? (
        <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">{error}</p>
      ) : null}
    </div>
  );
}
