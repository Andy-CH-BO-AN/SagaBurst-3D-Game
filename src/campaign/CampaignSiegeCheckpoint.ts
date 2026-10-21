import type { MobileSiegeRampState } from './MobileSiegeRampController'
import type { SiegeRampAssignment } from './MobileSiegeRampPolicy'

export interface CampaignSiegeCheckpoint {
  version: 1
  breached: boolean
  ramps: Array<{
    assignment: SiegeRampAssignment
    stagingZ: number
    position: { x: number; y: number; z: number }
    hp: number
    state: MobileSiegeRampState
    distance: number
    dockingProgress: number
  }>
  actors: Record<string, { entranceId: string | null; breachCompleted: boolean }>
  destroyedPalisadeIds: string[]
}

/** Optional v1 extension; old Career checkpoints need no migration. Invalid extensions are rejected. */
export function parseCampaignSiegeCheckpoint(value: unknown): CampaignSiegeCheckpoint | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as CampaignSiegeCheckpoint
  const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
  const id = (s: unknown): s is string => typeof s === 'string' && s.length > 0 && s.length <= 256
  if (raw.version !== 1 || typeof raw.breached !== 'boolean' || !Array.isArray(raw.ramps) || raw.ramps.length > 2
    || !raw.actors || typeof raw.actors !== 'object' || Array.isArray(raw.actors) || Object.keys(raw.actors).length > 1024
    || !Array.isArray(raw.destroyedPalisadeIds) || raw.destroyedPalisadeIds.length > 128
    || !raw.destroyedPalisadeIds.every(id)) return undefined
  const crewIds = new Set<string>(), rampIds = new Set<string>()
  for (const ramp of raw.ramps) {
    const a = ramp?.assignment
    if (!a || !['siege-ramp-left', 'siege-ramp-right'].includes(a.id)
      || a.side !== (a.id === 'siege-ramp-left' ? -1 : 1) || rampIds.has(a.id)
      || !Array.isArray(a.pusherIds) || a.pusherIds.length !== 4
      || !Array.isArray(a.assaultIds) || a.assaultIds.length !== 6
      || !finite(ramp.stagingZ) || !ramp.position || !finite(ramp.position.x) || !finite(ramp.position.y) || !finite(ramp.position.z)
      || !finite(ramp.hp) || ramp.hp < 0 || ramp.hp > 520 || !finite(ramp.distance) || ramp.distance < 0
      || !finite(ramp.dockingProgress) || ramp.dockingProgress < 0 || ramp.dockingProgress > 1
      || !['DEPLOYING', 'PUSHING', 'DOCKING', 'DOCKED', 'ABANDONED', 'DESTROYED'].includes(ramp.state)
      || (ramp.hp === 0) !== (ramp.state === 'DESTROYED')) return undefined
    rampIds.add(a.id)
    for (const actorId of [...a.pusherIds, ...a.assaultIds]) {
      if (!id(actorId) || crewIds.has(actorId)) return undefined
      crewIds.add(actorId)
    }
  }
  for (const [actorId, actor] of Object.entries(raw.actors)) {
    if (!id(actorId) || !actor || typeof actor.breachCompleted !== 'boolean'
      || actor.entranceId !== null && !id(actor.entranceId)) return undefined
  }
  return {
    version: 1, breached: raw.breached,
    ramps: raw.ramps.map(ramp => ({ assignment: { id: ramp.assignment.id, side: ramp.assignment.side,
      pusherIds: [...ramp.assignment.pusherIds], assaultIds: [...ramp.assignment.assaultIds] },
      stagingZ: ramp.stagingZ, position: { x: ramp.position.x, y: ramp.position.y, z: ramp.position.z },
      hp: ramp.hp, state: ramp.state, distance: ramp.distance, dockingProgress: ramp.dockingProgress })),
    actors: Object.fromEntries(Object.entries(raw.actors).map(([actorId, actor]) => [actorId,
      { entranceId: actor.entranceId, breachCompleted: actor.breachCompleted }])),
    destroyedPalisadeIds: [...new Set(raw.destroyedPalisadeIds)],
  }
}
