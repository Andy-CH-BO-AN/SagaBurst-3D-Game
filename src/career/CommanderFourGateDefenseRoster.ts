import type { NpcSpawnSpec } from '../battle/BattleSpawner'
import { resolveT4UnitLoadout, T4_UNIT_PROFILES } from '../battle/T4HeroCatalog'
import { UNIT_PRESETS, type UnitPresetId } from '../battle/UnitPresetCatalog'
import { TOWN_PLAYABLE_WORLD_BOUND } from '../town/TownBounds'
import { TOWN_GATES, townGatePoint, type TownGateId } from '../town/TownLayout'
import type { CharacterFaction } from '../world/CharacterVisuals'
import { AIType, Faction } from '../world/NPC'
import { createTownSiegeCrewSlots, type TownSiegeCrewSlot } from './TownFourGateSiegePolicy'
import type { OfficialCommandSquad } from './CareerCommandAuthority'
import { COMMANDER_TOWN_GATE_ORDER, commanderGateDefenseSlots } from './CommanderTownRoster'

export const COMMANDER_FOUR_GATE_DEFENSE_ID = 'commander-four-gate-defense'
/** Current accepted enemy army: 80 crew, 60 lancers, 120 archers, 80 T3 siege-escort infantry and 100 T3 vanguard. */
export const COMMANDER_FOUR_GATE_DEFENSE_ENEMIES = 440
/** v3 adds 40 T3 attackers per gate (25 vanguard, 15 archers) and the 20-per-gate T3 mission garrison. */
export type CommanderEnemyRosterVersion = 3
export const COMMANDER_FOUR_GATE_DEFENSE_ENEMY_ROSTER_VERSION: CommanderEnemyRosterVersion = 3
export const COMMANDER_FOUR_GATE_DEFENSE_ARCHERS_PER_GATE = 30
export const COMMANDER_FOUR_GATE_DEFENSE_VANGUARD_PER_GATE = 25
/** Mission-only T3 defenders per gate, outside the eight 30-person official squads. */
export const COMMANDER_FOUR_GATE_GARRISON_PER_GATE = { archer: 10, infantry: 10 } as const
export const COMMANDER_FOUR_GATE_DEFENSE_INFANTRY_PER_RAMP = 10
export const COMMANDER_FOUR_GATE_DEFENSE_PREPARATION_SECONDS = 180

export interface CommanderFourGateDefenseSlot {
  actorId: string
  gateId: TownGateId
  role: 'pusher' | 'assault' | 'lancer' | 'archer' | 'infantry' | 'vanguard'
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
  const point = townGatePoint(gate, (slot.side ?? 1) * 20, -(TOWN_PLAYABLE_WORLD_BOUND - 40))
  return { actorId: slot.actorId, x: point.x, z: point.z, faction: Faction.ENEMY, characterFaction: faction,
    aiType: AIType.MELEE, name: `${gateLabel} Siege Escort T3`, tier: 3, characterTier: 3,
    cavalry: false, respawnEnabled: false, presetId, loadout }
}

/** T3 vanguard: same faction infantry preset, mustered on the central gate lane between both vehicles. */
function vanguard(slot: CommanderFourGateDefenseSlot, faction: CharacterFaction): NpcSpawnSpec {
  const presetId: UnitPresetId = faction === 'roman' ? 'roman_heavy_infantry' : 'viking_berserker'
  const gate = TOWN_GATES.find(gate => gate.id === slot.gateId)!
  const gateCoordinate = Math.max(Math.abs(Math.sin(gate.yaw) * gate.x), Math.abs(Math.cos(gate.yaw) * gate.z))
  const point = townGatePoint(gate, (slot.slot % 5 - 2) * 3, -(TOWN_PLAYABLE_WORLD_BOUND - 8 - Math.floor((slot.slot - 1) / 5) * 3 - gateCoordinate))
  const gateLabel = `${gate.id[0].toUpperCase()}${gate.id.slice(1)}`
  return { actorId: slot.actorId, x: point.x, z: point.z, faction: Faction.ENEMY, characterFaction: faction,
    aiType: AIType.MELEE, name: `${gateLabel} Vanguard T3`, tier: 3, characterTier: 3,
    cavalry: false, respawnEnabled: false, presetId, loadout: { ...UNIT_PRESETS[presetId].tierLoadouts[3], mountId: null } }
}

export interface CommanderFourGateGarrisonSlot { actorId: string; gateId: TownGateId; role: 'archer' | 'infantry'; slot: number }
/** Mission-only defenders: identity is gate, role and slot under the accepted mission id. */
export function commanderFourGateGarrisonSlots(missionId: string): CommanderFourGateGarrisonSlot[] {
  return TOWN_GATES.flatMap(gate => (['archer', 'infantry'] as const).flatMap(role =>
    Array.from({ length: COMMANDER_FOUR_GATE_GARRISON_PER_GATE[role] }, (_, i) => ({
      actorId: `${missionId}:${gate.id}:garrison:${role}:${i + 1}`, gateId: gate.id, role, slot: i + 1 }))))
}
/** The mission's official squads: each gate's whole 20-man foot garrison joins that gate's native
 * infantry squad (1/3/5/7); the cavalry squads stay native. Commanded through the same eight squads. */
export function commanderFourGateMissionSquads(missionId: string, nativeSquads: readonly OfficialCommandSquad[] = commanderGateDefenseSlots()): OfficialCommandSquad[] {
  const garrison = commanderFourGateGarrisonSlots(missionId)
  return nativeSquads.map(squad => {
    if (squad.squadId % 2 === 0) return { ...squad, actorIds: [...squad.actorIds] }
    const gateId = COMMANDER_TOWN_GATE_ORDER[Math.floor((squad.squadId - 1) / 2)]
    return { ...squad, actorIds: [...squad.actorIds, ...garrison.filter(slot => slot.gateId === gateId).map(slot => slot.actorId)] }
  })
}

/** T3 defenders of the player's own faction; the deployment plan supplies their real posts. */
export function createCommanderFourGateGarrison(missionId: string, faction: CharacterFaction): NpcSpawnSpec[] {
  return commanderFourGateGarrisonSlots(missionId).map(slot => {
    const presetId: UnitPresetId = slot.role === 'archer' ? `${faction}_archer` : faction === 'roman' ? 'roman_heavy_infantry' : 'viking_berserker'
    const gate = TOWN_GATES.find(gate => gate.id === slot.gateId)!, point = townGatePoint(gate, 0, 20)
    const gateLabel = `${gate.id[0].toUpperCase()}${gate.id.slice(1)}`
    return { actorId: slot.actorId, x: point.x, z: point.z, faction: Faction.TOWN, characterFaction: faction,
      aiType: slot.role === 'archer' ? AIType.RANGED : AIType.MELEE,
      name: `${gateLabel} Garrison ${slot.role === 'archer' ? 'Archer' : 'Infantry'} T3`, tier: 3, characterTier: 3,
      cavalry: false, respawnEnabled: false, presetId, loadout: { ...UNIT_PRESETS[presetId].tierLoadouts[3], mountId: null } }
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
  const ground = [...crew.map(slot => slot.spec), ...cavalry, ...archers, ...infantryTroops, ...vanguardTroops]
  return { crew, cavalry, archers, infantry: infantryTroops, vanguard: vanguardTroops, ground, all: [...ground],
    gateByActorId: new Map(slots.map(slot => [slot.actorId, slot.gateId])) }
}
