import * as THREE from 'three'
import { TOWN_CITY, TOWN_GATES, townGatePoint, type TownGateId } from '../town/TownLayout'
import { TOWN_PLAYABLE_WORLD_BOUND } from '../town/TownBounds'
import { townCaptainProfile, townAssaultObjectiveRoster, type TownActorSpec } from '../town/TownRules'
import { T4_UNIT_PROFILES } from '../battle/T4HeroCatalog'
import { UNIT_PRESETS, type UnitPresetId } from '../battle/UnitPresetCatalog'
import type { NpcSpawnSpec } from '../battle/BattleSpawner'
import type { CharacterFaction } from '../world/CharacterVisuals'
import { AIType, Faction } from '../world/NPC'

export const SIEGE_COMBATANTS = 120
export const SIEGE_PREPARATION_SECONDS = 10
export interface TownSiegeState {
  version: 1
  rosterCreated: boolean
  /** Slot order is authoritative, including casualties and claimed world identities. */
  attackerIds: string[]
  claimedSquadIds: string[]
  destroyedGateIds: TownGateId[]
  releasedReserveGateIds: TownGateId[]
  crossedActorIds: string[]
  approachedActorIds: string[]
  defensePlans: SiegeDefensePlan[]
  gateHealth: Partial<Record<TownGateId, number>>
  playerPosition?: { x: number; z: number; yaw: number }
}
export function newTownSiegeState(): TownSiegeState {
  return { version: 1, rosterCreated: false, attackerIds: [], claimedSquadIds: [], destroyedGateIds: [], releasedReserveGateIds: [], crossedActorIds: [], approachedActorIds: [], defensePlans: [], gateHealth: {} }
}
export const siegeGate = (id: TownGateId) => TOWN_GATES.find(gate => gate.id === id)!
export const siegeOutward = (id: TownGateId) => new THREE.Vector3(Math.sin(siegeGate(id).yaw), 0, Math.cos(siegeGate(id).yaw))
export function siegePoint(id: TownGateId, side: number, inward: number): THREE.Vector3 {
  const p = townGatePoint(siegeGate(id), side, inward)
  return new THREE.Vector3(p.x, 0, p.z)
}
/** Nearest gate owns the local defense sector, including just outside its breach. */
export function siegeNearestGate(point: THREE.Vector3): TownGateId {
  return TOWN_GATES.reduce((nearest, gate) =>
    (point.x - gate.x) ** 2 + (point.z - gate.z) ** 2 < (point.x - nearest.x) ** 2 + (point.z - nearest.z) ** 2 ? gate : nearest).id
}
export function siegeReservePoint(id: TownGateId, index: number): THREE.Vector3 {
  return siegePoint(id, (index % 5 - 2) * 5, 30 + Math.floor(index / 5) * 5)
}
export function siegeMuster(id: TownGateId, slot = 0): THREE.Vector3 {
  const direction = siegeOutward(id), gate = siegeGate(id)
  const extent = TOWN_PLAYABLE_WORLD_BOUND - 45
  const center = new THREE.Vector3(Math.abs(direction.x) > .5 ? direction.x * extent : gate.x, 0,
    Math.abs(direction.z) > .5 ? direction.z * extent : gate.z)
  return center.add(new THREE.Vector3(direction.z, 0, -direction.x).multiplyScalar((slot % 6 - 2.5) * 5))
    .addScaledVector(direction, Math.floor(slot / 6) * 5)
}
export function insideSiegeTown(point: THREE.Vector3): boolean {
  return point.x > TOWN_CITY.minX && point.x < TOWN_CITY.maxX && point.z > TOWN_CITY.minZ && point.z < TOWN_CITY.maxZ
}
export interface SiegeRosterSlot { gateId: TownGateId; slot: number; spec: NpcSpawnSpec }
/** Player replaces a North regular melee slot; all four T4 officers remain present. */
export function siegeRoster(faction: CharacterFaction, assault: boolean): SiegeRosterSlot[] {
  return TOWN_GATES.flatMap((gate, gateIndex) => Array.from({ length: 30 }, (_, slot): SiegeRosterSlot | null => {
    if (assault && gateIndex === 0 && slot === 1) return null
    const ranger = gateIndex === 3 && slot === 20
    const captain = gateIndex !== 3 && slot === 0
    const presetId = `${faction}_${slot < 10 ? 'sword_cavalry' : slot < 20 ? 'lancer' : 'horse_archer'}` as UnitPresetId
    const hero = captain ? townCaptainProfile(faction) : ranger ? T4_UNIT_PROFILES.viking_archer : undefined
    const point = siegeMuster(gate.id, slot)
    return { gateId: gate.id, slot, spec: {
      x: point.x, z: point.z, faction: assault ? Faction.TOWN : Faction.ENEMY, characterFaction: faction,
      aiType: slot >= 20 ? AIType.RANGED : AIType.MELEE, name: captain ? 'Captain' : ranger ? 'Maki' : `${gate.id} ${slot + 1}`,
      tier: hero ? 4 : 3, cavalry: true, respawnEnabled: false, presetId, squadId: (gateIndex + 1) as 1 | 2 | 3 | 4,
      loadout: { ...UNIT_PRESETS[presetId].tierLoadouts[3], ...(ranger ? { mountId: 'black-cat' as const } : hero?.mountOverride ? { mountId: hero.mountOverride } : {}) },
      ...(hero ? { visualAssetId: hero.visualAssetId, combatProfileId: hero.combatProfileId, specialCombatProfile: hero.specialCombatProfile } : {}),
    } }
  }).filter((slot): slot is SiegeRosterSlot => slot !== null))
}
export interface SiegeDefensePlan { gateId: TownGateId; infantry: string[]; cavalry: string[]; leaderId?: string }
export function siegeDefensePlans(roster: readonly TownActorSpec[]): SiegeDefensePlan[] {
  const military = townAssaultObjectiveRoster([...roster])
  const plans: SiegeDefensePlan[] = TOWN_GATES.map(gate => ({ gateId: gate.id, infantry: [], cavalry: [] }))
  const leaders = ['captain', 'ranger', 'town-patrol:a:captain', 'town-patrol:b:captain']
  for (const actor of military.filter(actor => !actor.mounted && actor.role !== 'ranger' && actor.gateId)) {
    plans.find(plan => plan.gateId === actor.gateId)!.infantry.push(actor.id)
  }
  for (const actor of military.filter(actor => !actor.mounted && actor.role !== 'ranger' && !actor.gateId)) {
    [...plans].sort((a, b) => a.infantry.length - b.infantry.length)[0].infantry.push(actor.id)
  }
  leaders.forEach((id, index) => { if (military.some(actor => actor.id === id)) { plans[index].cavalry.push(id); plans[index].leaderId = id } })
  for (const actor of military.filter(actor => (actor.mounted || actor.role === 'ranger') && !leaders.includes(actor.id))) {
    [...plans].sort((a, b) => a.cavalry.length - b.cavalry.length)[0].cavalry.push(actor.id)
  }
  return plans
}
