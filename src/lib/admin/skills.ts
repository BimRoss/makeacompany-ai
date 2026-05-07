import skillsSnapshot from "@/data/admin/skills-snapshot.json";

import type { AdminSkill } from "@/lib/admin/team";

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
