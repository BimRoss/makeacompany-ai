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
   * Generation context — passed to the generate endpoint. The picker only
   * generates when both are non-empty.
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
    if (!displayName.trim() || !description.trim()) {
      setError("Add a name and short description first — Imagen uses them as the prompt.");
      return;
    }
    setError(null);
    setGenerating(true);
    setCandidates([]);
    try {
      const res = await fetch("/api/me/personal-agents/icon-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName, description }),
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
        // Single candidate — auto-pick. Same UX as the original single-Generate flow.
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
        <div className="flex-1 space-y-2">
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
              disabled={disabled || generating}
              className="inline-flex h-9 items-center justify-center rounded-lg border border-foreground/30 bg-foreground px-3 text-xs font-semibold text-background transition hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {generating ? "Generating..." : "Generate with Imagen"}
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
          <p className="text-xs text-muted-foreground">
            Uploaded or generated once and pushed to Slack. You can change it later from the agent panel.
          </p>
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
