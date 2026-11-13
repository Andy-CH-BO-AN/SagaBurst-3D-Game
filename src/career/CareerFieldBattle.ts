import * as THREE from 'three'
import type { BattleSpawnPlan, NpcSpawnSpec } from '../battle/BattleSpawner'
import { HERO_COMBAT_PROFILE_BY_ASSET } from '../battle/HeroCombatProfile'
import { UNIT_PRESETS, type UnitLoadout, type UnitPresetId } from '../battle/UnitPresetCatalog'
import { resolveT4UnitLoadout } from '../battle/T4HeroCatalog'
import type { CombatEvent } from '../combat/CombatAttribution'
import type { TacticalOrder } from '../battle/TacticalOrder'
import { T4_RANGER_BOW_RANGED_ID, defaultRangerMeleeWeaponId } from '../rpg/WeaponDatabase'
import { AIType, Faction } from '../world/NPC'
import type { HeroAssetId } from '../world/HeroAssetCatalog'
import { careerCombatPlayerLoadout } from './CaptainBattleLaunch'
import { resolveBorrowedCharacterIdentity } from './CareerBorrowedIdentity'
import type { CareerFelineBattleLaunch } from './CareerBridgeBattle'
import {
  CAVALRY_SWEEP_ID,
  SWEEP_CHARGE_DISTANCE,
  SWEEP_DETECTION_RANGE,
  createSweepRoster,
} from './CavalrySweep'
import { CAPTAIN_CAVALRY_COMMAND_ID } from './CaptainMissionCatalog'
import type { CaptainEagleCheckpoint } from './CaptainEagleCheckpoint'
import type { ActiveCareerMission } from './CareerMissionState'
import { getCareerMissionTemplate } from './CareerMissionCatalog'
import { resolveCareerHeroAsset } from './CareerPlayerProfile'
import { canonicalCareerMountId, type CareerMountId, type CareerProfile } from './CareerProfile'
import { resolveTownActorEquipment, townEquipmentActorSpecs } from './CareerTownEquipmentState'
import {
  VETERAN_MISSION_IDS,
  createVeteranRoster,
  createVeteranSpawnSpec,
  restoreVeteranTownCavalryReserveRoster,
  type VeteranMissionTemplateId,
} from './VeteranMission'
import {
  townActorHeroProfile,
  townMilitaryEquipment,
  townRoster,
  type TownActorSpec,
} from '../town/TownRules'
import { isRetiredRecruitPatrolMission } from './CareerMissionCatalog'

export const MIGRATED_RECRUIT_BANDIT_IDS = [
  'recruit-bandits-01',
  'recruit-bandits-02',
  'recruit-bandits-03',
  'recruit-bandits-04',
] as const

export const MIGRATED_VETERAN_FIELD_IDS = [
  VETERAN_MISSION_IDS[1], // veteran-scout-hunters
  VETERAN_MISSION_IDS[2], // veteran-village-intercept
  VETERAN_MISSION_IDS[4], // veteran-spear-line-hunt
] as const

export const MIGRATED_CAREER_FIELD_TEMPLATE_IDS = [
  ...MIGRATED_RECRUIT_BANDIT_IDS,
  CAVALRY_SWEEP_ID,
  ...MIGRATED_VETERAN_FIELD_IDS,
  CAPTAIN_CAVALRY_COMMAND_ID,
] as const

export const FIELD_BANDIT_LOADOUT: UnitLoadout = {
  meleeWeaponId: 'rusty_dagger',
  rangedWeaponId: null,
  shieldId: null,
  mountId: null,
}

export const FIELD_BANDIT_DETECTION_RANGE = 26
export const FIELD_VETERAN_ENGAGE_RANGE = 58
export const FIELD_SWEEP_CHARGE_DISTANCE = SWEEP_CHARGE_DISTANCE
export const FIELD_SWEEP_DETECTION_RANGE = SWEEP_DETECTION_RANGE

export interface CareerFieldPoint {
  x: number
  z: number
}

export interface CareerFieldDeployment {
  templateId: string
  kind: 'bandit' | 'cavalry-sweep' | 'veteran-field'
  title: string
  forceLabel: string
  plan: BattleSpawnPlan
  playerYaw: number
  captainActorId?: string
  campfireCenter?: CareerFieldPoint
  enemyCenter: CareerFieldPoint
  friendlyAnchor: CareerFieldPoint
  enemySquadIdsByActorId: Record<string, number>
}

export function isMigratedCareerFieldTemplate(templateId: string | undefined): boolean {
  return Boolean(templateId && (MIGRATED_CAREER_FIELD_TEMPLATE_IDS as readonly string[]).includes(templateId))
}

/**
 * Matches only the 9 formal Career field missions migrated from Living Town to
 * independent grassland (Roman) / snow (Viking) battlefields.
 * Keeps `veteran-tragedy-of-the-scouts`, `captain-patrol-command`, and Commander
 * town battles on their Town scenes.
 */
export function isMigratedCareerFieldMission(
  mission: Pick<ActiveCareerMission, 'templateId' | 'kind'> | undefined,
): boolean {
  if (!mission || isRetiredRecruitPatrolMission(mission)) return false
  if (!isMigratedCareerFieldTemplate(mission.templateId)) return false
  return mission.kind === 'bandit' || mission.kind === 'cavalry-sweep' || mission.kind === 'veteran-field'
}

export function careerFieldBattleMapId(faction: CareerProfile['faction']): 'original' | 'snow' {
  return faction === 'viking' ? 'snow' : 'original'
}

export function isCareerFieldNoCommandMission(
  mission: Pick<ActiveCareerMission, 'templateId' | 'kind' | 'officialSquad' | 'personalSquad'> | undefined,
): boolean {
  return Boolean(mission && isMigratedCareerFieldMission(mission) && !mission.officialSquad && !mission.personalSquad)
}

export function createCareerFieldBattleLaunch(profile: CareerProfile): CareerFelineBattleLaunch {
  const mission = profile.activeMission
  if (!mission || !isMigratedCareerFieldMission(mission)) {
    throw new Error('Expected migrated Career field mission')
  }
  if (mission.templateId === CAPTAIN_CAVALRY_COMMAND_ID && mission.officialSquad
    && (mission.officialSquad.missionId !== mission.id || mission.officialSquad.townFaction !== profile.faction)) {
    throw new Error('Captain cavalry command authority mismatch')
  }
  return {
    type: 'career-feline-battle',
    careerMissionId: mission.id,
    battle: {
      careerFelineMissionId: mission.id,
      mapId: careerFieldBattleMapId(profile.faction),
      mode: 'formation',
      commandGrouping: 'squad',
      playerFaction: profile.faction,
      playerHeroId: resolveCareerHeroAsset(profile),
      playerLoadout: careerCombatPlayerLoadout(profile),
      roman: {},
      viking: {},
      rules: { respawnEnabled: false, includeCamps: false },
    },
  }
}

export function careerFieldBattleHeroAssetIds(profile: CareerProfile): HeroAssetId[] {
  const deployment = createCareerFieldDeployment(profile)
  const assets = new Set<HeroAssetId>()
  const playerHero = resolveCareerHeroAsset(profile)
  if (playerHero) assets.add(playerHero)
  for (const spec of deployment.plan.npcSpecs) {
    if (spec.visualAssetId) assets.add(spec.visualAssetId)
  }
  return [...assets]
}

function tryResolveTownSpecMap(faction: CareerProfile['faction']): Map<string, TownActorSpec> {
  return new Map([
    ...townRoster().map(spec => [spec.id, spec] as const),
    ...townEquipmentActorSpecs(faction).map(spec => [spec.id, spec] as const),
  ])
}

function tryTownEquipment(profile: CareerProfile, faction: CareerProfile['faction'], actorId: string) {
  const specs = townEquipmentActorSpecs(faction)
  if (!profile.townEquipment?.[faction] || !specs.some(spec => spec.id === actorId)) return undefined
  return resolveTownActorEquipment(profile, faction, actorId)
}

function applyBorrowedAndTownState(
  spec: NpcSpawnSpec,
  actorId: string,
  profile: CareerProfile,
  mission: ActiveCareerMission,
  defaultCharacterFaction: CareerProfile['faction'],
): NpcSpawnSpec {
  const baseFaction = spec.characterFaction ?? defaultCharacterFaction
  const identity = resolveBorrowedCharacterIdentity(actorId, {
    characterFaction: baseFaction,
    characterTier: spec.characterTier ?? spec.tier,
    visualAssetId: spec.visualAssetId,
    combatProfileId: spec.combatProfileId,
    specialCombatProfile: spec.specialCombatProfile,
    heroArchetype: spec.heroArchetype,
  }, mission.borrowedActorIdentities)
  const townEquip = tryTownEquipment(profile, defaultCharacterFaction, actorId)
  const rangerBowLoadout = (actorId === 'ranger' || spec.heroArchetype === 'ranger' || identity.specialCombatProfile === 'maki-ranger')
    ? {
      ...(townEquip?.loadout ?? spec.loadout ?? resolveT4UnitLoadout(`${identity.characterFaction}_archer`)),
      meleeWeaponId: townEquip?.loadout.meleeWeaponId ?? spec.loadout?.meleeWeaponId ?? defaultRangerMeleeWeaponId(identity.characterFaction),
      rangedWeaponId: T4_RANGER_BOW_RANGED_ID,
      shieldId: null,
      mountId: spec.loadout?.mountId ?? townEquip?.loadout.mountId ?? 'black-cat',
      reversibleRangedSwitch: true,
    }
    : undefined
  const loadout = rangerBowLoadout
    ?? (townEquip ? { ...townEquip.loadout, mountId: spec.cavalry ? spec.loadout?.mountId ?? townEquip.loadout.mountId ?? 'horse' : townEquip.loadout.mountId ?? null } : spec.loadout)
  return {
    ...spec,
    actorId,
    faction: Faction.PLAYER,
    characterFaction: identity.characterFaction,
    tier: townEquip?.tier ?? spec.tier,
    characterTier: identity.characterTier,
    visualAssetId: identity.visualAssetId ?? spec.visualAssetId,
    combatProfileId: identity.combatProfileId ?? spec.combatProfileId,
    specialCombatProfile: identity.specialCombatProfile ?? spec.specialCombatProfile,
    heroArchetype: identity.heroArchetype ?? spec.heroArchetype,
    ...(loadout ? { loadout } : {}),
    cavalry: Boolean(spec.cavalry || loadout?.mountId),
    respawnEnabled: false,
  }
}

function buildTownBanditAllySpec(
  actorId: string,
  profile: CareerProfile,
  mission: ActiveCareerMission,
  townSpecs: ReadonlyMap<string, TownActorSpec>,
  x: number,
  z: number,
): NpcSpawnSpec {
  const faction = profile.faction
  const spec = townSpecs.get(actorId)
  if (!spec) {
    const presetId: UnitPresetId = faction === 'roman' ? 'roman_heavy_infantry' : 'viking_berserker'
    return applyBorrowedAndTownState({
      x, z, faction: Faction.PLAYER, characterFaction: faction, aiType: AIType.MELEE,
      name: 'Soldier', tier: 2, characterTier: 2, cavalry: false, respawnEnabled: false,
      presetId, loadout: { ...UNIT_PRESETS[presetId].tierLoadouts[2] },
    }, actorId, profile, mission, faction)
  }
  const military = townMilitaryEquipment(faction, spec)
  const hero = townActorHeroProfile(faction, spec)
  const mounted = Boolean(spec.mounted)
  const visualAssetId = hero?.visualAssetId
  const combatProfileId = visualAssetId ? HERO_COMBAT_PROFILE_BY_ASSET[visualAssetId] : undefined
  const loadout: UnitLoadout = {
    ...military.loadout,
    mountId: mounted ? hero?.mountOverride ?? military.loadout.mountId ?? 'horse' : null,
  }
  return applyBorrowedAndTownState({
    x, z, faction: Faction.PLAYER, characterFaction: faction,
    aiType: loadout.rangedWeaponId ? AIType.RANGED : AIType.MELEE,
    name: spec.role === 'captain' ? 'Captain' : 'Town Soldier',
    tier: hero ? 4 : military.level,
    characterTier: hero ? hero.characterTier : military.level,
    ...(hero ? { heroArchetype: 'captain' as const } : {}),
    cavalry: mounted, respawnEnabled: false, presetId: military.presetId, loadout,
    ...(visualAssetId ? { visualAssetId, combatProfileId } : {}),
  }, actorId, profile, mission, faction)
}

function createBanditEnemySpec(actorId: string, x: number, z: number, squadId?: number): NpcSpawnSpec {
  return {
    actorId,
    x,
    z,
    faction: Faction.BANDIT,
    characterFaction: 'viking',
    aiType: AIType.MELEE,
    name: 'Bandit',
    tier: 1,
    characterTier: 1,
    cavalry: false,
    respawnEnabled: false,
    loadout: { ...FIELD_BANDIT_LOADOUT },
    ...(squadId ? { squadId: squadId as NpcSpawnSpec['squadId'] } : {}),
  }
}

function positionGridBlock(
  specs: NpcSpawnSpec[],
  anchor: CareerFieldPoint,
  columns: number,
  colGap: number,
  rowGap: number,
  dirZ: number,
  inwardSign: 1 | -1,
): void {
  for (let i = 0; i < specs.length; i++) {
    const row = Math.floor(i / columns)
    const countInRow = Math.min(columns, specs.length - row * columns)
    const col = i % columns
    specs[i].x = Math.round((anchor.x + (col - (countInRow - 1) / 2) * colGap) * 100) / 100
    specs[i].z = Math.round((anchor.z + inwardSign * dirZ * row * rowGap) * 100) / 100
  }
}

function buildRecruitBanditDeployment(profile: CareerProfile, mission: ActiveCareerMission): CareerFieldDeployment {
  const dirZ = profile.faction === 'roman' ? 1 : -1
  const playerYaw = dirZ > 0 ? 0 : Math.PI
  const friendlyAnchor: CareerFieldPoint = { x: 0, z: -40 * dirZ }
  const campfireCenter: CareerFieldPoint = { x: 0, z: 42 * dirZ }
  const townSpecs = tryResolveTownSpecMap(profile.faction)
  const friendlySpecs = mission.friendlyActorIds.map((actorId, index) => {
    const spec = buildTownBanditAllySpec(actorId, profile, mission, townSpecs, 0, 0)
    if (index === 0) {
      spec.x = friendlyAnchor.x
      spec.z = friendlyAnchor.z
    } else {
      const slot = index - 1
      const col = slot % 4 - 1.5
      const row = Math.floor(slot / 4) + 1
      spec.x = Math.round(col * 2.2 * 100) / 100
      spec.z = Math.round((friendlyAnchor.z - dirZ * row * 2.2) * 100) / 100
    }
    return spec
  })
  const enemySpecs = mission.targetActorIds.map((actorId, index) => {
    const angle = index * 2.399
    const radius = 4.2 + (index % 3) * 1.9
    const x = Math.round((campfireCenter.x + Math.sin(angle) * radius) * 100) / 100
    const z = Math.round((campfireCenter.z + Math.cos(angle) * radius) * 100) / 100
    return createBanditEnemySpec(actorId, x, z)
  })
  const title = getCareerMissionTemplate(mission.templateId)?.name ?? '野外剿匪'
  return {
    templateId: mission.templateId,
    kind: 'bandit',
    title,
    forceLabel: '我方友軍',
    plan: {
      playerSpawn: { x: -2.4, z: friendlyAnchor.z - 2 * dirZ },
      pickupSpecs: [],
      horseSpecs: [],
      npcSpecs: [...friendlySpecs, ...enemySpecs],
    },
    playerYaw,
    captainActorId: mission.friendlyActorIds[0],
    campfireCenter,
    enemyCenter: campfireCenter,
    friendlyAnchor,
    enemySquadIdsByActorId: {},
  }
}

function buildSweepDeployment(profile: CareerProfile, mission: ActiveCareerMission): CareerFieldDeployment {
  const dirZ = profile.faction === 'roman' ? 1 : -1
  const playerYaw = dirZ > 0 ? 0 : Math.PI
  const friendlyAnchor: CareerFieldPoint = { x: 0, z: -70 * dirZ }
  const enemyCenter: CareerFieldPoint = { x: 0, z: 58 * dirZ }
  const captainVec = new THREE.Vector3(friendlyAnchor.x, 0, friendlyAnchor.z)
  const baseRoster = createSweepRoster(profile.faction, captainVec, playerYaw)
  if (mission.friendlyActorIds.length !== baseRoster.length) {
    throw new Error('Cavalry sweep friendly roster count mismatch')
  }
  const friendlySpecs = baseRoster.map((spec, index) => {
    const actorId = mission.friendlyActorIds[index]
    return applyBorrowedAndTownState(spec, actorId, profile, mission, profile.faction)
  })
  const enemySpecs = mission.targetActorIds.map((actorId, index) => {
    const col = index % 8 - 3.5
    const row = Math.floor(index / 8)
    const x = Math.round((enemyCenter.x + col * 3.4) * 100) / 100
    const z = Math.round((enemyCenter.z + dirZ * (row - 2) * 3.6) * 100) / 100
    return createBanditEnemySpec(actorId, x, z)
  })
  const captainCommand = mission.templateId === CAPTAIN_CAVALRY_COMMAND_ID
  const title = getCareerMissionTemplate(mission.templateId)?.name ?? (captainCommand ? '隊長：騎兵清剿' : '騎兵清剿')
  return {
    templateId: mission.templateId,
    kind: 'cavalry-sweep',
    title,
    forceLabel: captainCommand ? '受指揮騎兵' : '跟隨騎兵團',
    plan: {
      playerSpawn: { x: -4.2, z: friendlyAnchor.z + 6 * dirZ },
      pickupSpecs: [],
      horseSpecs: [],
      npcSpecs: [...friendlySpecs, ...enemySpecs],
    },
    playerYaw,
    captainActorId: mission.friendlyActorIds[0],
    campfireCenter: enemyCenter,
    enemyCenter,
    friendlyAnchor,
    enemySquadIdsByActorId: {},
  }
}

function buildVeteranFieldDeployment(profile: CareerProfile, mission: ActiveCareerMission): CareerFieldDeployment {
  const dirZ = profile.faction === 'roman' ? 1 : -1
  const playerYaw = dirZ > 0 ? 0 : Math.PI
  const friendlyAnchor: CareerFieldPoint = { x: 0, z: -68 * dirZ }
  const enemyCenter: CareerFieldPoint = { x: 0, z: 62 * dirZ }
  const templateId = mission.templateId as VeteranMissionTemplateId
  const roster = createVeteranRoster(
    templateId,
    profile.faction,
    mission.id,
    mission.veteranRosterVersion ?? 1,
    mission.borrowedActorIds,
  )
  restoreVeteranTownCavalryReserveRoster(roster, mission)
  const friendlyUnits = roster.friendly.map((unit, index) => {
    const actorId = mission.friendlyActorIds[index] ?? unit.actorId
    const base = createVeteranSpawnSpec(unit, profile.faction, 'friendly')
    return applyBorrowedAndTownState(base, actorId, profile, mission, profile.faction)
  })
  const enemyUnits = roster.enemy.map((unit, index) => {
    const actorId = mission.targetActorIds[index] ?? unit.actorId
    const base = createVeteranSpawnSpec(unit, profile.faction, 'enemy')
    return { ...base, actorId }
  })

  // Arrange friendly squads side by side at friendlyAnchor facing enemyCenter.
  const friendlyBySquad = new Map<number, NpcSpawnSpec[]>()
  for (const spec of friendlyUnits) {
    const squadId = spec.squadId ?? 1
    const group = friendlyBySquad.get(squadId) ?? []
    group.push(spec)
    friendlyBySquad.set(squadId, group)
  }
  const friendlySquadIds = [...friendlyBySquad.keys()].sort((a, b) => a - b)
  const friendlySpacing = 36
  friendlySquadIds.forEach((squadId, index) => {
    const offsetX = (index - (friendlySquadIds.length - 1) / 2) * friendlySpacing
    positionGridBlock(friendlyBySquad.get(squadId)!, { x: offsetX, z: friendlyAnchor.z }, 5, 3.6, 3.8, dirZ, -1)
  })

  // Arrange enemy squads cleanly along enemyCenter with preserved ambush squad IDs.
  const enemySquadIdsByActorId: Record<string, number> = {}
  const enemyBySquad = new Map<number, NpcSpawnSpec[]>()
  for (const spec of enemyUnits) {
    const squadId = spec.squadId ?? 1
    enemySquadIdsByActorId[spec.actorId!] = squadId
    const group = enemyBySquad.get(squadId) ?? []
    group.push(spec)
    enemyBySquad.set(squadId, group)
  }
  const enemySquadIds = [...enemyBySquad.keys()].sort((a, b) => a - b)
  if (templateId === 'veteran-village-intercept' && enemySquadIds.length === 2) {
    // Squad 1 (infantry screen) in front; Squad 2 (archers) supported slightly behind.
    positionGridBlock(enemyBySquad.get(enemySquadIds[0])!, { x: 0, z: 54 * dirZ }, 10, 3.0, 2.8, dirZ, 1)
    positionGridBlock(enemyBySquad.get(enemySquadIds[1])!, { x: 0, z: 76 * dirZ }, 10, 3.0, 2.8, dirZ, 1)
  } else {
    const enemySpacing = enemySquadIds.length > 2 ? 32 : 42
    enemySquadIds.forEach((squadId, index) => {
      const offsetX = (index - (enemySquadIds.length - 1) / 2) * enemySpacing
      const group = enemyBySquad.get(squadId)!
      const mounted = group.some(spec => spec.cavalry)
      positionGridBlock(group, { x: offsetX, z: enemyCenter.z }, 5, mounted ? 3.6 : 2.8, mounted ? 3.8 : 2.8, dirZ, 1)
    })
  }

  const title = getCareerMissionTemplate(mission.templateId)?.name ?? '老兵野戰'
  return {
    templateId: mission.templateId,
    kind: 'veteran-field',
    title,
    forceLabel: '友軍騎兵',
    plan: {
      playerSpawn: { x: -4.2, z: friendlyAnchor.z + 6 * dirZ },
      pickupSpecs: [],
      horseSpecs: [],
      npcSpecs: [...friendlyUnits, ...enemyUnits],
    },
    playerYaw,
    captainActorId: mission.friendlyActorIds[0],
    enemyCenter,
    friendlyAnchor,
    enemySquadIdsByActorId,
  }
}

export function createCareerFieldDeployment(profile: CareerProfile): CareerFieldDeployment {
  const mission = profile.activeMission
  if (!mission || !isMigratedCareerFieldMission(mission)) {
    throw new Error('Expected migrated Career field mission')
  }
  if (mission.kind === 'bandit') return buildRecruitBanditDeployment(profile, mission)
  if (mission.kind === 'cavalry-sweep') return buildSweepDeployment(profile, mission)
  return buildVeteranFieldDeployment(profile, mission)
}

export function careerFieldInitialTacticalOrder(
  mission: ActiveCareerMission,
  faction: Faction,
): TacticalOrder {
  if (!isMigratedCareerFieldMission(mission)) return faction === Faction.PLAYER ? 'defend' : 'attack'
  if (mission.kind === 'bandit') {
    if (faction !== Faction.PLAYER) return 'defend'
    return mission.phase === 'ENGAGING' ? 'charge' : 'defend'
  }
  if (mission.kind === 'cavalry-sweep') {
    if (faction !== Faction.PLAYER) return mission.sweepAlerted ? 'charge' : 'defend'
    return mission.phase === 'ENGAGING' ? 'charge' : 'attack'
  }
  // Veteran field: friendly riders advance/attack; enemy squads hold ambush until engaged.
  return faction === Faction.PLAYER ? 'attack' : 'defend'
}

export function isCareerFieldTargetSpec(
  mission: Pick<ActiveCareerMission, 'targetActorIds'>,
  actorId: string | undefined,
): boolean {
  return Boolean(actorId && mission.targetActorIds.includes(actorId))
}

export function isMigratedFieldDeploymentReady(
  mission: Pick<ActiveCareerMission, 'felineBattle' | 'commanderMission'>,
  runtimeReady = false,
): boolean {
  return runtimeReady || mission.felineBattle?.ready === true || mission.commanderMission?.deploymentComplete === true
}

export function resolveMigratedPlayerMountState(
  mission: Pick<ActiveCareerMission, 'mountState'> | undefined,
  mountId?: CareerMountId | null,
  profileMountArmor?: Partial<Record<CareerMountId, number>>,
): { mountId?: CareerMountId; hp?: number; armorImpact?: number; unavailable: boolean } {
  const effectiveId = mountId ?? mission?.mountState?.activeMountId
  if (!effectiveId) return { unavailable: false }
  const canonicalId = canonicalCareerMountId(effectiveId)
  const mountState = mission?.mountState
  const unavailable = Boolean(
    mountState?.unavailable?.includes(effectiveId) || mountState?.unavailable?.includes(canonicalId),
  )
  const savedHp = mountState?.hp?.[effectiveId] ?? mountState?.hp?.[canonicalId]
  const armorImpact = mountState?.armorImpact?.[effectiveId]
    ?? mountState?.armorImpact?.[canonicalId]
    ?? profileMountArmor?.[effectiveId]
    ?? profileMountArmor?.[canonicalId]
  return {
    mountId: effectiveId,
    hp: unavailable ? 0 : savedHp,
    armorImpact,
    unavailable,
  }
}

/**
 * Builds the initial open-field `felineBattle` declaration when launching or migrating
 * an in-flight mission save onto the standalone field runtime.
 * Dead actors from pre-migration saves stay dead (never respawned), stale Town coordinates
 * are ignored, and pre-existing HP/stamina/mount values are preserved.
 */
export function createCareerFieldCheckpointSeed(
  mission: ActiveCareerMission,
  plan: BattleSpawnPlan,
  fallbackPlayer: {
    hp: number
    maxHp: number
    stamina: number
    x: number
    y: number
    z: number
    yaw: number
    ammo: number
    shieldImpact: number
    stats: CaptainEagleCheckpoint['playerStats']
    mount?: {
      mountId?: CareerMountId | null
      hp?: number
      armorImpactRemaining?: number
      mounted?: boolean
    }
    profileMountArmor?: Partial<Record<CareerMountId, number>>
  },
  terrainHeightAt: (x: number, z: number) => number,
): CaptainEagleCheckpoint {
  const deadTargets = new Set(mission.deadTargetActorIds ?? [])
  const deadFriendlies = new Set(mission.deadFriendlyActorIds ?? [])
  const actors: CaptainEagleCheckpoint['actors'] = {}
  for (const spec of plan.npcSpecs) {
    if (!spec.actorId) throw new Error('Career field actor missing identity')
    const savedHealth = mission.actorHealth?.[spec.actorId]
    // Pre-migration Town saves keep per-actor resources in officialSquad.members. Only
    // resources carry over; every spatial field (position, formation, fall) is Town-space.
    const legacy = mission.officialSquad?.members?.[spec.actorId]
    const dead = deadTargets.has(spec.actorId) || deadFriendlies.has(spec.actorId) || savedHealth?.hp === 0
      || legacy?.status === 'dead' || legacy?.hp === 0
    const y = terrainHeightAt(spec.x, spec.z)
    const yaw = spec.faction === Faction.PLAYER ? fallbackPlayer.yaw : fallbackPlayer.yaw + Math.PI
    const hp = dead ? 0 : savedHealth?.hp ?? legacy?.hp
    const mountHp = savedHealth?.mountHp ?? legacy?.mount?.hp
    const spawn = { x: spec.x, y, z: spec.z, yaw }
    actors[spec.actorId] = {
      status: dead ? 'dead' : 'reserve',
      ...(hp !== undefined ? { hp } : {}),
      ...(legacy?.ammo !== undefined ? { ammo: legacy.ammo } : {}),
      ...(legacy?.shieldImpact !== undefined ? { shieldImpact: legacy.shieldImpact } : {}),
      ...(legacy?.order ? { order: legacy.order } : {}),
      position: spawn,
      ...(mountHp !== undefined && spec.cavalry ? {
        mount: {
          hp: mountHp,
          armorImpactRemaining: savedHealth?.mountArmorImpact ?? legacy?.mount?.armorImpactRemaining ?? 0,
          mounted: !dead && mountHp > 0 && (legacy?.mount?.mounted ?? true),
          position: spawn,
        },
      } : {}),
    }
  }
  const deadPlayer = Boolean(mission.playerDead)
  const playerHp = deadPlayer ? 0
    : mission.playerHp !== undefined ? Math.min(fallbackPlayer.maxHp, mission.playerHp) : fallbackPlayer.hp
  const migratedMount = resolveMigratedPlayerMountState(
    mission,
    fallbackPlayer.mount?.mountId,
    fallbackPlayer.profileMountArmor,
  )
  const resolvedMountHp = migratedMount.hp ?? fallbackPlayer.mount?.hp
  const resolvedMountArmor = migratedMount.armorImpact ?? fallbackPlayer.mount?.armorImpactRemaining ?? 0
  const mountDead = migratedMount.unavailable || (resolvedMountHp !== undefined && resolvedMountHp <= 0)
  const finalMountHp = resolvedMountHp === undefined ? undefined : (mountDead ? 0 : resolvedMountHp)
  const mountIdMatchesActive = !mission.mountState?.activeMountId
    || !migratedMount.mountId
    || mission.mountState.activeMountId === migratedMount.mountId
  const mounted = !deadPlayer && !mountDead && (fallbackPlayer.mount?.mounted ?? mountIdMatchesActive)
  const playerPosition = {
    x: fallbackPlayer.x,
    y: fallbackPlayer.y,
    z: fallbackPlayer.z,
    yaw: fallbackPlayer.yaw,
  }
  return {
    actors,
    ready: false,
    playerStats: mission.playerStats ?? fallbackPlayer.stats,
    player: {
      hp: playerHp,
      stamina: mission.playerStamina ?? fallbackPlayer.stamina,
      dead: deadPlayer,
      position: playerPosition,
      ammo: fallbackPlayer.ammo,
      shieldImpact: fallbackPlayer.shieldImpact,
      ...(finalMountHp !== undefined ? {
        mountHp: finalMountHp,
        mount: {
          hp: finalMountHp,
          armorImpactRemaining: resolvedMountArmor,
          mounted,
          position: playerPosition,
        },
      } : {}),
    },
  }
}

export function resolveFieldDamagedTargetId(
  event: CombatEvent,
  deployment: CareerFieldDeployment,
): string | null {
  if (event.type !== 'damage_applied' || event.appliedDamage <= 0) return null
  if (event.target.targetType === 'npc') return event.target.targetId
  if (event.target.targetType === 'mount' && event.target.ownerActorId) return event.target.ownerActorId
  void deployment
  return null
}

export function shouldTriggerSweepAlert(
  observers: readonly CareerFieldPoint[],
  enemyCenter: CareerFieldPoint,
  alreadyAlerted: boolean,
): boolean {
  if (alreadyAlerted) return true
  return observers.some(point => Math.hypot(point.x - enemyCenter.x, point.z - enemyCenter.z) <= FIELD_SWEEP_DETECTION_RANGE)
}

export function findVeteranSquadsInRange(
  observers: readonly CareerFieldPoint[],
  enemies: readonly { actorId: string; x: number; z: number }[],
  enemySquadIdsByActorId: Readonly<Record<string, number>>,
  alreadyEngaged: ReadonlySet<number>,
): number[] {
  const triggered: number[] = []
  const seen = new Set(alreadyEngaged)
  for (const enemy of enemies) {
    const squadId = enemySquadIdsByActorId[enemy.actorId]
    if (!squadId || seen.has(squadId)) continue
    if (observers.some(obs => Math.hypot(obs.x - enemy.x, obs.z - enemy.z) <= FIELD_VETERAN_ENGAGE_RANGE)) {
      seen.add(squadId)
      triggered.push(squadId)
    }
  }
  return triggered
}
