"use client";

import { useSearchParams } from "next/navigation";

export function AdminLoginMessages() {
  const searchParams = useSearchParams();
  const auth = searchParams.get("auth")?.trim();

  if (auth === "cancel") {
    return (
      <p className="text-center text-sm text-muted-foreground" role="status">
        Sign-in was canceled. You can try again when you are ready.
      </p>
    );
  }
  if (auth === "failed") {
    return (
      <p className="text-center text-sm text-muted-foreground" role="alert">
        Authentication did not complete. Please try again.
      </p>
    );
  }
  if (auth === "stale_session") {
    return (
      <p className="text-center text-sm text-muted-foreground" role="status">
        Your admin session could not be verified (expired cookie or backend session). Sign in again.
      </p>
    );
  }
  return null;
}
