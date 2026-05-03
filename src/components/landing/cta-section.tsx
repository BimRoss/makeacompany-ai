"use client";

import { type FormEvent, useEffect, useState } from "react";
import { ArrowRight, CheckCircle, Loader2 } from "lucide-react";
import { apiBase } from "@/lib/site";

export function CtaSection() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showToast, setShowToast] = useState(false);

  useEffect(() => {
    if (!showToast) {
      return;
    }
    const timer = setTimeout(() => setShowToast(false), 2500);
    return () => clearTimeout(timer);
  }, [showToast]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) {
      return;
    }
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !normalizedEmail.includes("@")) {
      setError("Please enter a valid email address.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${apiBase()}/v1/billing/free-trial-invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Unable to send invite right now. Please try again.");
        return;
      }
      setEmail("");
      setShowToast(true);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {showToast ? (
        <div className="pointer-events-none fixed inset-x-0 top-20 z-[60] flex justify-center px-4">
          <p className="pointer-events-auto rounded-full border border-foreground bg-background px-5 py-2 text-sm font-medium shadow-lg">
            Check Your Inbox
          </p>
        </div>
      ) : null}
      <section className="py-20">
        <div className="mx-auto w-full max-w-4xl px-6">
          <div className="relative overflow-hidden rounded-3xl border border-border bg-card p-8 shadow-lg sm:p-12">
            <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-primary/5 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-20 -left-20 h-64 w-64 rounded-full bg-primary/5 blur-3xl" />

            <div className="relative w-full text-center">
              <h2 className="mb-4 text-balance text-3xl font-bold tracking-tight sm:text-4xl">
                Ready to build?
              </h2>
              <p className="mx-auto mb-8 max-w-xl text-pretty text-lg text-muted-foreground">
                Enter your email below and try the product for free!
              </p>
              <div className="mb-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <CheckCircle className="h-4 w-4 text-foreground" />
                  <span>Free</span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <CheckCircle className="h-4 w-4 text-foreground" />
                  <span>AI employees in Slack</span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <CheckCircle className="h-4 w-4 text-foreground" />
                  <span>Upgrade anytime</span>
                </div>
              </div>
              <form onSubmit={onSubmit} className="mx-auto mb-3 flex w-full max-w-sm flex-col items-center gap-3">
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="Enter your email..."
                  autoComplete="email"
                  className="h-11 w-full rounded-full border border-border bg-muted px-4 text-center text-sm font-semibold tracking-tight text-foreground outline-none ring-0 placeholder:text-muted-foreground placeholder:transition-colors focus:border-foreground/30 focus:placeholder:text-transparent sm:h-12 sm:px-5 sm:text-base"
                />
                <button
                  type="submit"
                  disabled={loading}
                  aria-busy={loading}
                  className="waitlist-cta group inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 text-base font-semibold text-primary-foreground disabled:opacity-70 sm:h-14 sm:w-auto sm:px-10 sm:text-lg"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-white sm:h-5 sm:w-5" />
                      Sending invite...
                      <span className="inline-block w-4 shrink-0 sm:w-5" aria-hidden />
                    </>
                  ) : (
                    <>
                      <span className="inline-block w-4 shrink-0 sm:w-5" aria-hidden />
                      Start Building
                      <ArrowRight className="waitlist-cta-arrow h-4 w-4 shrink-0 sm:h-5 sm:w-5" aria-hidden />
                    </>
                  )}
                </button>
              </form>
              {error ? (
                <p className="mx-auto mb-2 w-full max-w-sm rounded-md border border-border bg-card px-3 py-2 text-sm text-left">
                  {error}
                </p>
              ) : null}
              <p className="mt-6 text-pretty text-sm text-muted-foreground">
                Built by{" "}
                <a
                  href="https://bimross.com"
                  className="font-medium text-foreground underline-offset-4 hover:underline"
                >
                  BimRoss
                </a>
                .
              </p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
