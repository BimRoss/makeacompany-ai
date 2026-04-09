import skillsSnapshot from "@/data/admin/skills-snapshot.json";

export type AdminSkill = {
  id: string;
  label: string;
  description: string;
  employeeIds: string[];
  comingSoon?: boolean;
};

type SkillsSnapshot = {
  generatedAt: string;
  source: string;
  skills: AdminSkill[];
};

const typedSnapshot = skillsSnapshot as SkillsSnapshot;
const skillsById = new Map(typedSnapshot.skills.map((skill) => [skill.id, skill]));

export function getAdminSkillsSnapshot(): SkillsSnapshot {
  return typedSnapshot;
}

export function getAdminSkills(): AdminSkill[] {
  return typedSnapshot.skills;
}

export function getAdminSkillById(skillId: string): AdminSkill | undefined {
  return skillsById.get(skillId);
}

export function getAdminSkillsByIds(skillIds: string[]): AdminSkill[] {
  return skillIds
    .map((skillId) => getAdminSkillById(skillId))
    .filter((skill): skill is AdminSkill => Boolean(skill));
}
