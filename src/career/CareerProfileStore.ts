import { isCareerOutpostStageId, type CareerOutpostMission, type CareerOutpostRecord } from './CareerOutpostMission'
import { PLAYER_MOUNT_IDS, type PlayerMountId } from '../battle/BattleConfig'
import { UNIT_PRESETS, type UnitPresetId, type UnitTier } from '../battle/UnitPresetCatalog'
import { ARMORS } from '../rpg/ArmorDatabase'
import { WEAPONS } from '../rpg/WeaponDatabase'
import { isHeroAssetId, type HeroAssetId } from '../world/HeroAssetCatalog'
import {
  cloneCareerProfile,
  canonicalCareerMountId,
  CAREER_RANKS,
  resolveCareerRank,
  type CareerLifetimeStats,
  type CareerMountId,
  type CareerProfile,
} from './CareerProfile'
import { getCareerMissionTemplate } from './CareerMissionCatalog'
import type { ActiveCareerMission, CareerMissionPhase, VeteranOutpostBattleState } from './CareerMissionState'
import { CAREER_DUEL_TEMPLATE_ID, DUEL_COUNTDOWN_SECONDS, DUEL_COMBAT_SECONDS, isCareerDuelPresetId, isCareerDuelTier } from './CareerDuelState'

export const CAREER_STORAGE_KEY = 'sagaburst_career_v1'

function nonNegativeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

function nonNegativeInteger(value: unknown): number {
  return Math.floor(nonNegativeNumber(value))
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((entry): entry is string => (
    typeof entry === 'string' && entry.trim().length > 0
  )).map(entry => entry.trim()))]
}

function parseLifetimeStats(value: unknown): CareerLifetimeStats {
  const input = value && typeof value === 'object'
    ? value as Partial<CareerLifetimeStats>
    : {}

  return {
    battles: nonNegativeInteger(input.battles),
    victories: nonNegativeInteger(input.victories),
    deaths: nonNegativeInteger(input.deaths),
    kills: nonNegativeInteger(input.kills),
    damage: nonNegativeNumber(input.damage),
    structureDamage: nonNegativeNumber(input.structureDamage),
    breaches: nonNegativeInteger(input.breaches),
  }
}

function parseMissionPlayerStats(value: unknown): ActiveCareerMission['playerStats'] {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const stats = {
    damageDealt: nonNegativeNumber(raw.damageDealt),
    damageTaken: nonNegativeNumber(raw.damageTaken),
    kills: nonNegativeInteger(raw.kills),
    structureDamage: nonNegativeNumber(raw.structureDamage),
    structuresDestroyed: nonNegativeInteger(raw.structuresDestroyed),
    gateBreaches: nonNegativeInteger(raw.gateBreaches),
  }
  return Object.values(stats).some(value => value > 0) ? stats : undefined
}

const MISSION_PHASES: CareerMissionPhase[] = ['ASSEMBLING', 'MARCHING', 'ENGAGING', 'RETURNING', 'PREPARING', 'ATTACKING', 'VICTORY_LOCKED', 'FAILURE_LOCKED', 'RESET', 'RESULT']
const CAREER_MOUNT_IDS: CareerMountId[] = ['horse', 'horse-t1', 'horse-t2', 'horse-t3', 'black-cat', 'corgi']

function parseMissionMountState(value: unknown): ActiveCareerMission['mountState'] {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const activeMountId = CAREER_MOUNT_IDS.includes(raw.activeMountId as CareerMountId)
    ? canonicalCareerMountId(raw.activeMountId as CareerMountId)
    : undefined
  const rawHp = raw.hp && typeof raw.hp === 'object' ? raw.hp as Record<string, unknown> : {}
  const hp: Partial<Record<CareerMountId, number>> = {}
  for (const id of CAREER_MOUNT_IDS) {
    const value = rawHp[id]
    const canonical = canonicalCareerMountId(id)
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) hp[canonical] = Math.min(hp[canonical] ?? value, value)
  }
  const unavailable = [...new Set(uniqueStrings(raw.unavailable)
    .filter((id): id is CareerMountId => CAREER_MOUNT_IDS.includes(id as CareerMountId))
    .map(canonicalCareerMountId))]
  if (!activeMountId && Object.keys(hp).length === 0 && unavailable.length === 0) return undefined
  return { ...(activeMountId ? { activeMountId } : {}), hp, unavailable }
}

function parseActorHealth(value: unknown, knownActorIds: ReadonlySet<string>): ActiveCareerMission['actorHealth'] | undefined {
  if (!value || typeof value !== 'object') return undefined
  const result: NonNullable<ActiveCareerMission['actorHealth']> = {}
  for (const [actorId, rawHealth] of Object.entries(value)) {
    if (!knownActorIds.has(actorId) || !rawHealth || typeof rawHealth !== 'object') continue
    const health = rawHealth as Record<string, unknown>
    if (typeof health.hp !== 'number' || !Number.isFinite(health.hp) || health.hp < 0) continue
    result[actorId] = {
      hp: health.hp,
      ...(typeof health.mountHp === 'number' && Number.isFinite(health.mountHp) && health.mountHp >= 0 ? { mountHp: health.mountHp } : {}),
    }
  }
  return Object.keys(result).length > 0 ? result : undefined
}

function parseVeteranOutpostBattleState(value: unknown): VeteranOutpostBattleState | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  if (!['deployment', 'assault', 'victory', 'defeat'].includes(raw.phase as string)
    || !['deployment', 'assault'].includes(raw.activePhase as string)) return undefined
  const gateState = ['closed', 'open', 'destroyed'].includes(raw.gateState as string)
    ? raw.gateState as VeteranOutpostBattleState['gateState'] : undefined
  return {
    phase: raw.phase as VeteranOutpostBattleState['phase'],
    activePhase: raw.activePhase as VeteranOutpostBattleState['activePhase'],
    assaultElapsedSeconds: nonNegativeNumber(raw.assaultElapsedSeconds),
    deploymentRemainingSeconds: nonNegativeNumber(raw.deploymentRemainingSeconds),
    reinforcementTriggered: raw.reinforcementTriggered === true,
    reinforcementSpawned: raw.reinforcementSpawned === true,
    reinforcementArrived: raw.reinforcementArrived === true,
    ...(typeof raw.reinforcementRemainingSeconds === 'number' && Number.isFinite(raw.reinforcementRemainingSeconds) && raw.reinforcementRemainingSeconds >= 0 ? { reinforcementRemainingSeconds: raw.reinforcementRemainingSeconds } : {}),
    battleFinished: raw.battleFinished === true,
    reinforcementQueueIndex: nonNegativeInteger(raw.reinforcementQueueIndex),
    assaultChargeTriggered: raw.assaultChargeTriggered === true,
    ...(typeof raw.gateHealth === 'number' && Number.isFinite(raw.gateHealth) && raw.gateHealth >= 0 ? { gateHealth: raw.gateHealth } : {}),
    ...(gateState ? { gateState } : {}),
  }
}

function parseActiveMission(value: unknown, faction: CareerProfile['faction']): ActiveCareerMission | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const template = typeof raw.templateId === 'string' ? getCareerMissionTemplate(raw.templateId) : null
  const duel = raw.kind === 'duel' && raw.templateId === CAREER_DUEL_TEMPLATE_ID
  const duelOpponentActorId = typeof raw.duelOpponentActorId === 'string' ? raw.duelOpponentActorId.trim() : ''
  const duelCaptainActorId = typeof raw.duelCaptainActorId === 'string' ? raw.duelCaptainActorId.trim() : ''
  const duelRefereeActorId = typeof raw.duelRefereeActorId === 'string' ? raw.duelRefereeActorId.trim() : duelCaptainActorId
  if (duel && (!isCareerDuelTier(raw.duelTier) || !isCareerDuelPresetId(raw.duelPresetId)
    || UNIT_PRESETS[raw.duelPresetId].faction !== faction || !duelOpponentActorId || !duelCaptainActorId || !duelRefereeActorId)) return undefined
  const outpostMission = template?.kind === 'veteran-outpost-defense' || template?.kind === 'veteran-outpost-assault'
  if (
    typeof raw.id !== 'string' || !raw.id
    || (!template && !duel)
    || !Number.isInteger(raw.targetCampId) || ((duel || template?.kind === 'town-defense' || template?.kind === 'enemy-town-assault' || outpostMission)
      ? raw.targetCampId !== -1
      : (raw.targetCampId as number) < 0 || (raw.targetCampId as number) > 4)
    || !MISSION_PHASES.includes(raw.phase as CareerMissionPhase)
  ) return undefined
  const targetActorIds = duel ? [duelOpponentActorId] : uniqueStrings(raw.targetActorIds)
  const friendlyActorIds = duel ? (duelRefereeActorId === duelOpponentActorId ? [] : [duelRefereeActorId]) : uniqueStrings(raw.friendlyActorIds)
  const reinforcementActorIds = uniqueStrings(raw.reinforcementActorIds)
  const allFriendlyActorIds = [...new Set([...friendlyActorIds, ...reinforcementActorIds])]
  if (template?.kind === 'town-defense' && !friendlyActorIds.includes('ranger')) friendlyActorIds.push('ranger')
  if (template?.kind === 'town-defense' && !friendlyActorIds.includes('deployment')) friendlyActorIds.push('deployment')
  if (targetActorIds.length === 0 || (!duel && friendlyActorIds.length === 0)) return undefined
  const mountState = parseMissionMountState(raw.mountState)
  const playerStats = parseMissionPlayerStats(raw.playerStats)
  const actorHealth = parseActorHealth(raw.actorHealth, new Set([...targetActorIds, ...allFriendlyActorIds]))
  const outpostBattleState = parseVeteranOutpostBattleState(raw.outpostBattleState)
  const marchPosition = raw.mountedMarchPosition as { x?: unknown; z?: unknown } | undefined
  const mountedMarchPosition = marchPosition && typeof marchPosition.x === 'number' && Number.isFinite(marchPosition.x)
    && typeof marchPosition.z === 'number' && Number.isFinite(marchPosition.z) ? { x: marchPosition.x, z: marchPosition.z } : undefined

  const mission: ActiveCareerMission = {
    id: raw.id,
    templateId: duel ? CAREER_DUEL_TEMPLATE_ID : template!.id,
    kind: duel ? 'duel' : template!.kind,
    targetCampId: raw.targetCampId as number,
    phase: raw.phase as CareerMissionPhase,
    targetActorIds,
    friendlyActorIds,
    deadTargetActorIds: uniqueStrings(raw.deadTargetActorIds).filter(id => targetActorIds.includes(id)),
    deadFriendlyActorIds: uniqueStrings(raw.deadFriendlyActorIds).filter(id => allFriendlyActorIds.includes(id)),
    deadCivilianActorIds: uniqueStrings(raw.deadCivilianActorIds).filter(id => uniqueStrings(raw.civilianActorIds).includes(id)),
    playerDead: raw.playerDead === true,
    ...(duel ? {
      duelTier: raw.duelTier as UnitTier,
      duelPresetId: raw.duelPresetId as UnitPresetId,
      duelOpponentActorId, duelCaptainActorId, duelRefereeActorId,
      duelCountdownElapsed: Math.min(DUEL_COUNTDOWN_SECONDS, nonNegativeNumber(raw.duelCountdownElapsed)),
      duelCombatElapsed: Math.min(DUEL_COMBAT_SECONDS, nonNegativeNumber(raw.duelCombatElapsed)),
      duelOpponentDead: raw.duelOpponentDead === true || uniqueStrings(raw.deadTargetActorIds).includes(duelOpponentActorId),
      ...(typeof raw.duelOpponentHp === 'number' && Number.isFinite(raw.duelOpponentHp) && raw.duelOpponentHp >= 0 ? { duelOpponentHp: raw.duelOpponentHp } : {}),
      ...(typeof raw.duelOpponentMountHp === 'number' && Number.isFinite(raw.duelOpponentMountHp) && raw.duelOpponentMountHp >= 0 ? { duelOpponentMountHp: raw.duelOpponentMountHp } : {}),
      ...(typeof raw.duelPlayerHp === 'number' && Number.isFinite(raw.duelPlayerHp) && raw.duelPlayerHp >= 0 ? { duelPlayerHp: raw.duelPlayerHp } : {}),
      ...(typeof raw.duelPlayerStamina === 'number' && Number.isFinite(raw.duelPlayerStamina) && raw.duelPlayerStamina >= 0 ? { duelPlayerStamina: raw.duelPlayerStamina } : {}),
      ...(typeof raw.duelOpponentAmmo === 'number' && Number.isFinite(raw.duelOpponentAmmo) && raw.duelOpponentAmmo >= 0 ? { duelOpponentAmmo: Math.floor(raw.duelOpponentAmmo) } : {}),
    } : {}),
    ...(playerStats ? { playerStats } : {}),
    mountedMarchProgress: nonNegativeNumber(raw.mountedMarchProgress),
    ...(mountedMarchPosition ? { mountedMarchPosition } : {}),
    followVoicePlayed: raw.followVoicePlayed === true,
    sweepAlerted: raw.sweepAlerted === true,
    routeStage: nonNegativeInteger(raw.routeStage),
    patrolStage: nonNegativeInteger(raw.patrolStage),
    defenseElapsed: nonNegativeNumber(raw.defenseElapsed),
    defensePreparationElapsed: nonNegativeNumber(raw.defensePreparationElapsed),
    defenseReserveCharged: raw.defenseReserveCharged === true,
    defenseCatDead: raw.defenseCatDead === true,
    survivalElapsed: nonNegativeNumber(raw.survivalElapsed),
    reinforcementElapsed: nonNegativeNumber(raw.reinforcementElapsed),
    reinforcementSpawned: raw.reinforcementSpawned === true,
    reinforcementArrived: raw.reinforcementArrived === true,
    reinforcementActorIds,
    chargedSquadIds: Array.isArray(raw.chargedSquadIds) ? [...new Set(raw.chargedSquadIds.filter((id): id is number => Number.isInteger(id) && id >= 1 && id <= 8))] : [],
    borrowedActorIds: uniqueStrings(raw.borrowedActorIds).filter(id => friendlyActorIds.includes(id)),
    ...(actorHealth ? { actorHealth } : {}),
    ...(typeof raw.playerHp === 'number' && Number.isFinite(raw.playerHp) && raw.playerHp >= 0 ? { playerHp: raw.playerHp } : {}),
    ...(typeof raw.playerStamina === 'number' && Number.isFinite(raw.playerStamina) && raw.playerStamina >= 0 ? { playerStamina: raw.playerStamina } : {}),
    ...(outpostBattleState ? { outpostBattleState } : {}),
    acceptedAt: nonNegativeInteger(raw.acceptedAt),
    ...(mountState ? { mountState } : {}),
    ...((template?.kind === 'town-defense' || template?.kind === 'enemy-town-assault') ? { civilianActorIds: uniqueStrings(raw.civilianActorIds) } : {}),
  }
  if (raw.result && typeof raw.result === 'object') {
    const result = raw.result as Record<string, unknown>
    const player = result.stats && typeof result.stats === 'object' ? result.stats as Record<string, unknown> : {}
    const merit = result.merit && typeof result.merit === 'object' ? result.merit as Record<string, unknown> : {}
    if (result.outcome === 'victory' || result.outcome === 'failure') {
      mission.result = {
        outcome: result.outcome,
        claimed: result.claimed === true,
        stats: {
          damageDealt: nonNegativeNumber(player.damageDealt),
          damageTaken: nonNegativeNumber(player.damageTaken),
          kills: nonNegativeInteger(player.kills),
          structureDamage: nonNegativeNumber(player.structureDamage),
          structuresDestroyed: nonNegativeInteger(player.structuresDestroyed),
          gateBreaches: nonNegativeInteger(player.gateBreaches),
          survived: player.survived === true,
        },
        merit: {
          damage: nonNegativeInteger(merit.damage),
          kills: nonNegativeInteger(merit.kills),
          contribution: nonNegativeInteger(merit.contribution),
          total: nonNegativeInteger(merit.total),
        },
        ...(result.defense && typeof result.defense === 'object' ? { defense: {
          civilianSurvived: nonNegativeInteger((result.defense as Record<string, unknown>).civilianSurvived),
          civilianDeaths: nonNegativeInteger((result.defense as Record<string, unknown>).civilianDeaths),
        } } : {}),
      }
    }
  }
  return mission
}

function parseOutpostMission(value: unknown): CareerOutpostMission | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  if (typeof raw.id !== 'string' || !raw.id.trim() || (raw.kind !== 'outpost-defense' && raw.kind !== 'outpost-relief') || !isCareerOutpostStageId(raw.stageId)) return undefined
  if (raw.kind === 'outpost-relief' && raw.stageId !== 3) return undefined
  return { id: raw.id.trim(), kind: raw.kind, stageId: raw.stageId, acceptedAt: nonNegativeInteger(raw.acceptedAt),
    ...(raw.kind === 'outpost-relief' && (raw.reliefPhase === 'march' || raw.reliefPhase === 'charge') ? { reliefPhase: raw.reliefPhase } : {}),
  }
}

function parseOutpostRecord(value: unknown): CareerOutpostRecord | undefined {
  const mission = parseOutpostMission(value)
  if (!mission) return undefined
  const raw = value as Record<string, unknown>
  if (raw.outcome !== 'victory' && raw.outcome !== 'defeat') return undefined
  if (!raw.stats || typeof raw.stats !== 'object' || !raw.merit || typeof raw.merit !== 'object') return undefined
  const stats = raw.stats as Record<string, unknown>, merit = raw.merit as Record<string, unknown>
  return {
    ...mission, outcome: raw.outcome, completed: raw.outcome === 'victory',
    stats: {
      damageDealt: nonNegativeNumber(stats.damageDealt), damageTaken: nonNegativeNumber(stats.damageTaken),
      kills: nonNegativeInteger(stats.kills), survived: stats.survived === true,
      structureDamage: nonNegativeNumber(stats.structureDamage), structuresDestroyed: nonNegativeInteger(stats.structuresDestroyed), gateBreaches: nonNegativeInteger(stats.gateBreaches),
    },
    merit: {
      victory: nonNegativeInteger(merit.victory), kills: nonNegativeInteger(merit.kills), characterDamage: nonNegativeInteger(merit.characterDamage), survival: nonNegativeInteger(merit.survival),
      structureDamage: nonNegativeInteger(merit.structureDamage), gateBreaches: nonNegativeInteger(merit.gateBreaches), total: nonNegativeInteger(merit.total),
    },
  }
}

export function parseCareerProfile(value: unknown): CareerProfile | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>

  if (raw.version !== 1) return null
  if (raw.faction !== 'roman' && raw.faction !== 'viking') return null

  // Temporary compatibility with the pre-merge #140 field names.
  const totalMerit = nonNegativeInteger(raw.totalMerit ?? raw.merit)
  const availableMerit = Math.min(
    totalMerit,
    nonNegativeInteger(raw.availableMerit ?? totalMerit),
  )

  const ownedWeapons = uniqueStrings(raw.ownedWeapons ?? raw.unlockedWeapons)
    .filter(id => Boolean(WEAPONS[id]))
  const ownedArmors = uniqueStrings(raw.ownedArmors ?? raw.unlockedShields)
    .filter(id => Boolean(ARMORS[id]))
  const ownedMounts = uniqueStrings(raw.ownedMounts ?? raw.unlockedMounts)
    .filter((id): id is PlayerMountId => (
      (PLAYER_MOUNT_IDS as readonly string[]).includes(id)
    ))
  const ownedHeroes = uniqueStrings(raw.ownedHeroes ?? raw.unlockedHeroes)
    .filter((id): id is HeroAssetId => isHeroAssetId(id))

  const enlistmentMeritBase = raw.enlistmentMeritBase === undefined ? 0
    : typeof raw.enlistmentMeritBase === 'number' && Number.isFinite(raw.enlistmentMeritBase) && raw.enlistmentMeritBase >= 0
      ? Math.min(totalMerit, Math.floor(raw.enlistmentMeritBase)) : totalMerit
  const eligible = resolveCareerRank(totalMerit - enlistmentMeritBase)
  const requested = CAREER_RANKS.indexOf(raw.rank as CareerProfile['rank'])
  const rank = CAREER_RANKS[Math.max(0, Math.min(requested, CAREER_RANKS.indexOf(eligible)))]
  const equipment = raw.equipment && typeof raw.equipment === 'object' ? raw.equipment as Record<string, unknown> : null
  const townEvent = raw.townEvent as CareerProfile['townEvent']
  const activeMission = parseActiveMission(raw.activeMission, raw.faction)
  const activeOutpostMission = parseOutpostMission(raw.activeOutpostMission)
  const selectedMountId = CAREER_MOUNT_IDS.includes(raw.selectedMountId as CareerMountId)
    ? canonicalCareerMountId(raw.selectedMountId as CareerMountId)
    : undefined
  if (townEvent && (typeof townEvent.id !== 'string' || !townEvent.id || !['hostile', 'settled'].includes(townEvent.state))) return null
  return {
    version: 1,
    faction: raw.faction,
    totalMerit,
    availableMerit,
    rank,
    enlistmentMeritBase,
    ...(equipment ? { equipment: {
      melee: typeof equipment.melee === 'string' ? equipment.melee : undefined,
      ranged: typeof equipment.ranged === 'string' ? equipment.ranged : undefined,
      shield: typeof equipment.shield === 'string' ? equipment.shield : null,
    } } : {}),
    ...(typeof raw.starterWeaponId === 'string' && WEAPONS[raw.starterWeaponId]?.tier === 1
      ? { starterWeaponId: raw.starterWeaponId } : {}),
    ...(townEvent ? { townEvent: { ...townEvent, ...(townEvent.deadActorIds ? { deadActorIds: uniqueStrings(townEvent.deadActorIds) } : {}), ...(townEvent.destroyedBuildingIds ? { destroyedBuildingIds: uniqueStrings(townEvent.destroyedBuildingIds) } : {}) } } : {}),
    ...(Array.isArray(raw.townDialogueSeen) ? { townDialogueSeen: uniqueStrings(raw.townDialogueSeen).filter(key => /^(roman|viking):(merchant|ranger|cat|captain|deployment|soldier-outpost)$/.test(key)) } : {}),
    ...(Array.isArray(raw.ownedHorseTiers) ? { ownedHorseTiers: [...new Set(raw.ownedHorseTiers.filter((tier): tier is 1 | 2 | 3 => [1, 2, 3].includes(tier)))] } : {}),
    ...(selectedMountId ? { selectedMountId } : {}),
    ...(activeMission ? { activeMission } : {}),
    ...(activeOutpostMission ? { activeOutpostMission } : {}),
    ...(Array.isArray(raw.completedOutpostStages) ? { completedOutpostStages: [...new Set(raw.completedOutpostStages.filter(isCareerOutpostStageId))] } : {}),
    ...(raw.completedOutpostRelief === true ? { completedOutpostRelief: true } : {}),
    ...(Array.isArray(raw.outpostBattleRecords) ? { outpostBattleRecords: raw.outpostBattleRecords.map(parseOutpostRecord).filter((record): record is CareerOutpostRecord => Boolean(record)) } : {}),
    ...(raw.careerMissionCompletions !== undefined ? { careerMissionCompletions: nonNegativeInteger(raw.careerMissionCompletions) } : {}),
    ...(raw.careerMissionCompletionsByTier && typeof raw.careerMissionCompletionsByTier === 'object'
      ? { careerMissionCompletionsByTier: {
        1: nonNegativeInteger((raw.careerMissionCompletionsByTier as Record<string, unknown>)[1]),
        2: nonNegativeInteger((raw.careerMissionCompletionsByTier as Record<string, unknown>)[2]),
        3: nonNegativeInteger((raw.careerMissionCompletionsByTier as Record<string, unknown>)[3]),
      } } : {}),
    ...(raw.duelHighestDefeatedTierByPreset && typeof raw.duelHighestDefeatedTierByPreset === 'object'
      ? { duelHighestDefeatedTierByPreset: Object.fromEntries(Object.entries(raw.duelHighestDefeatedTierByPreset)
        .filter(([presetId, tier]) => isCareerDuelPresetId(presetId) && isCareerDuelTier(tier))) as Partial<Record<UnitPresetId, UnitTier>> } : {}),
    ...(Array.isArray(raw.completedCareerMissionTemplateIds) ? { completedCareerMissionTemplateIds: uniqueStrings(raw.completedCareerMissionTemplateIds) } : {}),
    ownedWeapons,
    ownedArmors,
    ownedMounts,
    ownedHeroes,
    lifetimeStats: parseLifetimeStats(raw.lifetimeStats),
    claimedBattleIds: uniqueStrings(raw.claimedBattleIds),
  }
}

export class CareerProfileStore {
  constructor(private readonly storage: Storage = localStorage) {}

  loadChecked(): { profile: CareerProfile | null; error?: string } {
    try {
      const raw = this.storage.getItem(CAREER_STORAGE_KEY)
      if (raw === null) return { profile: null }
      const profile = parseCareerProfile(JSON.parse(raw))
      return profile ? { profile } : { profile: null, error: '生涯存檔損壞或版本不支援；原資料已保留。' }
    } catch { return { profile: null, error: '無法讀取生涯存檔；原資料已保留。' } }
  }

  load(): CareerProfile | null {
    const result = this.loadChecked()
    if (result.error) console.warn('[CareerProfileStore]', result.error)
    return result.profile
  }

  save(profile: CareerProfile): boolean {
    try {
      const parsed = parseCareerProfile(profile)
      if (!parsed) return false
      this.storage.setItem(
        CAREER_STORAGE_KEY,
        JSON.stringify(cloneCareerProfile(parsed)),
      )
      return true
    } catch {
      console.warn('[CareerProfileStore] Failed to save:', CAREER_STORAGE_KEY)
      return false
    }
  }

  hasProfile(): boolean {
    return this.storage.getItem(CAREER_STORAGE_KEY) !== null
  }
}
