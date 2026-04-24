"use client";

import { usePathname } from "next/navigation";

import { AdminLogoutButton } from "@/components/admin/admin-logout-button";

function showAdminShellLogout(pathname: string | null): boolean {
  if (!pathname) return false;
  if (pathname === "/twitter" || pathname.startsWith("/twitter/")) return true;
  if (pathname.startsWith("/admin/login")) return false;
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return true;
  return false;
}

/**
 * Logout in `AdminShell` only on protected surfaces: `/admin` (incl. channel detail
 * routes), `/twitter`, and never on catalog-style pages like `/skills` or `/employees`.
 * Portal company routes use `PortalHeaderLogoutSlot` instead.
 */
export function AdminHeaderLogoutSlot() {
  const pathname = usePathname();
  if (!showAdminShellLogout(pathname)) {
    return null;
  }
  return <AdminLogoutButton />;
}
