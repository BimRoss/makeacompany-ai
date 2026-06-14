"use client";

import { useSearchParams } from "next/navigation";

export function MeLoginMessages() {
  const searchParams = useSearchParams();
  const auth = searchParams.get("auth")?.trim();

  if (auth === "required") {
    return (
      <p className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-center text-sm text-muted-foreground" role="status">
        Sign in to view your account.
      </p>
    );
  }
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
        Sign-in did not complete. Try again.
      </p>
    );
  }
  if (auth === "unauthorized") {
    return (
      <p className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-center text-sm text-muted-foreground" role="alert">
        That account is not registered yet.
      </p>
    );
  }
  return null;
}
