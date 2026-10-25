import { migrateCareerHealth } from './CareerHealthMigration'
import { hasCompleteRetirementMobilizationCheckpoint, parseRetirementActorCheckpoints } from './CareerRetirementMobilization'
import { parseCareerRetirementState, type CareerRetirementRuntime } from './CareerRetirementState'
import { parseEagleFlightSnapshot } from '../movement/EagleFlightController'
import { TOWN_WATCHTOWER_ARCHER_IDS } from '../town/TownNativeGuardIdentity'
import { BRIDGEHEAD_FRIENDLIES, BRIDGEHEAD_ENEMIES, BRIDGEHEAD_FRIENDLY_SQUADS, BRIDGEHEAD_SQUAD_SIZE, isBridgeheadEnemyCount } from '../battle/BridgeheadRosterConfig'
import { horseVariantFromSave } from '../world/HorseAssetRegistry'
import { commanderGateDefenseSlots, commanderTownCommandMembership } from './CommanderTownRoster'
import { COMMANDER_FOUR_GATE_DEFENSE_ID, commanderFourGateDefenseActorIds } from './CommanderFourGateDefenseRoster'
import { parseCommanderFourGateDefenseState } from './CommanderFourGateDefenseState'
import { townRoster } from '../town/TownRules'
import { MOUNTED_RACES, isRaceRider, parseRaceSession, parseRaceRecords, type RaceId } from './CareerRaceState'
import { grantCommanderMelee } from './CareerCommanderEquipment'
import { parseCampaignSiegeCheckpoint } from '../campaign/CampaignSiegeCheckpoint'
import { parseTownEquipment } from './CareerTownEquipmentState'
import { retireNativeTownAirCommand, parseTownAirCommandSquad } from './TownAirCommandAuthority'
import { parseCivilianCommandSquad } from './CivilianCommandAuthority'
import { parseEnemyEaglePatrolCheckpoint } from '../town/EnemyEaglePatrolState'
import { outskirtsSquadSpecs } from '../town/TownOutskirtsRules'
import type { CareerDuelTier } from './CareerDuelState'
import { parseTownOutskirtsCheckpoint } from '../town/TownOutskirtsWarfareController'
import { parseTownPatrolCheckpoint } from '../town/TownPatrolCheckpoint'
import { parseOfficialCommandAuthority, parseTownCommandSquad } from './CareerCommandAuthority'
import { parseCaptainEagleCheckpoint } from './CaptainEagleCheckpoint'
import { parseTownEagleGarrisons } from '../town/TownEagleGarrisonState'
import { parseCareerAerialState } from './CareerAerialState'
import { canonicalInventoryId, normalizeCareerInventory, type CareerInventory } from './CareerInventory'
import { parsePersonalSquad } from './CareerPersonalSquad'
import { isCareerOutpostStageId, parseCareerOutpostCheckpoint, type CareerOutpostMission, type CareerOutpostRecord } from './CareerOutpostMission'
import { emptyPersonalContribution, parsePersonalMission } from './CareerPersonalSquadMission'
import { createCareerOutpostCommandSquads } from './CareerOutpostRoster'
import { PLAYER_MOUNT_IDS, type PlayerMountId } from '../battle/BattleConfig'
import { UNIT_PRESETS, type UnitPresetId } from '../battle/UnitPresetCatalog'
import { ARMORS } from '../rpg/ArmorDatabase'
import { WEAPONS } from '../rpg/WeaponDatabase'
import { normalizeSkillState, type SkillStateInput } from '../rpg/SkillManager'
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
import { BRIDGEHEAD_PREPARATION_SECONDS, type ActiveCareerMission, type CareerMissionPhase, type CommanderMissionState, type VeteranOutpostBattleState } from './CareerMissionState'
import { CAREER_DUEL_TEMPLATE_ID, DUEL_COUNTDOWN_SECONDS, DUEL_COMBAT_SECONDS, isCareerDuelPresetId, isCareerDuelTier, parseCareerDuelCommanderHome, parseCareerDuelTravelCheckpoint } from './CareerDuelState'

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

const MISSION_PHASES: CareerMissionPhase[] = ['DEPLOYING', 'ASSEMBLING', 'MARCHING', 'ENGAGING', 'RETURNING', 'PREPARING', 'SPAWNING', 'ATTACKING', 'VICTORY_LOCKED', 'FAILURE_LOCKED', 'RESET', 'RESULT']
const CAREER_MOUNT_IDS: CareerMountId[] = ['horse', 'horse-t1', 'horse-t2', 'horse-t3', 'black-cat', 'corgi', 'snow-leopard', 'xongkoro']

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
    mount = { position: { ...saved.position }, hp: saved.hp, ...(flight ? { flight } : {}) }
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

function parseCommanderMissionState(value: unknown, expectedKind: ActiveCareerMission['kind']): CommanderMissionState | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  if (raw.version !== 1 || raw.kind !== expectedKind
    || expectedKind === 'commander-four-gate-defense' && typeof raw.deploymentComplete !== 'boolean'
    || !['commander-sky-raid', 'commander-decapitation', 'commander-outpost-last-stand', 'commander-bridgehead-battle', 'commander-four-gate-defense'].includes(raw.kind as string)) return undefined
  const position = raw.playerPosition as Record<string, unknown> | undefined
  const playerPosition = position && typeof position.x === 'number' && Number.isFinite(position.x)
    && typeof position.z === 'number' && Number.isFinite(position.z)
    && typeof position.yaw === 'number' && Number.isFinite(position.yaw)
    ? { x: position.x, z: position.z, yaw: position.yaw } : undefined
  return { version: 1, kind: raw.kind as CommanderMissionState['kind'], deploymentComplete: raw.deploymentComplete === true,
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

function parseActiveMission(value: unknown, faction: CareerProfile['faction'], rank: CareerProfile['rank']): ActiveCareerMission | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const template = typeof raw.templateId === 'string' ? getCareerMissionTemplate(raw.templateId) : null
  const fourGateMission = template?.kind === 'commander-four-gate-defense'
  // Reject malformed roster data before normalization can hide duplicates or unbounded arrays.
  if (fourGateMission && (raw.kind !== 'commander-four-gate-defense' || typeof raw.id !== 'string' || raw.id.length > 130
    || !['targetActorIds', 'friendlyActorIds', 'civilianActorIds'].every(key => Array.isArray(raw[key])
      && (raw[key] as unknown[]).length <= 1024 && (raw[key] as unknown[]).every(id => typeof id === 'string' && id.trim() === id && id.length <= 200)
      && new Set(raw[key] as unknown[]).size === (raw[key] as unknown[]).length)
    || ['deadTargetActorIds', 'deadFriendlyActorIds', 'deadCivilianActorIds'].some(key => raw[key] !== undefined
      && (!Array.isArray(raw[key]) || (raw[key] as unknown[]).length > 1024
        || (raw[key] as unknown[]).some(id => typeof id !== 'string' || id.trim() !== id || id.length > 200)
        || new Set(raw[key] as unknown[]).size !== (raw[key] as unknown[]).length)))) return undefined
  const siege = parseSiege(raw.siege)
  if ((raw.kind === 'town-defense' || raw.kind === 'enemy-town-assault') && !siege) return undefined
  const duel = raw.kind === 'duel' && raw.templateId === CAREER_DUEL_TEMPLATE_ID
  const duelOpponentActorId = typeof raw.duelOpponentActorId === 'string' ? raw.duelOpponentActorId.trim() : ''
  const duelCaptainActorId = typeof raw.duelCaptainActorId === 'string' ? raw.duelCaptainActorId.trim() : ''
  const duelRefereeActorId = typeof raw.duelRefereeActorId === 'string' ? raw.duelRefereeActorId.trim() : duelCaptainActorId
  if (duel && (!isCareerDuelTier(raw.duelTier) || !isCareerDuelPresetId(raw.duelPresetId)
    || UNIT_PRESETS[raw.duelPresetId].faction !== faction || !duelOpponentActorId || !duelCaptainActorId || !duelRefereeActorId)) return undefined
  if (duel && raw.duelTier === 5 && (duelOpponentActorId !== 'commander' || duelCaptainActorId !== 'captain'
    || duelRefereeActorId !== duelCaptainActorId)) return undefined
  const outpostMission = template?.kind === 'veteran-outpost-defense' || template?.kind === 'veteran-outpost-assault' || template?.kind === 'captain-outpost-defense'
  const captainStandalone = template?.kind === 'captain-patrol-command' || template?.kind === 'captain-eagle-battle'
  const commanderMission = Boolean(template?.id.startsWith('commander-'))
  if (
    typeof raw.id !== 'string' || !raw.id
    || (!template && !duel)
    || !Number.isInteger(raw.targetCampId) || ((duel || template?.kind === 'town-defense' || template?.kind === 'enemy-town-assault' || outpostMission || captainStandalone || commanderMission)
      ? raw.targetCampId !== -1
      : (raw.targetCampId as number) < 0 || (raw.targetCampId as number) > 4)
    || !MISSION_PHASES.includes(raw.phase as CareerMissionPhase) || raw.phase === 'SPAWNING' && !fourGateMission
  ) return undefined
  const targetActorIds = duel ? [duelOpponentActorId] : uniqueStrings(raw.targetActorIds)
  const friendlyActorIds = duel ? (duelRefereeActorId === duelOpponentActorId ? [] : [duelRefereeActorId]) : uniqueStrings(raw.friendlyActorIds)
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
  const actorPositions = parseActorPositions(raw.actorPositions, knownActorIds)
  const engagedEnemySquadIds = parseEngagedEnemySquadIds(raw.engagedEnemySquadIds)
  const outpostBattleState = parseVeteranOutpostBattleState(raw.outpostBattleState)
  const outpostSiege = parseCampaignSiegeCheckpoint(raw.outpostSiege)
  if (raw.outpostSiege !== undefined && !outpostSiege) return undefined
  const commanderState = parseCommanderMissionState(raw.commanderMission, template?.kind)
  if (commanderMission && (!commanderState || rank !== 'commander')) return undefined
  const officialSquad = parseOfficialCommandAuthority(raw.officialSquad)
  const acceptedOfficialSquad = officialSquad?.type === 'mission-official' && officialSquad.missionId === raw.id
    && officialSquad.townFaction === faction
    && (officialSquad.commandRank !== 'commander' || rank === 'commander')
    && officialSquad.actorIds.every(id => allFriendlyActorIds.includes(id)) ? officialSquad : undefined
  if (commanderMission) {
    const rosterVersion = (raw.fourGateDefense as { rosterVersion?: unknown } | undefined)?.rosterVersion ?? 1
    if (fourGateMission && rosterVersion !== 1 && rosterVersion !== 2) return undefined
    const nativeSquads = fourGateMission ? commanderGateDefenseSlots(undefined, rosterVersion as 1 | 2) : []
    const nativeActorIds = nativeSquads.flatMap(squad => squad.actorIds)
    const expectedFriendly = fourGateMission ? nativeActorIds.length : template?.kind === 'commander-sky-raid' ? 50
      : template?.kind === 'commander-decapitation' ? 30 : template?.kind === 'commander-bridgehead-battle' ? BRIDGEHEAD_FRIENDLIES : 120
    const exactTargets = fourGateMission ? new Set(commanderFourGateDefenseActorIds(raw.id)) : undefined
    const validTargets = exactTargets ? targetActorIds.length === exactTargets.size && targetActorIds.every(id => exactTargets.has(id))
      : template?.kind === 'commander-sky-raid' ? targetActorIds.length >= 100
      : template?.kind === 'commander-decapitation' ? targetActorIds.length === 1 && targetActorIds[0] === 'commander'
      : template?.kind === 'commander-bridgehead-battle' ? isBridgeheadEnemyCount(targetActorIds.length) : targetActorIds.length === 100
    if (!acceptedOfficialSquad || acceptedOfficialSquad.commandRank !== 'commander'
      || friendlyActorIds.length !== expectedFriendly || acceptedOfficialSquad.actorIds.length !== expectedFriendly
      || !friendlyActorIds.every(id => acceptedOfficialSquad.actorIds.includes(id)) || !validTargets) return undefined
    if (fourGateMission && (friendlyActorIds.some(id => !nativeActorIds.includes(id))
      || acceptedOfficialSquad.squads?.length !== nativeSquads.length
      || nativeSquads.some(expected => {
        const saved = acceptedOfficialSquad.squads?.find(squad => squad.squadId === expected.squadId)
        return !saved || saved.actorIds.length !== expected.actorIds.length || saved.actorIds.some(id => !expected.actorIds.includes(id))
      }))) return undefined
  }
  const battle = parseCareerOutpostCheckpoint(raw.battle)
  const eagleBattle = parseCaptainEagleCheckpoint(raw.eagleBattle)
  const bridgeBattle = parseCaptainEagleCheckpoint(raw.bridgeBattle, BRIDGEHEAD_FRIENDLIES + BRIDGEHEAD_ENEMIES)
  const personalSquad = parsePersonalMission(raw.personalSquad)
  const civilianActorIds = uniqueStrings(raw.civilianActorIds)
  const nativeCivilianIds = fourGateMission ? townRoster().filter(actor => actor.role === 'civilian').map(actor => actor.id) : []
  const fourGateDefense = fourGateMission ? parseCommanderFourGateDefenseState(raw.fourGateDefense, {
    missionId: raw.id, faction, phase: raw.phase as CareerMissionPhase, targetActorIds, friendlyActorIds, civilianActorIds,
    personalActorIds: personalSquad?.memberIds, personalActors: personalSquad?.members, deadTargetActorIds: uniqueStrings(raw.deadTargetActorIds),
  }) : undefined
  if (fourGateMission && (!fourGateDefense || commanderState?.deploymentComplete !== fourGateDefense.deploymentComplete
    || civilianActorIds.length !== nativeCivilianIds.length || civilianActorIds.some(id => !nativeCivilianIds.includes(id))
    || uniqueStrings(raw.deadFriendlyActorIds).some(id => !friendlyActorIds.includes(id))
    || uniqueStrings(raw.deadCivilianActorIds).some(id => !civilianActorIds.includes(id))
    || raw.personalSquad !== undefined && !personalSquad)) return undefined
  const rawBridgeDeployment = raw.bridgeDeployment as Record<string, unknown> | undefined
  const bridgeDeployment = rawBridgeDeployment && ['preparing', 'spawning', 'assault'].includes(rawBridgeDeployment.phase as string)
    && typeof rawBridgeDeployment.preparationRemainingSeconds === 'number' && Number.isFinite(rawBridgeDeployment.preparationRemainingSeconds)
    && rawBridgeDeployment.preparationRemainingSeconds >= 0 && rawBridgeDeployment.preparationRemainingSeconds <= BRIDGEHEAD_PREPARATION_SECONDS
    && (rawBridgeDeployment.phase === 'preparing' || rawBridgeDeployment.preparationRemainingSeconds === 0)
    ? { phase: rawBridgeDeployment.phase as 'preparing' | 'spawning' | 'assault', preparationRemainingSeconds: rawBridgeDeployment.preparationRemainingSeconds }
    : undefined
  if (template?.kind === 'commander-bridgehead-battle' && (
    raw.bridgeBattle !== undefined && !bridgeBattle
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
          && personalSquad.members[bridgeBattle.player.mountActorId]?.mount)))) return undefined
  const marchPosition = raw.mountedMarchPosition as { x?: unknown; z?: unknown } | undefined
  const mountedMarchPosition = marchPosition && typeof marchPosition.x === 'number' && Number.isFinite(marchPosition.x)
    && typeof marchPosition.z === 'number' && Number.isFinite(marchPosition.z) ? { x: marchPosition.x, z: marchPosition.z } : undefined

  const mission: ActiveCareerMission = {
    ...(siege ? { siege } : {}),
    ...(commanderState ? { commanderMission: commanderState } : {}),
    ...(fourGateDefense ? { fourGateDefense } : {}),
    id: raw.id,
    ...(acceptedOfficialSquad ? { officialSquad: acceptedOfficialSquad } : {}),
    ...(template?.kind === 'captain-patrol-command' ? { patrolKilledActorIds: uniqueStrings(raw.patrolKilledActorIds),
      ...(raw.patrolReturnStates && typeof raw.patrolReturnStates === 'object' ? { patrolReturnStates: Object.fromEntries(
        Object.entries(raw.patrolReturnStates).filter(([id, state]) => officialSquad?.actorIds.includes(id)
          && (state === 'RETURN_TO_BARRACKS' || state === 'REFIT' || state === 'REJOIN_PATROL')),
      ) as ActiveCareerMission['patrolReturnStates'] } : {}),
      ...(parseTownOutskirtsCheckpoint(raw.patrolOutskirts) ? { patrolOutskirts: parseTownOutskirtsCheckpoint(raw.patrolOutskirts) } : {}),
      ...(parseOfficialCommandAuthority(raw.patrolAmbient) ? { patrolAmbient: parseOfficialCommandAuthority(raw.patrolAmbient) } : {}),
    } : {}),
    ...(battle && template?.kind === 'captain-outpost-defense' ? { battle } : {}),
    ...(bridgeBattle && template?.kind === 'commander-bridgehead-battle' ? { bridgeBattle } : {}),
    ...(bridgeDeployment && template?.kind === 'commander-bridgehead-battle' ? { bridgeDeployment } : {}),
    ...(eagleBattle && template?.kind === 'captain-eagle-battle' ? { eagleBattle } : {}),
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
      duelTier: raw.duelTier as CareerDuelTier,
      ...(raw.duelTier === 5 ? { duelCommanderHome: parseCareerDuelCommanderHome(raw.duelCommanderHome),
        duelTravel: parseCareerDuelTravelCheckpoint(raw.duelTravel, [duelOpponentActorId, duelCaptainActorId]) } : {}),
      duelPresetId: raw.duelPresetId as UnitPresetId,
      duelOpponentActorId, duelCaptainActorId, duelRefereeActorId,
      duelCountdownElapsed: Math.min(DUEL_COUNTDOWN_SECONDS, nonNegativeNumber(raw.duelCountdownElapsed)),
      duelCombatElapsed: Math.min(DUEL_COMBAT_SECONDS, nonNegativeNumber(raw.duelCombatElapsed)),
      duelOpponentDead: raw.duelOpponentDead === true || uniqueStrings(raw.deadTargetActorIds).includes(duelOpponentActorId),
      ...(typeof raw.duelOpponentMaxHp === 'number' && Number.isFinite(raw.duelOpponentMaxHp) && raw.duelOpponentMaxHp > 0 ? { duelOpponentMaxHp: raw.duelOpponentMaxHp } : {}),
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
  if (personalSquad && mission.kind !== 'duel') mission.personalSquad = personalSquad
  if (mission.result && raw.result && typeof raw.result === 'object') {
    const meritStats = parseMissionPlayerStats((raw.result as Record<string, unknown>).meritStats)
    if (meritStats) mission.result.meritStats = { ...meritStats, survived: mission.result.stats.survived }
  }
  if (fourGateDefense) {
    if ((fourGateDefense.phase === 'RESULT') !== Boolean(mission.result)
      || mission.result?.outcome === 'failure' && fourGateDefense.victoryReason !== undefined) return undefined
    if (mission.result?.outcome === 'victory') {
      if (!fourGateDefense.deploymentComplete || !fourGateDefense.attackStarted) return undefined
      if (fourGateDefense.victoryReason !== 'survival') {
        if (mission.deadTargetActorIds?.length !== mission.targetActorIds.length
          || mission.targetActorIds.some(id => fourGateDefense.actors[id]?.status !== 'dead')) return undefined
        // Old victories predate the explicit reason and can only represent elimination.
        fourGateDefense.victoryReason = 'elimination'
      }
    }
  }
  return mission
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
  // A prepared live finale must never migrate by healing fresh player resources.
  // Preserve receiptless legacy records; runtime refuses to start their ambush.
  if (careerRetirement?.phase === 'final-stand' && careerRetirement.mobilization && !retirementRuntime) return null
  if (raw.inventory !== undefined && (!raw.inventory || typeof raw.inventory !== 'object'
    || (raw.inventory as CareerInventory).version !== 1 || !(raw.inventory as CareerInventory).quantities
    || typeof (raw.inventory as CareerInventory).quantities !== 'object' || Array.isArray((raw.inventory as CareerInventory).quantities))) return null
  let townEquipment: CareerProfile['townEquipment']
  try { townEquipment = parseTownEquipment(raw.townEquipment) } catch { return null }
  let personalSquad: CareerProfile['personalSquad']
  try { personalSquad = parsePersonalSquad(raw.personalSquad) } catch { return null }

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
  // An ending checkpoint belongs only to a formally appointed, valid Commander.
  if (careerRetirement && rank !== 'commander') return null
  const equipment = raw.equipment && typeof raw.equipment === 'object' ? raw.equipment as Record<string, unknown> : null
  const townEvent = raw.townEvent as CareerProfile['townEvent']
  const activeRace = raw.activeRace === undefined ? undefined : parseRaceSession(raw.activeRace)
  const raceRecords = raw.raceRecords === undefined ? undefined : parseRaceRecords(raw.raceRecords)
  // Invalid in-flight races must never be silently discarded into a fresh Town.
  if (raw.racePlayerState !== undefined && !isRaceRider(raw.racePlayerState)) return null
  if (activeRace === null || raceRecords === null || activeRace && (raw.activeMission || raw.activeOutpostMission)) return null
  const activeMission = parseActiveMission(raw.activeMission, raw.faction, rank)
  const savedMission = raw.activeMission as Partial<ActiveCareerMission> | undefined
  // Never silently turn a rejected in-flight Commander V checkpoint into a peaceful Town.
  if ((savedMission?.kind === 'commander-four-gate-defense' || savedMission?.templateId === COMMANDER_FOUR_GATE_DEFENSE_ID)
    && !activeMission?.fourGateDefense) return null
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
    faction: raw.faction,
    totalMerit,
    availableMerit,
    rank,
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
    horseAppearanceVariant: horseVariantFromSave(raw.horseAppearanceVariant),
    ...(selectedMountId ? { selectedMountId } : {}),
    ...(isRaceRider(raw.racePlayerState) ? { racePlayerState: structuredClone(raw.racePlayerState) } : {}),
    ...(activeRace ? { activeRace } : {}),
    ...(raceRecords ? { raceRecords } : {}),
    ...(Array.isArray(raw.completedRaceIds) ? { completedRaceIds: MOUNTED_RACES.filter(r => (raw.completedRaceIds as unknown[]).includes(r.id)).map(r => r.id) } : {}),
    ...(raw.raceBestSeconds && typeof raw.raceBestSeconds === 'object' ? { raceBestSeconds: Object.fromEntries(MOUNTED_RACES.flatMap(r => {
      const seconds = (raw.raceBestSeconds as Record<RaceId, unknown>)[r.id]
      return typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0 ? [[r.id, seconds]] : []
    })) } : {}),
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
    ...(raw.townCommanderRecovery && typeof raw.townCommanderRecovery === 'object'
      && ['roman', 'viking'].includes((raw.townCommanderRecovery as Record<string, unknown>).faction as string)
      && parseCareerDuelCommanderHome(raw.townCommanderRecovery)
      ? { townCommanderRecovery: { ...parseCareerDuelCommanderHome(raw.townCommanderRecovery)!,
        faction: (raw.townCommanderRecovery as Record<string, unknown>).faction as CareerProfile['faction'] } } : {}),
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
      const rangerMigration = profile && profile.personalSquad?.members.some(member => member.type === 'ranger'
        && previous.personalSquad?.members.find(saved => saved.id === member.id)?.rangerEquipmentVersion !== 1)
      // Resident and Ranger receipts are independent: either may already be current
      // when the other migration runs. Publish both together only after one save.
      const residentMigration = profile && (['roman', 'viking'] as const).some(faction =>
        profile.townEquipment?.[faction]?.residentEquipmentVersion === 1
        && previous.townEquipment?.[faction]?.residentEquipmentVersion !== 1)
      const commanderShieldMigration = profile && (['roman', 'viking'] as const).some(faction =>
        profile.townEquipment?.[faction]?.commanderShieldItemId !== undefined
        && previous.townEquipment?.[faction]?.commanderShieldItemId === undefined)
      if (profile && (profile.healthRulesVersion !== previous.healthRulesVersion || residentMigration || rangerMigration || commanderShieldMigration || profile.commanderMeleeGranted && previous.commanderMeleeGranted !== true)
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
      const parsed = parseCareerProfile(profile)
      if (!parsed) return false
      if (profile.activeMission?.outpostSiege && !parsed.activeMission?.outpostSiege
        || profile.activeMission?.battle?.outpostSiege && !parsed.activeMission?.battle?.outpostSiege
        || profile.activeOutpostMission?.battle?.outpostSiege && !parsed.activeOutpostMission?.battle?.outpostSiege) return false
      if (profile.townAirCommandSquad && !parsed.townAirCommandSquad) return false
      if (profile.townCommandSquad?.commandRank === 'commander'
        && parsed.townCommandSquad?.commandRank !== 'commander') return false
      // A rejected expanded grant must not look like a successful ownership commit.
      if (profile.activeMission?.officialSquad?.commandRank === 'commander'
        && !parsed.activeMission?.officialSquad) return false
      if (profile.activeOutpostMission?.officialSquad?.commandRank === 'commander'
        && !parsed.activeOutpostMission?.officialSquad) return false
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
