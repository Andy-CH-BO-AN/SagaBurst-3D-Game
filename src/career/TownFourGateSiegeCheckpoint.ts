import type { MobileSiegeRampSnapshot } from '../campaign/MobileSiegeRamp'
import { SIEGE_RAMP, type TownSiegeRampId } from '../campaign/MobileSiegeRampPolicy'
import { DAMAGEABLE_OBSTACLE_HP } from '../world/DamageableObstacle'
import { parseFallingRiderSnapshot } from '../movement/FallingRider'
import { TOWN_GATES } from '../town/TownLayout'
import { TOWN_PLAYABLE_WORLD_BOUND } from '../town/TownBounds'
import type { PersonalActorCheckpoint } from './CareerPersonalSquadMission'
import type { TownGateBreachState } from './TownGateBreachPolicy'
import { townSiegeFrame, townSiegeRampId, TOWN_SIEGE_DOCK_INWARD, type TownSiegeRampAssignment } from './TownFourGateSiegePolicy'

export interface TownSiegeActorCheckpoint extends PersonalActorCheckpoint { entranceId: string | null; breachCompleted: boolean }
export interface TownFourGateSiegeCheckpoint {
  version: 1
  faction: 'roman' | 'viking'
  ramps: (MobileSiegeRampSnapshot<TownSiegeRampId> & { assignment: TownSiegeRampAssignment; travelDistance: number })[]
  gates: (TownGateBreachState & { hp: number })[]
  actors: Record<string, TownSiegeActorCheckpoint>
  playerCommandedActorIds: string[]
}
const finite = (value: unknown, max = 100000): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9:_-]{1,256}$/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value)
const uniqueIds = (value: unknown, max: number): value is string[] => Array.isArray(value) && value.length <= max && value.every(id) && new Set(value).size === value.length
const point = (value: unknown): boolean => {
  const p = value as { x: number; y: number; z: number } | undefined
  return !!p && typeof p.x === 'number' && typeof p.y === 'number' && typeof p.z === 'number'
    && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)
    && Math.abs(p.x) <= TOWN_PLAYABLE_WORLD_BOUND && Math.abs(p.z) <= TOWN_PLAYABLE_WORLD_BOUND && Math.abs(p.y) <= 200
}
const orders = ['attack', 'charge', 'defend', 'follow', 'formation']

/** Closed, bounded v1 contract, independent of the unchanged two-ramp Campaign parser. */
export function parseTownFourGateSiegeCheckpoint(value: unknown): TownFourGateSiegeCheckpoint | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as TownFourGateSiegeCheckpoint
  if (raw.version !== 1 || !['roman', 'viking'].includes(raw.faction) || !Array.isArray(raw.ramps) || raw.ramps.length !== 8
    || !Array.isArray(raw.gates) || raw.gates.length !== 4 || !raw.actors || typeof raw.actors !== 'object' || Array.isArray(raw.actors)
    || Object.keys(raw.actors).length > 1024 || !uniqueIds(raw.playerCommandedActorIds, 1024)) return undefined
  const rampIds = new Set<string>(), crewIds = new Set<string>(), gateIds = new Set<string>()
  for (const ramp of raw.ramps) {
    const a = ramp?.assignment
    if (!a || !TOWN_GATES.some(g => g.id === a.gateId) || ![-1, 1].includes(a.side) || a.id !== townSiegeRampId(a.gateId, a.side)
      || rampIds.has(a.id) || !uniqueIds(a.pusherIds, 4) || a.pusherIds.length !== 4 || !uniqueIds(a.assaultIds, 6) || a.assaultIds.length !== 6
      || !point(ramp.position) || !finite(ramp.hp, DAMAGEABLE_OBSTACLE_HP.siege_ramp) || !finite(ramp.travelDistance, 700) || ramp.travelDistance <= 0
      || !finite(ramp.distance, ramp.travelDistance) || !finite(ramp.dockingProgress, 1) || typeof ramp.stagingZ !== 'number' || !Number.isFinite(ramp.stagingZ)
      || !['DEPLOYING', 'PUSHING', 'DOCKING', 'DOCKED', 'ABANDONED', 'DESTROYED'].includes(ramp.state)
      || (ramp.hp === 0) !== (ramp.state === 'DESTROYED')
      || (ramp.state === 'DOCKED' && (ramp.distance !== ramp.travelDistance || ramp.dockingProgress !== 1))
      || (ramp.state === 'DOCKING' && (ramp.distance !== ramp.travelDistance || ramp.dockingProgress >= 1))
      || (['DEPLOYING', 'PUSHING'].includes(ramp.state) && ramp.dockingProgress !== 0)
      || ramp.state === 'DEPLOYING' && ramp.distance !== 0
      || ramp.state === 'PUSHING' && ramp.distance >= ramp.travelDistance
      || ramp.dockingProgress > 0 && ramp.distance !== ramp.travelDistance) return undefined
    rampIds.add(a.id)
    for (const actor of [...a.pusherIds, ...a.assaultIds]) { if (crewIds.has(actor)) return undefined; crewIds.add(actor) }
  }
  for (const gate of raw.gates) {
    if (!gate || !TOWN_GATES.some(g => g.id === gate.gateId) || gateIds.has(gate.gateId) || !['open', 'closed', 'destroyed'].includes(gate.gateState)
      || !finite(gate.hp, 2080) || (gate.hp === 0) !== (gate.gateState === 'destroyed') || !uniqueIds(gate.dockedRampIds, 2)
      || !uniqueIds(gate.releasedWallActorIds, 512) || !uniqueIds(gate.releasedCavalryActorIds, 512)
      || typeof gate.wallEventHandled !== 'boolean' || typeof gate.cavalryEventHandled !== 'boolean'
      || gate.gateState === 'destroyed' && !gate.cavalryEventHandled
      || gate.releasedWallActorIds.length > 0 && !gate.wallEventHandled || gate.releasedCavalryActorIds.length > 0 && !gate.cavalryEventHandled) return undefined
    gateIds.add(gate.gateId)
    const docked = raw.ramps.filter(r => r.assignment.gateId === gate.gateId && r.state === 'DOCKED').map(r => r.assignment.id)
    if (docked.length !== gate.dockedRampIds.length || docked.some(id => !gate.dockedRampIds.includes(id)) || docked.length && !gate.wallEventHandled) return undefined
  }
  const releasedIds = raw.gates.flatMap(g => [...g.releasedWallActorIds, ...g.releasedCavalryActorIds])
  if (new Set(releasedIds).size !== releasedIds.length || releasedIds.some(id => !Object.prototype.hasOwnProperty.call(raw.actors, id))) return undefined
  const entranceIds = new Set([...rampIds, ...TOWN_GATES.map(g => `town-siege-gate:${g.id}`)])
  for (const [actorId, actor] of Object.entries(raw.actors)) {
    if (!id(actorId) || !actor || !['reserve', 'deployed', 'dead', 'exited'].includes(actor.status) || !finite(actor.hp)
      || !point(actor.position) || !Number.isFinite(actor.position?.yaw) || actor.order === undefined || !orders.includes(actor.order)
      || typeof actor.breachCompleted !== 'boolean' || actor.entranceId !== null && !entranceIds.has(actor.entranceId)
      || (actor.status === 'dead') !== (actor.hp === 0)
      || actor.ammo !== undefined && !finite(actor.ammo) || actor.shieldImpact !== undefined && !finite(actor.shieldImpact)
      || actor.fall !== undefined && !parseFallingRiderSnapshot(actor.fall)) return undefined
    const mount = actor.mount
    if (mount && (!finite(mount.hp) || typeof mount.mounted !== 'boolean' || !point(mount.position) || !Number.isFinite(mount.position.yaw) || mount.flight !== undefined)) return undefined
    const f = actor.formation
    if (f && (!finite(f.commandId) && !(typeof f.commandId === 'number' && Number.isFinite(f.commandId))
      || !point(f.position) || !Number.isFinite(f.position.yaw) || typeof f.reached !== 'boolean'
      || f.speedLimit !== undefined && !finite(f.speedLimit) || f.arrivalOrder !== undefined && !orders.includes(f.arrivalOrder))) return undefined
  }
  if ([...crewIds].some(id => !Object.prototype.hasOwnProperty.call(raw.actors, id)) || raw.playerCommandedActorIds.some(id => !Object.prototype.hasOwnProperty.call(raw.actors, id))) return undefined
  // A checkpoint cannot give a live ramp a bridge while its physical position is still outside the dock.
  for (const ramp of raw.ramps) {
    const frame = townSiegeFrame(ramp.assignment.gateId), front = ramp.position
    const outwardDistance = (front.x - frame.gate.x) * frame.outward.x + (front.z - frame.gate.z) * frame.outward.z
    if (Math.abs(outwardDistance - (SIEGE_RAMP.bridgeLength - TOWN_SIEGE_DOCK_INWARD + ramp.travelDistance - ramp.distance)) > .01) return undefined
    const lateral = (front.x - frame.gate.x) * frame.tangent.x + (front.z - frame.gate.z) * frame.tangent.z
    if (lateral * ramp.assignment.side < 17 || Math.abs(lateral) > 65) return undefined
  }
  return { version: 1, faction: raw.faction, playerCommandedActorIds: [...raw.playerCommandedActorIds],
    ramps: raw.ramps.map(r => ({ assignment: { id: r.assignment.id, gateId: r.assignment.gateId, side: r.assignment.side,
      pusherIds: [...r.assignment.pusherIds], assaultIds: [...r.assignment.assaultIds] }, stagingZ: r.stagingZ,
      position: { x: r.position.x, y: r.position.y, z: r.position.z }, hp: r.hp, state: r.state,
      distance: r.distance, travelDistance: r.travelDistance, dockingProgress: r.dockingProgress })),
    gates: raw.gates.map(g => ({ gateId: g.gateId, gateState: g.gateState, hp: g.hp, dockedRampIds: [...g.dockedRampIds],
      wallEventHandled: g.wallEventHandled, cavalryEventHandled: g.cavalryEventHandled,
      releasedWallActorIds: [...g.releasedWallActorIds], releasedCavalryActorIds: [...g.releasedCavalryActorIds] })),
    actors: Object.fromEntries(Object.entries(raw.actors).map(([id, a]) => [id, {
      status: a.status, hp: a.hp, position: { x: a.position!.x, y: a.position!.y, z: a.position!.z, yaw: a.position!.yaw },
      order: a.order, entranceId: a.entranceId, breachCompleted: a.breachCompleted,
      ...(a.ammo !== undefined ? { ammo: a.ammo } : {}), ...(a.shieldImpact !== undefined ? { shieldImpact: a.shieldImpact } : {}),
      ...(a.fall ? { fall: parseFallingRiderSnapshot(a.fall) } : {}),
      ...(a.townRampartGarrison === true ? { townRampartGarrison: true } : {}),
      ...(a.townRampartMounted === true ? { townRampartMounted: true } : {}),
      ...(a.formation ? { formation: { commandId: a.formation.commandId, reached: a.formation.reached,
        position: { x: a.formation.position.x, y: a.formation.position.y, z: a.formation.position.z, yaw: a.formation.position.yaw },
        ...(a.formation.arrivalOrder ? { arrivalOrder: a.formation.arrivalOrder } : {}),
        ...(a.formation.speedLimit !== undefined ? { speedLimit: a.formation.speedLimit } : {}) } } : {}),
      ...(a.mount ? { mount: { hp: a.mount.hp, mounted: a.mount.mounted,
        position: { x: a.mount.position.x, y: a.mount.position.y, z: a.mount.position.z, yaw: a.mount.position.yaw } } } : {}),
    }])) }

}
