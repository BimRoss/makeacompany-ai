"use client";

import { useState } from "react";
import { Loader2, LogOut } from "lucide-react";

export function AdminLogoutButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/auth/logout", { method: "POST", cache: "no-store" });
      if (!res.ok) {
        setError("Could not log out. Try again.");
        setLoading(false);
        return;
      }
      window.location.assign("/admin/login");
    } catch {
      setError("Network error. Try again.");
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        aria-busy={loading}
        aria-label={loading ? "Logging out" : "Log out"}
        className="relative inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full text-foreground/70 motion-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/25 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent active:scale-[0.97] disabled:pointer-events-none disabled:opacity-60"
      >
        {loading ? (
          <Loader2 className="h-[1.125rem] w-[1.125rem] shrink-0 animate-spin" aria-hidden />
        ) : (
          <LogOut className="h-[1.125rem] w-[1.125rem] shrink-0" aria-hidden />
        )}
      </button>
      {error ? (
        <p className="max-w-[12rem] text-right text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
