import skillsSnapshot from "@/data/admin/skills-snapshot.json";
import teamSnapshot from "@/data/admin/team-snapshot.json";

export type TeamStatus = "active" | "inactive";

export type TeamLane =
  | "automation"
  | "sales"
  | "strategy"
  | "operations"
  | "internship"
  | "general";

export type TeamMember = {
  id: string;
  displayName: string;
  botDisplayName: string;
  lane: TeamLane;
  roleTitle: string;
  shortDescription: string;
  longDescription: string;
  backgroundColor: string;
  status: TeamStatus;
  sourceManifest: string;
  skillIds: string[];
};

export type AdminSkill = {
  id: string;
  label: string;
  description: string;
  employeeIds: string[];
  requiredParams?: string[];
  optionalParams?: string[];
  comingSoon?: boolean;
};

export type CapabilityCatalogEmployee = {
  id: string;
  label: string;
  description: string;
};

export type CapabilityCatalogSkill = {
  id: string;
  label: string;
  description: string;
  runtimeTool: string;
  requiredParams: string[];
  optionalParams: string[];
};

export type CapabilityCatalog = {
  coreEmployees: CapabilityCatalogEmployee[];
  skills: CapabilityCatalogSkill[];
  employeeSkillIds: Record<string, string[]>;
  updatedAt?: string;
  source?: string;
};

type TeamSnapshot = {
  employees: TeamMember[];
};

type SkillsSnapshot = {
  skills: AdminSkill[];
};

function backendBaseURL(): string {
  const isKubernetes = Boolean(process.env.KUBERNETES_SERVICE_HOST);
  const defaultBackendBase = isKubernetes ? "http://makeacompany-ai-backend:8080" : "http://localhost:8080";
  return (
    process.env.BACKEND_INTERNAL_API_BASE_URL ??
    process.env.NEXT_PUBLIC_BACKEND_API_BASE_URL ??
    defaultBackendBase
  );
}

function fallbackCatalogFromSnapshots(): {
  members: TeamMember[];
  skills: AdminSkill[];
} {
  const typedSkills = skillsSnapshot as SkillsSnapshot;
  const typedTeam = teamSnapshot as TeamSnapshot;
  const members = typedTeam.employees.map((member) => ({
    ...member,
    skillIds: Array.isArray(member.skillIds) ? member.skillIds : [],
  }));
  return {
    members,
    skills: typedSkills.skills,
  };
}

function roleForEmployee(id: string): Pick<TeamMember, "lane" | "roleTitle"> {
  switch (id) {
    case "alex":
      return { lane: "sales", roleTitle: "Head of Sales" };
    case "tim":
      return { lane: "strategy", roleTitle: "Head of Simplifying" };
    case "ross":
      return { lane: "automation", roleTitle: "Head of Automation" };
    case "garth":
      return { lane: "internship", roleTitle: "Head of Interns" };
    case "joanne":
      return { lane: "operations", roleTitle: "Head of Executive Operations" };
    default:
      return { lane: "general", roleTitle: "AI Employee" };
  }
}

function memberSort(a: TeamMember, b: TeamMember): number {
  const order = ["joanne", "ross", "alex", "tim", "garth"];
  const ai = order.indexOf(a.id);
  const bi = order.indexOf(b.id);
  if (ai !== -1 || bi !== -1) {
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  }
  return a.displayName.localeCompare(b.displayName);
}

function normalizeCatalogToAdminData(catalog: CapabilityCatalog): {
  members: TeamMember[];
  skills: AdminSkill[];
} {
  const members: TeamMember[] = catalog.coreEmployees.map((employee) => {
    const employeeID = String(employee.id || "").trim().toLowerCase();
    const role = roleForEmployee(employeeID);
    const skillIds = Array.isArray(catalog.employeeSkillIds?.[employeeID])
      ? [...new Set(catalog.employeeSkillIds[employeeID].map((id) => String(id).trim()).filter(Boolean))]
      : [];
    return {
      id: employeeID,
      displayName: String(employee.label || employeeID),
      botDisplayName: String(employee.label || employeeID),
      lane: role.lane,
      roleTitle: role.roleTitle,
      shortDescription: String(employee.description || "AI teammate"),
      longDescription: String(employee.description || "AI teammate configured from capability catalog."),
      backgroundColor: "#000000",
      status: "active",
      sourceManifest: "redis:makeacompany:catalog",
      skillIds,
    };
  });
  members.sort(memberSort);

  const employeeIdsBySkill = new Map<string, string[]>();
  for (const member of members) {
    for (const skillID of member.skillIds) {
      const current = employeeIdsBySkill.get(skillID) ?? [];
      current.push(member.id);
      employeeIdsBySkill.set(skillID, current);
    }
  }

  const skills: AdminSkill[] = (catalog.skills ?? []).map((skill) => ({
    id: String(skill.id || "").trim(),
    label: String(skill.label || skill.id || "").trim(),
    description: String(skill.description || "").trim(),
    employeeIds: employeeIdsBySkill.get(String(skill.id || "").trim()) ?? [],
    requiredParams: Array.isArray(skill.requiredParams) ? [...skill.requiredParams] : [],
    optionalParams: Array.isArray(skill.optionalParams) ? [...skill.optionalParams] : [],
  }));

  return { members, skills };
}

export async function getAdminCatalogData(): Promise<{
  members: TeamMember[];
  skills: AdminSkill[];
}> {
  const base = backendBaseURL().replace(/\/$/, "");
  try {
    const response = await fetch(`${base}/v1/admin/catalog`, { cache: "no-store" });
    if (!response.ok) {
      return fallbackCatalogFromSnapshots();
    }
    const payload = (await response.json()) as CapabilityCatalog;
    if (!Array.isArray(payload?.coreEmployees) || !Array.isArray(payload?.skills)) {
      return fallbackCatalogFromSnapshots();
    }
    return normalizeCatalogToAdminData(payload);
  } catch {
    return fallbackCatalogFromSnapshots();
  }
}
