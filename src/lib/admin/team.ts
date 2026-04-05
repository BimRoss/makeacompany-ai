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
};

type TeamSnapshot = {
  generatedAt: string;
  source: string;
  employees: TeamMember[];
};

const typedSnapshot = teamSnapshot as TeamSnapshot;

export function getAdminTeamSnapshot(): TeamSnapshot {
  return typedSnapshot;
}

export function getAdminTeamMembers(): TeamMember[] {
  return typedSnapshot.employees;
}
