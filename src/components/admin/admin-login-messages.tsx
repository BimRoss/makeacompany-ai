"use client";

import { useSearchParams } from "next/navigation";

export function AdminLoginMessages() {
  const searchParams = useSearchParams();
  const auth = searchParams.get("auth")?.trim();

  if (auth === "cancel") {
    return (
      <p className="text-center text-sm text-muted-foreground" role="status">
        Checkout canceled. You can try again when you are ready.
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
  return null;
}
