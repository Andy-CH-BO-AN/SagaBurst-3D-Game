/**
 * Parses and validates a saved active Career mission. Shared identity checks run first, then each
 * mission family's own roster rules; any failure rejects the whole mission (fail closed).
 */
import { parseDuelArenaId } from '../arena/DuelArenaCatalog'
import { parsePrisonBreakState } from './CareerPrisonBreak'
import { arenaTrialRoster, arenaTrialTierFromTemplateId, parseArenaTrialState } from './CareerArenaTrials'
import { legacySiegeCharacterTier, parseBorrowedCharacterIdentities } from './CareerBorrowedIdentity'
import { siegeRoster, siegeRosterVersion } from './TownSiege'
import { TOWN_WATCHTOWER_ARCHER_IDS } from '../town/TownNativeGuardIdentity'
import { BRIDGEHEAD_FRIENDLIES, BRIDGEHEAD_ENEMIES, BRIDGEHEAD_FRIENDLY_SQUADS, BRIDGEHEAD_SQUAD_SIZE, isBridgeheadEnemyCount } from '../battle/BridgeheadRosterConfig'
import { commanderGateDefenseSlots } from './CommanderTownRoster'
import { commanderFourGateDefenseActorIds } from './CommanderFourGateDefenseRoster'
import { parseCommanderFourGateDefenseState } from './CommanderFourGateDefenseState'
import { townRoster } from '../town/TownRules'
import { parseCampaignSiegeCheckpoint } from '../campaign/CampaignSiegeCheckpoint'
import type { CareerDuelTier } from './CareerDuelState'
import { careerDuelClassOptions } from './CareerDuelClasses'
import type { HeroCombatProfileId } from '../battle/HeroCombatProfile'
import { parseTownOutskirtsCheckpoint } from '../town/TownOutskirtsWarfareController'
import { parseOfficialCommandAuthority } from './CareerCommandAuthority'
import { parseCaptainEagleCheckpoint } from './CaptainEagleCheckpoint'
import { parseCareerOutpostCheckpoint } from './CareerOutpostMission'
import { parsePersonalMission } from './CareerPersonalSquadMission'
import { UNIT_PRESETS, type UnitPresetId } from '../battle/UnitPresetCatalog'
import type { CareerProfile } from './CareerProfile'
import { getCareerMissionTemplate } from './CareerMissionCatalog'
import { COMMANDER_FELINE_CAVALRY_KIND, COMMANDER_IRON_LEGION_KIND, FELINE_ENEMY_TOTAL, FELINE_FRIENDLY_SQUAD_SIZES, FELINE_FRIENDLY_TOTAL, felineCavalryActorIds, felineVanguardActorId } from './CommanderMissionCatalog'
import { HEAVY_FIELD_KIND, heavyActorIds, heavyNpcGroups, ironLegionEnemyActorIds, ironLegionVanguardActorId, isHeavyFieldMissionId, parseHeavyFieldState } from './HeavyCavalryMissions'
import { careerHeavyFieldMissionRankOk, heavyMissionOfficialCommandPolicy } from './HeavyFieldMission'
import { isMigratedCareerFieldTemplate } from './CareerFieldBattle'
import { BRIDGEHEAD_PREPARATION_SECONDS, type ActiveCareerMission, type CareerMissionPhase, type CommanderMissionState, type VeteranOutpostBattleState } from './CareerMissionState'
import { CAREER_DUEL_TEMPLATE_ID, DUEL_COUNTDOWN_SECONDS, DUEL_COMBAT_SECONDS, isCareerDuelPresetId, isCareerDuelTier, parseCareerDuelCommanderHome, parseCareerDuelTravelCheckpoint } from './CareerDuelState'
import { nonNegativeInteger, nonNegativeNumber, parseMissionMountState, parseMissionPlayerStats, uniqueStrings } from './CareerSaveFields'
import type { CareerMissionTemplate } from './CareerMissionCatalog'
import type { OfficialCommandAuthority } from './CareerCommandAuthority'
import type { PersonalSquadMission } from './CareerPersonalSquadMission'
import type { CaptainEagleCheckpoint } from './CaptainEagleCheckpoint'

const MISSION_PHASES: CareerMissionPhase[] = ['DEPLOYING', 'ASSEMBLING', 'MARCHING', 'ENGAGING', 'RETURNING', 'PREPARING', 'SPAWNING', 'ATTACKING', 'VICTORY_LOCKED', 'FAILURE_LOCKED', 'RESET', 'RESULT']

function parseActorPositions(value: unknown, knownActorIds: ReadonlySet<string>): ActiveCareerMission['actorPositions'] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const result: NonNullable<ActiveCareerMission['actorPositions']> = {}
  for (const [actorId, rawPosition] of Object.entries(value)) {
    if (!knownActorIds.has(actorId) || !rawPosition || typeof rawPosition !== 'object' || Array.isArray(rawPosition)) continue
    const position = rawPosition as Record<string, unknown>
    if (typeof position.x !== 'number' || !Number.isFinite(position.x)
      || typeof position.z !== 'number' || !Number.isFinite(position.z)
      || typeof position.yaw !== 'number' || !Number.isFinite(position.yaw)) continue
    result[actorId] = {
      x: position.x, z: position.z, yaw: position.yaw,
      ...(typeof position.y === 'number' && Number.isFinite(position.y) ? { y: position.y } : {}),
      ...(position.outpostRampartGarrison === true ? { outpostRampartGarrison: true } : {}),
      ...(position.townRampartGarrison === true ? { townRampartGarrison: true } : {}),
    }
  }
  return Object.keys(result).length > 0 ? result : undefined
}

function parseEngagedEnemySquadIds(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined
  const ids = [...new Set(value.filter((id): id is number => Number.isInteger(id) && id >= 1 && id <= 8))]
  return ids.length > 0 ? ids : undefined
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
      ...(typeof health.mountArmorImpact === 'number' && Number.isFinite(health.mountArmorImpact) ? { mountArmorImpact: Math.max(0, Math.min(50, health.mountArmorImpact)) } : {}),
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
  const position = raw.playerPosition as Partial<NonNullable<VeteranOutpostBattleState['playerPosition']>> | undefined
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
    ...(position && typeof position.x === 'number' && Number.isFinite(position.x)
      && typeof position.z === 'number' && Number.isFinite(position.z)
      && typeof position.yaw === 'number' && Number.isFinite(position.yaw)
      ? { playerPosition: { x: position.x, z: position.z, yaw: position.yaw,
        ...(typeof position.y === 'number' && Number.isFinite(position.y) ? { y: position.y } : {}) } } : {}),
    ...(typeof raw.gateHealth === 'number' && Number.isFinite(raw.gateHealth) && raw.gateHealth >= 0 ? { gateHealth: raw.gateHealth } : {}),
    ...(gateState ? { gateState } : {}),
  }
}

function parseCommanderMissionState(value: unknown, expectedKind: ActiveCareerMission['kind'], templateId?: string): CommanderMissionState | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  if (expectedKind === HEAVY_FIELD_KIND) {
    const heavyField = templateId && isHeavyFieldMissionId(templateId) ? parseHeavyFieldState(raw.heavyField, templateId) : undefined
    const position = raw.playerPosition as Record<string, unknown> | undefined
    return raw.version === 1 && raw.kind === HEAVY_FIELD_KIND && heavyField ? { version: 1, kind: HEAVY_FIELD_KIND, deploymentComplete: raw.deploymentComplete === true, heavyField,
      ...(position && [position.x, position.z, position.yaw].every(n => typeof n === 'number' && Number.isFinite(n)) ? { playerPosition: { x: position.x as number, z: position.z as number, yaw: position.yaw as number } } : {}) } : undefined
  }
  if (raw.version !== 1 || raw.kind !== expectedKind
    || expectedKind === 'commander-four-gate-defense' && typeof raw.deploymentComplete !== 'boolean'
    || !['commander-sky-raid', 'commander-decapitation', 'commander-outpost-last-stand', 'commander-bridgehead-battle', 'commander-four-gate-defense', COMMANDER_FELINE_CAVALRY_KIND, COMMANDER_IRON_LEGION_KIND].includes(raw.kind as string)
    || (raw.kind === COMMANDER_FELINE_CAVALRY_KIND || raw.kind === COMMANDER_IRON_LEGION_KIND) && (typeof raw.felineVanguardActorId !== 'string' || !raw.felineVanguardActorId)) return undefined
  const position = raw.playerPosition as Record<string, unknown> | undefined
  const playerPosition = position && typeof position.x === 'number' && Number.isFinite(position.x)
    && typeof position.z === 'number' && Number.isFinite(position.z)
    && typeof position.yaw === 'number' && Number.isFinite(position.yaw)
    ? { x: position.x, z: position.z, yaw: position.yaw } : undefined
  return { version: 1, kind: raw.kind as CommanderMissionState['kind'], deploymentComplete: raw.deploymentComplete === true,
    ...(raw.kind === COMMANDER_FELINE_CAVALRY_KIND || raw.kind === COMMANDER_IRON_LEGION_KIND ? { felineVanguardActorId: raw.felineVanguardActorId as string,
      felineChargeTriggered: raw.felineChargeTriggered === true } : {}),
    ...(playerPosition ? { playerPosition } : {}) }
}

function parseSiege(value: unknown): ActiveCareerMission['siege'] {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  if (raw.version !== 1) return undefined
  const gates = (value: unknown) => uniqueStrings(value).filter((id): id is 'north' | 'south' | 'east' | 'west' => ['north', 'south', 'east', 'west'].includes(id))
  const position = raw.playerPosition as { x?: unknown; y?: unknown; z?: unknown; yaw?: unknown } | undefined
  const health = raw.gateHealth && typeof raw.gateHealth === 'object' ? raw.gateHealth as Record<string, unknown> : {}
  return {
    version: 1, rosterCreated: raw.rosterCreated === true,
    rosterVersion: raw.rosterCreated === true && raw.rosterVersion !== 2 ? 1 : 2,
    attackerIds: uniqueStrings(raw.attackerIds), claimedSquadIds: uniqueStrings(raw.claimedSquadIds).filter(id => /^outskirts:cavalry:[abc]$/.test(id)),
    destroyedGateIds: gates(raw.destroyedGateIds), releasedReserveGateIds: gates(raw.releasedReserveGateIds),
    crossedActorIds: uniqueStrings(raw.crossedActorIds).filter(id => uniqueStrings(raw.attackerIds).includes(id)),
    approachedActorIds: uniqueStrings(raw.approachedActorIds).filter(id => uniqueStrings(raw.attackerIds).includes(id)),
    defensePlans: Array.isArray(raw.defensePlans) ? raw.defensePlans.flatMap(value => {
      if (!value || typeof value !== 'object') return []
      const plan = value as Record<string, unknown>, gateId = gates([plan.gateId])[0]
      return gateId ? [{ gateId, infantry: uniqueStrings(plan.infantry), cavalry: uniqueStrings(plan.cavalry), ...(typeof plan.leaderId === 'string' ? { leaderId: plan.leaderId } : {}) }] : []
    }) : [],
    gateHealth: Object.fromEntries(Object.entries(health).filter(([id, hp]) => gates([id]).length && typeof hp === 'number' && Number.isFinite(hp) && hp >= 0)),
    ...(position && typeof position.x === 'number' && Number.isFinite(position.x) && typeof position.z === 'number' && Number.isFinite(position.z)
      && typeof position.yaw === 'number' && Number.isFinite(position.yaw) ? { playerPosition: { x: position.x, z: position.z, yaw: position.yaw, ...(typeof position.y === 'number' && Number.isFinite(position.y) ? { y: position.y } : {}) } } : {}),
  }
}

/** What every family validator may read once the shared identity checks have passed. */
interface MissionParseContext {
  readonly raw: Record<string, unknown>
  readonly template: CareerMissionTemplate | null
  readonly faction: CareerProfile['faction']
  readonly rank: CareerProfile['rank']
  readonly fourGateMission: boolean
  readonly targetActorIds: string[]
  readonly friendlyActorIds: string[]
  readonly knownActorIds: ReadonlySet<string>
  readonly officialSquad: OfficialCommandAuthority | undefined
  readonly acceptedOfficialSquad: OfficialCommandAuthority | undefined
  readonly personalSquad: PersonalSquadMission | undefined
}

/** Four-gate rosters are bounded and duplicate-free before normalization can hide either. */
function rejectsFourGateRosterShape(raw: Record<string, unknown>): boolean {
  return Boolean(raw.kind !== 'commander-four-gate-defense' || typeof raw.id !== 'string' || raw.id.length > 130
    || !['targetActorIds', 'friendlyActorIds', 'civilianActorIds'].every(key => Array.isArray(raw[key])
      && (raw[key] as unknown[]).length <= 1024 && (raw[key] as unknown[]).every(id => typeof id === 'string' && id.trim() === id && id.length <= 200)
      && new Set(raw[key] as unknown[]).size === (raw[key] as unknown[]).length)
    || ['deadTargetActorIds', 'deadFriendlyActorIds', 'deadCivilianActorIds'].some(key => raw[key] !== undefined
      && (!Array.isArray(raw[key]) || (raw[key] as unknown[]).length > 1024
        || (raw[key] as unknown[]).some(id => typeof id !== 'string' || id.trim() !== id || id.length > 200)
        || new Set(raw[key] as unknown[]).size !== (raw[key] as unknown[]).length)))
}

interface DuelIdentity { duelOpponentActorId: string; duelCaptainActorId: string; duelRefereeActorId: string }

/** The duel's opponent, captain and referee; `undefined` rejects the save. */
function parseDuelIdentity(raw: Record<string, unknown>, faction: CareerProfile['faction']): DuelIdentity | undefined {
  const duelOpponentActorId = typeof raw.duelOpponentActorId === 'string' ? raw.duelOpponentActorId.trim() : ''
  const duelCaptainActorId = typeof raw.duelCaptainActorId === 'string' ? raw.duelCaptainActorId.trim() : ''
  const duelRefereeActorId = typeof raw.duelRefereeActorId === 'string' ? raw.duelRefereeActorId.trim() : duelCaptainActorId
  if (!isCareerDuelTier(raw.duelTier) || !isCareerDuelPresetId(raw.duelPresetId)
    || UNIT_PRESETS[raw.duelPresetId].faction !== faction || !duelOpponentActorId || !duelCaptainActorId || !duelRefereeActorId) return undefined
  if (raw.duelTier === 5 && (duelOpponentActorId !== 'commander' || duelCaptainActorId !== 'captain'
    || duelRefereeActorId !== duelCaptainActorId)) return undefined
  return { duelOpponentActorId, duelCaptainActorId, duelRefereeActorId }
}

/** Commander missions need the exact official roster of their template. */
function rejectsCommanderRoster({ raw, template, fourGateMission, friendlyActorIds, targetActorIds, acceptedOfficialSquad }: MissionParseContext): boolean {
  const rosterVersion = (raw.fourGateDefense as { rosterVersion?: unknown } | undefined)?.rosterVersion ?? 1
  if (fourGateMission && rosterVersion !== 1 && rosterVersion !== 2) return true
  const nativeSquads = fourGateMission ? commanderGateDefenseSlots(undefined, rosterVersion as 1 | 2) : []
  const nativeActorIds = nativeSquads.flatMap(squad => squad.actorIds)
  const expectedFriendly = fourGateMission ? nativeActorIds.length : template?.kind === 'commander-sky-raid' ? 50
    : template?.kind === 'commander-decapitation' ? 30 : template?.kind === 'commander-bridgehead-battle' ? BRIDGEHEAD_FRIENDLIES
    : template?.kind === COMMANDER_FELINE_CAVALRY_KIND || template?.kind === COMMANDER_IRON_LEGION_KIND ? FELINE_FRIENDLY_TOTAL : 120
  const enemyVersion = (raw.fourGateDefense as { enemyRosterVersion?: unknown } | undefined)?.enemyRosterVersion
  if (fourGateMission && enemyVersion !== undefined && enemyVersion !== 2) return true
  const exactTargets = fourGateMission ? new Set(commanderFourGateDefenseActorIds(raw.id as string, enemyVersion === 2 ? 2 : 1)) : undefined
  const validTargets = exactTargets ? targetActorIds.length === exactTargets.size && targetActorIds.every(id => exactTargets.has(id))
    : template?.kind === 'commander-sky-raid' ? targetActorIds.length >= 100
    : template?.kind === 'commander-decapitation' ? targetActorIds.length === 1 && targetActorIds[0] === 'commander'
    : template?.kind === 'commander-bridgehead-battle' ? isBridgeheadEnemyCount(targetActorIds.length)
    : template?.kind === COMMANDER_FELINE_CAVALRY_KIND || template?.kind === COMMANDER_IRON_LEGION_KIND ? targetActorIds.length === FELINE_ENEMY_TOTAL : targetActorIds.length === 100
  if (!acceptedOfficialSquad || acceptedOfficialSquad.commandRank !== 'commander'
    || friendlyActorIds.length !== expectedFriendly || acceptedOfficialSquad.actorIds.length !== expectedFriendly
    || !friendlyActorIds.every(id => acceptedOfficialSquad.actorIds.includes(id)) || !validTargets) return true
  if (fourGateMission && (friendlyActorIds.some(id => !nativeActorIds.includes(id))
    || acceptedOfficialSquad.squads?.length !== nativeSquads.length
    || nativeSquads.some(expected => {
      const saved = acceptedOfficialSquad.squads?.find(squad => squad.squadId === expected.squadId)
      return !saved || saved.actorIds.length !== expected.actorIds.length || saved.actorIds.some(id => !expected.actorIds.includes(id))
    }))) return true
  return false
}

/** Four-gate defense state must agree with the roster, civilians and the commander checkpoint. */
function rejectsFourGateDefense({ raw, friendlyActorIds, personalSquad }: MissionParseContext,
  fourGateDefense: ActiveCareerMission['fourGateDefense'], commanderState: CommanderMissionState | undefined,
  civilianActorIds: string[], nativeCivilianIds: string[]): boolean {
  return Boolean(!fourGateDefense || commanderState?.deploymentComplete !== fourGateDefense.deploymentComplete
    || civilianActorIds.length !== nativeCivilianIds.length || civilianActorIds.some(id => !nativeCivilianIds.includes(id))
    || uniqueStrings(raw.deadFriendlyActorIds).some(id => !friendlyActorIds.includes(id))
    || uniqueStrings(raw.deadCivilianActorIds).some(id => !civilianActorIds.includes(id))
    || raw.personalSquad !== undefined && !personalSquad)
}

function parseBridgeDeployment(raw: Record<string, unknown>): ActiveCareerMission['bridgeDeployment'] {
  const rawBridgeDeployment = raw.bridgeDeployment as Record<string, unknown> | undefined
  return rawBridgeDeployment && ['preparing', 'spawning', 'assault'].includes(rawBridgeDeployment.phase as string)
    && typeof rawBridgeDeployment.preparationRemainingSeconds === 'number' && Number.isFinite(rawBridgeDeployment.preparationRemainingSeconds)
    && rawBridgeDeployment.preparationRemainingSeconds >= 0 && rawBridgeDeployment.preparationRemainingSeconds <= BRIDGEHEAD_PREPARATION_SECONDS
    && (rawBridgeDeployment.phase === 'preparing' || rawBridgeDeployment.preparationRemainingSeconds === 0)
    ? { phase: rawBridgeDeployment.phase as 'preparing' | 'spawning' | 'assault', preparationRemainingSeconds: rawBridgeDeployment.preparationRemainingSeconds }
    : undefined
}

/** Bridgehead: fixed squads in roster order and a checkpoint covering exactly the known actors. */
function rejectsBridgehead({ raw, friendlyActorIds, targetActorIds, knownActorIds, acceptedOfficialSquad, personalSquad }: MissionParseContext,
  bridgeBattle: CaptainEagleCheckpoint | undefined, bridgeDeployment: ActiveCareerMission['bridgeDeployment']): boolean {
  return Boolean(raw.bridgeBattle !== undefined && !bridgeBattle
    || raw.bridgeDeployment !== undefined && !bridgeDeployment
    || new Set([...friendlyActorIds, ...targetActorIds]).size !== friendlyActorIds.length + targetActorIds.length
    || acceptedOfficialSquad?.squads?.length !== BRIDGEHEAD_FRIENDLY_SQUADS
    || acceptedOfficialSquad.squads.some((squad, index) => squad.squadId !== index + 1
      || squad.actorIds.length !== BRIDGEHEAD_SQUAD_SIZE || squad.actorIds.some((id, slot) => id !== friendlyActorIds[index * BRIDGEHEAD_SQUAD_SIZE + slot]))
    || bridgeBattle && (Object.keys(bridgeBattle.actors).length !== friendlyActorIds.length + targetActorIds.length
      || Object.keys(bridgeBattle.actors).some(id => !knownActorIds.has(id))
      || bridgeBattle.player.mountActorId && !(targetActorIds.includes(bridgeBattle.player.mountActorId)
        && bridgeBattle.actors[bridgeBattle.player.mountActorId]?.mount
        || personalSquad?.memberIds.includes(bridgeBattle.player.mountActorId)
          && personalSquad.members[bridgeBattle.player.mountActorId]?.mount)))
}

/** Feline Cavalry / Iron Legion: generated actor IDs, the vanguard and fixed squad sizes. */
function rejectsFelineFamily({ raw, template, friendlyActorIds, targetActorIds, knownActorIds, acceptedOfficialSquad, personalSquad }: MissionParseContext,
  commanderState: CommanderMissionState | undefined, felineBattle: CaptainEagleCheckpoint | undefined): boolean {
  const ironLegion = template?.kind === COMMANDER_IRON_LEGION_KIND
  const expectedFelineFriendly = felineCavalryActorIds(raw.id as string, 'friendly')
  const expectedFelineEnemies = ironLegion ? ironLegionEnemyActorIds(raw.id as string) : felineCavalryActorIds(raw.id as string, 'enemy')
  return Boolean(commanderState?.felineVanguardActorId !== (ironLegion ? ironLegionVanguardActorId(raw.id as string) : felineVanguardActorId(raw.id as string))
    || !targetActorIds.includes(commanderState?.felineVanguardActorId ?? '')
    || friendlyActorIds.some((id, index) => id !== expectedFelineFriendly[index])
    || targetActorIds.some((id, index) => id !== expectedFelineEnemies[index])
    || raw.personalSquad !== undefined && !personalSquad
    || personalSquad?.memberIds.some(id => knownActorIds.has(id))
    || acceptedOfficialSquad?.squads?.length !== FELINE_FRIENDLY_SQUAD_SIZES.length
    || acceptedOfficialSquad.squads.some((squad, index) => squad.squadId !== index + 1
      || squad.actorIds.length !== FELINE_FRIENDLY_SQUAD_SIZES[index]
      || squad.actorIds.some(id => !friendlyActorIds.includes(id)))
    || raw.felineBattle !== undefined && !felineBattle
    || felineBattle && (Object.keys(felineBattle.actors).length !== friendlyActorIds.length + targetActorIds.length
      || Object.keys(felineBattle.actors).some(id => !knownActorIds.has(id))
      || felineBattle.player.mountActorId && !(knownActorIds.has(felineBattle.player.mountActorId)
        && felineBattle.actors[felineBattle.player.mountActorId]?.mount
        || personalSquad?.memberIds.includes(felineBattle.player.mountActorId)
          && personalSquad.members[felineBattle.player.mountActorId]?.mount)))
}

/**
 * Heavy field missions: exact generated rosters and the rank's command policy.
 * Returns the official squad to keep (a recognizable legacy Captain grant is dropped), or `null` to reject.
 */
function resolveHeavyOfficialSquad({ raw, template, faction, rank, friendlyActorIds, targetActorIds, knownActorIds, officialSquad, acceptedOfficialSquad, personalSquad }: MissionParseContext,
  felineBattle: CaptainEagleCheckpoint | undefined): { squad: OfficialCommandAuthority | undefined } | null {
  let heavyOfficialSquad = acceptedOfficialSquad
  const templateId = template!.id as Parameters<typeof heavyNpcGroups>[0]
  const expectedFriendly = heavyActorIds(raw.id as string, 'friendly', heavyNpcGroups(templateId, 'friendly'))
  const expectedEnemies = heavyActorIds(raw.id as string, 'enemy', heavyNpcGroups(templateId, 'enemy'))
  const shouldCommand = heavyMissionOfficialCommandPolicy(rank, templateId)
  if (friendlyActorIds.length !== expectedFriendly.length || targetActorIds.length !== expectedEnemies.length
    || friendlyActorIds.some((id, index) => id !== expectedFriendly[index]) || targetActorIds.some((id, index) => id !== expectedEnemies[index])
    || raw.personalSquad !== undefined && !personalSquad
    || personalSquad?.memberIds.some(id => knownActorIds.has(id))
    || raw.felineBattle !== undefined && !felineBattle
    || felineBattle && (Object.keys(felineBattle.actors).length !== friendlyActorIds.length + targetActorIds.length
      || Object.keys(felineBattle.actors).some(id => !knownActorIds.has(id)))) return null
  if (shouldCommand) {
    if (!heavyOfficialSquad) return null
    if (rank === 'captain') {
      if (heavyOfficialSquad.commandRank !== undefined
        || heavyOfficialSquad.actorIds.length !== 29 || heavyOfficialSquad.actorIds.some(id => !friendlyActorIds.includes(id))) return null
    } else if (rank === 'commander') {
      const expectedSquadCount = Math.ceil(friendlyActorIds.length / 50)
      if (heavyOfficialSquad.commandRank !== 'commander'
        || heavyOfficialSquad.actorIds.length !== friendlyActorIds.length
        || heavyOfficialSquad.actorIds.some((id, index) => id !== friendlyActorIds[index])
        || !heavyOfficialSquad.squads
        || heavyOfficialSquad.squads.length !== expectedSquadCount
        || !heavyOfficialSquad.squads.every((squad, i) =>
          squad.squadId === i + 1
          && squad.actorIds.length === Math.min(50, friendlyActorIds.length - i * 50)
          && squad.actorIds.every((id, slot) => id === friendlyActorIds[i * 50 + slot])
        )) return null
    }
  } else {
    if (raw.officialSquad !== undefined) {
      // Safe compatibility: recognizable legacy save produced by older buggy code where Captain got unauthorized officialSquad in Soldier/Veteran mission.
      // It must match the exact recognizable grant structure from old heavyOfficialAuthority:
      // - rank === 'captain'
      // - officialSquad.type === 'mission-official'
      // - officialSquad.missionId === raw.id
      // - officialSquad.townFaction === faction
      // - officialSquad.commandRank === undefined
      // - actorIds must match exactly friendlyActorIds.slice(0, Math.min(50, friendlyActorIds.length))
      // If it does not match this recognizable legacy shape, fail-closed!
      const expectedCount = Math.min(50, friendlyActorIds.length)
      const isRecognizableLegacyCaptainGrant =
        rank === 'captain'
        && officialSquad?.type === 'mission-official'
        && officialSquad.missionId === raw.id
        && officialSquad.townFaction === faction
        && officialSquad.commandRank === undefined
        && officialSquad.actorIds.length === expectedCount
        && officialSquad.actorIds.every((id, slot) => id === friendlyActorIds[slot])

      if (isRecognizableLegacyCaptainGrant) {
        heavyOfficialSquad = undefined
      } else {
        return null
      }
    }
  }
  return { squad: heavyOfficialSquad }
}

/** Captain patrol command: kills, return states and its outskirts/ambient checkpoints. */
function parsePatrolFields(raw: Record<string, unknown>, officialSquad: OfficialCommandAuthority | undefined): Partial<ActiveCareerMission> {
  return { patrolKilledActorIds: uniqueStrings(raw.patrolKilledActorIds),
    ...(raw.patrolReturnStates && typeof raw.patrolReturnStates === 'object' ? { patrolReturnStates: Object.fromEntries(
      Object.entries(raw.patrolReturnStates).filter(([id, state]) => officialSquad?.actorIds.includes(id)
        && (state === 'RETURN_TO_BARRACKS' || state === 'REFIT' || state === 'REJOIN_PATROL')),
    ) as ActiveCareerMission['patrolReturnStates'] } : {}),
    ...(parseTownOutskirtsCheckpoint(raw.patrolOutskirts) ? { patrolOutskirts: parseTownOutskirtsCheckpoint(raw.patrolOutskirts) } : {}),
    ...(parseOfficialCommandAuthority(raw.patrolAmbient) ? { patrolAmbient: parseOfficialCommandAuthority(raw.patrolAmbient) } : {}),
  }
}

function parseDuelFields(raw: Record<string, unknown>, faction: CareerProfile['faction'],
  { duelOpponentActorId, duelCaptainActorId, duelRefereeActorId }: DuelIdentity): Partial<ActiveCareerMission> {
  return {
    duelMode: raw.duelMode === 'unarmed' ? 'unarmed' : 'armed',
    ...(raw.duelMode === 'unarmed' && raw.duelFailureReason === 'illegal_attack' ? { duelFailureReason: 'illegal_attack' as const } : {}),
    ...(raw.duelMode === 'unarmed' ? { duelPlayerWasMounted: raw.duelPlayerWasMounted === true,
      ...(typeof raw.duelPlayerHomeMountActorId === 'string' ? { duelPlayerHomeMountActorId: raw.duelPlayerHomeMountActorId } : {}) } : {}),
    duelTier: raw.duelTier as CareerDuelTier,
    ...(typeof raw.duelTutorialCareerId === 'string' ? { duelTutorialCareerId: raw.duelTutorialCareerId } : {}),
    ...(raw.duelMode === 'unarmed' || raw.duelTier === 5 || raw.duelTutorialCareerId ? { duelCommanderHome: parseCareerDuelCommanderHome(raw.duelCommanderHome),
      duelTravel: parseCareerDuelTravelCheckpoint(raw.duelTravel, [...new Set([duelOpponentActorId, duelCaptainActorId, ...(raw.duelTutorialCareerId ? [duelRefereeActorId] : [])])]) } : {}),
    duelPresetId: raw.duelPresetId as UnitPresetId,
    // An unknown arena ID is dropped; the duel then resumes in the legacy Town forecourt.
    ...(!raw.duelTutorialCareerId && parseDuelArenaId(raw.duelArenaId) ? { duelArenaId: parseDuelArenaId(raw.duelArenaId)! } : {}),
    // An unknown or illegal class is dropped, so the duel simply uses the resident's original class.
    ...(raw.duelMode !== 'unarmed' && typeof raw.duelClassId === 'string'
      && careerDuelClassOptions(faction, raw.duelPresetId as UnitPresetId, raw.duelTier as number).some(option => option.combatProfileId === raw.duelClassId)
      ? { duelClassId: raw.duelClassId as HeroCombatProfileId } : {}),
    duelOpponentActorId, duelCaptainActorId, duelRefereeActorId,
    duelCountdownElapsed: Math.min(DUEL_COUNTDOWN_SECONDS, nonNegativeNumber(raw.duelCountdownElapsed)),
    duelCombatElapsed: Math.min(raw.duelMode === 'unarmed' ? 90 : DUEL_COMBAT_SECONDS, nonNegativeNumber(raw.duelCombatElapsed)),
    duelOpponentDead: raw.duelOpponentDead === true || uniqueStrings(raw.deadTargetActorIds).includes(duelOpponentActorId),
    ...(typeof raw.duelOpponentMaxHp === 'number' && Number.isFinite(raw.duelOpponentMaxHp) && raw.duelOpponentMaxHp > 0 ? { duelOpponentMaxHp: raw.duelOpponentMaxHp } : {}),
    ...(typeof raw.duelOpponentHp === 'number' && Number.isFinite(raw.duelOpponentHp) && raw.duelOpponentHp >= 0 ? { duelOpponentHp: raw.duelOpponentHp } : {}),
    ...(typeof raw.duelOpponentMountArmorImpact === 'number' && Number.isFinite(raw.duelOpponentMountArmorImpact) ? { duelOpponentMountArmorImpact: Math.max(0, Math.min(50, raw.duelOpponentMountArmorImpact)) } : {}),
    ...(typeof raw.duelOpponentMountHp === 'number' && Number.isFinite(raw.duelOpponentMountHp) && raw.duelOpponentMountHp >= 0 ? { duelOpponentMountHp: raw.duelOpponentMountHp } : {}),
    ...(typeof raw.duelPlayerHp === 'number' && Number.isFinite(raw.duelPlayerHp) && raw.duelPlayerHp >= 0 ? { duelPlayerHp: raw.duelPlayerHp } : {}),
    ...(typeof raw.duelPlayerStamina === 'number' && Number.isFinite(raw.duelPlayerStamina) && raw.duelPlayerStamina >= 0 ? { duelPlayerStamina: raw.duelPlayerStamina } : {}),
    ...(typeof raw.duelOpponentAmmo === 'number' && Number.isFinite(raw.duelOpponentAmmo) && raw.duelOpponentAmmo >= 0 ? { duelOpponentAmmo: Math.floor(raw.duelOpponentAmmo) } : {}),
  }
}

function parseMissionResult(raw: Record<string, unknown>): ActiveCareerMission['result'] {
  if (!raw.result || typeof raw.result !== 'object') return undefined
  const result = raw.result as Record<string, unknown>
  const player = result.stats && typeof result.stats === 'object' ? result.stats as Record<string, unknown> : {}
  const merit = result.merit && typeof result.merit === 'object' ? result.merit as Record<string, unknown> : {}
  if (result.outcome !== 'victory' && result.outcome !== 'failure') return undefined
  return {
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

/** A four-gate result must match its defense phase; old victories can only be eliminations. Returns false to reject. */
function reconcileFourGateResult(mission: ActiveCareerMission, fourGateDefense: NonNullable<ActiveCareerMission['fourGateDefense']>): boolean {
  if ((fourGateDefense.phase === 'RESULT') !== Boolean(mission.result)
    || mission.result?.outcome === 'failure' && fourGateDefense.victoryReason !== undefined) return false
  if (mission.result?.outcome === 'victory') {
    if (!fourGateDefense.deploymentComplete || !fourGateDefense.attackStarted) return false
    if (fourGateDefense.victoryReason !== 'survival') {
      if (mission.deadTargetActorIds?.length !== mission.targetActorIds.length
        || mission.targetActorIds.some(id => fourGateDefense.actors[id]?.status !== 'dead')) return false
      // Old victories predate the explicit reason and can only represent elimination.
      fourGateDefense.victoryReason = 'elimination'
    }
  }
  return true
}

/** Structured borrowed identities, plus the one-time historical adapter for old siege rosters. */
function attachBorrowedIdentities(mission: ActiveCareerMission, raw: Record<string, unknown>, faction: CareerProfile['faction']): void {
  const borrowedActorIdentities = parseBorrowedCharacterIdentities(raw.borrowedActorIdentities,
    [...mission.friendlyActorIds, ...mission.targetActorIds, ...(mission.siege?.attackerIds ?? [])])
  if (borrowedActorIdentities) mission.borrowedActorIdentities = borrowedActorIdentities
  // Only old siege records need the historical ID adapter. Its result becomes
  // structured data once, so runtime factories never guess from actor names.
  if (raw.borrowedActorIdentities === undefined && mission.siege?.rosterCreated
    && mission.siege.attackerIds.some(id => legacySiegeCharacterTier(id, 3) === 2)) {
    const assault = mission.kind === 'enemy-town-assault'
    const characterFaction = assault ? faction : faction === 'roman' ? 'viking' : 'roman'
    siegeRoster(characterFaction, assault, siegeRosterVersion(mission.siege)).forEach(({ spec }, index) => {
      const id = mission.siege!.attackerIds[index]
      if (id && legacySiegeCharacterTier(id, spec.tier) !== spec.tier) {
        mission.borrowedActorIdentities = { ...mission.borrowedActorIdentities,
          [id]: { characterFaction, characterTier: 2 } }
      }
    })
}
}

export function parseActiveMission(value: unknown, faction: CareerProfile['faction'], rank: CareerProfile['rank']): ActiveCareerMission | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const template = typeof raw.templateId === 'string' ? getCareerMissionTemplate(raw.templateId) : null
  const fourGateMission = template?.kind === 'commander-four-gate-defense'
  // Reject malformed roster data before normalization can hide duplicates or unbounded arrays.
  if (fourGateMission && rejectsFourGateRosterShape(raw)) return undefined
  const siege = parseSiege(raw.siege)
  if ((raw.kind === 'town-defense' || raw.kind === 'enemy-town-assault') && !siege) return undefined
  const duel = raw.kind === 'duel' && raw.templateId === CAREER_DUEL_TEMPLATE_ID
  const trialTier = raw.kind === 'arena-squad-trial' ? arenaTrialTierFromTemplateId(raw.templateId) : null
  const trialRosterVersion = (raw.arenaTrial as { rosterVersion?: unknown } | undefined)?.rosterVersion === 2 ? 2 : 1
  const trialRoster = trialTier && typeof raw.id === 'string' && raw.id ? arenaTrialRoster(raw.id, trialTier, trialRosterVersion) : null
  if (raw.kind === 'arena-squad-trial' && !trialRoster) return undefined
  const duelIdentity = duel ? parseDuelIdentity(raw, faction) : undefined
  if (duel && !duelIdentity) return undefined
  const outpostMission = template?.kind === 'veteran-outpost-defense' || template?.kind === 'veteran-outpost-assault' || template?.kind === 'captain-outpost-defense'
  const captainStandalone = template?.kind === 'captain-patrol-command' || template?.kind === 'captain-eagle-battle'
  const commanderMission = Boolean(template?.id.startsWith('commander-'))
  const heavyMission = template?.kind === HEAVY_FIELD_KIND
  const migratedFieldMission = typeof template?.id === 'string' && isMigratedCareerFieldTemplate(template.id)
  if (
    typeof raw.id !== 'string' || !raw.id
    || (!template && !duel && !trialRoster)
    || !Number.isInteger(raw.targetCampId) || ((duel || trialRoster || template?.kind === 'town-defense' || template?.kind === 'enemy-town-assault' || outpostMission || captainStandalone || commanderMission || heavyMission)
      ? raw.targetCampId !== -1
      : (raw.targetCampId as number) < 0 || (raw.targetCampId as number) > 4)
    || !MISSION_PHASES.includes(raw.phase as CareerMissionPhase) || raw.phase === 'SPAWNING' && !fourGateMission
  ) return undefined
  const targetActorIds = duelIdentity ? [duelIdentity.duelOpponentActorId] : trialRoster ? trialRoster.filter(e => e.team === 'enemy').map(e => e.actorId) : uniqueStrings(raw.targetActorIds)
  const friendlyActorIds = duelIdentity ? (duelIdentity.duelRefereeActorId === duelIdentity.duelOpponentActorId ? [] : [duelIdentity.duelRefereeActorId]) : trialRoster ? trialRoster.filter(e => e.team === 'friendly').map(e => e.actorId) : uniqueStrings(raw.friendlyActorIds)
  const reinforcementActorIds = uniqueStrings(raw.reinforcementActorIds)
  if (template?.kind === 'town-defense' && !friendlyActorIds.includes('ranger')) friendlyActorIds.push('ranger')
  if (template?.kind === 'town-defense' && !friendlyActorIds.includes('deployment')) friendlyActorIds.push('deployment')
  const allFriendlyActorIds = [...new Set([...friendlyActorIds, ...reinforcementActorIds])]
  if ((targetActorIds.length === 0 && template?.kind !== 'captain-patrol-command') || (!duel && friendlyActorIds.length === 0)) return undefined
  const mountState = parseMissionMountState(raw.mountState)
  const playerStats = parseMissionPlayerStats(raw.playerStats)
  const knownActorIds = new Set([...targetActorIds, ...allFriendlyActorIds,
    ...TOWN_WATCHTOWER_ARCHER_IDS, ...TOWN_WATCHTOWER_ARCHER_IDS.map(id => `enemy-town:${id}`), ...(siege || fourGateMission ? uniqueStrings(raw.civilianActorIds) : [])])
  const actorHealth = parseActorHealth(raw.actorHealth, knownActorIds)
  const arenaTrial = trialRoster ? parseArenaTrialState(raw.arenaTrial, { friendlyActorIds, targetActorIds }) : undefined
  if (trialRoster && (!arenaTrial || arenaTrial.tier !== trialTier)) return undefined
  const actorPositions = parseActorPositions(raw.actorPositions, knownActorIds)
  const engagedEnemySquadIds = parseEngagedEnemySquadIds(raw.engagedEnemySquadIds)
  const outpostBattleState = parseVeteranOutpostBattleState(raw.outpostBattleState)
  const outpostSiege = parseCampaignSiegeCheckpoint(raw.outpostSiege)
  if (raw.outpostSiege !== undefined && !outpostSiege) return undefined
  const commanderState = parseCommanderMissionState(raw.commanderMission, template?.kind, template?.id)
  if (commanderMission && (!commanderState || rank !== 'commander')) return undefined
  if (heavyMission && (!commanderState || !careerHeavyFieldMissionRankOk({ rank }, template!.id))) return undefined
  const officialSquad = parseOfficialCommandAuthority(raw.officialSquad)
  const acceptedOfficialSquad = officialSquad?.type === 'mission-official' && officialSquad.missionId === raw.id
    && officialSquad.townFaction === faction
    && (officialSquad.commandRank !== 'commander' || rank === 'commander')
    && officialSquad.actorIds.every(id => allFriendlyActorIds.includes(id)) ? officialSquad : undefined
  const personalSquad = parsePersonalMission(raw.personalSquad)
  const ctx: MissionParseContext = { raw, template, faction, rank, fourGateMission, targetActorIds, friendlyActorIds, knownActorIds,
    officialSquad, acceptedOfficialSquad, personalSquad }
  if (commanderMission && rejectsCommanderRoster(ctx)) return undefined
  const battle = parseCareerOutpostCheckpoint(raw.battle)
  const eagleBattle = parseCaptainEagleCheckpoint(raw.eagleBattle)
  const bridgeBattle = parseCaptainEagleCheckpoint(raw.bridgeBattle, BRIDGEHEAD_FRIENDLIES + BRIDGEHEAD_ENEMIES)
  const felineBattle = parseCaptainEagleCheckpoint(raw.felineBattle, FELINE_FRIENDLY_TOTAL + FELINE_ENEMY_TOTAL)
  const civilianActorIds = uniqueStrings(raw.civilianActorIds)
  const nativeCivilianIds = fourGateMission ? townRoster().filter(actor => actor.role === 'civilian').map(actor => actor.id) : []
  const fourGateDefense = fourGateMission ? parseCommanderFourGateDefenseState(raw.fourGateDefense, {
    missionId: raw.id, faction, phase: raw.phase as CareerMissionPhase, targetActorIds, friendlyActorIds, civilianActorIds,
    personalActorIds: personalSquad?.memberIds, personalActors: personalSquad?.members, deadTargetActorIds: uniqueStrings(raw.deadTargetActorIds),
  }) : undefined
  if (fourGateMission && rejectsFourGateDefense(ctx, fourGateDefense, commanderState, civilianActorIds, nativeCivilianIds)) return undefined
  const bridgeDeployment = parseBridgeDeployment(raw)
  if (template?.kind === 'commander-bridgehead-battle' && rejectsBridgehead(ctx, bridgeBattle, bridgeDeployment)) return undefined
  const felineFamily = template?.kind === COMMANDER_FELINE_CAVALRY_KIND || template?.kind === COMMANDER_IRON_LEGION_KIND
  if (felineFamily && rejectsFelineFamily(ctx, commanderState, felineBattle)) return undefined
  let heavyOfficialSquad = acceptedOfficialSquad
  if (heavyMission) {
    const heavy = resolveHeavyOfficialSquad(ctx, felineBattle)
    if (!heavy) return undefined
    heavyOfficialSquad = heavy.squad
  }
  const marchPosition = raw.mountedMarchPosition as { x?: unknown; z?: unknown } | undefined
  const mountedMarchPosition = marchPosition && typeof marchPosition.x === 'number' && Number.isFinite(marchPosition.x)
    && typeof marchPosition.z === 'number' && Number.isFinite(marchPosition.z) ? { x: marchPosition.x, z: marchPosition.z } : undefined

  const mission: ActiveCareerMission = {
    ...(siege ? { siege } : {}),
    ...(commanderState ? { commanderMission: commanderState } : {}),
    ...(fourGateDefense ? { fourGateDefense } : {}),
    id: raw.id,
    ...(heavyMission ? (heavyOfficialSquad ? { officialSquad: heavyOfficialSquad } : {}) : (acceptedOfficialSquad ? { officialSquad: acceptedOfficialSquad } : {})),
    ...(template?.kind === 'captain-patrol-command' ? parsePatrolFields(raw, officialSquad) : {}),
    ...(battle && template?.kind === 'captain-outpost-defense' ? { battle } : {}),
    ...(bridgeBattle && template?.kind === 'commander-bridgehead-battle' ? { bridgeBattle } : {}),
    ...(felineBattle && (felineFamily || heavyMission || migratedFieldMission) ? { felineBattle } : {}),
    ...(bridgeDeployment && template?.kind === 'commander-bridgehead-battle' ? { bridgeDeployment } : {}),
    ...(eagleBattle && template?.kind === 'captain-eagle-battle' ? { eagleBattle } : {}),
    templateId: duel ? CAREER_DUEL_TEMPLATE_ID : trialRoster ? raw.templateId as string : template!.id,
    kind: duel ? 'duel' : trialRoster ? 'arena-squad-trial' : template!.kind,
    ...(arenaTrial ? { arenaTrial } : {}),
    ...(arenaTrial?.tier === 1 && raw.storyEventId === 'veteran-squad-spar' ? { storyEventId: 'veteran-squad-spar' as const } : {}),
    targetCampId: raw.targetCampId as number,
    phase: raw.phase as CareerMissionPhase,
    targetActorIds,
    friendlyActorIds,
    deadTargetActorIds: uniqueStrings(raw.deadTargetActorIds).filter(id => targetActorIds.includes(id)),
    deadFriendlyActorIds: uniqueStrings(raw.deadFriendlyActorIds).filter(id => allFriendlyActorIds.includes(id)),
    deadCivilianActorIds: uniqueStrings(raw.deadCivilianActorIds).filter(id => uniqueStrings(raw.civilianActorIds).includes(id)),
    playerDead: raw.playerDead === true,
    ...(duelIdentity ? parseDuelFields(raw, faction, duelIdentity) : {}),
    ...(playerStats ? { playerStats } : {}),
    mountedMarchProgress: nonNegativeNumber(raw.mountedMarchProgress),
    ...(mountedMarchPosition ? { mountedMarchPosition } : {}),
    followVoicePlayed: raw.followVoicePlayed === true,
    sweepAlerted: raw.sweepAlerted === true,
    fieldFriendlyCharge: raw.fieldFriendlyCharge === true,
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
    ...(raw.veteranRosterVersion === 1 || raw.veteranRosterVersion === 2 || raw.veteranRosterVersion === 3 ? { veteranRosterVersion: raw.veteranRosterVersion } : {}),
    ...(actorHealth ? { actorHealth } : {}),
    ...(actorPositions ? { actorPositions } : {}),
    ...(engagedEnemySquadIds ? { engagedEnemySquadIds } : {}),
    ...(typeof raw.playerHp === 'number' && Number.isFinite(raw.playerHp) && raw.playerHp >= 0 ? { playerHp: raw.playerHp } : {}),
    ...(typeof raw.playerStamina === 'number' && Number.isFinite(raw.playerStamina) && raw.playerStamina >= 0 ? { playerStamina: raw.playerStamina } : {}),
    ...(outpostBattleState ? { outpostBattleState } : {}),
    ...(outpostSiege ? { outpostSiege } : {}),
    acceptedAt: nonNegativeInteger(raw.acceptedAt),
    ...(mountState ? { mountState } : {}),
    ...((template?.kind === 'town-defense' || template?.kind === 'enemy-town-assault'
      || template?.kind === 'commander-sky-raid' || fourGateMission) ? { civilianActorIds: uniqueStrings(raw.civilianActorIds) } : {}),
  }
  const result = parseMissionResult(raw)
  if (result) mission.result = result
  if (raw.prisonBreak !== undefined) {
    const prison = parsePrisonBreakState(raw.prisonBreak, mission)
    if (!prison) return undefined
    mission.prisonBreak = prison
  }
  if (personalSquad && mission.kind !== 'duel') mission.personalSquad = personalSquad
  if (mission.result && raw.result && typeof raw.result === 'object') {
    const meritStats = parseMissionPlayerStats((raw.result as Record<string, unknown>).meritStats)
    if (meritStats) mission.result.meritStats = { ...meritStats, survived: mission.result.stats.survived }
  }
  if (fourGateDefense && !reconcileFourGateResult(mission, fourGateDefense)) return undefined
  attachBorrowedIdentities(mission, raw, faction)
  return mission
}
