export type CareerMissionTier = 1 | 2

/** Match the existing Recruit and Soldier mission boards, regardless of player rank. */
export function careerMissionTierForTemplateId(templateId: string): CareerMissionTier {
  return templateId === 'soldier-town-defense-01' || templateId === 'career-enemy-town-assault' ? 2 : 1
}
