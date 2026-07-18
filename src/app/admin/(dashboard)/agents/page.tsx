import Link from "next/link";

import { AdminAgentKillSwitch } from "@/components/admin/admin-agent-kill-switch";
import { AdminShell } from "@/components/admin/admin-shell";

// Dedicated admin surface for the system agents (Ross, Joanne): kill switches
// plus the browser Google Workspace re-auth. Session-gated by the (dashboard)
// layout's AdminSessionVerifiedBoundary and the /admin/* middleware.
export default function AdminAgentsPage() {
  return (
    <AdminShell>
      <div className="space-y-4">
        <Link
          href="/admin"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          ← Admin dashboard
        </Link>
        <AdminAgentKillSwitch />
      </div>
    </AdminShell>
  );
}
