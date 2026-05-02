"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

import { SlackPersonChip } from "@/components/admin/slack-person-chip";
import { useAdminFlashToast } from "@/components/admin/admin-flash-toast";

type PortalBilling = {
  hasManageableSubscription: boolean;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd?: number;
};

function formatPeriodEnd(ts: number | undefined): string | null {
  if (ts == null || ts <= 0) {
    return null;
  }
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(new Date(ts * 1000));
  } catch {
    return null;
  }
}

type Props = {
  channelId: string;
  displayName: string;
  portraitUrl?: string;
};

/**
 * Portal-only: header chip opens account profile + billing (cancel auto-renew).
 */
export function PortalWorkspaceProfileNavButton({ channelId, displayName, portraitUrl }: Props) {
  const want = channelId.trim();
  const name = displayName.trim();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const flash = useAdminFlashToast();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [meLoading, setMeLoading] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [billing, setBilling] = useState<PortalBilling | null>(null);
  const [meError, setMeError] = useState<string | null>(null);

  const [billingStep, setBillingStep] = useState<"profile" | "cancel_confirm">("profile");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const refreshMe = useCallback(async () => {
    if (!want) {
      return;
    }
    setMeLoading(true);
    setMeError(null);
    try {
      const res = await fetch("/api/portal/auth/me", { method: "GET", cache: "no-store" });
      if (!res.ok) {
        setEmail(null);
        setBilling(null);
        setMeError("Could not load account.");
        return;
      }
      const body = (await res.json()) as {
        authenticated?: boolean;
        email?: string;
        channelId?: string;
        billing?: Partial<PortalBilling>;
      };
      const cid = (body.channelId ?? "").trim();
      if (body.authenticated !== true || cid !== want) {
        setEmail(null);
        setBilling(null);
        setMeError("Session does not match this workspace.");
        return;
      }
      setEmail((body.email ?? "").trim() || null);
      const b = body.billing;
      setBilling({
        hasManageableSubscription: Boolean(b?.hasManageableSubscription),
        cancelAtPeriodEnd: Boolean(b?.cancelAtPeriodEnd),
        currentPeriodEnd: typeof b?.currentPeriodEnd === "number" ? b.currentPeriodEnd : undefined,
      });
    } catch {
      setMeError("Network error.");
      setEmail(null);
      setBilling(null);
    } finally {
      setMeLoading(false);
    }
  }, [want]);

  useEffect(() => {
    if (!dialogOpen) {
      return;
    }
    void refreshMe();
  }, [dialogOpen, refreshMe]);

  const closeDialog = () => {
    dialogRef.current?.close();
  };

  const openDialog = () => {
    setBillingStep("profile");
    setSubmitError(null);
    setMeError(null);
    setDialogOpen(true);
    dialogRef.current?.showModal();
  };

  const confirmCancel = useCallback(async () => {
    setSubmitError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/portal/billing/cancel-subscription", {
        method: "POST",
        cache: "no-store",
      });
      const payload = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        cancelAtPeriodEnd?: boolean;
        currentPeriodEnd?: number;
      } | null;
      if (!res.ok || !payload?.ok) {
        const msg = (payload?.error ?? "").trim() || `Request failed (${res.status})`;
        setSubmitError(msg);
        return;
      }
      setBilling((prev) =>
        prev
          ? {
              ...prev,
              hasManageableSubscription: false,
              cancelAtPeriodEnd: Boolean(payload.cancelAtPeriodEnd),
              currentPeriodEnd:
                typeof payload.currentPeriodEnd === "number" && payload.currentPeriodEnd > 0
                  ? payload.currentPeriodEnd
                  : prev.currentPeriodEnd,
            }
          : prev,
      );
      setBillingStep("profile");
      flash("success", "Auto-renew is off. You keep access through the end of this billing period.");
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }, [flash]);

  if (!name) {
    return null;
  }

  const periodLabel = formatPeriodEnd(billing?.currentPeriodEnd);

  return (
    <>
      <button
        type="button"
        className="inline-flex min-h-11 min-w-0 items-center justify-end rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/25 focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-colors hover:opacity-90"
        aria-label="Open account profile"
        aria-haspopup="dialog"
        aria-expanded={dialogOpen}
        onClick={openDialog}
      >
        <span className="min-w-0 shrink">
          <SlackPersonChip displayName={name} portraitUrl={portraitUrl} size="nav" />
        </span>
      </button>

      <dialog
        ref={dialogRef}
        className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-card p-0 text-foreground shadow-xl backdrop:bg-black/50 [&::backdrop]:bg-black/50"
        onClose={() => {
          setDialogOpen(false);
          setBillingStep("profile");
          setSubmitError(null);
        }}
      >
        <div className="relative max-h-[min(90vh,36rem)] overflow-y-auto p-6">
          <button
            type="button"
            className="absolute right-4 top-4 rounded-full p-1.5 text-muted-foreground motion-colors hover:bg-muted hover:text-foreground"
            aria-label="Close"
            onClick={closeDialog}
          >
            <X className="size-4" strokeWidth={2.25} />
          </button>

          {billingStep === "profile" ? (
            <div className="space-y-6 pr-8">
              <div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:items-start sm:text-left">
                <div className="shrink-0">
                  <SlackPersonChip displayName={name} portraitUrl={portraitUrl} size="comfortable" />
                </div>
                <div className="min-w-0 space-y-1">
                  <h2 className="font-display text-lg font-semibold tracking-tight text-foreground">Account</h2>
                  <p className="truncate text-sm text-muted-foreground">
                    {meLoading ? "Loading…" : email ?? meError ?? "—"}
                  </p>
                </div>
              </div>

              <div className="border-t border-border pt-5">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Billing</h3>
                {meLoading ? (
                  <p className="text-sm text-muted-foreground">Loading plan…</p>
                ) : meError ? (
                  <p className="text-sm text-destructive">{meError}</p>
                ) : billing?.cancelAtPeriodEnd ? (
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {periodLabel
                      ? `Auto-renew is off. Access continues through ${periodLabel}.`
                      : "Auto-renew is off. Access continues through the end of your billing period."}
                  </p>
                ) : billing?.hasManageableSubscription ? (
                  <div className="space-y-3">
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      You have an active Make A Company subscription. You can turn off auto-renew anytime; access stays through the
                      current period.
                    </p>
                    <button
                      type="button"
                      className="w-full rounded-xl border border-destructive/35 bg-destructive/8 px-4 py-2.5 text-sm font-medium text-destructive motion-colors hover:bg-destructive/12 sm:w-auto"
                      onClick={() => {
                        setSubmitError(null);
                        setBillingStep("cancel_confirm");
                      }}
                    >
                      Cancel subscription
                    </button>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No self-serve subscription is linked to this sign-in.</p>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-4 pr-8">
              <h2 className="font-display text-lg font-semibold tracking-tight">Turn off auto-renew?</h2>
              <p className="text-sm leading-relaxed text-muted-foreground">
                We&apos;ll stop charging at the end of your current billing period
                {periodLabel ? (
                  <>
                    {" "}
                    (<span className="text-foreground">{periodLabel}</span>)
                  </>
                ) : null}
                . Until then, your workspace stays fully available.
              </p>
              {submitError ? <p className="text-sm text-destructive">{submitError}</p> : null}
              <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end sm:gap-3">
                <button
                  type="button"
                  className="rounded-xl border border-border bg-background px-4 py-2.5 text-sm font-medium motion-colors hover:bg-muted"
                  onClick={() => {
                    setSubmitError(null);
                    setBillingStep("profile");
                  }}
                  disabled={submitting}
                >
                  Back
                </button>
                <button
                  type="button"
                  className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm font-medium text-destructive motion-colors hover:bg-destructive/15 disabled:opacity-50"
                  onClick={confirmCancel}
                  disabled={submitting}
                >
                  {submitting ? "Working…" : "Turn off auto-renew"}
                </button>
              </div>
            </div>
          )}
        </div>
      </dialog>
    </>
  );
}
