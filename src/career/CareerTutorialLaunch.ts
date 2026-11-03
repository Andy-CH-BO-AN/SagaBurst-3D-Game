import { createEmptyRomanArmyConfig, createEmptyVikingArmyConfig, PLAYER_MELEE_WEAPON_IDS, type BattleConfig, type UnitTierCounts } from '../battle/BattleConfig'
import type { UnitPresetId } from '../battle/UnitPresetCatalog'
import { townCommandSquadRoster, townMilitaryEquipment } from '../town/TownRules'
import type { CareerProfile } from './CareerProfile'

/** Explicit scene capability. Ordinary Training Ground/Custom Battle never receive one. */
export interface CareerTutorialLaunch {
  careerId: string
  sessionId: string
  stage: 'recruit' | 'captain'
}

/** Scene-local copies of the canonical Captain training roster. No Town or HR identities travel. */
export function createCareerCaptainTutorialConfig(profile: CareerProfile): BattleConfig {
  const viking = createEmptyVikingArmyConfig(), roman = createEmptyRomanArmyConfig()
  const army: Partial<Record<UnitPresetId, UnitTierCounts>> = profile.faction === 'roman' ? roman : viking
  const counts = new Map<UnitPresetId, number>()
  for (const spec of townCommandSquadRoster(profile.faction)) {
    const { presetId } = townMilitaryEquipment(profile.faction, spec)
    counts.set(presetId, (counts.get(presetId) ?? 0) + 1)
  }
  if ([...counts.values()].reduce((sum, count) => sum + count, 0) !== 30) throw new Error('Captain tutorial requires the canonical 30-person roster')
  for (const [preset, count] of counts) army[preset] = { 1: 0, 2: count, 3: 0 }
  if (profile.faction === 'roman') viking.viking_berserker = { 1: 10, 2: 0, 3: 0 }
  else roman.roman_heavy_infantry = { 1: 10, 2: 0, 3: 0 }
  const requested = profile.equipment?.melee ?? profile.starterWeaponId
  const melee = PLAYER_MELEE_WEAPON_IDS.find(id => id === requested) ?? (profile.faction === 'roman' ? 'gladius_rusty' : 'viking_axe_t1')
  return { viking, roman, playerFaction: profile.faction, mode: 'formation', commandGrouping: 'squad',
    squadAssignments: [...counts].map(([presetId, count]) => ({ presetId, tier: 2, squadId: 1, count })),
    rules: { respawnEnabled: false, includeCamps: false },
    playerLoadout: { meleeWeaponId: melee, rangedWeaponId: 'wooden_shortbow', shieldId: null, startMounted: false },
  }
}
