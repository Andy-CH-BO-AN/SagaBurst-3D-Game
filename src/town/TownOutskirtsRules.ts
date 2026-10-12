import * as THREE from 'three'
import type { CareerProfile } from '../career/CareerProfile'
import { Faction } from '../combat/CombatFaction'
import { resolveUnitLoadout, type UnitPresetId } from '../battle/UnitPresetCatalog'
import type { CharacterFaction } from '../world/CharacterVisuals'
import type { NpcSpawnSpec } from '../battle/BattleSpawner'
import { T4_UNIT_PROFILES, resolveT4UnitLoadout } from '../battle/T4HeroCatalog'
import { AIType } from '../world/NPC'

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

export type OutskirtsCavalryTier = 2 | 4

/** Only the invading enemy army upgrades after an actual Commander appointment. */
export function outskirtsCavalryTier(profile: Pick<CareerProfile, 'rank' | 'faction'>, townFaction: CharacterFaction): OutskirtsCavalryTier {
  return profile.rank === 'commander' && outskirtsCavalryFaction(townFaction, profile.faction).faction === Faction.ENEMY ? 4 : 2
}

/** Pure roster policy, shared by deployment and data-only composition tests. */
export function outskirtsCavalryMember(townFaction: CharacterFaction, playerFaction: CharacterFaction,
  tier: OutskirtsCavalryTier, index: number): Omit<NpcSpawnSpec, 'actorId' | 'x' | 'z'> {
  const army = outskirtsCavalryFaction(townFaction, playerFaction)
  const common = { faction: army.faction, characterFaction: army.characterFaction, cavalry: true, respawnEnabled: false }
  if (tier === 2) return { ...common, tier, aiType: AIType.MELEE,
    name: army.characterFaction === 'roman' ? 'Sword Cavalry' : 'Axe Cavalry', presetId: army.presetId, loadout: army.loadout }
  const ranger = index >= 5
  const presetId: UnitPresetId = ranger ? `${army.characterFaction}_archer` : army.presetId
  const hero = T4_UNIT_PROFILES[presetId]
  const loadout = resolveT4UnitLoadout(presetId)
  return { ...common, tier, aiType: ranger ? AIType.RANGED : AIType.MELEE,
    name: ranger ? 'Ranger' : 'Captain', presetId, visualAssetId: hero.visualAssetId,
    combatProfileId: hero.combatProfileId, specialCombatProfile: hero.specialCombatProfile,
    loadout: ranger ? { ...loadout, meleeWeaponId: 'maki-ranger-bow', mountId: 'black-cat' } : loadout }
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
