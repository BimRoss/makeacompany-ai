import type { Metadata } from "next";

import { AdminShell } from "@/components/admin/admin-shell";
import { PersonalAgentsAdminTable } from "@/components/admin/personal-agents-admin-table";

// /admin/personal-agents — read-only workspace aggregate of every
// personal agent across owners (issue #183 / #186 PR5). Owner-side
// management lives at /me/agents; admin can DM an owner to ask for
// action but doesn't delete agents from here in v1 (per #183 final
// decisions: read-only).

export const metadata: Metadata = {
  title: "Personal agents · admin · makeacompany.ai",
  robots: { index: false, follow: false },
};

export default function AdminPersonalAgentsPage() {
  return (
    <AdminShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Personal agents
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Every personal agent across owners. Read-only — owners manage
            agents from <code className="rounded bg-muted px-1 py-0.5 text-[10px]">/me/agents</code>.
          </p>
        </div>
        <PersonalAgentsAdminTable />
      </div>
    </AdminShell>
  );
}
