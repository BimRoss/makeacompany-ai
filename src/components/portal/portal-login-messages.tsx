"use client";

import { useSearchParams } from "next/navigation";

export function PortalLoginMessages() {
  const searchParams = useSearchParams();
  const auth = searchParams.get("auth")?.trim();

  if (auth === "cancel") {
    return (
      <p className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-center text-sm text-muted-foreground" role="status">
        Sign-in was canceled. You can try again when you are ready.
      </p>
    );
  }
  if (auth === "failed") {
    return (
      <p className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-center text-sm text-muted-foreground" role="alert">
        Sign-in did not complete. Tap Login to try again.
      </p>
    );
  }
  return null;
}
