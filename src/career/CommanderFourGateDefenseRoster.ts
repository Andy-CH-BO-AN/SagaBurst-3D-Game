import type { NpcSpawnSpec } from '../battle/BattleSpawner'
import { resolveT4UnitLoadout, T4_UNIT_PROFILES } from '../battle/T4HeroCatalog'
import { UNIT_PRESETS, type UnitPresetId } from '../battle/UnitPresetCatalog'
import { TOWN_PLAYABLE_WORLD_BOUND } from '../town/TownBounds'
import { TOWN_GATES, townGatePoint, type TownGateId } from '../town/TownLayout'
import type { CharacterFaction } from '../world/CharacterVisuals'
import { AIType, Faction } from '../world/NPC'
import { createTownSiegeCrewSlots, TOWN_SIEGE_WORLD_EDGE_INSET, type TownSiegeCrewSlot } from './TownFourGateSiegePolicy'
import { isCivilian, townRosterIdentity, type TownActorSpec } from '../town/TownRules'
import { townMerchantLoadout } from '../town/TownMerchantEquipment'
import type { OfficialCommandSquad } from './CareerCommandAuthority'
import { COMMANDER_TOWN_GATE_ORDER, commanderGateDefenseSlots } from './CommanderTownRoster'

export const COMMANDER_FOUR_GATE_DEFENSE_ID = 'commander-four-gate-defense'
export const COMMANDER_FOUR_GATE_DEFENSE_ENEMY_ROSTER_VERSION = 4 as const
export type CommanderEnemyRosterVersion = typeof COMMANDER_FOUR_GATE_DEFENSE_ENEMY_ROSTER_VERSION
export const COMMANDER_FOUR_GATE_DEFENDER_ROSTER_VERSION = 3 as const
export const FOUR_GATE_SQUAD_SIZE = 50
export const FOUR_GATE_RESERVE_SQUAD = 10
const FLANK_INFANTRY = { melee: 15, spear: 10 } as const
export const COMMANDER_FOUR_GATE_DEFENSE_ENEMIES = TOWN_GATES.length * (110 + 2 * (FLANK_INFANTRY.melee + FLANK_INFANTRY.spear))
export const COMMANDER_FOUR_GATE_DEFENSE_ARCHERS_PER_GATE = 30
export const COMMANDER_FOUR_GATE_DEFENSE_VANGUARD_PER_GATE = 25
export const COMMANDER_FOUR_GATE_GARRISON_PER_GATE = { archer: 10, infantry: 10, spear: 5 } as const
export const COMMANDER_FOUR_GATE_DEFENSE_INFANTRY_PER_RAMP = 10
export const COMMANDER_FOUR_GATE_DEFENSE_PREPARATION_SECONDS = 180

export interface CommanderFourGateDefenseSlot {
  actorId: string
  gateId: TownGateId
  role: 'pusher' | 'assault' | 'lancer' | 'archer' | 'infantry' | 'vanguard' | 'flank-melee' | 'flank-spear'
  tier: 3 | 4 | 5
  /** Stable authored role slot, not a position in a saved NPC array. */
  slot: number
  side?: -1 | 1
}

/** Saved identity is named by gate, vehicle, role and authored slot. Array reordering is harmless. */
export function commanderFourGateDefenseSlots(missionId: string,
  _enemyVersion: CommanderEnemyRosterVersion = COMMANDER_FOUR_GATE_DEFENSE_ENEMY_ROSTER_VERSION): CommanderFourGateDefenseSlot[] {
  const slots: CommanderFourGateDefenseSlot[] = []
  for (const gate of TOWN_GATES) {
    for (const side of [-1, 1] as const) {
      const prefix = `${missionId}:${gate.id}:${side < 0 ? 'left' : 'right'}`
      for (let slot = 1; slot <= 4; slot++) slots.push({ actorId: `${prefix}:pusher:${slot}`, gateId: gate.id, side, role: 'pusher', tier: 4, slot })
      for (let slot = 1; slot <= 5; slot++) slots.push({ actorId: `${prefix}:assault:t4:${slot}`, gateId: gate.id, side, role: 'assault', tier: 4, slot })
      slots.push({ actorId: `${prefix}:assault:t5:leader`, gateId: gate.id, side, role: 'assault', tier: 5, slot: 1 })
      for (const role of ['melee', 'spear'] as const) {
        for (let slot = 1; slot <= FLANK_INFANTRY[role]; slot++) {
          slots.push({ actorId: `${prefix}:flank:${role}:${slot}`, gateId: gate.id, side, role: `flank-${role}`, tier: 3, slot })
        }
      }
      // Rear guard of this exact vehicle; never Crew. Identity is faction-neutral.
      for (let slot = 1; slot <= COMMANDER_FOUR_GATE_DEFENSE_INFANTRY_PER_RAMP; slot++) {
        slots.push({ actorId: `${prefix}:escort:infantry:${slot}`, gateId: gate.id, side, role: 'infantry', tier: 3, slot })
      }
    }
    for (const role of ['lancer', 'archer'] as const) {
      for (let slot = 1; slot <= 14; slot++) slots.push({ actorId: `${missionId}:${gate.id}:${role}:t3:${slot}`, gateId: gate.id, role, tier: 3, slot })
      slots.push({ actorId: `${missionId}:${gate.id}:${role}:t4:leader`, gateId: gate.id, role, tier: 4, slot: 15 })
    }
    for (let slot = 16; slot <= COMMANDER_FOUR_GATE_DEFENSE_ARCHERS_PER_GATE; slot++) {
      slots.push({ actorId: `${missionId}:${gate.id}:archer:t3:${slot}`, gateId: gate.id, role: 'archer', tier: 3, slot })
    }
    for (let slot = 1; slot <= COMMANDER_FOUR_GATE_DEFENSE_VANGUARD_PER_GATE; slot++) {
      slots.push({ actorId: `${missionId}:${gate.id}:vanguard:t3:${slot}`, gateId: gate.id, role: 'vanguard', tier: 3, slot })
    }
  }
  return slots
}

export function commanderFourGateDefenseActorIds(missionId: string,
  enemyVersion: CommanderEnemyRosterVersion = COMMANDER_FOUR_GATE_DEFENSE_ENEMY_ROSTER_VERSION): string[] {
  return commanderFourGateDefenseSlots(missionId, enemyVersion).map(slot => slot.actorId)
}

/** Existing T3 melee infantry preset of the attacking faction: sword+scutum (Roman) or axe+round shield (Viking). */
function infantry(slot: CommanderFourGateDefenseSlot, faction: CharacterFaction): NpcSpawnSpec {
  const presetId: UnitPresetId = faction === 'roman' ? 'roman_heavy_infantry' : 'viking_berserker'
  const loadout = { ...UNIT_PRESETS[presetId].tierLoadouts[3], mountId: null }
  const gateLabel = `${slot.gateId[0].toUpperCase()}${slot.gateId.slice(1)}`
  // Placeholder muster behind the gate; the controller moves each to its vehicle's rear slot.
  const gate = TOWN_GATES.find(gate => gate.id === slot.gateId)!
  const point = townGatePoint(gate, (slot.side ?? 1) * 20, -(TOWN_PLAYABLE_WORLD_BOUND - TOWN_SIEGE_WORLD_EDGE_INSET - 40))
  return { actorId: slot.actorId, x: point.x, z: point.z, faction: Faction.ENEMY, characterFaction: faction,
    aiType: AIType.MELEE, name: `${gateLabel} Siege Escort T3`, tier: 3, characterTier: 3,
    cavalry: false, respawnEnabled: false, presetId, loadout }
}

/** T3 vanguard: same faction infantry preset, mustered on the central gate lane between both vehicles. */
function vanguard(slot: CommanderFourGateDefenseSlot, faction: CharacterFaction): NpcSpawnSpec {
  const presetId: UnitPresetId = faction === 'roman' ? 'roman_heavy_infantry' : 'viking_berserker'
  const gate = TOWN_GATES.find(gate => gate.id === slot.gateId)!
  const gateCoordinate = Math.max(Math.abs(Math.sin(gate.yaw) * gate.x), Math.abs(Math.cos(gate.yaw) * gate.z))
  const point = townGatePoint(gate, (slot.slot % 5 - 2) * 3, -(TOWN_PLAYABLE_WORLD_BOUND - TOWN_SIEGE_WORLD_EDGE_INSET - 8 - Math.floor((slot.slot - 1) / 5) * 3 - gateCoordinate))
  const gateLabel = `${gate.id[0].toUpperCase()}${gate.id.slice(1)}`
  return { actorId: slot.actorId, x: point.x, z: point.z, faction: Faction.ENEMY, characterFaction: faction,
    aiType: AIType.MELEE, name: `${gateLabel} Vanguard T3`, tier: 3, characterTier: 3,
    cavalry: false, respawnEnabled: false, presetId, loadout: { ...UNIT_PRESETS[presetId].tierLoadouts[3], mountId: null } }
}

export const FOUR_GATE_OFFICER_IDS = [
  'commander', 'captain', 'town-patrol:a:captain', 'town-patrol:b:captain',
  'hr-officer', 'deployment', 'ranger', 'eagle-trainer',
] as const

const reserveNativeIds = () => new Set<string>([
  ...townRosterIdentity().filter(actor => isCivilian(actor.role)).map(actor => actor.id),
  ...FOUR_GATE_OFFICER_IDS,
])

export const FOUR_GATE_GROUND_COMPANIES = [
  { role: 'spear', tier: 2, count: 5 },
  { role: 'spear', tier: 3, count: 10 },
  { role: 'ranged', tier: 2, count: 10 },
  { role: 'ranged', tier: 3, count: 5 },
  { role: 'melee', tier: 2, count: 10 },
  { role: 'melee', tier: 3, count: 10 },
] as const
type GroundCompany = typeof FOUR_GATE_GROUND_COMPANIES[number]

export interface CommanderFourGateGarrisonSlot {
  actorId: string
  gateId: TownGateId
  role: 'archer' | 'infantry' | 'spear' | 'ranged' | 'melee'
  tier: 2 | 3
  post: 'wall' | 'ground'
  slot: number
}

function groundCompanySlots(): GroundCompany[] {
  return FOUR_GATE_GROUND_COMPANIES.flatMap(company => Array.from({ length: company.count }, () => company))
}

/** Foot replacements retain the native training/Patrol identity in the accepted mission. */
export function commanderFourGateGroundResidents(): Map<string, GroundCompany> {
  const slots = groundCompanySlots(), reserveNative = reserveNativeIds()
  return new Map(commanderGateDefenseSlots().filter(squad => squad.squadId % 2 === 0)
    .flatMap(squad => squad.actorIds.filter(id => !reserveNative.has(id)).map((id, i) => [id, slots[i]] as const)))
}

export function commanderFourGateReserveRecruits(missionId: string): string[] {
  return Array.from({ length: FOUR_GATE_SQUAD_SIZE - reserveNativeIds().size }, (_, i) => `${missionId}:reserve:lancer:${i + 1}`)
}

export function commanderFourGateGarrisonSlots(missionId: string): CommanderFourGateGarrisonSlot[] {
  const native = commanderGateDefenseSlots(), reserveNative = reserveNativeIds()
  return COMMANDER_TOWN_GATE_ORDER.flatMap((gateId, index) => {
    const nativeGroundCount = native[index * 2 + 1].actorIds.filter(id => !reserveNative.has(id)).length
    const wall = (['archer', 'infantry', 'spear'] as const).flatMap(role =>
      Array.from({ length: COMMANDER_FOUR_GATE_GARRISON_PER_GATE[role] }, (_, i): CommanderFourGateGarrisonSlot => ({
        actorId: `${missionId}:${gateId}:garrison:${role}:${i + 1}`, gateId, role, slot: i + 1, tier: 3, post: 'wall',
      })))
    const ground = groundCompanySlots().slice(nativeGroundCount).map(({ role, tier }, i): CommanderFourGateGarrisonSlot => ({
      actorId: `${missionId}:${gateId}:ground:${i + nativeGroundCount + 1}`, gateId, role, tier, slot: i + nativeGroundCount + 1, post: 'ground',
    }))
    return [...wall, ...ground]
  })
}

export function commanderFourGateMissionSquads(missionId: string): OfficialCommandSquad[] {
  const garrison = commanderFourGateGarrisonSlots(missionId), reserveNative = reserveNativeIds()
  const squads = commanderGateDefenseSlots().map(squad => {
    const gateId = COMMANDER_TOWN_GATE_ORDER[Math.floor((squad.squadId - 1) / 2)]
    const post = squad.squadId % 2 === 0 ? 'ground' : 'wall'
    return { ...squad, actorIds: [...squad.actorIds.filter(id => !reserveNative.has(id)),
      ...garrison.filter(slot => slot.gateId === gateId && slot.post === post).map(slot => slot.actorId)] }
  })
  squads.push({ squadId: FOUR_GATE_RESERVE_SQUAD, actorIds: [...reserveNative, ...commanderFourGateReserveRecruits(missionId)] })
  const ids = squads.flatMap(squad => squad.actorIds)
  if (squads.some(squad => squad.actorIds.length !== FOUR_GATE_SQUAD_SIZE) || new Set(ids).size !== ids.length) {
    throw new Error('Invalid four-gate defense army')
  }
  return squads
}

export function fourGateFootPreset(faction: CharacterFaction, role: CommanderFourGateGarrisonSlot['role']): UnitPresetId {
  if (role === 'archer' || role === 'ranged' && faction === 'viking') return `${faction}_archer`
  if (role === 'ranged') return 'roman_javelin_infantry'
  if (role === 'spear') return `${faction}_spearman`
  return faction === 'roman' ? 'roman_heavy_infantry' : 'viking_berserker'
}

export function fourGateFootLoadout(faction: CharacterFaction, role: CommanderFourGateGarrisonSlot['role'], tier: 2 | 3) {
  const presetId = fourGateFootPreset(faction, role)
  return { presetId, loadout: { ...UNIT_PRESETS[presetId].tierLoadouts[tier], mountId: null } }
}

/** Mission-only kit: ordinary civilians receive a lance and shield; the Merchant retains his personal weapons. */
export function fourGateReserveTrooperLoadout(faction: CharacterFaction, role: 'civilian' | 'merchant' | 'recruit') {
  if (role === 'merchant') return townMerchantLoadout('horse')
  const lancer = UNIT_PRESETS[`${faction}_lancer`].tierLoadouts[role === 'civilian' ? 2 : 3]
  return role === 'civilian' ? { ...lancer, shieldId: faction === 'roman' ? 'scutum_t2' : 'round_shield_t2' } : { ...lancer }
}

export function prepareFourGateGroundResident(spec: TownActorSpec, company: GroundCompany): TownActorSpec {
  const { role, tier } = company
  return { ...spec, mounted: false, garrison: undefined, tier, y: undefined,
    unitKind: role === 'spear' ? 'spearman' : role,
    role: role === 'spear' ? 'spearman_infantry' : role === 'ranged' ? 'ranged_infantry' : 'melee_infantry' }
}

export function createCommanderFourGateGarrison(missionId: string, faction: CharacterFaction): NpcSpawnSpec[] {
  return commanderFourGateGarrisonSlots(missionId).map(slot => {
    const gate = TOWN_GATES.find(gate => gate.id === slot.gateId)!
    return { actorId: slot.actorId, ...townGatePoint(gate, 0, 20), faction: Faction.TOWN, characterFaction: faction,
      aiType: slot.role === 'archer' || slot.role === 'ranged' ? AIType.RANGED : AIType.MELEE,
      name: `${gate.id} ${slot.role} T${slot.tier}`, tier: slot.tier, characterTier: slot.tier,
      cavalry: false, respawnEnabled: false, ...fourGateFootLoadout(faction, slot.role, slot.tier) }
  })
}

function troop(slot: CommanderFourGateDefenseSlot, faction: CharacterFaction): NpcSpawnSpec {
  const presetId: UnitPresetId = `${faction}_${slot.role === 'lancer' ? 'lancer' : 'archer'}`
  const tier = slot.tier === 3 ? 3 : 4
  const hero = tier === 4 ? T4_UNIT_PROFILES[presetId] : undefined
  const loadout = tier === 4 ? resolveT4UnitLoadout(presetId) : { ...UNIT_PRESETS[presetId].tierLoadouts[3] }
  loadout.mountId = slot.role === 'lancer'
    ? tier === 3 ? 'horse' : faction === 'roman' ? 'corgi' : 'black-cat' : null
  const gate = TOWN_GATES.find(gate => gate.id === slot.gateId)!
  // Placeholder musters; the Commander controller moves lancers behind and archers ahead of their vehicles.
  const lateral = slot.role === 'lancer' ? (slot.slot % 5 - 2) * 4 : 74 + (slot.slot % 5) * 3.5
  // Leave room for the full mounted body/wing envelope at the actual map border.
  // Ground ranks occupy separate gate/outer-archer corridors, outside both vehicle lanes.
  const margin = 4 + Math.floor((slot.slot - 1) / 5) * 5
  const gateCoordinate = Math.max(Math.abs(Math.sin(gate.yaw) * gate.x), Math.abs(Math.cos(gate.yaw) * gate.z))
  const outward = TOWN_PLAYABLE_WORLD_BOUND - margin - gateCoordinate
  const point = townGatePoint(gate, lateral, -outward)
  const gateLabel = `${gate.id[0].toUpperCase()}${gate.id.slice(1)}`
  return { actorId: slot.actorId, x: point.x, z: point.z, faction: Faction.ENEMY, characterFaction: faction,
    aiType: slot.role === 'lancer' ? AIType.MELEE : AIType.RANGED,
    name: `${gateLabel} ${slot.role === 'lancer' ? 'Lancer' : 'Archer'} T${tier}`,
    tier, characterTier: tier,
    ...(hero ? { heroArchetype: hero.combatProfileId === 'ranger' ? 'ranger' as const : 'captain' as const } : {}),
    cavalry: Boolean(loadout.mountId), respawnEnabled: false, presetId, loadout,
    ...(hero ? { visualAssetId: hero.visualAssetId, combatProfileId: hero.combatProfileId,
      ...(hero.specialCombatProfile ? { specialCombatProfile: hero.specialCombatProfile } : {}) } : {}) }
}

/** Archer screen just ahead of its own vehicle: slots 1-7 and 16-23 lead the left ramp, 8-15 and 24-30 the right.
 * Each rank stands beside, never inside, the moving lane (the convoy detour only covers
 * bodies beside or behind the chassis), so the vehicle is never blocked from the front. */
export function commanderArcherScreenSide(slot: number): -1 | 1 { return slot <= 7 || slot >= 16 && slot <= 23 ? -1 : 1 }
export function commanderArcherScreenTarget(slot: number, front: { x: number; z: number }, inward: { x: number; z: number }): { x: number; z: number } {
  const index = slot <= 7 ? slot - 1 : slot <= 15 ? slot - 8 : slot <= 23 ? slot - 9 : slot - 16
  const flank = index % 2 === 0 ? -1 : 1, rank = Math.floor(index / 2)
  const lateral = flank * (8 + (rank % 2) * 3), ahead = 6 + Math.floor(rank / 2) * 4
  return { x: front.x + inward.x * ahead + inward.z * lateral, z: front.z + inward.z * ahead - inward.x * lateral }
}

/** Reuses PR7's eighty crew assets/profiles and Crew Allocation unchanged. Faction is the attacker. */
export function createCommanderFourGateDefenseRoster(missionId: string, faction: CharacterFaction,
  enemyVersion: CommanderEnemyRosterVersion = COMMANDER_FOUR_GATE_DEFENSE_ENEMY_ROSTER_VERSION): {
  crew: TownSiegeCrewSlot[]; cavalry: NpcSpawnSpec[]; archers: NpcSpawnSpec[]; infantry: NpcSpawnSpec[]; vanguard: NpcSpawnSpec[]
  flanks: { slot: CommanderFourGateDefenseSlot; formationSlot: number; spec: NpcSpawnSpec }[]
  ground: NpcSpawnSpec[]; all: NpcSpawnSpec[]; gateByActorId: Map<string, TownGateId>
} {
  const slots = commanderFourGateDefenseSlots(missionId, enemyVersion)
  const crewSlots = slots.filter(slot => slot.role === 'pusher' || slot.role === 'assault')
  const production = new Map(createTownSiegeCrewSlots(faction).map(slot => [
    `${slot.gateId}:${slot.side}:${slot.role}:${slot.spec.visualAssetId === `${faction}-hero-t5` ? 5 : 4}`, slot,
  ]))
  const crew = crewSlots.map(slot => {
    const original = production.get(`${slot.gateId}:${slot.side}:${slot.role}:${slot.tier}`)!
    return { ...original, spec: { ...original.spec, actorId: slot.actorId, loadout: { ...original.spec.loadout },
      name: `${slot.gateId[0].toUpperCase()}${slot.gateId.slice(1)} ${slot.role === 'pusher' ? 'Siege Pusher' : 'Assault Infantry'} T${slot.tier}` } }
  })
  const cavalry = slots.filter(slot => slot.role === 'lancer').map(slot => troop(slot, faction))
  const archers = slots.filter(slot => slot.role === 'archer').map(slot => troop(slot, faction))
  const infantryTroops = slots.filter(slot => slot.role === 'infantry').map(slot => infantry(slot, faction))
  const vanguardTroops = slots.filter(slot => slot.role === 'vanguard').map(slot => vanguard(slot, faction))
  const flanks = slots.filter(slot => slot.role === 'flank-melee' || slot.role === 'flank-spear').map(slot => ({
    slot, formationSlot: slot.slot - 1 + (slot.role === 'flank-spear' ? FLANK_INFANTRY.melee : 0),
    spec: { ...infantry(slot, faction), name: `${slot.gateId} ${slot.role === 'flank-spear' ? 'Spearman' : 'Infantry'} T3`,
      ...fourGateFootLoadout(faction, slot.role === 'flank-spear' ? 'spear' : 'melee', 3) },
  }))
  const ground = [...crew.map(slot => slot.spec), ...cavalry, ...archers, ...infantryTroops, ...vanguardTroops, ...flanks.map(({ spec }) => spec)]
  return { crew, cavalry, archers, flanks, infantry: infantryTroops, vanguard: vanguardTroops, ground, all: [...ground],
    gateByActorId: new Map(slots.map(slot => [slot.actorId, slot.gateId])) }
}
