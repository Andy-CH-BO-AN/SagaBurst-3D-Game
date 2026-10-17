import { cloneCareerProfile, type CareerProfile } from './CareerProfile'
import type { CareerRaceSession, RaceRider } from './CareerRaceState'
import type { RacePosition } from './CareerRaceRoute'
import { settleTown } from '../town/TownRules'

export function raceReturnAction(phase: CareerRaceSession['phase'] | undefined, canWalkBack: boolean, arrived: boolean, requestedDirect = false): 'direct' | 'walked' | null {
  if (phase !== 'returning') return null
  return requestedDirect || !canWalkBack ? 'direct' : arrived ? 'walked' : null
}

/** Stage one save: completed race, real resources and any deferred native Town settlement. */
export function raceReturnProfile(current: CareerProfile, player: RaceRider, destination: RacePosition | undefined, recoveryHp: number): CareerProfile | null {
  const race = current.activeRace
  if (!race || !['result', 'returning'].includes(race.phase) || !current.raceRecords?.some(r => r.sessionId === race.id)) return null
  let next = cloneCareerProfile(current)
  const event = next.townEvent
  if (event?.state === 'hostile' && event.pendingResult) {
    next = settleTown(next, event.id, event.pendingResult)
    // Native Town settlement owns death return/conquest, never a free race revival.
    delete next.racePlayerState
  } else {
    const returning = structuredClone(player)
    if (destination) {
      returning.position = { ...destination }
      if (returning.mounted) returning.mountPosition = { ...destination }
    }
    if (returning.dead) {
      if (!destination) return null
      returning.dead = false; returning.hp = recoveryHp; returning.mounted = false
    }
    next.racePlayerState = returning
  }
  delete next.activeRace
  return next
}
