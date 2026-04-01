"use client";

import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { apiBase } from "@/lib/site";

type CheckoutButtonProps = {
  label: string;
  className?: string;
};

export function CheckoutButton({ label, className }: CheckoutButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase()}/v1/billing/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Checkout failed");
        return;
      }
      if (!data.url) {
        setError("No checkout URL returned");
        return;
      }
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <button
        type="button"
        disabled={loading}
        onClick={onClick}
        className={`group inline-flex h-14 items-center justify-center rounded-lg bg-primary px-8 text-lg font-semibold text-primary-foreground transition hover:brightness-105 disabled:opacity-60 ${className ?? ""}`}
      >
        {loading ? "Opening checkout..." : label}
        <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-1" />
      </button>
      {error ? <p className="text-sm text-red-500">{error}</p> : null}
    </div>
  );
}
