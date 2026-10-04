import * as THREE from 'three'
import type { CareerProfile } from '../career/CareerProfile'
import { Faction } from '../combat/CombatFaction'
import { resolveUnitLoadout, type UnitPresetId } from '../battle/UnitPresetCatalog'
import type { CharacterFaction } from '../world/CharacterVisuals'

export const OUTSKIRTS_ALERT_RANGE = 35
/** Keep the established Bandit encounter distance and its provoked/returning semantics. */
export const OUTSKIRTS_ENCOUNTER_LEASH = 58
export const OUTSKIRTS_SENSOR_INTERVAL = .35
export const OUTSKIRTS_FOOT_SPEED = 2.2
export const OUTSKIRTS_CAVALRY_SPEED = 5
export type OutskirtsSquadKind = 'bandit' | 'cavalry'
export interface OutskirtsSquadSpec {
  id: string
  kind: OutskirtsSquadKind
  size: number
  phase: number
  route: THREE.Vector3[]
  edge: THREE.Vector3
}

export function outskirtsEnabled(profile: Pick<CareerProfile, 'rank'>): boolean {
  return profile.rank === 'captain' || profile.rank === 'commander'
}

/** The current world's owner defines the invading army, even in a foreign Town. */
export function outskirtsCavalryFaction(townFaction: CharacterFaction, playerFaction: CharacterFaction) {
  const characterFaction: CharacterFaction = townFaction === 'roman' ? 'viking' : 'roman'
  const presetId: UnitPresetId = characterFaction === 'roman' ? 'roman_sword_cavalry' : 'viking_sword_cavalry'
  return { characterFaction, faction: characterFaction === playerFaction ? Faction.TOWN : Faction.ENEMY,
    presetId, loadout: resolveUnitLoadout(presetId, 2) }
}

const points = (coordinates: readonly (readonly [number, number])[]) => coordinates.map(([x, z]) => new THREE.Vector3(x, 0, z))
const wRoute = (coordinates: readonly (readonly [number, number])[]) => points([...coordinates, ...coordinates.slice(1, -1).reverse()])

/** Independent sectors sit between the wall patrol and the five outer mission camps. */
export function outskirtsSquadSpecs(): OutskirtsSquadSpec[] {
  const bandits = [
    { route: [[-210, -170], [-180, -220], [-120, -190], [-170, -145]], edge: [-340, -180] },
    { route: [[210, -175], [250, -215], [170, -220], [180, -150]], edge: [340, -210] },
    { route: [[-180, -80], [-235, -40], [-230, 60], [-160, 40]], edge: [-340, -40] },
    { route: [[195, -40], [255, 0], [235, 85], [185, 75]], edge: [340, 60] },
    { route: [[-155, 145], [-210, 180], [-165, 225], [-110, 185]], edge: [-190, 340] },
    { route: [[185, 140], [235, 185], [160, 225], [140, 165]], edge: [195, 340] },
  ] as const
  const cavalry = [
    { route: [[-235, -250], [-205, -155], [-155, -245], [-110, -150], [-60, -235]], edge: [-130, -340] },
    { route: [[60, -240], [105, -150], [160, -240], [205, -150], [255, -245]], edge: [170, -340] },
    { route: [[-200, 235], [-110, 145], [-15, 235], [80, 145], [200, 230]], edge: [10, 340] },
  ] as const
  return [
    ...bandits.map((spec, i) => ({ id: `outskirts:bandit:${String.fromCharCode(97 + i)}`, kind: 'bandit' as const,
      size: 5, phase: i % spec.route.length, route: points(spec.route), edge: new THREE.Vector3(spec.edge[0], 0, spec.edge[1]) })),
    ...cavalry.map((spec, i) => ({ id: `outskirts:cavalry:${String.fromCharCode(97 + i)}`, kind: 'cavalry' as const,
      size: 10, phase: 1 + i * 2, route: wRoute(spec.route), edge: new THREE.Vector3(spec.edge[0], 0, spec.edge[1]) })),
  ]
}

export function outskirtsActorId(squadId: string, member: number, generation = 0): string {
  return `${squadId}:${member}${generation ? `:wave:${generation}` : ''}`
}
