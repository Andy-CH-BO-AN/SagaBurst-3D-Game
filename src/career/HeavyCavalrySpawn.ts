import type { NpcSpawnSpec } from '../battle/BattleSpawner'
import { T4_UNIT_PROFILES, resolveT4UnitLoadout } from '../battle/T4HeroCatalog'
import { getT5ProfileForPreset, resolveT5UnitLoadout, t5EquipmentIdsForArmy } from '../battle/T5HeroCatalog'
import type { HeroAssetId } from '../world/HeroAssetCatalog'
import { UNIT_PRESETS, type BaseUnitTier } from '../battle/UnitPresetCatalog'
import type { CharacterFaction } from '../world/CharacterVisuals'
import { AIType, Faction } from '../world/NPC'
import { COMMANDER_IRON_LEGION_ID, HEAVY_FIELD_SPECS, heavyPresetId, isHeavyFieldMissionId, type HeavyRole, type HeavyTier } from './HeavyCavalryMissions'

/**
 * One formal NPC of a heavy-cavalry Career battle. Loadouts come from the same per-tier
 * resolvers custom battles use, so T4 / T5 heavy cavalry keep their Byzantine / snow-leopard
 * kit and infantry keep their own tier equipment; nothing here is mission-specific.
 */
export function heavyUnitSpec(actorId: string, faction: CharacterFaction, allegiance: Faction,
  role: HeavyRole, tier: HeavyTier, squadId?: NpcSpawnSpec['squadId'], x = 0, z = 0): NpcSpawnSpec {
  const presetId = heavyPresetId(faction, role)
  const t4 = tier === 4 ? T4_UNIT_PROFILES[presetId] : undefined
  const t5 = tier === 5 ? getT5ProfileForPreset(presetId, faction) : undefined
  const loadout = t4 ? resolveT4UnitLoadout(presetId)
    : t5 ? resolveT5UnitLoadout(presetId)
    : { ...UNIT_PRESETS[presetId].tierLoadouts[Math.min(tier, 3) as BaseUnitTier] }
  return {
    actorId, x, z, faction: allegiance, characterFaction: faction,
    aiType: loadout.rangedWeaponId ? AIType.RANGED : AIType.MELEE,
    name: `T${tier} ${role}`, tier: Math.min(tier, 4) as NpcSpawnSpec['tier'], characterTier: tier,
    ...(t4 ? { heroArchetype: t4.combatProfileId === 'ranger' ? 'ranger' as const : 'captain' as const,
      visualAssetId: t4.visualAssetId, combatProfileId: t4.combatProfileId,
      ...(t4.specialCombatProfile ? { specialCombatProfile: t4.specialCombatProfile } : {}) } : {}),
    ...(t5 ? { heroArchetype: 'commander' as const, visualAssetId: t5.visualAssetId, combatProfileId: t5.combatProfileId } : {}),
    cavalry: Boolean(loadout.mountId), respawnEnabled: false, presetId, squadId, loadout,
  }
}

/** Hero visuals and on-demand Byzantine gear a heavy-cavalry launch must load before deployment. */
export function careerHeavyPreloadPlan(templateId: string, playerFaction: CharacterFaction): { heroAssets: HeroAssetId[]; equipmentIds: string[] } {
  const groups = templateId === COMMANDER_IRON_LEGION_ID ? [{ faction: opposite(playerFaction), roles: ['heavy_cavalry'] as HeavyRole[], tiers: [4, 5] as HeavyTier[] }]
    : !isHeavyFieldMissionId(templateId) ? []
    : [{ faction: playerFaction, roles: HEAVY_FIELD_SPECS[templateId].friendly.map(group => group.role), tiers: HEAVY_FIELD_SPECS[templateId].friendly.map(group => group.tier) },
      { faction: opposite(playerFaction), roles: HEAVY_FIELD_SPECS[templateId].enemy.map(group => group.role), tiers: HEAVY_FIELD_SPECS[templateId].enemy.map(group => group.tier) }]
  const heroAssets = new Set<HeroAssetId>(), equipmentIds = new Set<string>()
  for (const { faction, roles, tiers } of groups) for (const role of new Set(roles)) {
    const presetId = heavyPresetId(faction, role)
    if (tiers.includes(4)) heroAssets.add(T4_UNIT_PROFILES[presetId].visualAssetId)
    if (tiers.includes(5)) {
      heroAssets.add(getT5ProfileForPreset(presetId, faction).visualAssetId)
      for (const id of t5EquipmentIdsForArmy({ [presetId]: { 5: 1 } })) equipmentIds.add(id)
    }
  }
  return { heroAssets: [...heroAssets], equipmentIds: [...equipmentIds] }
}

function opposite(faction: CharacterFaction): CharacterFaction { return faction === 'roman' ? 'viking' : 'roman' }
