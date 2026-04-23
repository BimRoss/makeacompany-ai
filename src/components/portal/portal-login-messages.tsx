"use client";

import { useSearchParams } from "next/navigation";

export function PortalLoginMessages() {
  const searchParams = useSearchParams();
  const auth = searchParams.get("auth")?.trim();

  if (auth === "cancel") {
    return (
      <p className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-center text-sm text-muted-foreground" role="status">
        Checkout canceled. You can try again when you are ready.
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
  if (auth === "unauthorized") {
    return (
      <p className="rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3 text-center text-sm text-destructive" role="alert">
        You are not authorized to access this company. Sign in with the same email as a channel owner in Slack (and
        ensure owner ids and Slack user sync are configured).
      </p>
    );
  }
  return null;
}
