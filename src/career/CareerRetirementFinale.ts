import { cloneCareerProfile, type CareerProfile } from './CareerProfile'
import { hasCompleteRetirementMobilizationCheckpoint } from './CareerRetirementMobilization'
import { parseCareerRetirementState, type CareerRetirementOutcome } from './CareerRetirementState'
import { TOWN_RETIREMENT_RALLY_REGION } from '../town/TownBounds'

export const COMMANDER_RETIREMENT_FINAL_STAND_SECONDS = 300

interface HorizontalPosition { x: number; z: number }
export interface CommanderRetirementFinalStandForces {
  playerDead: boolean
  /** Runtime-owned survival check for legal combat-capable private humanoids. */
  privateFightersAlive: boolean
  /** Runtime-owned completion check across the canonical Town humanoid roster. */
  allTownEnemiesDefeated: boolean
}
export interface CommanderRetirementFinalStandFrame extends CommanderRetirementFinalStandForces {
  deltaSeconds: number
  playerPosition: HorizontalPosition
}

/** Mount type and height cannot alter the horizontal admission boundary. */
export function atCommanderRetirementRally(point: HorizontalPosition): boolean {
  const area = TOWN_RETIREMENT_RALLY_REGION
  return Number.isFinite(point.x) && Number.isFinite(point.z)
    && point.x >= area.minX && point.x <= area.maxX && point.z >= area.minZ && point.z <= area.maxZ
}

/** Missing or unloaded canonical enemies are not proof of defeat. */
export function areAllRetirementEnemiesDefeated(expectedIds: ReadonlySet<string>,
  observed: ReadonlyMap<string, { readonly dead: boolean }>): boolean {
  if (expectedIds.size === 0) return false
  for (const id of expectedIds) if (observed.get(id)?.dead !== true) return false
  return true
}

function validFinaleProfile(current: CareerProfile, phase: 'mobilizing' | 'final-stand'): boolean {
  const state = parseCareerRetirementState(current.careerRetirement)
  return current.rank === 'commander' && state?.phase === phase && Boolean(state.mobilization)
    && !current.activeMission && !current.activeOutpostMission && !current.activeRace
    && current.townEvent?.state !== 'hostile'
}

/** Stage only: the runtime must save and publish this profile before issuing any attack. */
export function beginCommanderRetirementFinalStand(current: CareerProfile): CareerProfile | null {
  if (!validFinaleProfile(current, 'mobilizing') || !hasCompleteRetirementMobilizationCheckpoint(current)) return null
  const next = cloneCareerProfile(current)
  next.careerRetirement = { ...next.careerRetirement!, phase: 'final-stand', combatElapsedSeconds: 0 }
  return next
}

function outcomeFor(current: CareerProfile, forces: CommanderRetirementFinalStandForces): CareerRetirementOutcome | undefined {
  // A mutual wipe is a defeat even when the last Town enemy also dies this frame.
  if (forces.playerDead && !forces.privateFightersAlive) return 'fallen'
  return forces.allTownEnemiesDefeated
    || current.careerRetirement!.combatElapsedSeconds >= COMMANDER_RETIREMENT_FINAL_STAND_SECONDS ? 'escaped' : undefined
}

/** A cheap immutable clock step, using the persisted checkpoint as its only elapsed source.
 * Native roster validation belongs at phase entry, completion and the storage boundary,
 * not in a per-frame scan here. Runtime supplies authoritative force survival facts.
 */
export function advanceCommanderRetirementFinalStand(current: CareerProfile,
  frame: CommanderRetirementFinalStandFrame): { profile: CareerProfile; outcome?: CareerRetirementOutcome } {
  if (!validFinaleProfile(current, 'final-stand')) return { profile: current }
  const state = current.careerRetirement!
  const delta = Number.isFinite(frame.deltaSeconds) && frame.deltaSeconds > 0 ? frame.deltaSeconds : 0
  // Rally position gates admission only; an admitted battle never pauses when leaving it.
  const elapsed = !frame.playerDead || frame.privateFightersAlive
    ? Math.min(COMMANDER_RETIREMENT_FINAL_STAND_SECONDS, state.combatElapsedSeconds + delta)
    : state.combatElapsedSeconds
  const profile = elapsed === state.combatElapsedSeconds ? current
    : { ...current, careerRetirement: { ...state, combatElapsedSeconds: elapsed } }
  const outcome = outcomeFor(profile, frame)
  return { profile, ...(outcome ? { outcome } : {}) }
}

/** The completion transaction stages an isolated snapshot with no mission rewards. */
export function completeCommanderRetirement(current: CareerProfile, forces: CommanderRetirementFinalStandForces): CareerProfile | null {
  if (!validFinaleProfile(current, 'final-stand') || !hasCompleteRetirementMobilizationCheckpoint(current)) return null
  const outcome = outcomeFor(current, forces)
  if (!outcome) return null
  const next = cloneCareerProfile(current)
  next.careerRetirement = { ...next.careerRetirement!, phase: 'completed', outcome }
  return next
}

/** Formal checkpoint owner used only by the dev-gated QA adapter. Never rewinds the clock
 * or chooses an outcome: the remaining five seconds still require ordinary survival.
 */
function fastForwardCommanderRetirementFinalStand(current: CareerProfile): CareerProfile | null {
  if (!validFinaleProfile(current, 'final-stand') || !hasCompleteRetirementMobilizationCheckpoint(current)
    || current.careerRetirement!.combatElapsedSeconds >= COMMANDER_RETIREMENT_FINAL_STAND_SECONDS) return null
  const next = cloneCareerProfile(current)
  next.careerRetirement!.combatElapsedSeconds = Math.max(next.careerRetirement!.combatElapsedSeconds,
    COMMANDER_RETIREMENT_FINAL_STAND_SECONDS - 5)
  return next
}

/** Owns a terminal candidate across failed writes. The snapshot never escapes this owner:
 * every save attempt receives its own clone, so neither later damage nor a failed save
 * callback can revise the detected outcome or its casualty/resource snapshot.
 */
export class CareerRetirementFinaleOwner {
  private candidate: CareerProfile | null = null
  get outcome(): CareerRetirementOutcome | undefined { return this.candidate?.careerRetirement?.outcome }

  advance(current: CareerProfile, frame: CommanderRetirementFinalStandFrame): CareerProfile {
    if (this.candidate) return current
    const result = advanceCommanderRetirementFinalStand(current, frame)
    if (result.outcome) this.candidate = completeCommanderRetirement(result.profile, frame)
    return result.profile
  }

  retryCompletion(save: (next: CareerProfile) => boolean): CareerProfile | null {
    if (!this.candidate) return null
    const next = cloneCareerProfile(this.candidate)
    return save(next) ? next : null
  }

  fastForward(current: CareerProfile): CareerProfile | null {
    return this.candidate ? null : fastForwardCommanderRetirementFinalStand(current)
  }
}
