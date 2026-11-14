import { CAREER_CLASSES_BY_FACTION, isCareerEliteClass, isRoadClass, T5_CLASS_ROAD, unlockedCareerClasses, type CareerClassRoad } from './CareerElitePromotion'
import { isT4ClassId, T4_CLASS_ROAD, T4_CLASSES_BY_FACTION, unlockedT4Classes } from './CareerT4Promotion'
import { createCareerTutorialState, parseCareerTutorialState } from './CareerTutorialState'
import { migrateCareerHealth } from './CareerHealthMigration'
import { hasCompleteRetirementMobilizationCheckpoint, parseRetirementActorCheckpoints } from './CareerRetirementMobilization'
import { parseCareerRetirementState, type CareerRetirementRuntime } from './CareerRetirementState'
import { parseEagleFlightSnapshot } from '../movement/EagleFlightController'
import { TOWN_WATCHTOWER_ARCHER_IDS } from '../town/TownNativeGuardIdentity'
import { horseVariantFromSave } from '../world/HorseAssetRegistry'
import { commanderGateDefenseSlots, commanderTownCommandMembership } from './CommanderTownRoster'
import { COMMANDER_FOUR_GATE_DEFENSE_ID } from './CommanderFourGateDefenseRoster'
import { MOUNTED_RACES, RACE_SCHEDULE_VERSION, isRaceRider, parseRaceSession, parseRaceRecords, type RaceId } from './CareerRaceState'
import { grantCommanderMelee } from './CareerCommanderEquipment'
import { parseTownEquipment } from './CareerTownEquipmentState'
import { retireNativeTownAirCommand, parseTownAirCommandSquad } from './TownAirCommandAuthority'
import { parseCivilianCommandSquad } from './CivilianCommandAuthority'
import { parseEnemyEaglePatrolCheckpoint } from '../town/EnemyEaglePatrolState'
import { outskirtsSquadSpecs } from '../town/TownOutskirtsRules'
import type { CareerDuelTier } from './CareerDuelState'
import { parseTownOutskirtsCheckpoint } from '../town/TownOutskirtsWarfareController'
import { parseTownPatrolCheckpoint } from '../town/TownPatrolCheckpoint'
import { parseOfficialCommandAuthority, parseTownCommandSquad } from './CareerCommandAuthority'
import { parseTownEagleGarrisons } from '../town/TownEagleGarrisonState'
import { parseCareerAerialState } from './CareerAerialState'
import { canonicalInventoryId, careerItemTotal, normalizeCareerInventory, type CareerInventory } from './CareerInventory'
import { hasFormalVictoryEvidence, parseCareerStoryState } from './CareerStoryEvents'
import { parsePersonalSquad } from './CareerPersonalSquad'
import { isCareerOutpostStageId, parseCareerOutpostCheckpoint, type CareerOutpostMission, type CareerOutpostRecord } from './CareerOutpostMission'
import { emptyPersonalContribution, parsePersonalMission } from './CareerPersonalSquadMission'
import { createCareerOutpostCommandSquads } from './CareerOutpostRoster'
import { PLAYER_MOUNT_IDS, type PlayerMountId } from '../battle/BattleConfig'
import { type UnitPresetId } from '../battle/UnitPresetCatalog'
import { ARMORS } from '../rpg/ArmorDatabase'
import { WEAPONS } from '../rpg/WeaponDatabase'
import { normalizeSkillState, type SkillStateInput } from '../rpg/SkillManager'
import { isHeroAssetId, type HeroAssetId } from '../world/HeroAssetCatalog'
import {
  cloneCareerProfile,
  canonicalCareerMountId,
  ownsCareerHorse,
  CAREER_RANKS,
  resolveCareerRank,
  type CareerLifetimeStats,
  type CareerMountId,
  type CareerProfile,
  type LegacyRaceProgress,
} from './CareerProfile'
import { HEAVY_FIELD_KIND, isHeavyFieldMissionId } from './HeavyCavalryMissions'
import { type ActiveCareerMission } from './CareerMissionState'
import { isCareerDuelPresetId, isCareerDuelTier, parseCareerDuelCommanderHome } from './CareerDuelState'
import { parseActiveMission } from './ActiveMissionParser'
import { CAREER_MOUNT_IDS, nonNegativeInteger, nonNegativeNumber, parseMissionMountState, parseMissionPlayerStats, parseMountArmor, uniqueStrings } from './CareerSaveFields'

export const CAREER_STORAGE_KEY = 'sagaburst_career_v1'

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

/** Retirement has no mission respawn. Missing/corrupt resource data must not heal it. */
function parseRetirementRuntime(value: unknown): CareerRetirementRuntime | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Partial<CareerRetirementRuntime>, player = raw.player
  const validPosition = (point: unknown): point is CareerRetirementRuntime['player']['position'] => {
    if (!point || typeof point !== 'object' || Array.isArray(point)) return false
    const p = point as CareerRetirementRuntime['player']['position']
    return [p.x, p.y, p.z, p.yaw].every(v => typeof v === 'number' && Number.isFinite(v))
  }
  const resource = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
  if (!player || !validPosition(player.position) || typeof player.mounted !== 'boolean'
    || ![player.hp, player.stamina, player.arrows, player.shieldImpact].every(resource)) return undefined
  if (player.shieldDurability !== undefined && (!player.shieldDurability || typeof player.shieldDurability !== 'object'
    || Array.isArray(player.shieldDurability) || Object.values(player.shieldDurability).some(value => !resource(value)))) return undefined
  let mountState: CareerRetirementRuntime['mountState']
  if (raw.mountState !== undefined) {
    const state = raw.mountState
    if (!state || typeof state !== 'object' || !state.hp || typeof state.hp !== 'object' || Array.isArray(state.hp)
      || !Array.isArray(state.unavailable) || new Set(state.unavailable).size !== state.unavailable.length
      || state.unavailable.some(id => !CAREER_MOUNT_IDS.includes(id))
      || Object.entries(state.hp).some(([id, hp]) => !CAREER_MOUNT_IDS.includes(id as CareerMountId) || !resource(hp))
      || state.activeMountId !== undefined && !CAREER_MOUNT_IDS.includes(state.activeMountId)) return undefined
    mountState = parseMissionMountState(state) ?? { hp: {}, unavailable: [] }
  }
  let mount: CareerRetirementRuntime['mount']
  if (raw.mount !== undefined) {
    const saved = raw.mount
    if (!saved || !validPosition(saved.position) || !resource(saved.hp)) return undefined
    const flight = saved.flight === undefined ? undefined : parseEagleFlightSnapshot(saved.flight)
    if (saved.flight !== undefined && !flight) return undefined
    mount = { position: { ...saved.position }, hp: saved.hp, armorImpactRemaining: saved.armorImpactRemaining, ...(flight ? { flight } : {}) }
  }
  if (player.mounted && !mount) return undefined
  let stats: CareerRetirementRuntime['stats']
  if (raw.stats !== undefined) {
    const input = raw.stats
    if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
    const fields = ['damageDealt', 'damageTaken', 'kills', 'structureDamage', 'structuresDestroyed', 'gateBreaches'] as const
    const counts = ['kills', 'structuresDestroyed', 'gateBreaches'] as const
    for (const totals of [input.player, input.personal]) {
      if (!totals || typeof totals !== 'object' || Array.isArray(totals)
        || fields.some(key => !resource(totals[key])) || counts.some(key => !Number.isInteger(totals[key]))) return undefined
    }
    stats = {
      player: parseMissionPlayerStats(input.player) ?? { ...emptyPersonalContribution(), damageTaken: 0 },
      personal: parseMissionPlayerStats(input.personal) ?? { ...emptyPersonalContribution(), damageTaken: 0 },
    }
  }
  return { player: { position: { ...player.position }, hp: player.hp, stamina: player.stamina,
    arrows: player.arrows, shieldImpact: player.shieldImpact, mounted: player.mounted,
    ...(player.shieldDurability ? { shieldDurability: { ...player.shieldDurability } } : {}) },
    ...(mountState ? { mountState } : {}), ...(mount ? { mount } : {}), ...(stats ? { stats } : {}) }
}

function parseOutpostMission(value: unknown, faction?: CareerProfile['faction'], rank?: CareerProfile['rank']): CareerOutpostMission | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  if (typeof raw.id !== 'string' || !raw.id.trim() || (raw.kind !== 'outpost-defense' && raw.kind !== 'outpost-relief') || !isCareerOutpostStageId(raw.stageId)) return undefined
  if (raw.kind === 'outpost-relief' && raw.stageId !== 3) return undefined
  const personalSquad = parsePersonalMission(raw.personalSquad), battle = parseCareerOutpostCheckpoint(raw.battle)
  const authority = parseOfficialCommandAuthority(raw.officialSquad)
  const productionIds = authority && faction && rank === 'commander'
    ? createCareerOutpostCommandSquads(faction, { id: raw.id.trim(), kind: raw.kind, stageId: raw.stageId }).flatMap(squad => squad.actorIds) : []
  const officialSquad = authority?.type === 'mission-official' && authority.commandRank === 'commander'
    && authority.missionId === raw.id.trim() && authority.townFaction === faction && rank === 'commander'
    && authority.actorIds.length === productionIds.length && authority.actorIds.every(id => productionIds.includes(id)) ? authority : undefined
  return { id: raw.id.trim(), kind: raw.kind, stageId: raw.stageId, acceptedAt: nonNegativeInteger(raw.acceptedAt),
    ...(officialSquad ? { officialSquad } : {}),
    ...(personalSquad ? { personalSquad } : {}),
    ...(battle ? { battle } : {}),
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
  const meritStats = parseMissionPlayerStats(raw.meritStats)
  return {
    ...mission, outcome: raw.outcome, completed: raw.outcome === 'victory',
    ...(meritStats ? { meritStats: { ...meritStats, survived: stats.survived === true } } : {}),
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

function parseLegacyRaceProgress(value: unknown): LegacyRaceProgress[] | undefined {
  if (!Array.isArray(value)) return undefined
  const result: LegacyRaceProgress[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const raw = item as Record<string, unknown>
    const scheduleVersion = typeof raw.scheduleVersion === 'number' && Number.isInteger(raw.scheduleVersion) && raw.scheduleVersion > 0
      ? raw.scheduleVersion
      : undefined
    if (!scheduleVersion) continue
    const completedRaceIds = Array.isArray(raw.completedRaceIds)
      ? (uniqueStrings(raw.completedRaceIds) as RaceId[])
      : []
    const raceBestSeconds = raw.raceBestSeconds && typeof raw.raceBestSeconds === 'object'
      ? Object.fromEntries(Object.entries(raw.raceBestSeconds).flatMap(([k, v]) => {
          return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? [[k as RaceId, v]] : []
        }))
      : undefined
    result.push({
      scheduleVersion,
      completedRaceIds,
      ...(raceBestSeconds && Object.keys(raceBestSeconds).length > 0 ? { raceBestSeconds } : {}),
    })
  }
  return result.length > 0 ? result : undefined
}

export function parseCareerProfile(value: unknown): CareerProfile | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const careerRetirement = Object.prototype.hasOwnProperty.call(raw, 'careerRetirement')
    ? parseCareerRetirementState(raw.careerRetirement) : undefined
  // Never turn a malformed irreversible ending checkpoint into an ordinary Town save.
  if (careerRetirement === null) return null
  const retirementRuntime = raw.retirementRuntime === undefined ? undefined : parseRetirementRuntime(raw.retirementRuntime)
  if (raw.retirementRuntime !== undefined && (!careerRetirement || !retirementRuntime)) return null
  // A prepared live finale must never migrate by healing fresh player resources.
  // Preserve receiptless legacy records; runtime refuses to start their ambush.
  if (careerRetirement?.phase === 'final-stand' && careerRetirement.mobilization && !retirementRuntime) return null
  if (raw.inventory !== undefined && (!raw.inventory || typeof raw.inventory !== 'object'
    || (raw.inventory as CareerInventory).version !== 1 || !(raw.inventory as CareerInventory).quantities
    || typeof (raw.inventory as CareerInventory).quantities !== 'object' || Array.isArray((raw.inventory as CareerInventory).quantities))) return null
  let townEquipment: CareerProfile['townEquipment']
  try { townEquipment = parseTownEquipment(raw.townEquipment) } catch { return null }
  let personalSquad: CareerProfile['personalSquad']
  try { personalSquad = parsePersonalSquad(raw.personalSquad, raw.faction === 'viking' ? 'viking' : 'roman') } catch { return null }

  if (raw.version !== 1) return null
  if (raw.faction !== 'roman' && raw.faction !== 'viking') return null

  // Temporary compatibility with the pre-merge #140 field names.
  const totalMerit = nonNegativeInteger(raw.totalMerit ?? raw.merit)
  const availableMerit = nonNegativeInteger(raw.availableMerit ?? totalMerit)

  const ownedWeapons = uniqueStrings(raw.ownedWeapons ?? raw.unlockedWeapons)
    .filter(id => Boolean(WEAPONS[id]))
  const ownedArmors = uniqueStrings(raw.ownedArmors ?? raw.unlockedShields)
    .filter(id => Boolean(ARMORS[id]))
  const ownedMounts = uniqueStrings(uniqueStrings(raw.ownedMounts ?? raw.unlockedMounts).map(canonicalInventoryId))
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
  // Class roads (T5 Commander, T4 Captain): unlocks are explicit saved state of this faction. Legacy saves had none: derive only the
  // class in use (faction default), never a guessed second one. Cross-faction, duplicate or contradictory records are rejected.
  const faction = raw.faction, merit = totalMerit - enlistmentMeritBase
  const unlockRecord = <T extends string>(road: CareerClassRoad<T>, value: unknown): T[] | undefined | null => value === undefined ? undefined
    : Array.isArray(value) && value.length >= 1 && new Set(value).size === value.length && value.every(id => isRoadClass(road, faction, id)) ? [...value] : null
  // A record whose only class needs more than its rank's threshold (Byzantine 30,000, Centurion/Dragon Oathguard 7,000, ...) is a first
  // appointment; only a purchased second class may sit below it.
  const firstAppointmentValid = <T extends string>(road: CareerClassRoad<T>, used: T, unlocked: T[] | undefined) =>
    unlocked !== undefined && unlocked.length > 1 || merit >= road.firstMerit[used]
  const rawElite = raw.eliteClass as unknown
  if (rawElite !== undefined && rawElite !== null && !(rank === 'commander' && isCareerEliteClass(rawElite) && isRoadClass(T5_CLASS_ROAD, faction, rawElite))) return null
  const unlockedCareerClasses = unlockRecord(T5_CLASS_ROAD, raw.unlockedCareerClasses)
  if (unlockedCareerClasses === null || unlockedCareerClasses && rank !== 'commander') return null
  const eliteClass = isCareerEliteClass(rawElite) ? rawElite : null
  const usedClass = eliteClass ?? CAREER_CLASSES_BY_FACTION[faction][0]
  if (rank === 'commander' && (unlockedCareerClasses && !unlockedCareerClasses.includes(usedClass) || !firstAppointmentValid(T5_CLASS_ROAD, usedClass, unlockedCareerClasses))) return null
  const officer = rank === 'captain' || rank === 'commander'
  const rawT4 = raw.t4Specialization as unknown
  if (rawT4 !== undefined && !(officer && isRoadClass(T4_CLASS_ROAD, faction, rawT4))) return null
  const t4Unlocked = unlockRecord(T4_CLASS_ROAD, raw.unlockedT4Classes)
  if (t4Unlocked === null || t4Unlocked && !officer) return null
  const t4Specialization = isT4ClassId(rawT4) ? rawT4 : undefined
  const usedT4 = t4Specialization ?? (rank === 'captain' ? T4_CLASSES_BY_FACTION[faction][0] : undefined)
  if (usedT4 && (t4Unlocked && !t4Unlocked.includes(usedT4) || !firstAppointmentValid(T4_CLASS_ROAD, usedT4, t4Unlocked))) return null
  const tutorial = raw.tutorial === undefined ? createCareerTutorialState(rank, false) : parseCareerTutorialState(raw.tutorial)
  if (!tutorial) return null
  const tutorialDuel = (raw.activeMission as Partial<ActiveCareerMission> | undefined)?.duelTutorialCareerId
  if (tutorialDuel !== undefined && tutorialDuel !== tutorial.careerId) return null
  // An ending checkpoint belongs only to a formally appointed, valid Commander.
  if (careerRetirement && rank !== 'commander') return null
  const equipment = raw.equipment && typeof raw.equipment === 'object' ? raw.equipment as Record<string, unknown> : null
  const townEvent = raw.townEvent as CareerProfile['townEvent']
  const activeRace = raw.activeRace === undefined ? undefined : parseRaceSession(raw.activeRace)
  const raceRecords = raw.raceRecords === undefined ? undefined : parseRaceRecords(raw.raceRecords)
  // Invalid in-flight races must never be silently discarded into a fresh Town.
  if (raw.racePlayerState !== undefined && !isRaceRider(raw.racePlayerState)) return null
  if (activeRace === null || raceRecords === null || activeRace && (raw.activeMission || raw.activeOutpostMission)) return null
  let activeMission: ActiveCareerMission | undefined
  try { activeMission = parseActiveMission(raw.activeMission, raw.faction, rank) } catch { return null }
  if (tutorialDuel !== undefined && activeMission?.duelTutorialCareerId !== tutorialDuel) return null
  const savedMission = raw.activeMission as Partial<ActiveCareerMission> | undefined
  if (savedMission?.prisonBreak && !activeMission?.prisonBreak) return null
  // Never silently turn a rejected in-flight Commander V checkpoint into a peaceful Town.
  if ((savedMission?.kind === 'commander-four-gate-defense' || savedMission?.templateId === COMMANDER_FOUR_GATE_DEFENSE_ID)
    && !activeMission?.fourGateDefense) return null
  if ((savedMission?.kind === HEAVY_FIELD_KIND || (typeof savedMission?.templateId === 'string' && isHeavyFieldMissionId(savedMission.templateId)))
    && !activeMission) return null
  const activeOutpostMission = parseOutpostMission(raw.activeOutpostMission, raw.faction, rank)
  const personalSquadRuntime = parsePersonalMission(raw.personalSquadRuntime)
  const townCommandSquad = parseTownCommandSquad(raw.townCommandSquad)
  const civilianCommandSquad = parseCivilianCommandSquad(raw.civilianCommandSquad)
  const townAirCommandSquad = parseTownAirCommandSquad(raw.townAirCommandSquad)
  const selectedMountId = CAREER_MOUNT_IDS.includes(raw.selectedMountId as CareerMountId)
    ? canonicalCareerMountId(raw.selectedMountId as CareerMountId)
    : undefined
  if (townEvent && (typeof townEvent.id !== 'string' || !townEvent.id || !['hostile', 'settled'].includes(townEvent.state))) return null
  if (townEvent?.pendingResult !== undefined && (townEvent.state !== 'hostile' || !['player_defeated', 'town_defeated'].includes(townEvent.pendingResult))) return null
  const profile: CareerProfile = {
    ...(careerRetirement ? { careerRetirement } : {}),
    ...(retirementRuntime ? { retirementRuntime } : {}),
    ...(raw.retirementTowerGuards !== undefined ? { retirementTowerGuards: parseRetirementActorCheckpoints(raw.retirementTowerGuards, TOWN_WATCHTOWER_ARCHER_IDS) ?? undefined } : {}),
    ...(townEquipment ? { townEquipment } : {}),
    ...(raw.inventory ? { inventory: raw.inventory as CareerInventory } : {}),
    version: 1,
    ...(raw.healthRulesVersion === 1 ? { healthRulesVersion: 1 as const } : {}),
    ...(raw.commanderHealthVersion === 1 ? { commanderHealthVersion: 1 as const } : {}),
    faction: raw.faction,
    tutorial,
    totalMerit,
    availableMerit,
    rank,
    eliteClass,
    ...(unlockedCareerClasses ? { unlockedCareerClasses: [...unlockedCareerClasses] } : {}),
    ...(t4Specialization ? { t4Specialization } : {}),
    ...(t4Unlocked ? { unlockedT4Classes: [...t4Unlocked] } : {}),
    ...(raw.meleeSelectionOrigin === 'starter' || raw.meleeSelectionOrigin === 'custom'
      ? { meleeSelectionOrigin: raw.meleeSelectionOrigin } : {}),
    ...(raw.commanderMeleeGranted === true ? { commanderMeleeGranted: true } : {}),
    ...(personalSquad ? { personalSquad } : {}),
    ...(personalSquadRuntime ? { personalSquadRuntime } : {}),
    ...(townCommandSquad && townCommandSquad.townFaction === raw.faction ? { townCommandSquad } : {}),
    ...(townAirCommandSquad && townAirCommandSquad.townFaction === raw.faction ? { townAirCommandSquad } : {}),
    ...(civilianCommandSquad && civilianCommandSquad.townFaction === raw.faction ? { civilianCommandSquad } : {}),
    skills: normalizeSkillState(raw.skills && typeof raw.skills === 'object' ? raw.skills as SkillStateInput : undefined),
    enlistmentMeritBase,
    ...(equipment ? { equipment: {
      ...(typeof equipment.melee === 'string' ? { melee: equipment.melee } : {}),
      ...(typeof equipment.ranged === 'string' ? { ranged: equipment.ranged } : {}),
      ...(typeof equipment.shield === 'string' || equipment.shield === null ? { shield: equipment.shield as string | null } : {}),
    } } : {}),
    ...(typeof raw.starterWeaponId === 'string' && WEAPONS[raw.starterWeaponId]?.tier === 1
      ? { starterWeaponId: raw.starterWeaponId } : {}),
    ...(townEvent ? { townEvent: { ...townEvent, ...(townEvent.authorizedTownCommandActorIds ? { authorizedTownCommandActorIds: uniqueStrings(townEvent.authorizedTownCommandActorIds) } : {}), ...(townEvent.deadActorIds ? { deadActorIds: uniqueStrings(townEvent.deadActorIds) } : {}), ...(townEvent.destroyedBuildingIds ? { destroyedBuildingIds: uniqueStrings(townEvent.destroyedBuildingIds) } : {}) } } : {}),
    ...(raw.enemyEaglePatrols && typeof raw.enemyEaglePatrols === 'object' ? { enemyEaglePatrols: Object.fromEntries(
      (['roman', 'viking'] as const).flatMap(faction => {
        const saved = parseEnemyEaglePatrolCheckpoint((raw.enemyEaglePatrols as CareerProfile['enemyEaglePatrols'])?.[faction])
        return saved ? [[faction, saved]] : []
      })) } : {}),
    ...(parseTownEagleGarrisons(raw.townEagleGarrisons, raw.townEagleGarrison) ? { townEagleGarrisons: parseTownEagleGarrisons(raw.townEagleGarrisons, raw.townEagleGarrison) } : {}),
    ...(parseCareerAerialState(raw.playerAerialState) ? { playerAerialState: parseCareerAerialState(raw.playerAerialState) } : {}),
    ...(raw.townOutskirts && typeof raw.townOutskirts === 'object' ? { townOutskirts: Object.fromEntries(
      (['roman', 'viking'] as const).flatMap(faction => {
        const saved = parseTownOutskirtsCheckpoint((raw.townOutskirts as CareerProfile['townOutskirts'])?.[faction])
        return saved ? [[faction, { squads: saved.squads.map(squad => ({ ...squad, members: outskirtsSquadSpecs().some(spec => spec.id === squad.id && spec.kind === 'cavalry') ? squad.members : {} })) }]] : []
      })) } : {}),
    ...(raw.townPatrols && typeof raw.townPatrols === 'object' ? { townPatrols: Object.fromEntries(
      (['roman', 'viking'] as const).flatMap(faction => {
        const saved = parseTownPatrolCheckpoint((raw.townPatrols as CareerProfile['townPatrols'])?.[faction])
        return saved ? [[faction, saved]] : []
      })) } : {}),
    ...(Array.isArray(raw.townDialogueSeen) ? { townDialogueSeen: uniqueStrings(raw.townDialogueSeen).filter(key => /^(roman|viking):(merchant|ranger|eagle-trainer|cat|captain|deployment|soldier-outpost|hr-unlocked|hr-recruit-soldier|hr-recruit-captain|hr-recruit-ranger|hr-recruit-commander)$/.test(key)) } : {}),
    ...(Array.isArray(raw.ownedHorseTiers) ? { ownedHorseTiers: [...new Set(raw.ownedHorseTiers.filter((tier): tier is 1 | 2 | 3 => [1, 2, 3].includes(tier)))] } : {}),
    ...(Object.keys(parseMountArmor(raw.mountArmor)).length ? { mountArmor: parseMountArmor(raw.mountArmor) } : {}),
    horseAppearanceVariant: horseVariantFromSave(raw.horseAppearanceVariant),
    ...(selectedMountId ? { selectedMountId } : {}),
    ...(isRaceRider(raw.racePlayerState) ? { racePlayerState: structuredClone(raw.racePlayerState) } : {}),
    ...(activeRace ? { activeRace } : {}),
    ...(raceRecords ? { raceRecords } : {}),
    ...(() => {
      const existingLegacy = raw.legacyRaceProgress ? parseLegacyRaceProgress(raw.legacyRaceProgress) ?? [] : []
      const legacyEntries = [...existingLegacy]
      if (raw.raceScheduleVersion !== RACE_SCHEDULE_VERSION) {
        const legacyVersion = typeof raw.raceScheduleVersion === 'number' && Number.isInteger(raw.raceScheduleVersion) && raw.raceScheduleVersion > 0
          ? raw.raceScheduleVersion
          : 1
        const legacyCompleted = Array.isArray(raw.completedRaceIds)
          ? (uniqueStrings(raw.completedRaceIds) as RaceId[])
          : []
        const legacyBest = raw.raceBestSeconds && typeof raw.raceBestSeconds === 'object'
          ? Object.fromEntries(Object.entries(raw.raceBestSeconds).flatMap(([k, v]) => {
              return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? [[k as RaceId, v]] : []
            }))
          : {}
        if (legacyCompleted.length > 0 || Object.keys(legacyBest).length > 0) {
          const idx = legacyEntries.findIndex(e => e.scheduleVersion === legacyVersion)
          if (idx >= 0) {
            const mergedCompleted = [...new Set([...legacyEntries[idx].completedRaceIds, ...legacyCompleted])]
            const mergedBest = { ...(legacyEntries[idx].raceBestSeconds ?? {}), ...legacyBest }
            legacyEntries[idx] = {
              scheduleVersion: legacyVersion,
              completedRaceIds: mergedCompleted,
              ...(Object.keys(mergedBest).length > 0 ? { raceBestSeconds: mergedBest } : {}),
            }
          } else {
            legacyEntries.push({
              scheduleVersion: legacyVersion,
              completedRaceIds: legacyCompleted,
              ...(Object.keys(legacyBest).length > 0 ? { raceBestSeconds: legacyBest } : {}),
            })
          }
        }
      }
      return legacyEntries.length > 0 ? { legacyRaceProgress: legacyEntries } : {}
    })(),
    ...(raw.raceScheduleVersion === RACE_SCHEDULE_VERSION ? { raceScheduleVersion: RACE_SCHEDULE_VERSION } : {}),
    ...(raw.raceScheduleVersion === RACE_SCHEDULE_VERSION && Array.isArray(raw.completedRaceIds)
      ? { completedRaceIds: MOUNTED_RACES.filter(r => (raw.completedRaceIds as unknown[]).includes(r.id)).map(r => r.id) }
      : {}),
    ...(raw.raceScheduleVersion === RACE_SCHEDULE_VERSION && raw.raceBestSeconds && typeof raw.raceBestSeconds === 'object'
      ? { raceBestSeconds: Object.fromEntries(MOUNTED_RACES.flatMap(r => {
        const seconds = (raw.raceBestSeconds as Record<RaceId, unknown>)[r.id]
        return typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0 ? [[r.id, seconds]] : []
      })) }
      : {}),
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
        ...((raw.careerMissionCompletionsByTier as Record<string, unknown>)[4] !== undefined ? { 4: nonNegativeInteger((raw.careerMissionCompletionsByTier as Record<string, unknown>)[4]) } : {}),
        ...((raw.careerMissionCompletionsByTier as Record<string, unknown>)[5] !== undefined ? { 5: nonNegativeInteger((raw.careerMissionCompletionsByTier as Record<string, unknown>)[5]) } : {}),
      } } : {}),
    ...(raw.townDuelResidentRecovery && typeof raw.townDuelResidentRecovery === 'object'
      && (raw.townDuelResidentRecovery as Record<string, unknown>).faction === raw.faction
      && typeof (raw.townDuelResidentRecovery as Record<string, unknown>).actorId === 'string'
      && parseCareerDuelCommanderHome(raw.townDuelResidentRecovery)
      ? { townDuelResidentRecovery: { ...parseCareerDuelCommanderHome(raw.townDuelResidentRecovery)!, faction: raw.faction as CareerProfile['faction'],
        actorId: (raw.townDuelResidentRecovery as Record<string, unknown>).actorId as string } } : {}),
    ...(raw.townCommanderRecovery && typeof raw.townCommanderRecovery === 'object'
      && ['roman', 'viking'].includes((raw.townCommanderRecovery as Record<string, unknown>).faction as string)
      && parseCareerDuelCommanderHome(raw.townCommanderRecovery)
      ? { townCommanderRecovery: { ...parseCareerDuelCommanderHome(raw.townCommanderRecovery)!,
        faction: (raw.townCommanderRecovery as Record<string, unknown>).faction as CareerProfile['faction'] } } : {}),
    ...(isCareerDuelTier(raw.unarmedDuelHighestDefeatedTier) ? { unarmedDuelHighestDefeatedTier: raw.unarmedDuelHighestDefeatedTier } : {}),
    ...(raw.duelHighestDefeatedTierByPreset && typeof raw.duelHighestDefeatedTierByPreset === 'object'
      ? { duelHighestDefeatedTierByPreset: Object.fromEntries(Object.entries(raw.duelHighestDefeatedTierByPreset)
        .filter(([presetId, tier]) => isCareerDuelPresetId(presetId) && isCareerDuelTier(tier))) as Partial<Record<UnitPresetId, CareerDuelTier>> } : {}),
    ...(Array.isArray(raw.completedCareerMissionTemplateIds) ? { completedCareerMissionTemplateIds: uniqueStrings(raw.completedCareerMissionTemplateIds) } : {}),
    ownedWeapons,
    ownedArmors,
    ownedMounts,
    ownedHeroes,
    lifetimeStats: parseLifetimeStats(raw.lifetimeStats),
    claimedBattleIds: uniqueStrings(raw.claimedBattleIds),
  }
  // Legacy wins without mission identities cannot prove distinct settlements; keep only durable identified records.
  if (raw.tutorial === undefined) {
    tutorial.settledMissionIds = [...new Set([
      ...(profile.outpostBattleRecords ?? []).map(record => record.id),
      ...(activeMission?.kind !== 'duel' && activeMission?.result?.claimed && profile.claimedBattleIds.includes(activeMission.id)
        ? [activeMission.id] : []),
    ])]
  }
  // Migrate peaceful authority by actor identity. Active mission grants remain immutable.
  if (!activeMission && !activeOutpostMission && profile.townEvent?.state !== 'hostile'
    && profile.townCommandSquad?.commandRank === 'commander') {
    const previous = profile.townCommandSquad
    // Generic legacy grants are retained; only the authored Commander roster is migrated.
    const legacyIds = commanderGateDefenseSlots(undefined, 1).flatMap(squad => squad.actorIds)
    if (previous.actorIds.length === legacyIds.length && previous.actorIds.every(id => legacyIds.includes(id))) {
      const membership = commanderTownCommandMembership(previous)
      const ids = new Set(membership.actorIds)
      profile.townCommandSquad = { ...previous, ...membership,
        members: Object.fromEntries(Object.entries(previous.members ?? {}).filter(([id]) => ids.has(id))),
        ...(previous.refittingActorIds ? { refittingActorIds: previous.refittingActorIds.filter(id => ids.has(id)) } : {}) }
    }
  }
  if (raw.retirementTowerGuards !== undefined && !profile.retirementTowerGuards) return null
  // Validate the raw full-resource receipt before permissive legacy normalization.
  if (careerRetirement?.mobilization && !hasCompleteRetirementMobilizationCheckpoint({ ...raw, careerRetirement } as unknown as CareerProfile)) return null
  if (!hasCompleteRetirementMobilizationCheckpoint(profile)) return null
  retireNativeTownAirCommand(profile, townCommandSquad)
  try { grantCommanderMelee(profile); normalizeCareerInventory(profile) } catch { return null }
  migrateCareerHealth(profile)
  const careerStory = parseCareerStoryState(raw.careerStory, {
    horseOwned: ownsCareerHorse(profile) || tutorial.purchases.horse,
    formalVictory: hasFormalVictoryEvidence(profile),
    eagleOwned: careerItemTotal(profile, 'xongkoro') > 0 || profile.ownedMounts.includes('xongkoro'),
    ...(activeRace ? { activeRaceId: activeRace.id } : {}), ...(activeMission ? { activeMissionId: activeMission.id } : {}),
  })
  if (careerStory) profile.careerStory = careerStory
  return profile
}

export class CareerProfileStore {
  constructor(private readonly storage: Storage = localStorage) {}

  loadChecked(): { profile: CareerProfile | null; error?: string } {
    try {
      const raw = this.storage.getItem(CAREER_STORAGE_KEY)
      if (raw === null) return { profile: null }
      const source: unknown = JSON.parse(raw)
      const profile = parseCareerProfile(source)
      // A migrated grant is usable only after its inventory and receipt are durably saved.
      // Failed storage leaves the original save intact and exposes no partially granted profile.
      const previous = source as Partial<CareerProfile>
      const rangerMigration = profile && profile.personalSquad?.members.some(member => member.type === 'ranger' && member.rangerEquipmentVersion === 1
        && previous.personalSquad?.members.find(saved => saved.id === member.id)?.rangerEquipmentVersion !== 1)
      const personalIdentityMigration = profile && profile.personalSquad?.members.some(member => {
        const saved = previous.personalSquad?.members.find(value => value.id === member.id)
        return !saved || saved.characterFaction !== member.characterFaction || saved.characterTier !== member.characterTier || saved.heroArchetype !== member.heroArchetype || saved.visualAssetId !== member.visualAssetId
          || saved.recruitmentRole !== member.recruitmentRole || saved.originalHirePrice !== member.originalHirePrice
      })
      const borrowedIdentityMigration = profile && profile.activeMission?.borrowedActorIdentities !== undefined
        && previous.activeMission?.borrowedActorIdentities === undefined
      // Resident and Ranger receipts are independent: either may already be current
      // when the other migration runs. Publish both together only after one save.
      const residentMigration = profile && (['roman', 'viking'] as const).some(faction =>
        profile.townEquipment?.[faction]?.residentEquipmentVersion === 1
        && previous.townEquipment?.[faction]?.residentEquipmentVersion !== 1)
      const commanderShieldMigration = profile && (['roman', 'viking'] as const).some(faction =>
        profile.townEquipment?.[faction]?.commanderShieldItemId !== undefined
        && previous.townEquipment?.[faction]?.commanderShieldItemId === undefined)
      const heavyCaptainRevocationMigration = Boolean(
        profile
        && profile.rank === 'captain'
        && (previous.activeMission?.kind === HEAVY_FIELD_KIND || (typeof previous.activeMission?.templateId === 'string' && isHeavyFieldMissionId(previous.activeMission.templateId)))
        && previous.activeMission?.officialSquad !== undefined
        && profile.activeMission?.officialSquad === undefined
      )
      if (profile && (previous.tutorial === undefined || profile.healthRulesVersion !== previous.healthRulesVersion || profile.commanderHealthVersion !== previous.commanderHealthVersion || residentMigration || rangerMigration || personalIdentityMigration || borrowedIdentityMigration || commanderShieldMigration || profile.commanderMeleeGranted && previous.commanderMeleeGranted !== true || heavyCaptainRevocationMigration)
        && !this.save(profile)) return { profile: null, error: '生涯資料升級無法儲存；原資料已保留，請重試。' }
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
      const existingBytes = this.storage.getItem(CAREER_STORAGE_KEY)
      const existing = existingBytes ? JSON.parse(existingBytes) as Partial<CareerProfile> : null
      // An old scene may never replace a later enlistment. Creation may replace only a completed ending.
      if (existing?.tutorial?.careerId && profile.tutorial?.careerId !== existing.tutorial.careerId
        && !(existing.careerRetirement?.phase === 'completed' && profile.tutorial?.legacy === false
          && profile.rank === 'recruit' && profile.totalMerit === 0 && !profile.careerRetirement)) return false
      const parsed = parseCareerProfile(profile)
      if (!parsed) return false
      // Unlocks are permanent within an enlistment: a stale scene may not drop one (switching the class in use is allowed).
      const stored = existing ? parseCareerProfile(existing) : null
      if (stored && parsed.tutorial?.careerId === stored.tutorial?.careerId && parsed.enlistmentMeritBase === stored.enlistmentMeritBase
        && (unlockedCareerClasses(stored).some(id => !unlockedCareerClasses(parsed).includes(id))
          || unlockedT4Classes(stored).some(id => !unlockedT4Classes(parsed).includes(id)))) return false
      if (profile.tutorial && !parsed.tutorial || profile.activeMission?.duelTutorialCareerId && parsed.activeMission?.duelTutorialCareerId !== profile.activeMission.duelTutorialCareerId) return false
      if (profile.activeMission?.outpostSiege && !parsed.activeMission?.outpostSiege
        || profile.activeMission?.battle?.outpostSiege && !parsed.activeMission?.battle?.outpostSiege
        || profile.activeOutpostMission?.battle?.outpostSiege && !parsed.activeOutpostMission?.battle?.outpostSiege) return false
      if (profile.activeMission?.prisonBreak && !parsed.activeMission?.prisonBreak) return false
      if (profile.townAirCommandSquad && !parsed.townAirCommandSquad) return false
      if (profile.townCommandSquad?.commandRank === 'commander'
        && parsed.townCommandSquad?.commandRank !== 'commander') return false
      // A rejected expanded grant must not look like a successful ownership commit.
      if (profile.activeMission?.officialSquad?.commandRank === 'commander'
        && !parsed.activeMission?.officialSquad) return false
      if (profile.activeOutpostMission?.officialSquad?.commandRank === 'commander'
        && !parsed.activeOutpostMission?.officialSquad) return false
      if ((profile.activeMission?.kind === HEAVY_FIELD_KIND || (typeof profile.activeMission?.templateId === 'string' && isHeavyFieldMissionId(profile.activeMission.templateId)))
        && !parsed.activeMission) return false
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
