import {
  COMBAT_BALANCE,
} from '../combat/CombatBalance'
import {
  createEmptyRomanArmyConfig,
  createEmptyVikingArmyConfig,
  PLAYER_MELEE_WEAPON_IDS,
  PLAYER_MOUNT_IDS,
  PLAYER_RANGED_WEAPON_IDS,
  PLAYER_SHIELD_IDS,
  type ArmyConfig,
  type BattleConfig,
  type PlayerLoadoutConfig,
  type UnitTierCounts,
} from '../battle/BattleConfig'
import type { HorseAppearanceVariant } from '../world/HorseAssetRegistry'
import type { NpcSpawnSpec } from '../battle/BattleSpawner'
import {
  MAX_COMMAND_SQUAD_SIZE,
  MAX_COMMAND_SQUADS,
  type CommandGroupingMode,
  type SquadAssignment,
} from '../battle/CommandTarget'
import { getCampaignOutpostPlacement } from './CampaignOutpost'
import {
  getUnitPreset,
  ROMAN_PRESET_IDS,
  VIKING_PRESET_IDS,
  type UnitPresetId,
  type BaseUnitTier as UnitTier,
  type UnitTier as BattleUnitTier,
  BASE_UNIT_TIERS,
  CUSTOM_BATTLE_UNIT_TIERS,
} from '../battle/UnitPresetCatalog'
import { isHeroAssetId, type PlayerHeroId } from '../world/HeroAssetCatalog'
import { WEAPONS } from '../rpg/WeaponDatabase'
import {
  DEFENSE_CAMPAIGN_REINFORCEMENT_STAGING,
  getDefenseCampaignStage,
  isCampaignStageId,
  opposingCampaignFaction,
  resolveCampaignAttackerRolePresets,
  resolveCampaignRolePreset,
  type CampaignFaction,
  type CampaignStageId,
  type CampaignUnitRole,
} from './CampaignConfig'
import type { VeteranOutpostBattleState } from '../career/CareerMissionState'
import { createVeteranRoster } from '../career/VeteranMission'
import { parsePersonalMission, type PersonalSquadMission } from '../career/CareerPersonalSquadMission'

export interface DefenseCampaignCapabilities {
  reinforcementsEnabled: boolean
  playerCommandsEnabled: boolean
  gateControlEnabled: boolean
  attackerHeroesEnabled: boolean
}

export interface CareerVeteranOutpostLaunchData {
  missionId: string
  templateId: 'veteran-dread-outpost' | 'veteran-outpost-assault'
  missionKind: 'veteran-outpost-defense' | 'veteran-outpost-assault'
  playerFaction: CampaignFaction
  outpostFaction: CampaignFaction
  runtimeState: VeteranOutpostBattleState
  reinforcementDelaySeconds: number
  assaultChargeDistanceMeters: number
}

export function defenseCampaignCapabilities(config?: DefenseCampaignLaunchConfig): DefenseCampaignCapabilities {
  return {
    reinforcementsEnabled: true,
    playerCommandsEnabled: true,
    gateControlEnabled: true,
    attackerHeroesEnabled: true,
    ...config?.capabilities,
  }
}

export interface DefenseCampaignLaunchConfig {
  type: 'defense'
  deploymentSeconds?: number
  capabilities?: Partial<DefenseCampaignCapabilities>
  careerMissionId?: string
  careerMissionKind?: 'outpost-defense' | 'outpost-relief' | 'veteran-outpost-defense' | 'veteran-outpost-assault' | 'captain-outpost-defense'
  careerReliefPhase?: 'march' | 'charge'
  careerVeteranOutpost?: CareerVeteranOutpostLaunchData
  careerPersonalSquad?: PersonalSquadMission
  defenderFaction: CampaignFaction
  stageId: CampaignStageId
  defenderArmy: Record<string, UnitTierCounts>
  playerLoadout: PlayerLoadoutConfig
  playerHeroId?: PlayerHeroId | null
  playerMountAppearanceVariant?: HorseAppearanceVariant
  commandGrouping?: CommandGroupingMode
  squadAssignments?: SquadAssignment[]
}

export type DefenseCampaignWave = 'defenders' | 'attackers' | 'reinforcement'
export const CAMPAIGN_DEFENDER_HERO_CAP = 1

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
    cloned[presetId] = { 1: counts[1], 2: counts[2], 3: counts[3], 4: counts[4] ?? 0 }
  }
  return cloned
}

function putCount(
  army: Record<string, UnitTierCounts>,
  presetId: UnitPresetId,
  tier: BattleUnitTier,
  count: number,
): void {
  const counts = army[presetId] ?? { 1: 0, 2: 0, 3: 0 }
  counts[tier] = (counts[tier] ?? 0) + count
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
        mountId: 'horse',
      }
    : {
        meleeWeaponId: 'heavy_lance',
        rangedWeaponId: 'elven_runebow',
        shieldId: 'round_shield_t3',
        startMounted: true,
        mountId: 'horse',
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
  const veteranOutpost = config.careerVeteranOutpost
  if (config.careerMissionKind === 'captain-outpost-defense' && (!config.careerMissionId || config.stageId !== 9)) errors.push('Captain Frontline requires Career Stage IX')
  if (config.careerPersonalSquad && (!config.careerMissionId || !parsePersonalMission(config.careerPersonalSquad))) {
    errors.push('Personal squad requires a valid Career mission roster')
  }
  if (config.type !== 'defense') errors.push('Campaign type must be defense')
  if (config.deploymentSeconds !== undefined && (
    !Number.isFinite(config.deploymentSeconds)
    || config.deploymentSeconds < 0
    || (config.deploymentSeconds === 0 && !veteranOutpost)
  )) {
    errors.push('Deployment seconds must be a positive finite number')
  }
  if (
    config.commandGrouping !== undefined
    && config.commandGrouping !== 'preset'
    && config.commandGrouping !== 'squad'
  ) {
    errors.push('Invalid command grouping')
  }
  if (config.defenderFaction !== 'roman' && config.defenderFaction !== 'viking') {
    errors.push('Invalid defender faction')
  }
  if (config.playerHeroId !== undefined && config.playerHeroId !== null && !isHeroAssetId(config.playerHeroId)) {
    errors.push('Invalid player Hero')
  }
  if (veteranOutpost) {
    const expectedKind = veteranOutpost.templateId === 'veteran-dread-outpost'
      ? 'veteran-outpost-defense'
      : 'veteran-outpost-assault'
    if (veteranOutpost.missionKind !== expectedKind || config.careerMissionKind !== expectedKind) {
      errors.push('Veteran Outpost mission kind does not match its template')
    }
    if (!config.careerMissionId || config.careerMissionId !== veteranOutpost.missionId) {
      errors.push('Veteran Outpost mission id does not match its launch')
    }
    if (config.defenderFaction !== veteranOutpost.outpostFaction) {
      errors.push('Campaign defender faction must own the Veteran Outpost')
    }
    if (veteranOutpost.playerFaction !== 'roman' && veteranOutpost.playerFaction !== 'viking') {
      errors.push('Invalid Veteran Outpost player faction')
    }
    if (veteranOutpost.outpostFaction !== 'roman' && veteranOutpost.outpostFaction !== 'viking') {
      errors.push('Invalid Veteran Outpost owner faction')
    }
    if (veteranOutpost.templateId === 'veteran-dread-outpost'
      && (!Number.isFinite(veteranOutpost.reinforcementDelaySeconds) || veteranOutpost.reinforcementDelaySeconds <= 0)) {
      errors.push('Veteran I reinforcement delay must be positive')
    }
    if (veteranOutpost.templateId === 'veteran-outpost-assault'
      && veteranOutpost.playerFaction === veteranOutpost.outpostFaction) {
      errors.push('Veteran IV player faction must oppose the Outpost owner')
    }
    if (veteranOutpost.templateId === 'veteran-dread-outpost'
      && veteranOutpost.playerFaction !== veteranOutpost.outpostFaction) {
      errors.push('Veteran I player faction must defend its Outpost')
    }
    const saved = veteranOutpost.runtimeState
    if (!saved || !Number.isFinite(saved.assaultElapsedSeconds) || saved.assaultElapsedSeconds < 0
      || !Number.isFinite(saved.deploymentRemainingSeconds) || saved.deploymentRemainingSeconds < 0
      || !Number.isInteger(saved.reinforcementQueueIndex) || saved.reinforcementQueueIndex < 0) {
      errors.push('Invalid Veteran Outpost checkpoint')
    }
  }

  if (typeof config.stageId !== 'number' || !isCampaignStageId(config.stageId)) {
    errors.push('Invalid campaign stage')
    return { valid: false, errors }
  }
  const stageId = config.stageId

  const stage = getDefenseCampaignStage(stageId)
  const allowedPresets = config.defenderFaction === 'roman'
    ? ROMAN_PRESET_IDS
    : VIKING_PRESET_IDS
  const army = config.defenderArmy

  if (veteranOutpost) {
    // Career Veteran Outposts supply trusted per-side rosters outside the
    // deployable Defense Campaign army builder and its stage capacity limits.
  } else if (!army || typeof army !== 'object') {
    errors.push('Missing defender army')
  } else {
    let total = 0
    let mounted = 0
    let heroes = 0
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
      for (const key of Object.keys(rawCounts)) {
        if (!['1', '2', '3', '4'].includes(key)) errors.push(`Campaign NPC tier ${key} is not allowed`)
      }

      const preset = getUnitPreset(presetKey as UnitPresetId)
      for (const tier of BASE_UNIT_TIERS) {
        const count = (rawCounts as UnitTierCounts)[tier]
        if (!Number.isInteger(count) || count < 0) {
          errors.push(`${presetKey} T${tier} must be a non-negative integer`)
          continue
        }
        total += count
        tierTotals[tier] += count
        if (preset.tierLoadouts[tier].mountId) mounted += count
      }
      const heroCount = (rawCounts as UnitTierCounts)[4] ?? 0
      if (!Number.isInteger(heroCount) || heroCount < 0) {
        errors.push(`${presetKey} T4 must be a non-negative integer`)
      } else {
        heroes += heroCount
      }
    }

    if (total + heroes < 1) errors.push('Deploy at least one defender')
    if (total > stage.defenderDeployment.maxUnits) {
      errors.push(`Defender total exceeds ${stage.defenderDeployment.maxUnits}`)
    }
    if (heroes > CAMPAIGN_DEFENDER_HERO_CAP) {
      errors.push(`Defender T4 total ${heroes} exceeds ${CAMPAIGN_DEFENDER_HERO_CAP}`)
    }

    for (const tier of BASE_UNIT_TIERS) {
      if (tierTotals[tier] > stage.defenderDeployment.tierCapacity[tier]) {
        errors.push(
          `T${tier} total ${tierTotals[tier]} exceeds capacity ${stage.defenderDeployment.tierCapacity[tier]}`,
        )
      }
    }

    const upperTierPoolCap = stage.defenderDeployment.upperTierPoolCap
    if (upperTierPoolCap !== null && tierTotals[2] + tierTotals[3] > upperTierPoolCap) {
      errors.push(
        `T2+T3 total ${tierTotals[2] + tierTotals[3]} exceeds shared capacity ${upperTierPoolCap}`,
      )
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
    if (config.playerHeroId === 'maki-archer-t4' && WEAPONS[loadout.rangedWeaponId]?.combatKind !== 'bow') {
      errors.push('Ranger player must equip a bow')
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
    if (loadout.mountId !== undefined && !(PLAYER_MOUNT_IDS as readonly string[]).includes(loadout.mountId)) {
      errors.push('Invalid player mount')
    }
  }

  return { valid: errors.length === 0, errors }
}

export function validateDefenseCampaignSquadAssignments(
  launch: DefenseCampaignLaunchConfig,
): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  if (launch.commandGrouping !== 'squad') return { valid: true, errors }

  const assignments = launch.squadAssignments
  if (!assignments) {
    return { valid: false, errors: ['Missing squad assignments'] }
  }

  const allowedPresets = launch.defenderFaction === 'roman'
    ? ROMAN_PRESET_IDS
    : VIKING_PRESET_IDS
  const expected = new Map<string, number>()
  for (const [presetId, counts] of Object.entries(launch.defenderArmy)) {
    if (!(allowedPresets as readonly string[]).includes(presetId)) continue
    for (const tier of CUSTOM_BATTLE_UNIT_TIERS) {
      const count = counts[tier] ?? 0
      if (count > 0) expected.set(`${presetId}:T${tier}`, count)
    }
  }

  const assignedByUnit = new Map<string, number>()
  const assignedBySquad = new Map<number, number>()
  const seen = new Set<string>()

  for (const assignment of assignments) {
    const key = `${assignment.presetId}:T${assignment.tier}`
    const uniqueKey = `${key}:S${assignment.squadId}`
    if (seen.has(uniqueKey)) {
      errors.push(`Duplicate squad assignment: ${uniqueKey}`)
      continue
    }
    seen.add(uniqueKey)

    if (!(allowedPresets as readonly string[]).includes(assignment.presetId)) {
      errors.push(`Invalid squad preset: ${assignment.presetId}`)
    }
    if (!CUSTOM_BATTLE_UNIT_TIERS.includes(assignment.tier)) {
      errors.push(`Invalid squad tier: ${String(assignment.tier)}`)
    }
    if (
      !Number.isInteger(assignment.squadId)
      || assignment.squadId < 1
      || assignment.squadId > MAX_COMMAND_SQUADS
    ) {
      errors.push(`Invalid squad id: ${String(assignment.squadId)}`)
    }
    if (!Number.isInteger(assignment.count) || assignment.count <= 0) {
      errors.push(`Invalid squad count: ${String(assignment.count)}`)
      continue
    }
    if (!expected.has(key)) {
      errors.push(`Squad assignment references undeployed unit: ${key}`)
      continue
    }

    assignedByUnit.set(key, (assignedByUnit.get(key) ?? 0) + assignment.count)
    assignedBySquad.set(
      assignment.squadId,
      (assignedBySquad.get(assignment.squadId) ?? 0) + assignment.count,
    )
  }

  for (const [squadId, count] of assignedBySquad) {
    if (count > MAX_COMMAND_SQUAD_SIZE) {
      errors.push(`Squad ${squadId} exceeds ${MAX_COMMAND_SQUAD_SIZE} units`)
    }
  }
  for (const [key, count] of expected) {
    const assigned = assignedByUnit.get(key) ?? 0
    if (assigned !== count) {
      errors.push(`${key} assigned ${assigned}/${count}`)
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

  const veteranOutpost = launch.careerVeteranOutpost
  if (veteranOutpost) {
    const roster = createVeteranRoster(veteranOutpost.templateId, veteranOutpost.playerFaction, veteranOutpost.missionId)
    const enemyFaction = opposingCampaignFaction(veteranOutpost.playerFaction)
    const ownerUnits = veteranOutpost.outpostFaction === veteranOutpost.playerFaction ? roster.friendly : roster.enemy
    const attackerUnits = veteranOutpost.outpostFaction === veteranOutpost.playerFaction ? roster.enemy : roster.friendly
    const entries = wave === 'reinforcement'
      ? roster.reinforcements.map(unit => ({ unit, faction: veteranOutpost.playerFaction }))
      : (wave === 'defenders' ? ownerUnits : attackerUnits)
          .map(unit => ({ unit, faction: wave === 'defenders' ? veteranOutpost.outpostFaction : enemyFaction }))
    for (const { unit, faction } of entries) putCount(side(faction), unit.presetId, unit.tier, 1)
    return { viking, roman }
  }

  if (wave === 'defenders') {
    const destination = side(defender)
    Object.assign(destination, cloneArmy(launch.defenderArmy))
  } else if (wave === 'attackers') {
    // Split each tier bucket using the stage's authoritative role ratios.
    // Reject non-integral allocations instead of silently rounding gameplay data.
    for (const tier of [1, 2, 3] as UnitTier[]) {
      const tierTotal = launch.careerMissionKind === 'outpost-relief' ? (tier === 2 ? 60 : 0) : stage.attackerArmy.tierCounts[tier]
      if (tierTotal === 0) continue

      for (const role of ROLE_ORDER) {
        const roleCount = (
          tierTotal
          * stage.attackerArmy.roleCounts[role]
          / stage.attackerArmy.totalUnits
        )
        if (!Number.isInteger(roleCount)) {
          throw new Error(
            `Defense Campaign Stage ${stage.id} cannot allocate T${tier} ${role} integrally`,
          )
        }
        const presets = resolveCampaignAttackerRolePresets(attacker, role)
        const presetCount = roleCount / presets.length
        if (!Number.isInteger(presetCount)) {
          throw new Error(
            `Defense Campaign Stage ${stage.id} cannot split T${tier} ${role} across ${presets.length} presets`,
          )
        }
        for (const presetId of presets) {
          putCount(
            side(attacker),
            presetId,
            tier,
            presetCount,
          )
        }
      }
    }
    if (defenseCampaignCapabilities(launch).attackerHeroesEnabled) {
      putCount(side(attacker), resolveCampaignRolePreset(attacker, 'frontline'), 4, 1)
      putCount(side(attacker), resolveCampaignAttackerRolePresets(attacker, 'ranged')[0], 4, 1)
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

  if (wave === 'reinforcement' && !defenseCampaignCapabilities(launch).reinforcementsEnabled) {
    throw new Error('Reinforcements are disabled for this battle')
  }
  const armies = createWaveArmy(launch, wave)
  return {
    mode: 'formation',
    commandGrouping: launch.commandGrouping ?? 'preset',
    spectator: false,
    playerFaction: launch.careerVeteranOutpost?.playerFaction ?? launch.defenderFaction,
    playerHp: COMBAT_BALANCE.hp.playerDefault,
    playerLoadout: { ...launch.playerLoadout },
    playerHeroId: launch.playerHeroId,
    squadAssignments: wave === 'defenders'
      ? launch.squadAssignments?.map(assignment => ({ ...assignment }))
      : [],
    viking: armies.viking,
    roman: armies.roman,
    rules: {
      respawnEnabled: false,
      includeCamps: false,
    },
  }
}


export function positionDefenseCampaignDefenders(
  specs: NpcSpawnSpec[],
  defenderFaction: CampaignFaction,
): void {
  const mounted = specs.filter(spec => spec.cavalry)
  if (mounted.length === 0) return

  const placement = getCampaignOutpostPlacement(defenderFaction)
  const inwardSign = Math.sign(placement.backZ - placement.frontZ)
  const columnsPerWing = 6
  const wingBaseX = 6
  const spacingX = 2.4
  const spacingZ = 3.5
  const startZ = placement.frontZ + inwardSign * 15

  // Campaign defenders share one bounded mounted formation instead of the
  // generic cavalry + horse-archer outer wings. With 90 mounted defenders the
  // generic second wing can reach |x| ~= 49m, outside the 44m outpost wall.
  // Keep both wings inside the central clear corridor; campaign tents live
  // farther out toward the side walls.
  for (let i = 0; i < mounted.length; i++) {
    const spec = mounted[i]
    const wingSign = i % 2 === 0 ? -1 : 1
    const wingIndex = Math.floor(i / 2)
    const row = Math.floor(wingIndex / columnsPerWing)
    const col = wingIndex % columnsPerWing

    spec.x = (wingBaseX + col * spacingX) * wingSign
    spec.z = startZ + row * spacingZ * inwardSign
  }
}

/** Keep an attacker wave at least 100m beyond the owning Outpost's front gate. */
export function positionDefenseCampaignAttackers(
  specs: NpcSpawnSpec[],
  outpostFaction: CampaignFaction,
): void {
  if (specs.length === 0) return
  const placement = getCampaignOutpostPlacement(outpostFaction)
  const inwardSign = Math.sign(placement.backZ - placement.frontZ)
  const closestOutsideDistance = Math.min(...specs.map(spec => (placement.frontZ - spec.z) * inwardSign))
  const shiftOutward = Math.max(0, 100 - closestOutsideDistance)
  if (shiftOutward === 0) return
  for (const spec of specs) spec.z -= inwardSign * shiftOutward
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
