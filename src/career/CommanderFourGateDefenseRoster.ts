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
export const COMMANDER_FOUR_GATE_DEFENSE_ENEMIES = 230
export const COMMANDER_FOUR_GATE_DEFENSE_PREPARATION_SECONDS = 180

export interface CommanderFourGateDefenseSlot {
  actorId: string
  gateId: TownGateId
  role: 'pusher' | 'assault' | 'lancer' | 'archer' | 'ranger'
  tier: 3 | 4 | 5
  /** Stable authored role slot, not a position in a saved NPC array. */
  slot: number
  side?: -1 | 1
}

/** Saved identity is named by gate, vehicle, role and authored slot. Array reordering is harmless. */
export function commanderFourGateDefenseSlots(missionId: string): CommanderFourGateDefenseSlot[] {
  const slots: CommanderFourGateDefenseSlot[] = []
  for (const gate of TOWN_GATES) {
    for (const side of [-1, 1] as const) {
      const prefix = `${missionId}:${gate.id}:${side < 0 ? 'left' : 'right'}`
      for (let slot = 1; slot <= 4; slot++) slots.push({ actorId: `${prefix}:pusher:${slot}`, gateId: gate.id, side, role: 'pusher', tier: 4, slot })
      for (let slot = 1; slot <= 5; slot++) slots.push({ actorId: `${prefix}:assault:t4:${slot}`, gateId: gate.id, side, role: 'assault', tier: 4, slot })
      slots.push({ actorId: `${prefix}:assault:t5:leader`, gateId: gate.id, side, role: 'assault', tier: 5, slot: 1 })
    }
    for (const role of ['lancer', 'archer'] as const) {
      for (let slot = 1; slot <= 14; slot++) slots.push({ actorId: `${missionId}:${gate.id}:${role}:t3:${slot}`, gateId: gate.id, role, tier: 3, slot })
      slots.push({ actorId: `${missionId}:${gate.id}:${role}:t4:leader`, gateId: gate.id, role, tier: 4, slot: 15 })
    }
  }
  for (let slot = 1; slot <= 30; slot++) slots.push({ actorId: `${missionId}:air:ranger:${slot}`,
    gateId: TOWN_GATES[(slot - 1) % TOWN_GATES.length].id, role: 'ranger', tier: 4, slot })
  return slots
}

export function commanderFourGateDefenseActorIds(missionId: string): string[] {
  return commanderFourGateDefenseSlots(missionId).map(slot => slot.actorId)
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
    tier, cavalry: Boolean(loadout.mountId), respawnEnabled: false, presetId, loadout,
    ...(hero ? { visualAssetId: hero.visualAssetId, combatProfileId: hero.combatProfileId,
      ...(hero.specialCombatProfile ? { specialCombatProfile: hero.specialCombatProfile } : {}) } : {}) }
}

/** Reuses PR7's eighty crew assets/profiles and Crew Allocation unchanged. Faction is the attacker. */
export function createCommanderFourGateDefenseRoster(missionId: string, faction: CharacterFaction): {
  crew: TownSiegeCrewSlot[]; cavalry: NpcSpawnSpec[]; archers: NpcSpawnSpec[]; air: NpcSpawnSpec[]
  ground: NpcSpawnSpec[]; all: NpcSpawnSpec[]; gateByActorId: Map<string, TownGateId>
} {
  const slots = commanderFourGateDefenseSlots(missionId)
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
  const air = slots.filter(slot => slot.role === 'ranger').map(slot => troop(slot, faction))
  const ground = [...crew.map(slot => slot.spec), ...cavalry, ...archers]
  return { crew, cavalry, archers, air, ground, all: [...ground, ...air],
    gateByActorId: new Map(slots.map(slot => [slot.actorId, slot.gateId])) }
}
