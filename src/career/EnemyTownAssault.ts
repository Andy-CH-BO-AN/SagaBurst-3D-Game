import { MAX_COMMAND_SQUAD_SIZE } from '../battle/CommandTarget'
import { UNIT_PRESETS, type UnitPresetId } from '../battle/UnitPresetCatalog'
import { T4_UNIT_PROFILES } from '../battle/T4HeroCatalog'
import type { NpcSpawnSpec } from '../battle/BattleSpawner'
import { Faction, AIType } from '../world/NPC'
import type { CharacterFaction } from '../world/CharacterVisuals'
import { townCaptainProfile, townRoster } from '../town/TownRules'
import { createCareerMissionId, type ActiveCareerMission } from './CareerMissionState'
import { cloneCareerProfile, canonicalCareerMountId, type CareerProfile } from './CareerProfile'
import { availableRecruitMissions } from './CareerMissionCatalog'
import { ARMORS } from '../rpg/ArmorDatabase'
import { canUseCareerEquipment } from '../town/TownEquipment'
import { canUseCareerMount, careerMountTier, ownedCareerMountIds } from './CareerMountController'

export const ENEMY_TOWN_ASSAULT_ID = 'career-enemy-town-assault'
/** Deploy owned, rank-legal shields and mounts at their highest tier. */
export function prepareEnemyTownAssaultEquipment(current: CareerProfile): CareerProfile {
  const profile = cloneCareerProfile(current)
  const shields = [...(profile.equipment?.shield ? [profile.equipment.shield] : []), ...profile.ownedArmors]
    .filter(id => ARMORS[id] && canUseCareerEquipment(profile, id))
    .sort((a, b) => ARMORS[b].tier - ARMORS[a].tier)
  if (shields[0]) profile.equipment = { ...profile.equipment, shield: shields[0] }
  const mounts = [...(profile.selectedMountId ? [profile.selectedMountId] : []), ...ownedCareerMountIds(profile)]
    .map(canonicalCareerMountId)
    .filter(id => canUseCareerMount(profile, id))
    .sort((a, b) => careerMountTier(b, profile) - careerMountTier(a, profile))
  if (mounts[0]) profile.selectedMountId = mounts[0]
  return profile
}
/** Recheck progression at the domain entry point, not just the deployment UI. */
export function acceptEnemyTownAssault(current: CareerProfile, id?: string): CareerProfile | null {
  if (current.activeOutpostMission || current.townEvent?.state === 'hostile'
    || !availableRecruitMissions(current).some(template => template.id === ENEMY_TOWN_ASSAULT_ID)) return null
  const profile = prepareEnemyTownAssaultEquipment(current)
  profile.activeMission = createEnemyTownAssaultMission(id)
  return profile
}
export function enemyTownFaction(faction: CharacterFaction): CharacterFaction { return faction === 'roman' ? 'viking' : 'roman' }
export function careerTownFaction(profile: { faction: CharacterFaction; activeMission?: ActiveCareerMission }): CharacterFaction {
  return profile.activeMission?.kind === 'enemy-town-assault' ? enemyTownFaction(profile.faction) : profile.faction
}
export function createEnemyTownAssaultMission(id = createCareerMissionId(ENEMY_TOWN_ASSAULT_ID)): ActiveCareerMission {
  const roster = townRoster()
  return {
    id, templateId: ENEMY_TOWN_ASSAULT_ID, kind: 'enemy-town-assault', targetCampId: -1, phase: 'ATTACKING',
    targetActorIds: roster.filter(actor => actor.role.includes('_') || ['captain', 'ranger', 'deployment'].includes(actor.role)).map(actor => actor.id),
    civilianActorIds: roster.filter(actor => actor.role === 'civilian').map(actor => actor.id),
    friendlyActorIds: Array.from({ length: 89 }, (_, index) => `${id}:assault:${index}`), acceptedAt: Date.now(),
  }
}
/** Player occupies the second slot of A; only 89 NPC specs are emitted. */
export function createAssaultRoster(faction: CharacterFaction): NpcSpawnSpec[] {
  const result: NpcSpawnSpec[] = []
  const kinds = faction === 'roman'
    ? ['roman_heavy_infantry', 'roman_archer', 'roman_sword_cavalry', 'roman_lancer', 'roman_horse_archer'] as const
    : ['viking_berserker', 'viking_archer', 'viking_sword_cavalry', 'viking_lancer', 'viking_horse_archer'] as const
  for (const squadId of [1, 2, 3] as const) {
    const count = MAX_COMMAND_SQUAD_SIZE - (squadId === 1 ? 1 : 0)
    for (let index = 0; index < count; index++) {
      const leader = index === 0
      const presetId: UnitPresetId = leader ? squadId === 1 ? `${faction}_sword_cavalry` : squadId === 2 ? `${faction}_archer` : 'viking_berserker' : kinds[(index + squadId - 1) % kinds.length]
      const hero = leader ? squadId === 1 ? townCaptainProfile(faction) : T4_UNIT_PROFILES[presetId] : undefined
      const slot = squadId === 1 && index > 0 ? index + 1 : index
      result.push({
        x: (squadId - 2) * 44 + (slot % 5 - 2) * 7, z: 132 + Math.floor(slot / 5) * 7,
        faction: Faction.TOWN, characterFaction: faction,
        aiType: squadId === 2 && leader || presetId.endsWith('archer') ? AIType.RANGED : AIType.MELEE,
        name: leader ? ['Captain', 'Maki', 'Varangian Captain'][squadId - 1] : `Expedition ${squadId}-${index}`,
        tier: leader ? 4 : 2, cavalry: presetId.includes('cavalry') || presetId.endsWith('lancer') || presetId.endsWith('horse_archer'),
        respawnEnabled: false, presetId, squadId,
        loadout: { ...UNIT_PRESETS[presetId].tierLoadouts[hero?.baseLoadoutTier ?? 2], ...(hero ? { mountId: hero.mountOverride } : {}) },
        ...(hero ? { visualAssetId: hero.visualAssetId, combatProfileId: hero.combatProfileId, specialCombatProfile: hero.specialCombatProfile } : {}),
      })
    }
  }
  return result
}
export function resolveAssaultOutcome(playerDead: boolean, militaryAlive: number, assaultNpcAlive: number): 'victory' | 'failure' | null {
  if (militaryAlive === 0) return 'victory'
  return playerDead && assaultNpcAlive === 0 ? 'failure' : null
}
