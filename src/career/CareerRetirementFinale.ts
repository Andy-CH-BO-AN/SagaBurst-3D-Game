import { cloneCareerProfile, type CareerProfile } from './CareerProfile'
import { hasCompleteRetirementMobilizationCheckpoint } from './CareerRetirementMobilization'
import { parseCareerRetirementState, type CareerRetirementOutcome } from './CareerRetirementState'
import { TOWN_RETIREMENT_EXTRACTION } from '../town/TownBounds'

export const COMMANDER_RETIREMENT_FINAL_STAND_SECONDS = 300
export const COMMANDER_RETIREMENT_RALLY_TRIGGER_RADIUS = 8
/** Leaves room to maneuver in the authored wilderness, clipped by the normal world edge. */
export const COMMANDER_RETIREMENT_FINAL_STAND_RADIUS = 45

interface HorizontalPosition { x: number; z: number }
export interface CommanderRetirementFinalStandFrame {
  deltaSeconds: number
  playerPosition: HorizontalPosition
  playerDead: boolean
}

function withinExtractionRadius(point: HorizontalPosition, radius: number): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.z)
    && Math.hypot(point.x - TOWN_RETIREMENT_EXTRACTION.x, point.z - TOWN_RETIREMENT_EXTRACTION.z) <= radius
}

/** Mount type and height cannot alter either horizontal boundary. */
export function atCommanderRetirementRally(point: HorizontalPosition): boolean {
  return withinExtractionRadius(point, COMMANDER_RETIREMENT_RALLY_TRIGGER_RADIUS)
}

export function insideCommanderRetirementFinalStandZone(point: HorizontalPosition): boolean {
  return withinExtractionRadius(point, COMMANDER_RETIREMENT_FINAL_STAND_RADIUS)
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

function outcomeFor(current: CareerProfile, playerDead: boolean): CareerRetirementOutcome | undefined {
  if (playerDead) return 'fallen'
  return current.careerRetirement!.combatElapsedSeconds >= COMMANDER_RETIREMENT_FINAL_STAND_SECONDS ? 'escaped' : undefined
}

/** A cheap immutable clock step, using the persisted checkpoint as its only elapsed source.
 * Native roster validation belongs at phase entry, completion and the storage boundary,
 * not in a per-frame scan of every Town actor. There is no enemy/private-survivor gate.
 */
export function advanceCommanderRetirementFinalStand(current: CareerProfile,
  frame: CommanderRetirementFinalStandFrame): { profile: CareerProfile; outcome?: CareerRetirementOutcome } {
  if (!validFinaleProfile(current, 'final-stand')) return { profile: current }
  const state = current.careerRetirement!
  const delta = Number.isFinite(frame.deltaSeconds) && frame.deltaSeconds > 0 ? frame.deltaSeconds : 0
  const elapsed = !frame.playerDead && insideCommanderRetirementFinalStandZone(frame.playerPosition)
    ? Math.min(COMMANDER_RETIREMENT_FINAL_STAND_SECONDS, state.combatElapsedSeconds + delta)
    : state.combatElapsedSeconds
  const profile = elapsed === state.combatElapsedSeconds ? current
    : { ...current, careerRetirement: { ...state, combatElapsedSeconds: elapsed } }
  const outcome = outcomeFor(profile, frame.playerDead)
  return { profile, ...(outcome ? { outcome } : {}) }
}

/** The completion transaction stages an isolated snapshot with no mission rewards. */
export function completeCommanderRetirement(current: CareerProfile, playerDead: boolean): CareerProfile | null {
  if (!validFinaleProfile(current, 'final-stand') || !hasCompleteRetirementMobilizationCheckpoint(current)) return null
  const outcome = outcomeFor(current, playerDead)
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
    if (result.outcome) this.candidate = completeCommanderRetirement(result.profile, frame.playerDead)
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
