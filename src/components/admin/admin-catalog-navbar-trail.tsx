"use client";

import { useEffect, useMemo } from "react";
import { usePathname } from "next/navigation";

import { AdminCatalogNavLabels, type EmployeesSkillsNavActive } from "@/components/admin/admin-catalog-nav-labels";
import { useWorkspaceNavbarTrail } from "@/components/workspace-navbar-trail-provider";

function employeesSkillsNavActive(pathname: string): EmployeesSkillsNavActive {
  if (pathname === "/employees") {
    return "employees";
  }
  if (pathname === "/skills") {
    return "skills";
  }
  return null;
}

/**
 * Routes `/employees` + `/skills` use the squad header tray (skills list is skills-mcp-server).
 */
export function AdminCatalogNavbarTrail() {
  const pathname = usePathname();
  const { setWorkspaceNavbarTrail } = useWorkspaceNavbarTrail();

  const active = employeesSkillsNavActive(pathname);
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
