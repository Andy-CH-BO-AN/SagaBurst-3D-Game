import { MAX_COMMAND_SQUAD_SIZE } from '../battle/CommandTarget'
import { UNIT_PRESETS, type UnitPresetId } from '../battle/UnitPresetCatalog'
import { T4_UNIT_PROFILES } from '../battle/T4HeroCatalog'
import type { NpcSpawnSpec } from '../battle/BattleSpawner'
import { Faction, AIType } from '../world/NPC'
import type { CharacterFaction } from '../world/CharacterVisuals'
import { townCaptainProfile, townRoster } from '../town/TownRules'
import { createCareerMissionId, type ActiveCareerMission } from './CareerMissionState'

export const ENEMY_TOWN_ASSAULT_ID = 'career-enemy-town-assault'
export const ASSAULT_PREPARATION_SECONDS = 10
export function enemyTownFaction(faction: CharacterFaction): CharacterFaction { return faction === 'roman' ? 'viking' : 'roman' }
export function careerTownFaction(profile: { faction: CharacterFaction; activeMission?: ActiveCareerMission }): CharacterFaction {
  return profile.activeMission?.kind === 'enemy-town-assault' ? enemyTownFaction(profile.faction) : profile.faction
}
export function createEnemyTownAssaultMission(id = createCareerMissionId(ENEMY_TOWN_ASSAULT_ID)): ActiveCareerMission {
  const roster = townRoster()
  return {
    id, templateId: ENEMY_TOWN_ASSAULT_ID, kind: 'enemy-town-assault', targetCampId: -1, phase: 'PREPARING',
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
