import { cloneCareerProfile, type CareerProfile } from './CareerProfile'
import { RACE_STORY_ID, type CareerRaceSession, type RaceRider } from './CareerRaceState'
import { releaseCareerStoryEvent } from './CareerStoryEvents'
import type { RacePosition } from './CareerRaceRoute'
import { settleTown } from '../town/TownRules'

export function raceReturnAction(phase: CareerRaceSession['phase'] | undefined, canWalkBack: boolean, arrived: boolean, requestedDirect = false): 'direct' | 'walked' | null {
  if (phase !== 'returning') return null
  return requestedDirect || !canWalkBack ? 'direct' : arrived ? 'walked' : null
}

/** Stage one save: completed race or a technical story-race cancellation, with real Town resources. */
export function raceReturnProfile(current: CareerProfile, player: RaceRider, destination: RacePosition | undefined, recoveryHp: number,
  options: { dismount?: boolean; mountDestination?: RacePosition; cancelStoryRace?: boolean } = {}): CareerProfile | null {
  const race = current.activeRace
  if (!race) return null
  const recorded = Boolean(current.raceRecords?.some(r => r.sessionId === race.id))
  if (options.cancelStoryRace ? race.story !== RACE_STORY_ID || race.result !== undefined || recorded
    : !['result', 'returning'].includes(race.phase) || !recorded) return null
  let next = cloneCareerProfile(current)
  if (options.cancelStoryRace) releaseCareerStoryEvent(next, RACE_STORY_ID, race.id)
  const event = next.townEvent
  if (event?.state === 'hostile' && event.pendingResult) {
    next = settleTown(next, event.id, event.pendingResult)
    // Native Town settlement owns death return/conquest, never a free race revival.
    delete next.racePlayerState
  } else {
    const returning = structuredClone(player)
    if (destination) {
      returning.position = { ...destination }
      // Walking arrival: the mount is left at its own proven parking spot, never under the player.
      if (options.dismount) returning.mounted = false
      if (options.mountDestination) returning.mountPosition = { ...options.mountDestination }
      else if (returning.mounted) returning.mountPosition = { ...destination }
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
