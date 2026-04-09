import { AdminShell } from "@/components/admin/admin-shell";
import { SkillsCardsGrid } from "@/components/admin/skills-cards-grid";
import type { AdminSkill } from "@/lib/admin/skills";
import { getAdminSkills } from "@/lib/admin/skills";
import { getAdminTeamMembers } from "@/lib/admin/team";

const comingSoonSkills: AdminSkill[] = [
  {
    id: "github",
    label: "Github",
    description: "Build, deploy, and scale apps",
    employeeIds: [],
    comingSoon: true,
  },
  {
    id: "google-calendar",
    label: "Google Calendar",
    description: "book, organize, and prioritize with ease",
    employeeIds: [],
    comingSoon: true,
  },
  {
    id: "twitter",
    label: "Twitter",
    description: "discover and search tweets in seconds",
    employeeIds: [],
    comingSoon: true,
  },
  {
    id: "reddit",
    label: "Reddit",
    description: "learn quickly from humans (and bots)",
    employeeIds: [],
    comingSoon: true,
  },
  {
    id: "web",
    label: "Web",
    description: "search, scrape, inform",
    employeeIds: [],
    comingSoon: true,
  },
  {
    id: "create-employees",
    label: "Create Employees",
    description: "hire people in natural language",
    employeeIds: [],
    comingSoon: true,
  },
  {
    id: "leads",
    label: "Leads",
    description: "find qualified leads with lead poet",
    employeeIds: [],
    comingSoon: true,
  },
  {
    id: "3d-models",
    label: "3D Models",
    description: "create digital objects with natural language",
    employeeIds: [],
    comingSoon: true,
  },
  {
    id: "ridges",
    label: "Ridges",
    description: "deploy AI coding agents even better than ours",
    employeeIds: [],
    comingSoon: true,
  },
];

export default function SkillsPage() {
  const skills = [...getAdminSkills(), ...comingSoonSkills];
  const members = getAdminTeamMembers();

  return (
    <AdminShell>
      <section className="space-y-4">
        {skills.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Skills</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              No skills have been configured yet. Add them upstream and re-run the team sync.
            </p>
          </div>
        ) : (
          <SkillsCardsGrid skills={skills} members={members} />
        )}
      </section>
    </AdminShell>
  );
}
