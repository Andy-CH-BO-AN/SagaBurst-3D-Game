export type CareerMissionTier = 1 | 2 | 3

/** Match the existing Recruit and Soldier mission boards, regardless of player rank. */
export function careerMissionTierForTemplateId(templateId: string): CareerMissionTier {
  if (templateId.startsWith('veteran-')) return 3
  return templateId === 'career-enemy-town-assault' ? 2 : 1
}
