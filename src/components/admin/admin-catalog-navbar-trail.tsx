"use client";

import { useEffect, useMemo } from "react";
import { usePathname } from "next/navigation";

import { AdminCatalogNavLabels, type AdminCatalogNavActive } from "@/components/admin/admin-catalog-nav-labels";
import { useWorkspaceNavbarTrail } from "@/components/workspace-navbar-trail-provider";

function catalogActiveFromPathname(pathname: string): AdminCatalogNavActive {
  if (pathname === "/employees") {
    return "employees";
  }
  if (pathname === "/skills") {
    return "skills";
  }
  return null;
}

/**
 * Sets the workspace header trail on `/employees` and `/skills` so the bar matches channel pages.
 */
export function AdminCatalogNavbarTrail() {
  const pathname = usePathname();
  const { setWorkspaceNavbarTrail } = useWorkspaceNavbarTrail();

  const active = catalogActiveFromPathname(pathname);
  const trail = useMemo(() => {
    if (active === null) {
      return null;
    }
    return (
      <div className="flex min-w-0 flex-1 items-center">
        <AdminCatalogNavLabels active={active} />
      </div>
    );
  }, [active]);

  useEffect(() => {
    if (!trail) {
      return;
    }
    setWorkspaceNavbarTrail(trail);
    return () => {
      setWorkspaceNavbarTrail(null);
    };
  }, [trail, setWorkspaceNavbarTrail]);

  return null;
}
