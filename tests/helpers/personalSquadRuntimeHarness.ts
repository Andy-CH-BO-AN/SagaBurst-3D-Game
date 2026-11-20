import { Euler, Vector3 } from 'three'
import { expect, vi } from 'vitest'
import { addCareerItem } from '../../src/career/CareerInventory'
import { recruitPersonalSquadMember } from '../../src/career/CareerPersonalSquad'
import type { PersonalActorPosition, PersonalSquadMission } from '../../src/career/CareerPersonalSquadMission'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { EaglePadReservations } from '../../src/career/EaglePadReservations'
import { PersonalSquadRuntime, type spawnPersonalSquadActor } from '../../src/career/PersonalSquadRuntime'
import { ShieldState } from '../../src/combat/ShieldBlocking'
import type { EagleFlightPhase, EagleFlightSnapshot } from '../../src/movement/EagleFlightController'
import type { EagleLandingQueue } from '../../src/world/EagleLandingQueue'
import type { Mount } from '../../src/world/Mount'
import { Faction, type NPC } from '../../src/world/NPC'
import { NpcSpawnScheduler } from '../../src/world/NpcSpawnScheduler'
import { getTerrainHeight } from '../../src/world/Terrain'
import { careerRankFixture } from './careerRankFixture'

export interface StandbyActor {
  combatantId: string; dead: boolean; hp: number; maxHp: number; isMounted: boolean; isFalling: boolean
  /** Command-recipient identity read by ArmyCommandController. */
  faction: Faction; presetId: string; squadId: 'personal'
  mount?: Mount; tacticalOrder: string; missionMovement: boolean; formationCommandId: number | null; arrived: boolean
  /** The last walk/formation destination the runtime ordered, as the real NPC keeps it. */
  formationTarget?: Vector3
  combatAmmo: number; shield: { shieldImpactRemaining: number; shieldImpactMax: number } & Partial<ShieldState>
  /** The shield id the actor was given; its durability is keyed by this id while the model loads. */
  requestedShieldId?: string | null; refitCombat?: () => void
  group: { position: Vector3; rotation: Euler }; combatPosition: Vector3; disposed: boolean
  setTacticalOrder(order: string): void; assignFormationTarget: ReturnType<typeof vi.fn<NPC['assignFormationTarget']>>
  assignFollowTarget: ReturnType<typeof vi.fn>; isFormationTargetReached(id: number): boolean
  restoreCombatHealth(hp: number): void; restoreCombatAmmo(): void; dispose(): void
  flightOrder?: string; setEagleFlightOrder(order: { kind: string } | null): void
  mountVehicle(mount: Mount): void; dismountFromMount(): void
}
/** Grounded, stopped eagle on its pad: the numeric fields `isEaglePadArrived` and checkpoints read. */
export interface StandbyEagle {
  isFlyingMount: true; isAirborne: boolean; dead: boolean; currentHp: number; maxHp: number; armorImpactRemaining: number
  group: { position: Vector3; rotation: Euler }
  flight: { phase: EagleFlightPhase; speed: number; yaw: number; velocity: { x: number; y: number; z: number }
    snapshot(): unknown; restore(snapshot: EagleFlightSnapshot): void }
  restoreArmor(): void; dispose(): void
}
export interface StandbyHarnessOptions {
  saved?: PersonalSquadMission; failOnce?: string[]; queue?: EagleLandingQueue; loadingShields?: boolean; field?: boolean
}
type SpawnMember = Parameters<typeof spawnPersonalSquadActor>[1]

/**
 * Real `PersonalSquadRuntime` over saved hires; the actor factory returns numeric doubles
 * with only the private-squad lifecycle API (no scene, mesh or asset).
 */
export function standbyHarness(members: { id: string; mount?: 'xongkoro' | 'black-cat' }[], options: StandbyHarnessOptions = {}) {
  let profile = createCareerProfile('roman')
  Object.assign(profile, careerRankFixture(profile.faction, 'captain')); profile.availableMerit = 100_000
  // Real hires own their equipment; a mounted hire additionally owns its mount.
  for (const { id } of members) expect(recruitPersonalSquadMember(profile, 'soldier', next => { profile = next; return true }, () => id).recruited).toBe(true)
  for (const { id, mount } of members) if (mount) {
    addCareerItem(profile, mount, 1)
    profile.personalSquad!.members.find(member => member.id === id)!.equipment!.mount = mount
  }
  if (options.saved) profile.personalSquadRuntime = options.saved
  const muster = Array.from({ length: 30 }, (_, i) => ({ x: -80 + i % 5 * 4.5, y: 2.1, z: 20 + Math.floor(i / 5) * 4.5, yaw: 0 }))
  const pad = { id: 'private-eagle-pad:1', x: -85, y: 0, z: 54, yaw: Math.PI }
  const spawned: { id: string; slot: { x: number; z: number }; pad?: { x: number; z: number } }[] = []
  const actors: StandbyActor[] = [], mounts: StandbyEagle[] = []
  const failures = new Set(options.failOnce)
  const spawn = (_scene: unknown, member: SpawnMember, _faction: unknown, slot: PersonalActorPosition, _emit: unknown, boardingPad?: PersonalActorPosition) => {
    if (failures.delete(member.id)) throw new Error(`asset unavailable: ${member.id}`)
    const position = new Vector3(slot.x, slot.y ?? 0, slot.z)
    const actor: StandbyActor = { combatantId: member.id, dead: false, hp: 100, maxHp: 100, isMounted: false, isFalling: false,
      faction: Faction.PLAYER, presetId: 'roman_heavy_infantry', squadId: 'personal',
      tacticalOrder: 'defend', missionMovement: false, formationCommandId: null, arrived: false, combatAmmo: 0,
      shield: options.loadingShields ? new ShieldState() : { shieldImpactRemaining: 0, shieldImpactMax: 0 },
      requestedShieldId: options.loadingShields ? member.equipment?.shield ?? null : undefined,
      refitCombat() {}, group: { position, rotation: new Euler() }, combatPosition: position, disposed: false,
      setTacticalOrder(order) { actor.tacticalOrder = order },
      // A new walk order clears the previous arrival, as on the real NPC.
      assignFormationTarget: vi.fn<NPC['assignFormationTarget']>((id, target, _facing, _speed, arrivalOrder) => {
        actor.formationCommandId = id; actor.formationTarget = target.clone(); actor.tacticalOrder = arrivalOrder ?? 'formation'; actor.arrived = false
      }),
      assignFollowTarget: vi.fn(() => { actor.tacticalOrder = 'follow' }),
      isFormationTargetReached: () => actor.arrived,
      restoreCombatHealth(hp) { actor.hp = Math.min(actor.maxHp, hp) }, restoreCombatAmmo() {}, setEagleFlightOrder(order) { actor.flightOrder = order?.kind },
      dispose() { actor.disposed = true },
      mountVehicle(mount) { actor.mount = mount; actor.isMounted = true },
      dismountFromMount() { actor.mount = undefined; actor.isMounted = false } }
    actors.push(actor); spawned.push({ id: member.id, slot: { x: slot.x, z: slot.z }, ...(boardingPad ? { pad: { x: boardingPad.x, z: boardingPad.z } } : {}) })
    if (member.equipment?.mount !== 'xongkoro') return { npc: actor as unknown as NPC }
    const at = boardingPad ?? slot
    const flight: StandbyEagle['flight'] = { phase: 'grounded', speed: 0, yaw: pad.yaw, velocity: { x: 0, y: 0, z: 0 },
      snapshot: () => ({ phase: flight.phase, yaw: flight.yaw, pitch: 0, bank: 0, speed: flight.speed, velocity: { ...flight.velocity } }),
      restore(snapshot) { flight.phase = snapshot.phase; flight.yaw = snapshot.yaw; flight.speed = snapshot.speed } }
    const eagle: StandbyEagle = { isFlyingMount: true, isAirborne: false, dead: false, currentHp: 180, maxHp: 200, armorImpactRemaining: 0,
      group: { position: new Vector3(at.x, getTerrainHeight(at.x, at.z), at.z), rotation: new Euler(0, pad.yaw, 0) },
      flight, restoreArmor() {}, dispose() {} }
    mounts.push(eagle)
    if (!boardingPad) actor.mountVehicle(eagle as unknown as Mount)
    return { npc: actor as unknown as NPC, mount: eagle as unknown as Mount }
  }
  const scheduler = new NpcSpawnScheduler()
  const player = { dead: false, combatPosition: new Vector3(), group: { rotation: { y: 0 } } }
  const runtime = new PersonalSquadRuntime({} as never, muster, () => profile, () => player as never, spawn as typeof spawnPersonalSquadActor,
    { scheduler, hasHR: !options.field, ...(options.field ? { sceneKey: 'mission-field' } : {}), eaglePads: new EaglePadReservations([pad]), eagleLandingQueue: options.queue })
  let frame = 0
  const flush = () => { while (scheduler.pending) scheduler.tick(++frame) }
  return { runtime, scheduler, muster, pad, spawned, actors, mounts, flush,
    get profile() { return profile }, set profile(value) { profile = value } }
}
