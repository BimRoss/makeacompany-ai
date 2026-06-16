"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type CreateResponse = {
  agentId?: string;
  slackAppId?: string;
  installUrl?: string;
  error?: string;
};

export function MePersonalAgentCreationForm() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [longDescription, setLongDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installUrl, setInstallUrl] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/me/personal-agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: displayName.trim(),
          description: description.trim(),
          longDescription: longDescription.trim() || undefined,
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as CreateResponse;
      if (!res.ok || !payload.installUrl) {
        setError(payload.error || `Create failed (${res.status})`);
        setSubmitting(false);
        return;
      }
      setInstallUrl(payload.installUrl);
      // Stay on this card so the user can click the install link. The status
      // panel polls and replaces this card once they finish Slack OAuth.
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setSubmitting(false);
    }
  }

  if (installUrl) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Your Slack app has been created. Install it to your workspace to bring your agent online.
        </p>
        <a
          href={installUrl}
          className="inline-flex h-10 items-center justify-center rounded-xl bg-foreground px-5 text-sm font-semibold text-background shadow-sm transition hover:bg-foreground/90"
        >
          Install in Slack
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label htmlFor="agent-name" className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Agent name
        </label>
        <input
          id="agent-name"
          type="text"
          required
          maxLength={32}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Garth"
          className="block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm focus:border-foreground/30 focus:outline-none focus:ring-2 focus:ring-foreground/10"
        />
        <p className="mt-1 text-xs text-muted-foreground">Becomes the Slack app name + bot username.</p>
      </div>
      <div>
        <label htmlFor="agent-desc" className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Short description
        </label>
        <input
          id="agent-desc"
          type="text"
          required
          maxLength={140}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="My personal AI agent on Slack"
          className="block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm focus:border-foreground/30 focus:outline-none focus:ring-2 focus:ring-foreground/10"
        />
      </div>
      <div>
        <label htmlFor="agent-long" className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Long description <span className="text-muted-foreground/60">(optional)</span>
        </label>
        <textarea
          id="agent-long"
          rows={3}
          maxLength={500}
          value={longDescription}
          onChange={(e) => setLongDescription(e.target.value)}
          placeholder="A few sentences explaining what this agent does on your behalf."
          className="block w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground shadow-sm focus:border-foreground/30 focus:outline-none focus:ring-2 focus:ring-foreground/10"
        />
      </div>

      {/* Icon upload + Imagen-4-fast generate are deferred to a follow-up. */}

      {error ? (
        <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">{error}</p>
      ) : null}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={submitting || !displayName.trim() || !description.trim()}
          className="inline-flex h-10 items-center justify-center rounded-xl bg-foreground px-5 text-sm font-semibold text-background shadow-sm transition hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "Creating..." : "Create my agent"}
        </button>
      </div>
    </form>
  );
}
