import { isCareerOutpostStageId, type CareerOutpostMission, type CareerOutpostRecord } from './CareerOutpostMission'
import { PLAYER_MOUNT_IDS, type PlayerMountId } from '../battle/BattleConfig'
import { ARMORS } from '../rpg/ArmorDatabase'
import { WEAPONS } from '../rpg/WeaponDatabase'
import { isHeroAssetId, type HeroAssetId } from '../world/HeroAssetCatalog'
import {
  cloneCareerProfile,
  CAREER_RANKS,
  resolveCareerRank,
  type CareerLifetimeStats,
  type CareerMountId,
  type CareerProfile,
} from './CareerProfile'
import { getRecruitMissionTemplate } from './CareerMissionCatalog'
import type { ActiveCareerMission, CareerMissionPhase } from './CareerMissionState'

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
const CAREER_MOUNT_IDS: CareerMountId[] = ['horse-t1', 'horse-t2', 'horse-t3', 'black-cat', 'corgi']

function parseMissionMountState(value: unknown): ActiveCareerMission['mountState'] {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const activeMountId = CAREER_MOUNT_IDS.includes(raw.activeMountId as CareerMountId)
    ? raw.activeMountId as CareerMountId
    : undefined
  const rawHp = raw.hp && typeof raw.hp === 'object' ? raw.hp as Record<string, unknown> : {}
  const hp: Partial<Record<CareerMountId, number>> = {}
  for (const id of CAREER_MOUNT_IDS) {
    if (typeof rawHp[id] === 'number' && Number.isFinite(rawHp[id]) && (rawHp[id] as number) >= 0) hp[id] = rawHp[id] as number
  }
  const unavailable = uniqueStrings(raw.unavailable)
    .filter((id): id is CareerMountId => CAREER_MOUNT_IDS.includes(id as CareerMountId))
  if (!activeMountId && Object.keys(hp).length === 0 && unavailable.length === 0) return undefined
  return { ...(activeMountId ? { activeMountId } : {}), hp, unavailable }
}

function parseActiveMission(value: unknown): ActiveCareerMission | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const template = typeof raw.templateId === 'string' ? getRecruitMissionTemplate(raw.templateId) : null
  if (
    typeof raw.id !== 'string' || !raw.id
    || !template
    || !Number.isInteger(raw.targetCampId) || (template.kind === 'town-defense'
      ? raw.targetCampId !== -1
      : (raw.targetCampId as number) < 0 || (raw.targetCampId as number) > 4)
    || !MISSION_PHASES.includes(raw.phase as CareerMissionPhase)
  ) return undefined
  const targetActorIds = uniqueStrings(raw.targetActorIds)
  const friendlyActorIds = uniqueStrings(raw.friendlyActorIds)
  if (template.kind === 'town-defense' && !friendlyActorIds.includes('ranger')) friendlyActorIds.push('ranger')
  if (template.kind === 'town-defense' && !friendlyActorIds.includes('deployment')) friendlyActorIds.push('deployment')
  if (targetActorIds.length === 0 || friendlyActorIds.length === 0) return undefined
  const mountState = parseMissionMountState(raw.mountState)
  const playerStats = parseMissionPlayerStats(raw.playerStats)

  const mission: ActiveCareerMission = {
    id: raw.id,
    templateId: template.id,
    kind: template.kind,
    targetCampId: raw.targetCampId as number,
    phase: raw.phase as CareerMissionPhase,
    targetActorIds,
    friendlyActorIds,
    deadTargetActorIds: uniqueStrings(raw.deadTargetActorIds).filter(id => targetActorIds.includes(id)),
    deadFriendlyActorIds: uniqueStrings(raw.deadFriendlyActorIds).filter(id => friendlyActorIds.includes(id)),
    deadCivilianActorIds: uniqueStrings(raw.deadCivilianActorIds).filter(id => uniqueStrings(raw.civilianActorIds).includes(id)),
    ...(playerStats ? { playerStats } : {}),
    routeStage: nonNegativeInteger(raw.routeStage),
    patrolStage: nonNegativeInteger(raw.patrolStage),
    defenseElapsed: nonNegativeNumber(raw.defenseElapsed),
    defensePreparationElapsed: nonNegativeNumber(raw.defensePreparationElapsed),
    defenseReserveCharged: raw.defenseReserveCharged === true,
    defenseCatDead: raw.defenseCatDead === true,
    acceptedAt: nonNegativeInteger(raw.acceptedAt),
    ...(mountState ? { mountState } : {}),
    ...(template.kind === 'town-defense' ? { civilianActorIds: uniqueStrings(raw.civilianActorIds) } : {}),
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
  if (typeof raw.id !== 'string' || !raw.id.trim() || raw.kind !== 'outpost-defense' || !isCareerOutpostStageId(raw.stageId)) return undefined
  return { id: raw.id.trim(), kind: 'outpost-defense', stageId: raw.stageId, acceptedAt: nonNegativeInteger(raw.acceptedAt) }
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
  const activeMission = parseActiveMission(raw.activeMission)
  const activeOutpostMission = parseOutpostMission(raw.activeOutpostMission)
  const selectedMountId = CAREER_MOUNT_IDS.includes(raw.selectedMountId as CareerMountId)
    ? raw.selectedMountId as CareerMountId
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
    ...(Array.isArray(raw.outpostBattleRecords) ? { outpostBattleRecords: raw.outpostBattleRecords.map(parseOutpostRecord).filter((record): record is CareerOutpostRecord => Boolean(record)) } : {}),
    ...(raw.careerMissionCompletions !== undefined ? { careerMissionCompletions: nonNegativeInteger(raw.careerMissionCompletions) } : {}),
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
