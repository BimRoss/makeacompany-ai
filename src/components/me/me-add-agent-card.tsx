"use client";

import { useState } from "react";

import { MePersonalAgentCreationForm } from "@/components/me/me-personal-agent-creation-form";

type CanCreateReason = "" | "max_reached" | "prior_not_installed" | "no_slack_user_id";

type Props = {
  canCreate: boolean;
  canCreateReason: CanCreateReason;
  /** True when the owner is at the per-user cap; suppress the card entirely. */
  atMax: boolean;
};

// The trailing "Add agent" tile in the Agents section (#651, PR 3/3). It is the
// ONLY entry point to the creation form — clicking it expands the form inline.
// State is driven by the /mine gate fields:
//   - canCreate            → enabled ghost card; click reveals the form.
//   - prior_not_installed  → disabled/greyed card + helper text.
//   - max_reached / atMax  → render nothing (header already reads N/N).
//   - no_slack_user_id     → handled upstream (no card; Slack-join messaging).
export function MeAddAgentCard({ canCreate, canCreateReason, atMax }: Props) {
  const [open, setOpen] = useState(false);

  // At the cap there is no add affordance at all.
  if (atMax || canCreateReason === "max_reached" || canCreateReason === "no_slack_user_id") {
    return null;
  }

  if (open && canCreate) {
    return (
      <section className="rounded-2xl bg-white p-4 shadow-[0_10px_40px_-12px_rgba(0,0,0,0.18)] ring-1 ring-black/[0.05] sm:p-5 dark:bg-zinc-950 dark:ring-white/[0.06]">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h3 className="text-base font-semibold tracking-tight text-foreground">New agent</h3>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="inline-flex h-8 items-center rounded-full px-3 text-xs font-medium text-muted-foreground transition hover:text-foreground"
          >
            Cancel
          </button>
        </div>
        {/* On a successful create the form calls router.refresh(), which
            re-fetches the envelope so the new card + updated canCreate render. */}
        <MePersonalAgentCreationForm />
      </section>
    );
  }

  const disabled = !canCreate;

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      disabled={disabled}
      aria-label="Add agent"
      className={`group flex w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition ${
        disabled
          ? "cursor-not-allowed border-border/60 bg-muted/20"
          : "border-border bg-white/40 hover:border-foreground/30 hover:bg-muted/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground/30 dark:bg-zinc-950/40 dark:hover:bg-zinc-900/40"
      }`}
    >
      <span
        aria-hidden
        className={`flex h-12 w-12 items-center justify-center rounded-full border-2 text-2xl font-light transition ${
          disabled
            ? "border-border/60 text-muted-foreground/50"
            : "border-border text-muted-foreground group-hover:border-foreground/40 group-hover:text-foreground"
        }`}
      >
        +
      </span>
      <span
        className={`text-sm font-medium ${
          disabled ? "text-muted-foreground/60" : "text-foreground"
        }`}
      >
        Add agent
      </span>
      {disabled && canCreateReason === "prior_not_installed" ? (
        <span className="max-w-xs text-xs text-muted-foreground">
          Finish installing your last agent before adding another.
        </span>
      ) : null}
    </button>
  );
}
