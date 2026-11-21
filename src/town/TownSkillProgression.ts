import { cloneCareerProfile, type CareerProfile } from '../career/CareerProfile'
import { skillStatesEqual, type SkillProgressionAward } from '../rpg/CombatSkillProgression'
import type { SkillState } from '../rpg/SkillManager'

/** Live skill, profile and save effects the Town scene owns. */
export interface TownSkillXpPorts {
  /** False while the player is dead, a spectator or an observer. */
  canAward(): boolean
  profile(): CareerProfile
  publishProfile(profile: CareerProfile): void
  skillState(): SkillState
  addXp(skill: SkillProgressionAward['skill'], xp: number): number
  syncPlayerLevels(state: SkillState): void
  markDirty(): void
  /** A level-up saves now; plain XP is debounced. */
  flushNow(): void
  scheduleFlush(): void
  onLevelUp(levelsGained: number): void
}

/** Applies one XP award to the live skills and the Town profile; the save is flushed by the scene. */
export function applyTownSkillXp({ skill, xp }: SkillProgressionAward, ports: TownSkillXpPorts): void {
  if (!ports.canAward()) return
  if (xp <= 0 || ports.profile().activeMission?.duelTutorialCareerId) return
  const before = ports.skillState()
  const levelsGained = ports.addXp(skill, xp)
  const after = ports.skillState()
  ports.syncPlayerLevels(after)
  if (skillStatesEqual(before, after)) return
  const next = cloneCareerProfile(ports.profile())
  next.skills = after
  ports.publishProfile(next)
  ports.markDirty()
  if (levelsGained > 0) ports.flushNow()
  else ports.scheduleFlush()
  if (levelsGained > 0) ports.onLevelUp(levelsGained)
}
