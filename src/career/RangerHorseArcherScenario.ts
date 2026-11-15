import { PRESET_SCENARIO_L } from '../battle/BattleConfig'
import { BattleSpawner, type BattleSpawnPlan } from '../battle/BattleSpawner'
import type { FelineMountVariant } from '../world/BlackCatVisual'
import type { HeroAssetId } from '../world/HeroAssetCatalog'
import { FELINE_FRIENDLY_GROUPS, type FelineCavalryGroup } from './CommanderMissionCatalog'
import { felineFriendlyMountId, felineRangerCavalrySpec, felineRoleTemplateSlots } from './CareerBridgeBattle'

/** DEV scenario L: each side fields the Commander VI Ranger army scaled 1.5x (90 caracal, 90 serval,
 * 30 black / 30 white / 30 orange cat, 30 snow leopard with the T5 kit). */
export const RANGER_HORSE_ARCHER_SIDE_COUNT = 300
export const RANGER_HORSE_ARCHER_GROUPS: readonly FelineCavalryGroup[] = FELINE_FRIENDLY_GROUPS.map(group => ({
  ...group, count: group.count * 3 / 2,
}))
export const RANGER_HORSE_ARCHER_MOUNTS: readonly FelineMountVariant[] = ['black-cat', 'white-cat', 'orange-cat', 'serval', 'caracal']
export const RANGER_HORSE_ARCHER_HERO_ASSETS: readonly HeroAssetId[] = ['maki-archer-t4']

/** Keeps every formation slot (identity, allegiance, squad and position) and replaces only its unit. */
export function createRangerHorseArcherScenarioPlan(config = PRESET_SCENARIO_L): BattleSpawnPlan {
  const template = BattleSpawner.createSpawnPlan(config)
  const npcSpecs = (['roman', 'viking'] as const).flatMap(faction => {
    const cursors = { melee: 0, lancer: 0, horse_archer: 0 }
    const slots = {
      melee: felineRoleTemplateSlots(template, faction, 'melee'),
      lancer: felineRoleTemplateSlots(template, faction, 'lancer'),
      horse_archer: felineRoleTemplateSlots(template, faction, 'horse_archer'),
    }
    const side = RANGER_HORSE_ARCHER_GROUPS.flatMap(group => Array.from({ length: group.count }, (_, index) => {
      const slot = slots[group.role][cursors[group.role]++]
      if (!slot) throw new Error(`Scenario L is missing a ${faction} ${group.role} formation slot`)
      const actorId = slot.actorId ?? `scenario-l:${faction}:t${group.tier}:${group.role}:${index}`
      return felineRangerCavalrySpec(slot, actorId, faction, slot.faction, group.role, group.tier,
        felineFriendlyMountId(group.role, group.tier, index, group.count))
    }))
    if (side.length !== RANGER_HORSE_ARCHER_SIDE_COUNT
      || Object.entries(cursors).some(([role, used]) => used !== slots[role as keyof typeof slots].length)) {
      throw new Error(`Scenario L ${faction} roster does not match its formation`)
    }
    return side
  })
  return { ...template, npcSpecs }
}

/** Melee/shield ids that need their GLB prepared before spawn. */
export function rangerHorseArcherEquipmentIds(plan: BattleSpawnPlan): string[] {
  return [...new Set(plan.npcSpecs.flatMap(spec => [spec.loadout?.meleeWeaponId, spec.loadout?.shieldId])
    .filter((id): id is string => Boolean(id)))]
}
