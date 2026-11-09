import type { NpcSpawnSpec } from '../battle/BattleSpawner'
import { resolveT4UnitLoadout, T4_UNIT_PROFILES } from '../battle/T4HeroCatalog'
import { UNIT_PRESETS, type UnitPresetId } from '../battle/UnitPresetCatalog'
import { AIType, Faction } from '../world/NPC'
import type { CharacterFaction } from '../world/CharacterVisuals'
import { TOWN_GATES, townGatePoint, type TownGateId } from '../town/TownLayout'
import { TOWN_PLAYABLE_WORLD_BOUND } from '../town/TownBounds'
import { XONGKORO_LANDING } from '../world/EagleLanding'
import { createTownSiegeCrewSlots, type TownSiegeCrewSlot } from './TownFourGateSiegePolicy'

export const COMMANDER_FOUR_GATE_DEFENSE_ID = 'commander-four-gate-defense'
/** Current accepted enemy army: 80 crew, 60 lancers, 60 archers and 80 T3 siege-escort infantry. */
export const COMMANDER_FOUR_GATE_DEFENSE_ENEMIES = 280
/** Accepted before the infantry escort: the same army with 30 Giant Eagle Rangers and no infantry. */
export const COMMANDER_FOUR_GATE_DEFENSE_LEGACY_ENEMIES = 230
/** Independent of the defender `rosterVersion`. Absent in a save means the legacy 230 enemy army. */
export type CommanderEnemyRosterVersion = 1 | 2
export const COMMANDER_FOUR_GATE_DEFENSE_ENEMY_ROSTER_VERSION: CommanderEnemyRosterVersion = 2
export const COMMANDER_FOUR_GATE_DEFENSE_INFANTRY_PER_RAMP = 10
export const COMMANDER_FOUR_GATE_DEFENSE_PREPARATION_SECONDS = 180

export interface CommanderFourGateDefenseSlot {
  actorId: string
  gateId: TownGateId
  role: 'pusher' | 'assault' | 'lancer' | 'archer' | 'ranger' | 'infantry'
  tier: 3 | 4 | 5
  /** Stable authored role slot, not a position in a saved NPC array. */
  slot: number
  side?: -1 | 1
}

/** Saved identity is named by gate, vehicle, role and authored slot. Array reordering is harmless. */
export function commanderFourGateDefenseSlots(missionId: string,
  enemyVersion: CommanderEnemyRosterVersion = COMMANDER_FOUR_GATE_DEFENSE_ENEMY_ROSTER_VERSION): CommanderFourGateDefenseSlot[] {
  const slots: CommanderFourGateDefenseSlot[] = []
  for (const gate of TOWN_GATES) {
    for (const side of [-1, 1] as const) {
      const prefix = `${missionId}:${gate.id}:${side < 0 ? 'left' : 'right'}`
      for (let slot = 1; slot <= 4; slot++) slots.push({ actorId: `${prefix}:pusher:${slot}`, gateId: gate.id, side, role: 'pusher', tier: 4, slot })
      for (let slot = 1; slot <= 5; slot++) slots.push({ actorId: `${prefix}:assault:t4:${slot}`, gateId: gate.id, side, role: 'assault', tier: 4, slot })
      slots.push({ actorId: `${prefix}:assault:t5:leader`, gateId: gate.id, side, role: 'assault', tier: 5, slot: 1 })
      // Rear guard of this exact vehicle; never Crew. Identity is faction-neutral.
      if (enemyVersion === 2) for (let slot = 1; slot <= COMMANDER_FOUR_GATE_DEFENSE_INFANTRY_PER_RAMP; slot++) {
        slots.push({ actorId: `${prefix}:escort:infantry:${slot}`, gateId: gate.id, side, role: 'infantry', tier: 3, slot })
      }
    }
    for (const role of ['lancer', 'archer'] as const) {
      for (let slot = 1; slot <= 14; slot++) slots.push({ actorId: `${missionId}:${gate.id}:${role}:t3:${slot}`, gateId: gate.id, role, tier: 3, slot })
      slots.push({ actorId: `${missionId}:${gate.id}:${role}:t4:leader`, gateId: gate.id, role, tier: 4, slot: 15 })
    }
  }
  // Legacy 230-man missions keep their Giant Eagle Rangers; new missions have none.
  if (enemyVersion === 1) for (let slot = 1; slot <= 30; slot++) slots.push({ actorId: `${missionId}:air:ranger:${slot}`,
    gateId: TOWN_GATES[(slot - 1) % TOWN_GATES.length].id, role: 'ranger', tier: 4, slot })
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

function troop(slot: CommanderFourGateDefenseSlot, faction: CharacterFaction): NpcSpawnSpec {
  const presetId: UnitPresetId = `${faction}_${slot.role === 'lancer' ? 'lancer' : 'archer'}`
  const tier = slot.tier === 3 ? 3 : 4
  const hero = tier === 4 ? T4_UNIT_PROFILES[presetId] : undefined
  // Exactly the existing Sky Raid T4 Ranger loadout; no separate aerial damage/range policy.
  const loadout = tier === 4 ? resolveT4UnitLoadout(presetId) : { ...UNIT_PRESETS[presetId].tierLoadouts[3] }
  loadout.mountId = slot.role === 'ranger' ? 'xongkoro' : slot.role === 'lancer'
    ? tier === 3 ? 'horse' : faction === 'roman' ? 'corgi' : 'black-cat' : null
  const gate = TOWN_GATES.find(gate => gate.id === slot.gateId)!
  // Cavalry use the central gate approach. Archers stay clear of both ramp lanes.
  const lateral = slot.role === 'lancer' ? (slot.slot % 5 - 2) * 4
    : slot.role === 'archer' ? 74 + (slot.slot % 5) * 3.5
      : (Math.floor((slot.slot - 1) / 4) - 3.5) * (XONGKORO_LANDING.width + XONGKORO_LANDING.separation)
  // Leave room for the full mounted body/wing envelope at the actual map border.
  // Ground ranks occupy separate gate/outer-archer corridors, outside both vehicle lanes.
  const margin = slot.role === 'ranger' ? XONGKORO_LANDING.width / 2 + XONGKORO_LANDING.separation
    : 4 + Math.floor((slot.slot - 1) / 5) * 5
  const gateCoordinate = Math.max(Math.abs(Math.sin(gate.yaw) * gate.x), Math.abs(Math.cos(gate.yaw) * gate.z))
  const outward = TOWN_PLAYABLE_WORLD_BOUND - margin - gateCoordinate
  const point = townGatePoint(gate, lateral, -outward)
  const gateLabel = `${gate.id[0].toUpperCase()}${gate.id.slice(1)}`
  return { actorId: slot.actorId, x: point.x, z: point.z, faction: Faction.ENEMY, characterFaction: faction,
    aiType: slot.role === 'lancer' ? AIType.MELEE : AIType.RANGED,
    name: `${slot.role === 'ranger' ? 'Giant Eagle Ranger' : `${gateLabel} ${slot.role === 'lancer' ? 'Lancer' : 'Archer'}`} T${tier}`,
    tier, characterTier: tier,
    ...(hero ? { heroArchetype: hero.combatProfileId === 'ranger' ? 'ranger' as const : 'captain' as const } : {}),
    cavalry: Boolean(loadout.mountId), respawnEnabled: false, presetId, loadout,
    ...(hero ? { visualAssetId: hero.visualAssetId, combatProfileId: hero.combatProfileId,
      ...(hero.specialCombatProfile ? { specialCombatProfile: hero.specialCombatProfile } : {}) } : {}) }
}

/** Reuses PR7's eighty crew assets/profiles and Crew Allocation unchanged. Faction is the attacker. */
export function createCommanderFourGateDefenseRoster(missionId: string, faction: CharacterFaction,
  enemyVersion: CommanderEnemyRosterVersion = COMMANDER_FOUR_GATE_DEFENSE_ENEMY_ROSTER_VERSION): {
  crew: TownSiegeCrewSlot[]; cavalry: NpcSpawnSpec[]; archers: NpcSpawnSpec[]; infantry: NpcSpawnSpec[]; air: NpcSpawnSpec[]
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
  const air = slots.filter(slot => slot.role === 'ranger').map(slot => troop(slot, faction))
  const ground = [...crew.map(slot => slot.spec), ...cavalry, ...archers, ...infantryTroops]
  return { crew, cavalry, archers, infantry: infantryTroops, air, ground, all: [...ground, ...air],
    gateByActorId: new Map(slots.map(slot => [slot.actorId, slot.gateId])) }
}
