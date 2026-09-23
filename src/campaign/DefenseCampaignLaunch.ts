import {
  COMBAT_BALANCE,
} from '../combat/CombatBalance'
import {
  createEmptyRomanArmyConfig,
  createEmptyVikingArmyConfig,
  PLAYER_MELEE_WEAPON_IDS,
  PLAYER_RANGED_WEAPON_IDS,
  PLAYER_SHIELD_IDS,
  type ArmyConfig,
  type BattleConfig,
  type PlayerLoadoutConfig,
  type UnitTierCounts,
} from '../battle/BattleConfig'
import type { NpcSpawnSpec } from '../battle/BattleSpawner'
import {
  getUnitPreset,
  ROMAN_PRESET_IDS,
  VIKING_PRESET_IDS,
  type UnitPresetId,
  type UnitTier,
} from '../battle/UnitPresetCatalog'
import {
  DEFENSE_CAMPAIGN_REINFORCEMENT_STAGING,
  getDefenseCampaignStage,
  isCampaignStageId,
  opposingCampaignFaction,
  resolveCampaignRolePreset,
  type CampaignFaction,
  type CampaignStageId,
  type CampaignUnitRole,
} from './CampaignConfig'

export interface DefenseCampaignLaunchConfig {
  type: 'defense'
  defenderFaction: CampaignFaction
  stageId: CampaignStageId
  defenderArmy: Record<string, UnitTierCounts>
  playerLoadout: PlayerLoadoutConfig
}

export type DefenseCampaignWave = 'defenders' | 'attackers' | 'reinforcement'

const ROLE_ORDER: readonly CampaignUnitRole[] = [
  'frontline',
  'ranged',
  'sword_cavalry',
  'lancer',
  'horse_archer',
]

function emptyArmy(faction: CampaignFaction): ArmyConfig {
  return faction === 'roman'
    ? createEmptyRomanArmyConfig()
    : createEmptyVikingArmyConfig()
}

function cloneArmy(army: Record<string, UnitTierCounts>): Record<string, UnitTierCounts> {
  const cloned: Record<string, UnitTierCounts> = {}
  for (const [presetId, counts] of Object.entries(army)) {
    cloned[presetId] = { 1: counts[1], 2: counts[2], 3: counts[3] }
  }
  return cloned
}

function putCount(
  army: Record<string, UnitTierCounts>,
  presetId: UnitPresetId,
  tier: UnitTier,
  count: number,
): void {
  const counts = army[presetId] ?? { 1: 0, 2: 0, 3: 0 }
  counts[tier] += count
  army[presetId] = counts
}

export function createDefaultDefensePlayerLoadout(
  faction: CampaignFaction,
): PlayerLoadoutConfig {
  return faction === 'roman'
    ? {
        meleeWeaponId: 'heavy_lance',
        rangedWeaponId: 'legionary_pilum',
        shieldId: 'scutum_t3',
        startMounted: true,
      }
    : {
        meleeWeaponId: 'heavy_lance',
        rangedWeaponId: 'elven_runebow',
        shieldId: 'round_shield_t3',
        startMounted: true,
      }
}

export function createDefaultDefenseArmy(
  _faction: CampaignFaction,
  _stageId: CampaignStageId = 1,
): Record<string, UnitTierCounts> {
  // Start empty so the player explicitly builds the defending army.
  return {}
}

export function validateDefenseCampaignLaunchConfig(
  value: unknown,
): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  if (!value || typeof value !== 'object') {
    return { valid: false, errors: ['Invalid Defense Campaign config'] }
  }

  const config = value as DefenseCampaignLaunchConfig
  if (config.type !== 'defense') errors.push('Campaign type must be defense')
  if (config.defenderFaction !== 'roman' && config.defenderFaction !== 'viking') {
    errors.push('Invalid defender faction')
  }

  if (typeof config.stageId !== 'number' || !isCampaignStageId(config.stageId)) {
    errors.push('Invalid campaign stage')
    return { valid: false, errors }
  }
  const stageId = config.stageId

  // #103 exposes Stage 1 only. Keeping this explicit prevents sessionStorage
  // from bypassing the locked Stage 2-9 UI before their runtime is shipped.
  if (stageId !== 1) {
    errors.push('Only Defense Campaign Stage 1 is currently playable')
  }

  const stage = getDefenseCampaignStage(stageId)
  const allowedPresets = config.defenderFaction === 'roman'
    ? ROMAN_PRESET_IDS
    : VIKING_PRESET_IDS
  const army = config.defenderArmy

  if (!army || typeof army !== 'object') {
    errors.push('Missing defender army')
  } else {
    let total = 0
    let mounted = 0
    const tierTotals: Record<UnitTier, number> = { 1: 0, 2: 0, 3: 0 }

    for (const [presetKey, rawCounts] of Object.entries(army)) {
      if (!(allowedPresets as readonly string[]).includes(presetKey)) {
        errors.push(`Invalid defender preset: ${presetKey}`)
        continue
      }
      if (!rawCounts || typeof rawCounts !== 'object') {
        errors.push(`Invalid counts for ${presetKey}`)
        continue
      }

      const preset = getUnitPreset(presetKey as UnitPresetId)
      for (const tier of [1, 2, 3] as UnitTier[]) {
        const count = (rawCounts as UnitTierCounts)[tier]
        if (!Number.isInteger(count) || count < 0) {
          errors.push(`${presetKey} T${tier} must be a non-negative integer`)
          continue
        }
        total += count
        tierTotals[tier] += count
        if (preset.tierLoadouts[tier].mountId) mounted += count
      }
    }

    if (total < 1) errors.push('Deploy at least one defender')
    if (total > stage.defenderDeployment.maxUnits) {
      errors.push(`Defender total exceeds ${stage.defenderDeployment.maxUnits}`)
    }

    for (const tier of [1, 2, 3] as UnitTier[]) {
      if (tierTotals[tier] > stage.defenderDeployment.tierCapacity[tier]) {
        errors.push(
          `T${tier} total ${tierTotals[tier]} exceeds capacity ${stage.defenderDeployment.tierCapacity[tier]}`,
        )
      }
    }

    const cap = stage.defenderDeployment.cavalryCap
    if (cap !== null && mounted > cap) {
      errors.push(`Mounted defenders ${mounted} exceeds cavalry cap ${cap}`)
    }
  }

  const loadout = config.playerLoadout
  if (!loadout || typeof loadout !== 'object') {
    errors.push('Missing player loadout')
  } else {
    if (!(PLAYER_MELEE_WEAPON_IDS as readonly string[]).includes(loadout.meleeWeaponId)) {
      errors.push('Invalid player melee weapon')
    }
    if (!(PLAYER_RANGED_WEAPON_IDS as readonly string[]).includes(loadout.rangedWeaponId)) {
      errors.push('Invalid player ranged weapon')
    }
    if (
      loadout.shieldId !== null
      && !(PLAYER_SHIELD_IDS as readonly string[]).includes(loadout.shieldId)
    ) {
      errors.push('Invalid player shield')
    }
    if (typeof loadout.startMounted !== 'boolean') {
      errors.push('playerLoadout.startMounted must be boolean')
    }
  }

  return { valid: errors.length === 0, errors }
}

function createWaveArmy(
  launch: DefenseCampaignLaunchConfig,
  wave: DefenseCampaignWave,
): {
  viking: ArmyConfig
  roman: ArmyConfig
} {
  const defender = launch.defenderFaction
  const attacker = opposingCampaignFaction(defender)
  const stage = getDefenseCampaignStage(launch.stageId)
  const viking = emptyArmy('viking')
  const roman = emptyArmy('roman')
  const side = (faction: CampaignFaction): Record<string, UnitTierCounts> => (
    (faction === 'viking' ? viking : roman) as Record<string, UnitTierCounts>
  )

  if (wave === 'defenders') {
    const destination = side(defender)
    Object.assign(destination, cloneArmy(launch.defenderArmy))
  } else if (wave === 'attackers') {
    // Stage 1 is all T2. Keeping the wave builder intentionally strict makes
    // the Stage 2-9 tier allocator a separate follow-up instead of hidden logic.
    if (
      stage.attackerArmy.tierCounts[1] !== 0
      || stage.attackerArmy.tierCounts[3] !== 0
    ) {
      throw new Error('Stage 2-9 attacker tier allocation is not implemented in #103')
    }

    for (const role of ROLE_ORDER) {
      const count = stage.attackerArmy.roleCounts[role]
      putCount(side(attacker), resolveCampaignRolePreset(attacker, role), 2, count)
    }
  } else {
    putCount(
      side(defender),
      resolveCampaignRolePreset(defender, stage.reinforcement.role),
      stage.reinforcement.tier,
      stage.reinforcement.count,
    )
  }

  return { viking, roman }
}

export function createDefenseCampaignWaveConfig(
  launch: DefenseCampaignLaunchConfig,
  wave: DefenseCampaignWave,
): BattleConfig {
  const validation = validateDefenseCampaignLaunchConfig(launch)
  if (!validation.valid) {
    throw new Error(`Invalid Defense Campaign config: ${validation.errors.join('; ')}`)
  }

  const armies = createWaveArmy(launch, wave)
  return {
    mode: 'formation',
    spectator: false,
    playerFaction: launch.defenderFaction,
    playerHp: COMBAT_BALANCE.hp.playerDefault,
    playerLoadout: { ...launch.playerLoadout },
    viking: armies.viking,
    roman: armies.roman,
    rules: {
      respawnEnabled: false,
      includeCamps: false,
    },
  }
}


export function positionDefenseCampaignReinforcements(
  specs: NpcSpawnSpec[],
  defenderFaction: CampaignFaction,
): void {
  // Relief cavalry arrives from the attacking army's side of the battlefield,
  // so it rides into the enemy rear instead of materializing inside the fort.
  const enemyDirectionSign = defenderFaction === 'roman' ? 1 : -1
  const columns = 10
  const spacingX = 2.2
  const spacingZ = 2.3
  const baseZ = DEFENSE_CAMPAIGN_REINFORCEMENT_STAGING.distanceFromCenter
    * enemyDirectionSign

  for (let i = 0; i < specs.length; i++) {
    const row = Math.floor(i / columns)
    const col = i % columns
    const countInRow = Math.min(columns, specs.length - row * columns)
    specs[i].x = (col - (countInRow - 1) / 2) * spacingX
    specs[i].z = baseZ + row * spacingZ * enemyDirectionSign
  }
}
