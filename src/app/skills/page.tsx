import { AdminShell } from "@/components/admin/admin-shell";
import { AgentSkillsList } from "@/components/admin/agent-skills-list";
import { getAgentSkills } from "@/lib/admin/agent-skills";

export default async function SkillsPage() {
  const agentSkillsResult = await getAgentSkills();

  return (
    <AdminShell>
      <div className="space-y-10">
        <AgentSkillsList result={agentSkillsResult} />
      </div>
    </AdminShell>
  );
}
