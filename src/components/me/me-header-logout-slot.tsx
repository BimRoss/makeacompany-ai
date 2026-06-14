"use client";

import { usePathname } from "next/navigation";

import { MeLogoutButton } from "@/components/me/me-logout-button";

/** Hides /me logout on /me/login (signed-out users have nothing to log out of). */
export function MeHeaderLogoutSlot() {
  const pathname = usePathname();
  const last = pathname.split("/").filter(Boolean).at(-1);
  if (last === "login") {
    return null;
  }
  return <MeLogoutButton />;
}
