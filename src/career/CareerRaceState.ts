import { TOWN_COMMANDER_ID } from '../town/TownCommanderIdentity'
import { canAllocateCareerItemToPlayer } from './CareerInventory'
import type { CareerMountId, CareerProfile } from './CareerProfile'
import { canonicalCareerMountId, cloneCareerProfile } from './CareerProfile'
import { illegalTownCrossing, insideRaceTown, legalRaceStart, lineCrossing, RACE_LINES, type RacePosition } from './CareerRaceRoute'
import { releaseCareerStoryEvent, settleCareerStoryEvent } from './CareerStoryEvents'

export type RaceMountId = 'horse' | 'armored-horse' | 'corgi' | 'black-cat' | 'white-cat' | 'orange-cat' | 'serval' | 'caracal' | 'snow-leopard'
export type RaceId = 'race-1' | 'race-2' | 'race-3' | 'race-4' | 'race-5' | 'race-6'
export type RaceScheduleVersion = 3
export const RACE_SCHEDULE_VERSION = 3 as const
export type RaceOutcome = 'win' | 'loss' | 'draw'

export const RACE_MOUNT_NAMES: Readonly<Record<RaceMountId, string>> = {
  horse: '戰馬',
  'armored-horse': '重甲戰馬',
  corgi: '柯基',
  'black-cat': '黑貓',
  'white-cat': '白貓',
  'orange-cat': '橘貓',
  serval: '藪貓',
  caracal: '獰貓',
  'snow-leopard': '重甲雪豹',
}

export interface MountedRaceDefinition {
  readonly id: RaceId
  readonly name: string
  readonly mount: RaceMountId
  readonly opponents?: readonly RaceMountId[]
  readonly sprint: boolean
  readonly merit: number
}

export const MOUNTED_RACES: readonly MountedRaceDefinition[] = [
  { id: 'race-1', name: 'Race I', mount: 'horse', sprint: true, merit: 100 },
  { id: 'race-2', name: 'Race II', mount: 'orange-cat', sprint: true, merit: 400 },
  { id: 'race-3', name: 'Race III', mount: 'corgi', sprint: true, merit: 900 },
  { id: 'race-4', name: 'Race IV', mount: 'snow-leopard', sprint: true, merit: 1600 },
  { id: 'race-5', name: 'Race V', mount: 'black-cat', opponents: ['black-cat', 'white-cat'], sprint: true, merit: 2500 },
  { id: 'race-6', name: 'Race VI', mount: 'serval', opponents: ['serval', 'caracal'], sprint: true, merit: 3600 },
]

export function pickRaceOpponentMount(definition: MountedRaceDefinition, random: () => number = Math.random): RaceMountId {
  const pool = definition.opponents ?? [definition.mount]
  if (pool.length <= 1) return definition.mount
  const index = Math.min(pool.length - 1, Math.max(0, Math.floor(random() * pool.length)))
  return pool[index]
}

export function raceStageOpponentLabel(definition: MountedRaceDefinition): string {
  const pool = definition.opponents ?? [definition.mount]
  return pool.map(id => RACE_MOUNT_NAMES[id]).join('／')
}

export function raceDefinitionForSchedule(id: unknown, scheduleVersion: unknown): MountedRaceDefinition | undefined {
  return scheduleVersion === RACE_SCHEDULE_VERSION ? MOUNTED_RACES.find(race => race.id === id) : undefined
}
export interface RaceRider {
  actorId: string
  mountId: RaceMountId
  position: RacePosition
  mountPosition: RacePosition
  hp: number
  mountArmorImpact?: number
  mountHp: number
  stamina: number
  mounted: boolean
  dead: boolean
  checkpoint: number
  /** Last progression sample, kept separate from snapshots taken by other actor updates. */
  routePosition?: RacePosition
  finishSeconds?: number
  dnf?: string
}
export interface RaceReferee {
  position: RacePosition
  hp: number
  mountArmorImpact?: number
  mountHp?: number
  mountPosition?: RacePosition
  mounted: boolean
}
export type RaceStoryId = 'commander-circuit-race'
export const RACE_STORY_ID: RaceStoryId = 'commander-circuit-race'
/** The invitation runs the first circuit as a sprint race. */
export const RACE_STORY_RACE_ID: RaceId = 'race-1'
export interface CareerRaceSession {
  version: 1
  deployed: boolean
  id: string
  raceId: RaceId
  /** Captured by the current acceptance writer. */
  scheduleVersion: RaceScheduleVersion
  /** Set only when the invitation was accepted at the Commander; ordinary entries never carry it. */
  story?: RaceStoryId
  phase: 'guiding' | 'countdown' | 'racing' | 'finishing' | 'result' | 'returning'
  countdownSeconds: number
  elapsedSeconds: number
  gameSeconds: number
  startedAtSeconds?: number
  phaseSeconds: number
  player: RaceRider
  opponent: RaceRider
  referee?: RaceReferee
  /** Captured native Commander resources, restored when the race ends. */
  opponentHome?: RaceReferee
  opponentAmmo?: number
  waypoint: number
  result?: RaceOutcome
  reason?: string
  guideFallback?: string
}
/** Story races are sprint-enabled. Ordinary races retain their saved schedule's sprint rule. */
export function raceOpponentCanSprint(session: Pick<CareerRaceSession, 'raceId' | 'scheduleVersion' | 'story'>): boolean {
  return session.story === RACE_STORY_ID || Boolean(raceDefinitionForSchedule(session.raceId, session.scheduleVersion)?.sprint)
}

export interface CareerRaceRecord {
  sessionId: string
  raceId: RaceId
  scheduleVersion: RaceScheduleVersion
  story?: RaceStoryId
  result: RaceOutcome
  legalFinish: boolean
  playerSeconds?: number
  opponentSeconds?: number
  merit: number
}
/** Spawn finalization must fail unless its initial race checkpoint is durable. */
export function finalizeRaceDeployment(session: CareerRaceSession, save: () => boolean): void {
  const deployed = session.deployed
  session.deployed = true
  try {
    if (!save()) throw new Error('賽手部署狀態保存失敗；重新載入可重試同場賽事。')
  } catch (error) {
    session.deployed = deployed
    throw error
  }
}
export interface RaceMountEligibility {
  id: CareerMountId | null
  ownedActive: boolean
  mounted: boolean
  dead: boolean
  hp: number
  airborne: boolean
  legal: boolean
}
interface RaceCommanderCandidate {
  spec: { id: string }
  npc: { dead: boolean; hostileToPlayer: boolean; isFalling: boolean; mount?: { isAirborne: boolean } | null }
}
/** Borrow the native resident, never substitute a random cavalryman when he is unavailable. */
export function selectRaceCommander<T extends RaceCommanderCandidate>(residents: readonly T[]): T | undefined {
  return residents.find(r => r.spec.id === TOWN_COMMANDER_ID && !r.npc.dead && !r.npc.hostileToPlayer && !r.npc.isFalling && !r.npc.mount?.isAirborne)
}
/** Rank-independent racing policy; the mount adapter supplies existing legal-use rules. */
export function canEnterRace(profile: CareerProfile, mount: RaceMountEligibility): boolean {
  return !profile.activeRace && !profile.activeMission && !profile.activeOutpostMission
    && mount.id !== null && canonicalCareerMountId(mount.id) !== 'xongkoro'
    && mount.ownedActive && mount.legal && mount.mounted && !mount.dead && mount.hp > 0 && !mount.airborne
    && canAllocateCareerItemToPlayer(profile, mount.id)
}
export function raceRecordProfile(profile: CareerProfile, session: CareerRaceSession): CareerProfile {
  const next = cloneCareerProfile(profile)
  next.activeRace = structuredClone(session)
  if (!session.result || session.phase === 'finishing' || next.raceRecords?.some(record => record.sessionId === session.id)) return next
  let merit = session.result === 'win' ? raceDefinitionForSchedule(session.raceId, session.scheduleVersion)!.merit : 0
  // The invitation's fixed award replaces the ordinary one in this same save. A draw returns the invitation unused.
  let story: RaceStoryId | undefined
  if (session.story && session.raceId === RACE_STORY_RACE_ID) {
    if (session.result === 'draw') releaseCareerStoryEvent(next, session.story, session.id)
    else {
      const fixed = settleCareerStoryEvent(next, session.story, session.id, session.result === 'win' ? 'victory' : 'defeat')
      if (fixed !== null) { merit = fixed; story = session.story }
    }
  }
  const record: CareerRaceRecord = { sessionId: session.id, raceId: session.raceId, result: session.result, merit,
    ...(story ? { story } : {}),
    scheduleVersion: session.scheduleVersion,
    legalFinish: session.player.finishSeconds !== undefined,
    ...(session.player.finishSeconds !== undefined ? { playerSeconds: session.player.finishSeconds } : {}),
    ...(session.opponent.finishSeconds !== undefined ? { opponentSeconds: session.opponent.finishSeconds } : {}) }
  next.raceRecords = [...(next.raceRecords ?? []), record]
  next.totalMerit += merit
  next.availableMerit += merit
  if (session.scheduleVersion === RACE_SCHEDULE_VERSION) {
    next.raceScheduleVersion = RACE_SCHEDULE_VERSION
    if (record.playerSeconds !== undefined) next.raceBestSeconds = { ...next.raceBestSeconds,
      [record.raceId]: Math.min(next.raceBestSeconds?.[record.raceId] ?? Infinity, record.playerSeconds) }
    if (record.result === 'win') next.completedRaceIds = [...new Set([...(next.completedRaceIds ?? []), record.raceId])]
  }
  return next
}
/**
 * LAN co-op: the guest whose legal finish beats every other guest's, the player's and the opponent's;
 * only then is the race that guest's. Null while nobody qualifies or once the race is decided.
 */
export function coopGuestRaceWinner<T extends { seconds: number | undefined }>(session: CareerRaceSession, guests: readonly T[]): T | null {
  if (session.result) return null
  let best: T | null = null
  for (const guest of guests) if (guest.seconds !== undefined && (!best || guest.seconds < best.seconds!)) best = guest
  if (!best) return null
  const seconds = best.seconds!
  return (session.player.finishSeconds === undefined || seconds < session.player.finishSeconds)
    && (session.opponent.finishSeconds === undefined || seconds < session.opponent.finishSeconds) ? best : null
}
export function lockRace(session: CareerRaceSession, result: RaceOutcome, reason: string): void {
  if (session.result) return
  session.result = result; session.reason = reason; session.phase = 'result'; session.phaseSeconds = 0
}
export function raceRiderDone(rider: RaceRider): boolean {
  return rider.finishSeconds !== undefined || rider.dead || Boolean(rider.dnf)
}
export function raceIsRunning(session: CareerRaceSession): boolean {
  return session.phase === 'racing' || session.phase === 'finishing'
}
/** Lock the winner immediately; keep the trailing rider running to collect both finish times. */
export function resolveRace(session: CareerRaceSession): void {
  const a = session.player, b = session.opponent
  if (session.result) {
    if (session.phase === 'finishing' && raceRiderDone(a) && raceRiderDone(b)) { session.phase = 'result'; session.phaseSeconds = 0 }
    return
  }
  if (a.finishSeconds !== undefined || b.finishSeconds !== undefined) {
    lockRace(session, a.finishSeconds === b.finishSeconds ? 'draw'
      : a.finishSeconds !== undefined && (b.finishSeconds === undefined || a.finishSeconds < b.finishSeconds) ? 'win' : 'loss', '合法完賽')
    if (!raceRiderDone(a) || !raceRiderDone(b)) session.phase = 'finishing'
  } else if ((a.dead || a.dnf) && (b.dead || b.dnf)) lockRace(session, 'draw', '雙方皆無法合法完賽')
}
export function advanceRaceRider(rider: RaceRider, previous: RacePosition, elapsed: number, dt: number,
  legalSegment: boolean, maximumSpeed: number, mountingDistance = 0): void {
  if (rider.finishSeconds !== undefined || rider.dnf || rider.dead) return
  previous = rider.routePosition ?? previous
  // The racer must follow the route, but can continue on foot or another mount.
  // A nearby mount interaction moves the rider to its seat once; still validate the swept route.
  if (!legalSegment || Math.hypot(rider.position.x - previous.x, rider.position.z - previous.z) > maximumSpeed * dt + 1.5 + mountingDistance
    || illegalTownCrossing(previous, rider.position, rider.checkpoint)) rider.dnf = '不合法路線或位移'
  if (rider.dnf) return
  rider.routePosition = { ...rider.position }
  const crossing = lineCrossing(previous, rider.position, RACE_LINES[rider.checkpoint], rider.checkpoint > 0 && rider.checkpoint < 4)
  if (!crossing) return
  rider.checkpoint++
  if (rider.checkpoint === RACE_LINES.length) rider.finishSeconds = elapsed - dt + crossing.t * dt
}
/** Losing the referee changes guidance, never the session or town-event outcome. */
export function updateRaceGuidance(session: CareerRaceSession, available: boolean, attacked: boolean): void {
  if ((session.phase === 'guiding' || session.phase === 'countdown') && (!available || attacked || session.phaseSeconds > 180))
    session.guideFallback = 'Captain 無法繼續引導，請依箭頭自行前往北門；賽事繼續。'
}
export function advanceRaceClock(session: CareerRaceSession, dt: number, ready: boolean): void {
  if (session.result && session.phase !== 'finishing' || !Number.isFinite(dt) || dt < 0) return
  session.gameSeconds += dt
  session.phaseSeconds += dt
  if (session.phase === 'guiding') {
    if (ready) { session.phase = 'countdown'; session.countdownSeconds = 10; session.phaseSeconds = 0 }
  } else if (session.phase === 'countdown') {
    session.countdownSeconds = Math.max(0, session.countdownSeconds - dt)
    if (session.countdownSeconds === 0) {
      if (!session.player.dead && !session.player.dnf && !legalRaceStart(session.player.position)) {
        session.player.dnf = insideRaceTown(session.player.position) ? '未在合法起跑區' : '倒數結束仍在北門外'
        lockRace(session, 'loss', session.player.dnf)
      } else { session.phase = 'racing'; session.startedAtSeconds = session.gameSeconds; session.phaseSeconds = 0 }
    }
  } else if (raceIsRunning(session)) session.elapsedSeconds += dt
}

function object(value: unknown): Record<string, unknown> | null { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null }
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
const nonnegative = (n: unknown): n is number => finite(n) && n >= 0
const mountId = (id: unknown): id is RaceMountId => [
  'horse', 'armored-horse', 'corgi', 'black-cat', 'white-cat', 'orange-cat', 'serval', 'caracal', 'snow-leopard',
].includes(id as string)
const outcome = (value: unknown): value is RaceOutcome => ['win', 'loss', 'draw'].includes(value as string)
function position(value: unknown): value is RacePosition {
  const p = object(value)
  return Boolean(p && finite(p.x) && finite(p.z) && finite(p.y) && finite(p.yaw) && Math.abs(p.x) <= 350 && Math.abs(p.z) <= 350)
}
export function isRaceRider(value: unknown): value is RaceRider {
  const r = object(value)
  return Boolean(r && typeof r.actorId === 'string' && r.actorId.length > 0 && mountId(r.mountId)
    && position(r.position) && position(r.mountPosition) && nonnegative(r.hp) && nonnegative(r.mountHp) && nonnegative(r.stamina)
    && (r.routePosition === undefined || position(r.routePosition))
    && typeof r.mounted === 'boolean' && typeof r.dead === 'boolean' && r.dead === (r.hp === 0)
    && Number.isInteger(r.checkpoint) && (r.checkpoint as number) >= 0 && (r.checkpoint as number) <= 5
    && (r.checkpoint === 5 ? nonnegative(r.finishSeconds) : r.finishSeconds === undefined)
    && (r.dnf === undefined || typeof r.dnf === 'string'))
}
export function isRaceReferee(value: unknown): value is RaceReferee {
  const r = object(value)
  return Boolean(r && position(r.position) && nonnegative(r.hp) && typeof r.mounted === 'boolean'
    && (r.mountHp === undefined || nonnegative(r.mountHp)) && (r.mountPosition === undefined || position(r.mountPosition)))
}
export function parseRaceSession(value: unknown): CareerRaceSession | null {
  const s = object(value)
  const definition = s && raceDefinitionForSchedule(s.raceId, s.scheduleVersion)
  if (!s || !definition || s.version !== 1 || typeof s.deployed !== 'boolean' || typeof s.id !== 'string' || !s.id
    || !['guiding', 'countdown', 'racing', 'finishing', 'result', 'returning'].includes(s.phase as string)
    || !nonnegative(s.countdownSeconds) || s.countdownSeconds > 10 || !nonnegative(s.elapsedSeconds) || !nonnegative(s.gameSeconds) || !nonnegative(s.phaseSeconds)
    || !isRaceRider(s.player) || !isRaceRider(s.opponent) || s.player.actorId !== 'player'
    || s.opponent.actorId !== TOWN_COMMANDER_ID
    || (s.opponent.actorId === TOWN_COMMANDER_ID && !isRaceReferee(s.opponentHome))
    || !(definition.opponents ?? [definition.mount]).includes(s.opponent.mountId as RaceMountId)
    || !Number.isInteger(s.waypoint) || (s.waypoint as number) < 0 || (s.waypoint as number) > 200
    || (s.result !== undefined && !outcome(s.result))
    || (s.startedAtSeconds !== undefined && !nonnegative(s.startedAtSeconds))
    || (s.referee !== undefined && !isRaceReferee(s.referee))
    || (s.opponentHome !== undefined && !isRaceReferee(s.opponentHome))
    || (s.opponentAmmo !== undefined && !nonnegative(s.opponentAmmo))
    || (s.story !== undefined && (s.story !== RACE_STORY_ID || s.raceId !== RACE_STORY_RACE_ID))
    || (s.reason !== undefined && typeof s.reason !== 'string')
    || (s.guideFallback !== undefined && typeof s.guideFallback !== 'string')
    || (s.phase === 'finishing' || s.phase === 'result' || s.phase === 'returning') !== (s.result !== undefined)
    || s.phase === 'finishing' && s.player.finishSeconds === undefined && s.opponent.finishSeconds === undefined) return null
  return structuredClone(s) as unknown as CareerRaceSession
}
export function parseRaceRecords(value: unknown): CareerRaceRecord[] | null {
  if (!Array.isArray(value)) return null
  const ids = new Set<string>(), records: CareerRaceRecord[] = []
  for (const raw of value) {
    const r = object(raw)
    if (!r || typeof r.sessionId !== 'string' || !r.sessionId || !raceDefinitionForSchedule(r.raceId, r.scheduleVersion) || !outcome(r.result)
      || typeof r.legalFinish !== 'boolean' || (r.playerSeconds !== undefined && !nonnegative(r.playerSeconds))
      || (r.opponentSeconds !== undefined && !nonnegative(r.opponentSeconds)) || r.legalFinish !== (r.playerSeconds !== undefined)
      || (r.story !== undefined && (r.story !== RACE_STORY_ID || r.raceId !== RACE_STORY_RACE_ID))
      || !nonnegative(r.merit) || !Number.isInteger(r.merit)) return null
    if (!ids.has(r.sessionId)) { ids.add(r.sessionId); records.push(structuredClone(r) as unknown as CareerRaceRecord) }
  }
  return records
}
