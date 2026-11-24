import { gameStorage } from '../save/GameStorage'
import { PLAYER_MOUNT_IDS, type PlayerMountId } from '../battle/BattleConfig'
import { type UnitPresetId } from '../battle/UnitPresetCatalog'
import { parseEagleFlightSnapshot } from '../movement/EagleFlightController'
import { ARMORS } from '../rpg/ArmorDatabase'
import { normalizeSkillState, type SkillStateInput } from '../rpg/SkillManager'
import { WEAPONS } from '../rpg/WeaponDatabase'
import { parseEnemyEaglePatrolCheckpoint } from '../town/EnemyEaglePatrolState'
import { parseTownEagleGarrisons } from '../town/TownEagleGarrisonState'
import { TOWN_WATCHTOWER_ARCHER_IDS } from '../town/TownNativeGuardIdentity'
import { outskirtsSquadSpecs } from '../town/TownOutskirtsRules'
import { parseTownOutskirtsCheckpoint } from '../town/TownOutskirtsWarfareController'
import { parseTownPatrolCheckpoint } from '../town/TownPatrolCheckpoint'
import { isHeroAssetId, type HeroAssetId } from '../world/HeroAssetCatalog'
import { horseVariantFromSave } from '../world/HorseAssetRegistry'
import { parseActiveMission } from './ActiveMissionParser'
import { parseCareerAerialState } from './CareerAerialState'
import { parseOfficialCommandAuthority, parseTownCommandSquad } from './CareerCommandAuthority'
import type { CareerDuelTier } from './CareerDuelState'
import { isCareerDuelPresetId, isCareerDuelTier, parseCareerDuelCommanderHome } from './CareerDuelState'
import { CAREER_CLASSES_BY_FACTION, isCareerEliteClass, isRoadClass, T5_CLASS_ROAD, unlockedCareerClasses, type CareerClassRoad } from './CareerElitePromotion'
import { normalizeCareerInventory, type CareerInventory } from './CareerInventory'
import { type ActiveCareerMission } from './CareerMissionState'
import { isCareerOutpostStageId, parseCareerOutpostCheckpoint, type CareerOutpostMission, type CareerOutpostRecord } from './CareerOutpostMission'
import { createCareerOutpostCommandSquads } from './CareerOutpostRoster'
import { parsePersonalSquad } from './CareerPersonalSquad'
import { emptyPersonalContribution, parsePersonalMission } from './CareerPersonalSquadMission'
import { canonicalCareerMountId, CAREER_RANKS, cloneCareerProfile, resolveCareerRank, type CareerLifetimeStats, type CareerMountId, type CareerProfile } from './CareerProfile'
import { isRaceRider, MOUNTED_RACES, parseRaceRecords, parseRaceSession, RACE_SCHEDULE_VERSION, type RaceId } from './CareerRaceState'
import { hasCompleteRetirementMobilizationCheckpoint, parseRetirementActorCheckpoints } from './CareerRetirementMobilization'
import { parseCareerRetirementState, type CareerRetirementRuntime } from './CareerRetirementState'
import { CAREER_MOUNT_IDS, nonNegativeInteger, nonNegativeNumber, parseMissionMountState, parseMissionPlayerStats, parseMountArmor, uniqueStrings } from './CareerSaveFields'
import { parseCareerStoryState } from './CareerStoryEvents'
import { isT4ClassId, T4_CLASS_ROAD, unlockedT4Classes } from './CareerT4Promotion'
import { parseTownEquipment } from './CareerTownEquipmentState'
import { parseCareerTutorialState } from './CareerTutorialState'
import { parseCivilianCommandSquad } from './CivilianCommandAuthority'
import { COMMANDER_FOUR_GATE_DEFENSE_ID } from './CommanderFourGateDefenseRoster'
import { HEAVY_FIELD_KIND, isHeavyFieldMissionId } from './HeavyCavalryMissions'

export const CAREER_STORAGE_KEY = 'sagaburst_career_v2'

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

export function parseCareerProfile(value: unknown): CareerProfile | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const careerRetirement = Object.prototype.hasOwnProperty.call(raw, 'careerRetirement')
    ? parseCareerRetirementState(raw.careerRetirement) : undefined
  // Never turn a malformed irreversible ending checkpoint into an ordinary Town save.
  if (careerRetirement === null) return null
  const retirementRuntime = raw.retirementRuntime === undefined ? undefined : parseRetirementRuntime(raw.retirementRuntime)
  if (raw.retirementRuntime !== undefined && (!careerRetirement || !retirementRuntime)) return null
  // A prepared final stand requires the current player-resource and combat-counter checkpoint.
  if (careerRetirement?.phase === 'final-stand' && careerRetirement.mobilization && (!retirementRuntime || !retirementRuntime.stats)) return null
  if (raw.inventory !== undefined && (!raw.inventory || typeof raw.inventory !== 'object'
    || (raw.inventory as CareerInventory).version !== 1 || !(raw.inventory as CareerInventory).quantities
    || typeof (raw.inventory as CareerInventory).quantities !== 'object' || Array.isArray((raw.inventory as CareerInventory).quantities))) return null
  let townEquipment: CareerProfile['townEquipment']
  try { townEquipment = parseTownEquipment(raw.townEquipment) } catch { return null }
  let personalSquad: CareerProfile['personalSquad']
  try { personalSquad = parsePersonalSquad(raw.personalSquad, raw.faction === 'viking' ? 'viking' : 'roman') } catch { return null }

  if (raw.version !== 2) return null
  if (raw.faction !== 'roman' && raw.faction !== 'viking') return null

  const totalMerit = raw.totalMerit, availableMerit = raw.availableMerit
  if (typeof totalMerit !== 'number' || !Number.isSafeInteger(totalMerit) || totalMerit < 0
    || typeof availableMerit !== 'number' || !Number.isSafeInteger(availableMerit) || availableMerit < 0) return null

  const ownedWeapons = uniqueStrings(raw.ownedWeapons)
    .filter(id => Boolean(WEAPONS[id]))
  const ownedArmors = uniqueStrings(raw.ownedArmors)
    .filter(id => Boolean(ARMORS[id]))
  const ownedMounts = uniqueStrings(raw.ownedMounts)
    .filter((id): id is PlayerMountId => (
      (PLAYER_MOUNT_IDS as readonly string[]).includes(id)
    ))
  const ownedHeroes = uniqueStrings(raw.ownedHeroes)
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
  if (rawElite !== null && !(rank === 'commander' && isCareerEliteClass(rawElite) && isRoadClass(T5_CLASS_ROAD, faction, rawElite))) return null
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
  const usedT4 = t4Specialization
  if (usedT4 && (t4Unlocked && !t4Unlocked.includes(usedT4) || !firstAppointmentValid(T4_CLASS_ROAD, usedT4, t4Unlocked))) return null
  const tutorial = parseCareerTutorialState(raw.tutorial)
  if (!tutorial || !raw.inventory || !raw.careerStory || !raw.skills || !raw.careerMissionCompletionsByTier
    || raw.raceScheduleVersion !== RACE_SCHEDULE_VERSION
    || rank === 'commander' && !unlockedCareerClasses
    || officer && (!t4Specialization || !t4Unlocked)) return null
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
  if (raw.activeMission !== undefined && !activeMission) return null
  const savedMission = raw.activeMission as Partial<ActiveCareerMission> | undefined
  if (savedMission?.prisonBreak && !activeMission?.prisonBreak) return null
  // Never silently turn a rejected in-flight Commander V checkpoint into a peaceful Town.
  if ((savedMission?.kind === 'commander-four-gate-defense' || savedMission?.templateId === COMMANDER_FOUR_GATE_DEFENSE_ID)
    && !activeMission?.fourGateDefense) return null
  if ((savedMission?.kind === HEAVY_FIELD_KIND || (typeof savedMission?.templateId === 'string' && isHeavyFieldMissionId(savedMission.templateId)))
    && !activeMission) return null
  const activeOutpostMission = parseOutpostMission(raw.activeOutpostMission, raw.faction, rank)
  if (raw.activeOutpostMission !== undefined && !activeOutpostMission) return null
  const personalSquadRuntime = parsePersonalMission(raw.personalSquadRuntime)
  const townCommandSquad = parseTownCommandSquad(raw.townCommandSquad)
  const civilianCommandSquad = parseCivilianCommandSquad(raw.civilianCommandSquad)
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
    version: 2,
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
    ...(parseTownEagleGarrisons(raw.townEagleGarrisons) ? { townEagleGarrisons: parseTownEagleGarrisons(raw.townEagleGarrisons) } : {}),
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
    ...(Object.keys(parseMountArmor(raw.mountArmor)).length ? { mountArmor: parseMountArmor(raw.mountArmor) } : {}),
    horseAppearanceVariant: horseVariantFromSave(raw.horseAppearanceVariant),
    ...(selectedMountId ? { selectedMountId } : {}),
    ...(isRaceRider(raw.racePlayerState) ? { racePlayerState: structuredClone(raw.racePlayerState) } : {}),
    ...(activeRace ? { activeRace } : {}),
    ...(raceRecords ? { raceRecords } : {}),
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
  if (raw.retirementTowerGuards !== undefined && !profile.retirementTowerGuards) return null
  // Authenticate complete native resources before inventory normalization.
  if (careerRetirement?.mobilization && !hasCompleteRetirementMobilizationCheckpoint({ ...raw, careerRetirement } as unknown as CareerProfile)) return null
  if (!hasCompleteRetirementMobilizationCheckpoint(profile)) return null
  try { normalizeCareerInventory(profile) } catch { return null }
  const careerStory = parseCareerStoryState(raw.careerStory, {
    ...(activeRace ? { activeRaceId: activeRace.id } : {}), ...(activeMission ? { activeMissionId: activeMission.id } : {}),
  })
  if (!careerStory) return null
  profile.careerStory = careerStory
  return profile
}

/** Last stored bytes parsed per Storage. parseCareerProfile is a pure function of the bytes, so
 * identical bytes reuse its result; the cached profile is never handed out or mutated. */
const parsedStoredBytes = new WeakMap<Storage, { bytes: string; profile: CareerProfile | null }>()

/** Throws like JSON.parse for unreadable bytes; a rejected profile is null. */
function parseStoredCareerBytes(storage: Storage, bytes: string): CareerProfile | null {
  const cached = parsedStoredBytes.get(storage)
  if (cached?.bytes === bytes) return cached.profile
  const profile = parseCareerProfile(JSON.parse(bytes))
  parsedStoredBytes.set(storage, { bytes, profile })
  return profile
}

export class CareerProfileStore {
  constructor(private readonly storage: Storage = gameStorage()) {}

  loadChecked(): { profile: CareerProfile | null; error?: string } {
    try {
      const raw = this.storage.getItem(CAREER_STORAGE_KEY)
      if (raw === null) return { profile: null }
      const parsed = parseStoredCareerBytes(this.storage, raw)
      return parsed ? { profile: structuredClone(parsed) } : { profile: null, error: '生涯存檔損壞或版本不支援；原資料已保留。' }
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
      // Read-only below: comparisons against the durable save.
      const stored = existingBytes === null ? null : parseStoredCareerBytes(this.storage, existingBytes)
      if (existingBytes !== null && !stored) return false
      // An old scene may never replace a later enlistment. Creation may replace only a completed ending.
      if (stored?.tutorial?.careerId && profile.tutorial?.careerId !== stored.tutorial.careerId
        && !(stored.careerRetirement?.phase === 'completed'
          && profile.rank === 'recruit' && profile.totalMerit === 0 && !profile.careerRetirement)) return false
      const parsed = parseCareerProfile(profile)
      if (!parsed) return false
      // Unlocks are permanent within an enlistment: a stale scene may not drop one (switching the class in use is allowed).
      if (stored && parsed.tutorial?.careerId === stored.tutorial?.careerId && parsed.enlistmentMeritBase === stored.enlistmentMeritBase
        && (unlockedCareerClasses(stored).some(id => !unlockedCareerClasses(parsed).includes(id))
          || unlockedT4Classes(stored).some(id => !unlockedT4Classes(parsed).includes(id)))) return false
      if (profile.tutorial && !parsed.tutorial || profile.activeMission?.duelTutorialCareerId && parsed.activeMission?.duelTutorialCareerId !== profile.activeMission.duelTutorialCareerId) return false
      if (profile.activeMission?.outpostSiege && !parsed.activeMission?.outpostSiege
        || profile.activeMission?.battle?.outpostSiege && !parsed.activeMission?.battle?.outpostSiege
        || profile.activeOutpostMission?.battle?.outpostSiege && !parsed.activeOutpostMission?.battle?.outpostSiege) return false
      if (profile.activeMission?.prisonBreak && !parsed.activeMission?.prisonBreak) return false
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
