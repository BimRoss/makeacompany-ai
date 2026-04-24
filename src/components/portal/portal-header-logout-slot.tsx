"use client";

import { usePathname } from "next/navigation";

import { PortalLogoutButton } from "@/components/portal/portal-logout-button";

type Props = { channelId: string };

/** Hides portal logout on `/{channelId}/login` (signed-out users have nothing to log out of). */
export function PortalHeaderLogoutSlot({ channelId }: Props) {
  const pathname = usePathname();
  const last = pathname.split("/").filter(Boolean).at(-1);
  if (last === "login") {
    return null;
  }
  return <PortalLogoutButton channelId={channelId} />;
}
