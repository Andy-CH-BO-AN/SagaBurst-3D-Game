import { parseCommandActorCheckpoint } from '../career/CareerCommandAuthority'
import type { PersonalActorCheckpoint } from '../career/CareerPersonalSquadMission'
import { townRoster, type TownPatrolId } from './TownRules'
import { townPatrolDeparture, townPatrolRoute } from './TownPatrolRoute'

export interface TownPatrolTravelCheckpoint {
  state: 'MOVING_TO_ROUTE' | 'PATROLLING'
  waypoint: number
  departureIndex: number
  leaderActorId?: string
}

export interface TownPatrolCheckpoint {
  squads: { id: TownPatrolId; generation: number; respawnRemaining?: number;
    members: Record<string, PersonalActorCheckpoint>;
    travel?: TownPatrolTravelCheckpoint;
    returning?: string[] }[]
}

/** Optional per-town schema. Missing legacy data never changes mission ownership. */
export function parseTownPatrolCheckpoint(value: unknown): TownPatrolCheckpoint | undefined {
  if (!value || typeof value !== 'object' || !Array.isArray((value as TownPatrolCheckpoint).squads)) return undefined
  const squads: TownPatrolCheckpoint['squads'] = []
  for (const raw of (value as TownPatrolCheckpoint).squads) {
    if (!raw || !['A', 'B'].includes(raw.id) || squads.some(s => s.id === raw.id)
      || !Number.isSafeInteger(raw.generation) || raw.generation < 0) continue
    const ids = townRoster().filter(s => s.patrolId === raw.id).map(s => s.id)
    // Veteran VI prefixes the same permanent identities in its foreign scene.
    const members = Object.fromEntries(ids.flatMap(id => [id, `enemy-town:${id}`]).flatMap(id => {
      const member = parseCommandActorCheckpoint(raw.members?.[id])
      return member ? [[id, member]] : []
    }))
    const route = townPatrolRoute(), departureLength = townPatrolDeparture(raw.id, route).waypoints.length
    const travel = raw.travel
    const validTravel = travel && ['MOVING_TO_ROUTE', 'PATROLLING'].includes(travel.state)
      && Number.isSafeInteger(travel.waypoint) && travel.waypoint >= 0 && travel.waypoint < route.length
      && Number.isSafeInteger(travel.departureIndex) && travel.departureIndex >= 0
      && travel.departureIndex <= departureLength
      && (travel.state !== 'MOVING_TO_ROUTE' || travel.departureIndex < departureLength)
    squads.push({ id: raw.id, generation: raw.generation, members,
      ...(validTravel ? { travel: { state: travel.state, waypoint: travel.waypoint,
        departureIndex: travel.state === 'PATROLLING' ? departureLength : travel.departureIndex,
        ...(typeof travel.leaderActorId === 'string' && travel.leaderActorId in members ? { leaderActorId: travel.leaderActorId } : {}) } } : {}),
      ...(raw.respawnRemaining !== undefined ? { respawnRemaining: Number.isFinite(raw.respawnRemaining)
        ? Math.min(60, Math.max(0, raw.respawnRemaining)) : 60 } : {}),
      ...(Array.isArray(raw.returning) ? { returning: raw.returning.filter(id => typeof id === 'string' && id in members) } : {}) })
  }
  return { squads }
}
