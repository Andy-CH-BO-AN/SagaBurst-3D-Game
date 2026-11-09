import { BRIDGEHEAD_FRIENDLIES, isBridgeheadEnemyCount } from '../battle/BridgeheadRosterConfig'
import { createEmptyRomanArmyConfig, createEmptyVikingArmyConfig, type BattleConfig, type RomanArmyConfig, type VikingArmyConfig } from '../battle/BattleConfig'
import { BATTLE_FRONTLINE_Z, BattleSpawner, type BattleSpawnPlan, type NpcSpawnSpec } from '../battle/BattleSpawner'
import { MAX_COMMAND_SQUAD_SIZE } from '../battle/CommandTarget'
import {
  COMMANDER_BRIDGEHEAD_ID,
  COMMANDER_FELINE_CAVALRY_ID,
  COMMANDER_FELINE_CAVALRY_KIND,
  COMMANDER_IRON_LEGION_ID,
  COMMANDER_IRON_LEGION_KIND,
  FELINE_ENEMY_GROUPS,
  FELINE_ENEMY_TOTAL,
  FELINE_FRIENDLY_GROUPS,
  FELINE_FRIENDLY_TOTAL,
  FELINE_FRIENDLY_SQUAD_SIZES,
  FELINE_VANGUARD_ADVANCE_METERS,
  createBridgeheadRoster,
  type FelineCavalryRole,
} from './CommanderMissionCatalog'
import { IRON_LEGION_ENEMY_GROUPS } from './HeavyCavalryMissions'
import { heavyUnitSpec } from './HeavyCavalrySpawn'
import { createCareerHeavyBattleLaunch, createCareerHeavySpawnPlan, isCareerHeavyFieldBattle } from './HeavyFieldMission'
import { heavyTacticalOrder } from './HeavyCavalryMissions'
import { careerCombatPlayerLoadout } from './CaptainBattleLaunch'
import { resolveCareerHeroAsset } from './CareerPlayerProfile'
import { claimCareerMission, clearCareerMission, type CareerProfile } from './CareerProfile'
import type { CareerProfileStore } from './CareerProfileStore'
import type { BattleStatsSnapshot } from '../combat/BattleStatsTracker'
import { BRIDGEHEAD_PREPARATION_SECONDS, resolveCareerMissionOutcome, type ActiveCareerMission, type BridgeBattleDeployment } from './CareerMissionState'
import { commanderActorConfirmedDead } from './CommanderOutpost'
import { stageMissionReturnRebuild } from './CareerMissionReturnRecovery'
import { townRoster } from '../town/TownRules'
import { legacyPersonalEquipment } from './CareerInventory'
import { AIType, Faction } from '../world/NPC'
import { T4_UNIT_PROFILES, resolveT4UnitLoadout } from '../battle/T4HeroCatalog'
import { HERO_COMBAT_PROFILE_BY_ASSET } from '../battle/HeroCombatProfile'
import type { HeroAssetId } from '../world/HeroAssetCatalog'
import type { UnitLoadout, UnitPresetId } from '../battle/UnitPresetCatalog'
import type { CombatEvent } from '../combat/CombatAttribution'
import type { TacticalOrder } from '../battle/TacticalOrder'
import { careerCommanderLoadout } from './CareerCommanderEquipment'
import { townCommanderHeroAsset } from '../town/TownCommander'

/** A trusted Career launch, separate from Campaign stages and untrusted free battle config. */
export interface CareerBridgeBattleLaunch {
  type: 'career-bridge-battle'
  careerMissionId: string
  battle: BattleConfig
}

function careerFieldMissionMatches(mission: ActiveCareerMission | undefined, templateId: string, kind: ActiveCareerMission['kind']): boolean {
  return mission?.templateId === templateId && mission.kind === kind
}

export function isCareerBridgeBattle(mission: ActiveCareerMission | undefined): boolean {
  return careerFieldMissionMatches(mission, COMMANDER_BRIDGEHEAD_ID, 'commander-bridgehead-battle')
}

/** Only a durably claimed mission can leave the battlefield on reload. */
export function recoverClaimedCareerBridgeBattle(profile: CareerProfile,
  store: Pick<CareerProfileStore, 'save'>): 'resume' | 'return-to-town' | 'save-failed' {
  const mission = profile.activeMission
  if (!isCareerBridgeBattle(mission) || !mission || !profile.claimedBattleIds.includes(mission.id)) return 'resume'
  return store.save(clearCareerBridgeBattle(profile, mission.id)) ? 'return-to-town' : 'save-failed'
}

/** Carry battle-worn HR checkpoints through the same atomic save that clears the mission. */
export function clearCareerBridgeBattle(profile: CareerProfile, missionId: string): CareerProfile {
  const mission = profile.activeMission
  const next = clearCareerMission(profile, missionId)
  if (mission?.id !== missionId || !isCareerBridgeBattle(mission)
    || !mission.result && !profile.claimedBattleIds.includes(missionId)) return next
  return stageMissionReturnRebuild(next, townRoster().map(spec => ({ spec })), mission.personalSquad)
}

export function createCareerBridgeBattleLaunch(profile: CareerProfile): CareerBridgeBattleLaunch {
  const mission = profile.activeMission
  if (!isCareerBridgeBattle(mission) || !mission || profile.rank !== 'commander'
    || mission.officialSquad?.commandRank !== 'commander' || mission.officialSquad.missionId !== mission.id
    || mission.friendlyActorIds.length !== BRIDGEHEAD_FRIENDLIES || !isBridgeheadEnemyCount(mission.targetActorIds.length)) {
    throw new Error('Expected saved Commander Bridgehead mission')
  }
  return { type: 'career-bridge-battle', careerMissionId: mission.id, battle: {
    mode: 'formation', commandGrouping: 'squad', playerFaction: profile.faction,
    playerHeroId: resolveCareerHeroAsset(profile), playerLoadout: careerCombatPlayerLoadout(profile),
    roman: {}, viking: {}, rules: { respawnEnabled: false, includeCamps: false },
  } }
}

/** Older in-progress battles resume their existing assault rather than gaining another preparation period. */
export function resolveCareerBridgeDeployment(mission: ActiveCareerMission): BridgeBattleDeployment {
  if (mission.bridgeDeployment) return { ...mission.bridgeDeployment }
  const phase = mission.commanderMission?.deploymentComplete || mission.bridgeBattle?.ready ? 'assault'
    : mission.targetActorIds.some(id => {
      const actor = mission.bridgeBattle?.actors[id]
      return actor && actor.status !== 'reserve'
    }) ? 'spawning' : 'preparing'
  return { phase, preparationRemainingSeconds: phase === 'preparing' ? BRIDGEHEAD_PREPARATION_SECONDS : 0 }
}

export function createCareerBridgeSpawnPlan(profile: CareerProfile, wave: 'initial' | 'attackers' = 'initial'): BattleSpawnPlan {
  createCareerBridgeBattleLaunch(profile)
  const mission = profile.activeMission!
  const roster = createBridgeheadRoster(mission, profile.faction)
  const alive = (id: string) => !commanderActorConfirmedDead(mission, id)
    && mission.bridgeBattle?.actors[id]?.status !== 'dead' && mission.bridgeBattle?.actors[id]?.hp !== 0
  const enemy = resolveCareerBridgeDeployment(mission).phase !== 'preparing' ? roster.enemy : []
  return { playerSpawn: { x: 0, z: -108 }, horseSpecs: [], pickupSpecs: [],
    npcSpecs: [...(wave === 'initial' ? roster.friendly : []), ...enemy].filter(spec => alive(spec.actorId!)) }
}

/** Rider death does not remove a surviving, dismounted mount from the saved battlefield. */
export function createCareerBridgeOrphanMountPlan(profile: CareerProfile) {
  const mission = profile.activeMission!
  const enemy = createBridgeheadRoster(mission, profile.faction).enemy.flatMap(spec => {
    const actor = mission.bridgeBattle?.actors[spec.actorId!]
    return actor?.mount && actor.mount.hp > 0 && (commanderActorConfirmedDead(mission, spec.actorId!) || actor.status === 'dead' || actor.hp === 0)
      ? [{ actorId: spec.actorId!, mountId: spec.loadout!.mountId!, stableKey: spec.actorId!, saved: actor.mount }] : []
  })
  return [...enemy, ...createCareerFieldPersonalOrphanMountPlan(profile)]
}

/** Personal mounts outlive fallen riders in either Commander field mission. */
export function createCareerFieldPersonalOrphanMountPlan(profile: CareerProfile) {
  const mission = profile.activeMission
  if (!mission) return []
  return (profile.personalSquad?.members ?? []).flatMap(member => {
    if (!mission.personalSquad?.memberIds.includes(member.id)) return []
    const actor = mission.personalSquad.members[member.id]
    const mountId = (member.equipment ?? legacyPersonalEquipment(member.type, profile.faction)).mount
    return mountId && actor?.status === 'dead' && actor.mount && actor.mount.hp > 0
      ? [{ actorId: member.id, mountId, stableKey: `personal:${member.id}`, saved: actor.mount }] : []
  })
}

/**
 * Restore surviving orphan mounts from both Commander VI armies, without respawning
 * their deceased riders. The personal squad remains a separately owned roster.
 *
 * Migration Note: Prior check-pointed saves serialized physical mount status (hp, position,
 * yaw/pitch) under actor records without persisting redundant species strings. Surviving
 * orphan mounts reconstruct their species deterministically from createCareerFelineSpawnPlan(profile).
 * As a result, older in-flight saves safely migrate to the refined role-to-mount assignment
 * (e.g. deceased T4 melee rider mount migrating from earlier white-cat to caracal) while
 * preserving health points, coordinates, orientation, living status, and player mount borrowing.
 */
export function createCareerFelineOrphanMountPlan(profile: CareerProfile) {
  const mission = profile.activeMission
  if (!isCareerFelineBattle(mission) || !mission.felineBattle) return createCareerFieldPersonalOrphanMountPlan(profile)
  const riders = createCareerFelineSpawnPlan(profile).npcSpecs.flatMap(spec => {
    const actorId = spec.actorId!
    const official = mission.officialSquad?.members?.[actorId]
    const field = mission.felineBattle?.actors[actorId]
    const actor = official?.status !== 'reserve' ? official ?? field : field ?? official
    const mount = actor?.mount ?? field?.mount ?? official?.mount
    const dead = actor?.status === 'dead' || actor?.hp === 0 || commanderActorConfirmedDead(mission, actorId)
    if (!dead || !mount || mount.hp <= 0 || !spec.loadout?.mountId) return []
    return [{ actorId, mountId: spec.loadout.mountId, stableKey: actorId, saved: mount }]
  })
  return [...riders, ...createCareerFieldPersonalOrphanMountPlan(profile)]
}

/** Stable objective accounting. Missing/queued actors remain alive; mount IDs never enter these sets. */
export class CareerBridgeBattleRuntime {
  private deploymentState: BridgeBattleDeployment
  get deployment(): Readonly<BridgeBattleDeployment> { return this.deploymentState }
  readonly friendlyIds: Set<string>
  readonly targetIds: Set<string>
  readonly deadFriendly: Set<string>
  readonly deadTargets: Set<string>
  friendlyAlive = 0
  enemyAlive = 0

  constructor(mission: ActiveCareerMission) {
    this.deploymentState = resolveCareerBridgeDeployment(mission)
    this.friendlyIds = new Set(mission.friendlyActorIds)
    this.targetIds = new Set(mission.targetActorIds)
    this.deadFriendly = new Set(mission.deadFriendlyActorIds)
    this.deadTargets = new Set(mission.deadTargetActorIds)
    for (const id of [...this.friendlyIds, ...this.targetIds]) {
      const saved = mission.bridgeBattle?.actors[id]
      if (commanderActorConfirmedDead(mission, id) || saved?.status === 'dead' || saved?.hp === 0) this.recordDeath(id)
    }
    this.updateCounts(mission)
  }

  /** Only the live gameplay caller advances this clock; loading and queued spawns consume no preparation time. */
  advancePreparation(dt: number): void {
    if (this.deploymentState.phase === 'preparing' && Number.isFinite(dt)) {
      this.deploymentState.preparationRemainingSeconds = Math.max(0, this.deploymentState.preparationRemainingSeconds - Math.max(0, dt))
    }
  }

  beginEnemyDeployment(save: (state: BridgeBattleDeployment) => boolean): boolean {
    if (this.deploymentState.phase !== 'preparing' || this.deploymentState.preparationRemainingSeconds > 0) return false
    return this.transition('spawning', save)
  }

  completeEnemyDeployment(deploymentReady: boolean, save: (state: BridgeBattleDeployment) => boolean): boolean {
    if (!deploymentReady || this.deploymentState.phase !== 'spawning') return false
    return this.transition('assault', save)
  }

  private transition(phase: BridgeBattleDeployment['phase'], save: (state: BridgeBattleDeployment) => boolean): boolean {
    const next = { phase, preparationRemainingSeconds: 0 }
    if (!save(next)) return false
    this.deploymentState = next
    return true
  }

  recordDeath(actorId: string): void {
    if (this.targetIds.has(actorId)) this.deadTargets.add(actorId)
    else if (this.friendlyIds.has(actorId)) this.deadFriendly.add(actorId)
  }

  observe(mission: ActiveCareerMission, actors: readonly { combatantId: string; dead: boolean }[]): void {
    for (const actor of actors) if (actor.dead) this.recordDeath(actor.combatantId)
    this.updateCounts(mission)
  }

  private updateCounts(mission: ActiveCareerMission): void {
    this.friendlyAlive = mission.friendlyActorIds.reduce((n, id) => n + Number(!this.deadFriendly.has(id)), 0)
    this.enemyAlive = mission.targetActorIds.reduce((n, id) => n + Number(!this.deadTargets.has(id)), 0)
  }

  outcome(playerDead: boolean, deploymentReady: boolean, personalAlive = 0) {
    if (!deploymentReady || this.deploymentState.phase !== 'assault') return null
    return resolveCareerMissionOutcome(playerDead, true, this.enemyAlive, this.friendlyAlive + personalAlive)
  }
}

/** Result publication is acknowledged only after the complete reward/claim transaction saves. */
export function commitCareerBridgeBattleResult(store: Pick<CareerProfileStore, 'loadChecked' | 'save'>,
  missionId: string, stats: BattleStatsSnapshot) {
  const profile = store.loadChecked().profile
  const mission = profile?.activeMission
  if (!profile || !mission || mission.id !== missionId || !isCareerBridgeBattle(mission)) return null
  const runtime = new CareerBridgeBattleRuntime(mission)
  const personalAlive = mission.personalSquad?.memberIds.filter(id => {
    const actor = mission.personalSquad!.members[id]
    return actor && actor.hp !== 0 && (actor.status === 'deployed'
      || actor.status === 'reserve' && mission.personalSquad!.pendingMemberIds?.includes(id))
  }).length ?? 0
  const outcome = mission.result?.outcome ?? runtime.outcome(mission.playerDead === true,
    mission.commanderMission?.deploymentComplete === true && mission.bridgeBattle?.ready === true, personalAlive)
  if (!outcome) return null
  const claim = claimCareerMission(profile, missionId, outcome, stats.player, stats.meritPlayer)
  return store.save(claim.profile) ? claim : null
}


/** Trusted Commander VI launch using the existing open formation battlefield. */
export interface CareerFelineBattleLaunch {
  type: 'career-feline-battle'
  careerMissionId: string
  battle: BattleConfig
}

function felineRolePreset(faction: CareerProfile['faction'], role: FelineCavalryRole): UnitPresetId {
  return `${faction}_${role === 'melee' ? 'sword_cavalry' : role}` as UnitPresetId
}

function felineFormationRoleCount(groups: readonly { role: FelineCavalryRole; count: number }[], role: FelineCavalryRole): number {
  return groups.filter(group => group.role === role).reduce((sum, group) => sum + group.count, 0)
}

function setFelineFormationCount(
  roman: RomanArmyConfig,
  viking: VikingArmyConfig,
  faction: CareerProfile['faction'],
  role: FelineCavalryRole,
  count: number,
): void {
  if (faction === 'roman') {
    const bucket = role === 'melee' ? roman.roman_sword_cavalry
      : role === 'lancer' ? roman.roman_lancer : roman.roman_horse_archer
    if (!bucket) throw new Error(`Missing Roman formation bucket for ${role}`)
    bucket[3] = count
    return
  }
  const bucket = role === 'melee' ? viking.viking_sword_cavalry
    : role === 'lancer' ? viking.viking_lancer : viking.viking_horse_archer
  if (!bucket) throw new Error(`Missing Viking formation bucket for ${role}`)
  bucket[3] = count
}

export function careerFelineHeroAssetIds(profile: Pick<CareerProfile, 'faction'>): HeroAssetId[] {
  const enemyFaction: CareerProfile['faction'] = profile.faction === 'roman' ? 'viking' : 'roman'
  const assets = new Set<HeroAssetId>()
  for (const faction of [profile.faction, enemyFaction] as const) {
    for (const role of ['melee', 'lancer', 'horse_archer'] as const) {
      assets.add(T4_UNIT_PROFILES[felineRolePreset(faction, role)].visualAssetId)
    }
    assets.add(townCommanderHeroAsset(faction))
  }
  return [...assets]
}

function createFelineFormationPlan(faction: CareerProfile['faction']): BattleSpawnPlan {
  const enemyFaction = faction === 'roman' ? 'viking' : 'roman'
  const roman = createEmptyRomanArmyConfig()
  const viking = createEmptyVikingArmyConfig()
  for (const role of ['melee', 'lancer', 'horse_archer'] as const) {
    setFelineFormationCount(roman, viking, faction, role, felineFormationRoleCount(FELINE_FRIENDLY_GROUPS, role))
    setFelineFormationCount(roman, viking, enemyFaction, role, felineFormationRoleCount(FELINE_ENEMY_GROUPS, role))
  }
  return BattleSpawner.createSpawnPlan({
    mode: 'formation', commandGrouping: 'squad', playerFaction: faction,
    viking, roman, rules: { respawnEnabled: false, includeCamps: false },
  })
}

function felineGroupSlots(plan: BattleSpawnPlan, faction: CareerProfile['faction'], role: FelineCavalryRole): NpcSpawnSpec[] {
  const presetId = felineRolePreset(faction, role)
  return plan.npcSpecs.filter(spec => spec.characterFaction === faction && spec.presetId === presetId)
}

function felineT4Spec(template: NpcSpawnSpec, actorId: string, faction: CareerProfile['faction'],
  allegiance: Faction, role: FelineCavalryRole, mountId: string, squadId?: NpcSpawnSpec['squadId']): NpcSpawnSpec {
  const presetId = felineRolePreset(faction, role)
  const hero = T4_UNIT_PROFILES[presetId]
  const baseLoadout = resolveT4UnitLoadout(presetId)
  let loadout: UnitLoadout
  if (allegiance === Faction.PLAYER) {
    if (role === 'horse_archer') {
      loadout = {
        ...baseLoadout,
        meleeWeaponId: 'spear_t4',
        rangedWeaponId: 'maki-ranger-bow-ranged',
        shieldId: 'paladin_shield_t4',
        mountId,
      }
    } else {
      loadout = {
        ...baseLoadout,
        rangedWeaponId: 'maki-ranger-bow-ranged',
        mountId,
      }
    }
  } else {
    loadout = { ...baseLoadout, mountId }
  }
  return {
    ...template, actorId, faction: allegiance, characterFaction: faction, name: `T4 ${role}`,
    tier: 4, characterTier: 4, heroArchetype: hero.combatProfileId === 'ranger' ? 'ranger' : 'captain',
    aiType: loadout.rangedWeaponId ? AIType.RANGED : AIType.MELEE, cavalry: true, respawnEnabled: false,
    presetId, loadout, visualAssetId: hero.visualAssetId, combatProfileId: hero.combatProfileId,
    ...(hero.specialCombatProfile ? { specialCombatProfile: hero.specialCombatProfile } : {}),
    ...(squadId ? { squadId } : {}),
  }
}

function felineT5Spec(template: NpcSpawnSpec, actorId: string, faction: CareerProfile['faction'],
  allegiance: Faction, role: FelineCavalryRole, mountId: string, squadId?: NpcSpawnSpec['squadId']): NpcSpawnSpec {
  const asset = townCommanderHeroAsset(faction)
  const commander = careerCommanderLoadout(faction)
  const loadout: UnitLoadout = allegiance === Faction.PLAYER
    ? (role === 'lancer'
        ? { ...commander, meleeWeaponId: 'spear_t5', rangedWeaponId: 'bow_t5', mountId }
        : { ...commander, rangedWeaponId: 'bow_t5', mountId })
    : (role === 'lancer'
        ? { ...commander, meleeWeaponId: 'spear_t5', rangedWeaponId: null, mountId }
        : role === 'horse_archer' ? { ...commander, mountId } : { ...commander, rangedWeaponId: null, mountId })
  return {
    ...template, actorId, faction: allegiance, characterFaction: faction, name: `T5 ${role}`,
    tier: 4, characterTier: 5, heroArchetype: 'commander',
    aiType: loadout.rangedWeaponId ? AIType.RANGED : AIType.MELEE, cavalry: true, respawnEnabled: false,
    presetId: felineRolePreset(faction, role), loadout, visualAssetId: asset,
    combatProfileId: HERO_COMBAT_PROFILE_BY_ASSET[asset],
    ...(squadId ? { squadId } : {}),
  }
}

export function felineFriendlyMountId(role: FelineCavalryRole, tier: 4 | 5, indexInGroup: number): string {
  if (tier === 5) return 'snow-leopard'
  if (role === 'melee') return 'caracal'
  if (role === 'lancer') return 'serval'
  if (indexInGroup < 20) return 'black-cat'
  if (indexInGroup < 40) return 'white-cat'
  return 'orange-cat'
}

function expandFelineSide(
  mission: ActiveCareerMission,
  plan: BattleSpawnPlan,
  faction: CareerProfile['faction'],
  friendly: boolean,
): NpcSpawnSpec[] {
  const groups = friendly ? FELINE_FRIENDLY_GROUPS : FELINE_ENEMY_GROUPS
  const ids = friendly ? mission.friendlyActorIds : mission.targetActorIds
  const allegiance = friendly ? Faction.PLAYER : Faction.ENEMY
  const slots = new Map<FelineCavalryRole, NpcSpawnSpec[]>([
    ['melee', felineGroupSlots(plan, faction, 'melee')],
    ['lancer', felineGroupSlots(plan, faction, 'lancer')],
    ['horse_archer', felineGroupSlots(plan, faction, 'horse_archer')],
  ])
  const cursors: Record<FelineCavalryRole, number> = { melee: 0, lancer: 0, horse_archer: 0 }
  let actorOffset = 0, friendlySquad = 1, friendlySquadFill = 0
  const result: NpcSpawnSpec[] = []
  for (const group of groups) for (let i = 0; i < group.count; i++) {
    const template = slots.get(group.role)![cursors[group.role]++]
    if (!template) throw new Error(`Missing formation slot for ${faction} ${group.role}`)
    const actorId = ids[actorOffset++]
    if (!actorId) throw new Error('Feline cavalry roster identity mismatch')
    let squadId: NpcSpawnSpec['squadId']
    if (friendly) {
      squadId = friendlySquad as NpcSpawnSpec['squadId']
      if (++friendlySquadFill === FELINE_FRIENDLY_SQUAD_SIZES[friendlySquad - 1]) {
        friendlySquad++; friendlySquadFill = 0
      }
    }
    const mountId = friendly
      ? felineFriendlyMountId(group.role, group.tier, i)
      : 'horse'
    result.push(group.tier === 4
      ? felineT4Spec(template, actorId, faction, allegiance, group.role, mountId, squadId)
      : felineT5Spec(template, actorId, faction, allegiance, group.role, mountId, squadId))
  }
  return result
}

/**
 * Places the seven friendly Commander VI squads in a deliberate tactical formation:
 * Front rank:
 *   - S1 (T4 Melee, 30): Front Left Wing (relativeX = -24)
 *   - S7 (T5 Lancer, 20): Front Center Assault Core (relativeX = 0)
 *   - S2 (T4 Melee, 30): Front Right Wing (relativeX = +24)
 * Rear rank:
 *   - S3 (T4 Lancer, 30): Rear Left Wing (relativeX = -36)
 *   - S5 (T4 Horse Archer, 30): Rear Center-Left (relativeX = -12)
 *   - S6 (T4 Horse Archer, 30): Rear Center-Right (relativeX = +12)
 *   - S4 (T4 Lancer, 30): Rear Right Wing (relativeX = +36)
 *
 * S5 and S6 flank the center, preserving a 9.6m central advance lane behind S7.
 * All squads are placed in front of player spawn (|Z| = 145), leaving a safe buffer.
 */
export function positionFelineFriendlyTacticalFormation(
  specs: NpcSpawnSpec[],
  faction: CareerProfile['faction'],
): void {
  if (specs.length !== FELINE_FRIENDLY_TOTAL) {
    throw new Error('Invalid Six Feline Cavalry friendly count')
  }

  const columnsPerBlock = 5
  const mountedColumnGap = 3.6
  const mountedRankGap = 3.8
  const maxRankDepth = (Math.ceil(MAX_COMMAND_SQUAD_SIZE / columnsPerBlock) - 1) * mountedRankGap
  const rankGap = 6.2
  const rearRankEndAbsZ = 140
  const rearRankStartAbsZ = rearRankEndAbsZ - maxRankDepth
  const frontRankEndAbsZ = rearRankStartAbsZ - rankGap
  const frontRankStartAbsZ = frontRankEndAbsZ - maxRankDepth

  const zSign = faction === 'viking' ? 1 : -1
  const xSign = faction === 'viking' ? -1 : 1

  const layouts: Array<{ squadId: number; size: number; centerX: number; startAbsZ: number }> = [
    { squadId: 1, size: 30, centerX: -24, startAbsZ: frontRankStartAbsZ },
    { squadId: 2, size: 30, centerX: 24, startAbsZ: frontRankStartAbsZ },
    { squadId: 3, size: 30, centerX: -36, startAbsZ: rearRankStartAbsZ },
    { squadId: 4, size: 30, centerX: 36, startAbsZ: rearRankStartAbsZ },
    { squadId: 5, size: 30, centerX: -12, startAbsZ: rearRankStartAbsZ },
    { squadId: 6, size: 30, centerX: 12, startAbsZ: rearRankStartAbsZ },
    { squadId: 7, size: 20, centerX: 0, startAbsZ: frontRankStartAbsZ },
  ]

  let offset = 0
  for (const layout of layouts) {
    for (let index = 0; index < layout.size; index++) {
      const spec = specs[offset++]
      const row = Math.floor(index / columnsPerBlock)
      const countInRow = Math.min(columnsPerBlock, layout.size - row * columnsPerBlock)
      const col = index % columnsPerBlock
      const unitRelX = layout.centerX + (col - (countInRow - 1) / 2) * mountedColumnGap
      const unitAbsZ = layout.startAbsZ + row * mountedRankGap
      spec.x = Math.round(unitRelX * xSign * 100) / 100
      spec.z = Math.round(unitAbsZ * zSign * 100) / 100
    }
  }
}

/**
 * Commander VI has independent mounted units, not two elongated cavalry wings.
 * Preserve the formal squad/actor order; only rearrange deterministic spawn positions.
 * Each squad has its own five-abreast block with clear lateral and rear lanes.
 */
function positionFelineSquadBlocks(specs: NpcSpawnSpec[], squadSizes: readonly number[], faction: CareerProfile['faction']): void {
  if (squadSizes.reduce((total, size) => total + size, 0) !== specs.length
    || squadSizes.some(size => size < 1 || size > MAX_COMMAND_SQUAD_SIZE)) {
    throw new Error('Invalid Six Feline Cavalry formation groups')
  }
  const columnsPerBlock = 5
  const mountedColumnGap = 3.6
  const mountedRankGap = 3.8
  const blockGap = 10
  const blockPitchX = (columnsPerBlock - 1) * mountedColumnGap + blockGap
  const blockPitchZ = (Math.ceil(MAX_COMMAND_SQUAD_SIZE / columnsPerBlock) - 1) * mountedRankGap + blockGap
  const frontAbsZ = BATTLE_FRONTLINE_Z - blockGap
  const zSign = faction === 'viking' ? 1 : -1
  const firstRankBlocks = Math.floor(squadSizes.length / 2)
  let offset = 0
  for (const [squadIndex, squadSize] of squadSizes.entries()) {
    const secondRank = squadIndex >= firstRankBlocks
    const blocksInRank = secondRank ? squadSizes.length - firstRankBlocks : firstRankBlocks
    const column = secondRank ? squadIndex - firstRankBlocks : squadIndex
    const centerX = (column - (blocksInRank - 1) / 2) * blockPitchX
    for (let index = 0; index < squadSize; index++) {
      const spec = specs[offset++]
      const row = Math.floor(index / columnsPerBlock)
      const countInRow = Math.min(columnsPerBlock, squadSize - row * columnsPerBlock)
      const col = index % columnsPerBlock
      spec.x = Math.round((centerX + (col - (countInRow - 1) / 2) * mountedColumnGap) * 100) / 100
      spec.z = Math.round((frontAbsZ + Number(secondRank) * blockPitchZ + row * mountedRankGap) * zSign * 100) / 100
    }
  }
}

/**
 * The open-field battle runtime: Commander VI / VII (six-cat army, vanguard charge) and the
 * Soldier / Veteran / Captain heavy-cavalry battles (state-machine triggers) share it.
 */
export function isCareerFelineBattle(mission: ActiveCareerMission | undefined): mission is ActiveCareerMission & { readonly openFieldBattle?: true } {
  return careerFieldMissionMatches(mission, COMMANDER_FELINE_CAVALRY_ID, COMMANDER_FELINE_CAVALRY_KIND)
    || careerFieldMissionMatches(mission, COMMANDER_IRON_LEGION_ID, COMMANDER_IRON_LEGION_KIND)
    || isCareerHeavyFieldBattle(mission)
}

/** Initial / restored order of one NPC of a field battle; the Reload path uses the same rule. */
export function careerFieldTacticalOrder(mission: ActiveCareerMission, faction: Faction): TacticalOrder {
  const heavy = mission.commanderMission?.heavyField
  if (isCareerHeavyFieldBattle(mission) && heavy) return heavyTacticalOrder(mission.templateId, faction === Faction.PLAYER ? 'friendly' : 'enemy', heavy)
  return felineInitialTacticalOrder(faction, mission.commanderMission?.felineChargeTriggered === true)
}

/** Commander VII: the enemy army is 300 formal heavy cavalry (T4 210 + T5 90). */
function expandIronLegionEnemy(mission: ActiveCareerMission, faction: CareerProfile['faction']): NpcSpawnSpec[] {
  let offset = 0
  return IRON_LEGION_ENEMY_GROUPS.flatMap(group => Array.from({ length: group.count }, () => {
    const actorId = mission.targetActorIds[offset++]
    if (!actorId) throw new Error('Iron Legion roster identity mismatch')
    return heavyUnitSpec(actorId, faction, Faction.ENEMY, group.role, group.tier)
  }))
}

export function createCareerFelineBattleLaunch(profile: CareerProfile): CareerFelineBattleLaunch {
  const mission = profile.activeMission
  if (isCareerHeavyFieldBattle(mission)) return createCareerHeavyBattleLaunch(profile)
  if (!isCareerFelineBattle(mission) || profile.rank !== 'commander'
    || mission.friendlyActorIds.length !== FELINE_FRIENDLY_TOTAL || mission.targetActorIds.length !== FELINE_ENEMY_TOTAL
    || mission.officialSquad?.commandRank !== 'commander' || mission.officialSquad.missionId !== mission.id) {
    throw new Error('Expected saved Six Feline Cavalry mission')
  }
  return { type: 'career-feline-battle', careerMissionId: mission.id, battle: {
    careerFelineMissionId: mission.id,
    mode: 'formation', commandGrouping: 'squad', playerFaction: profile.faction,
    playerHeroId: resolveCareerHeroAsset(profile), playerLoadout: careerCombatPlayerLoadout(profile),
    roman: {}, viking: {}, rules: { respawnEnabled: false, includeCamps: false },
  } }
}

export function createCareerFelineSpawnPlan(profile: CareerProfile): BattleSpawnPlan {
  createCareerFelineBattleLaunch(profile)
  const mission = profile.activeMission!
  if (isCareerHeavyFieldBattle(mission)) return createCareerHeavySpawnPlan(profile)
  const enemyFaction = profile.faction === 'roman' ? 'viking' : 'roman'
  const template = createFelineFormationPlan(profile.faction)
  const friendly = expandFelineSide(mission, template, profile.faction, true)
  const enemy = mission.templateId === COMMANDER_IRON_LEGION_ID
    ? expandIronLegionEnemy(mission, enemyFaction) : expandFelineSide(mission, template, enemyFaction, false)
  // Friendly units deploy in tactical order; enemy units retain existing blocks and vanguard.
  positionFelineFriendlyTacticalFormation(friendly, profile.faction)
  const enemySquadSizes = Array.from({ length: Math.ceil(enemy.length / MAX_COMMAND_SQUAD_SIZE) },
    (_, index) => Math.min(MAX_COMMAND_SQUAD_SIZE, enemy.length - index * MAX_COMMAND_SQUAD_SIZE))
  positionFelineSquadBlocks(enemy, enemySquadSizes, enemyFaction)
  const vanguard = enemy.find(spec => spec.actorId === mission.commanderMission?.felineVanguardActorId)
  if (!vanguard || vanguard.characterTier !== 5 || !(vanguard.presetId?.endsWith('_lancer') || vanguard.presetId?.endsWith('_heavy_cavalry'))) {
    throw new Error('Six Feline Cavalry vanguard identity is invalid')
  }
  const mainEnemy = enemy.filter(spec => spec !== vanguard)
  const front = mainEnemy.reduce((best, spec) => Math.abs(spec.z) < Math.abs(best.z) ? spec : best)
  const formationCenterX = mainEnemy.reduce((sum, spec) => sum + spec.x, 0) / mainEnemy.length
  const forwardSign = Math.sign(-front.z) || 1
  vanguard.x = Math.round(formationCenterX * 100) / 100
  vanguard.z = Math.round((front.z + forwardSign * FELINE_VANGUARD_ADVANCE_METERS) * 100) / 100
  return { playerSpawn: template.playerSpawn, pickupSpecs: [], horseSpecs: [], npcSpecs: [...friendly, ...enemy] }
}

export function felineInitialTacticalOrder(faction: Faction, chargeTriggered: boolean): TacticalOrder {
  return faction === Faction.PLAYER ? 'defend' : chargeTriggered ? 'charge' : 'attack'
}

export function shouldTriggerFelineVanguardCharge(mission: ActiveCareerMission, event: CombatEvent): boolean {
  return isCareerFelineBattle(mission)
    && mission.commanderMission?.felineChargeTriggered !== true
    && event.type === 'damage_applied' && event.appliedDamage > 0
    && event.target.targetType === 'npc'
    && event.target.targetId === mission.commanderMission?.felineVanguardActorId
}

/** Issue the one-shot in-memory attack before attempting any durable write.
 * A failed write leaves the live mission marked for the normal field checkpoint retry. */
export function dispatchFelineVanguardCharge(mission: ActiveCareerMission, event: CombatEvent,
  issueCharge: () => void): boolean {
  if (!markFelineVanguardCharge(mission, event)) return false
  issueCharge()
  return true
}

export function markFelineVanguardCharge(mission: ActiveCareerMission, event: CombatEvent): boolean {
  if (!shouldTriggerFelineVanguardCharge(mission, event) || !mission.commanderMission) return false
  mission.commanderMission.felineChargeTriggered = true
  return true
}

export interface FelineDeploymentReadinessInput {
  spawnBatchReady: boolean
  battleReady: boolean
  personalSquadReady?: boolean
}

/**
 * Validates that all three required production subsystems (cavalry spawn batch,
 * mission feline battle state, and any active personal squad) have completely
 * finalized deployment before the loading overlay is dismissed.
 */
export function validateFelineDeploymentReadiness(input: FelineDeploymentReadinessInput): void {
  if (!input.spawnBatchReady || !input.battleReady || (input.personalSquadReady !== undefined && !input.personalSquadReady)) {
    throw new Error('Six Feline Cavalry deployment did not complete')
  }
}
