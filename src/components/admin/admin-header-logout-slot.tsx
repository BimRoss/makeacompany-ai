"use client";

import { usePathname } from "next/navigation";

import { AdminLogoutButton } from "@/components/admin/admin-logout-button";

/** Hides admin logout on `/admin/login` when the shell wraps that route. */
export function AdminHeaderLogoutSlot() {
  const pathname = usePathname();
  if (pathname === "/admin/login" || pathname?.startsWith("/admin/login/")) {
    return null;
  }
  return <AdminLogoutButton />;
}
