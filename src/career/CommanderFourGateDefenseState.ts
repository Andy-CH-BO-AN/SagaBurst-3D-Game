import type { CombatEvent } from '../combat/CombatAttribution'
import type { BattleStatsSnapshot } from '../combat/BattleStatsTracker'
import { COMMANDER_TOWN_ROSTER_VERSION, type CommanderTownRosterVersion } from './CommanderTownRoster'
import { TOWN_AUTONOMOUS_GUARD_IDS } from '../town/TownNativeGuardIdentity'
import { parseCaptainEagleCheckpoint, type CaptainEagleCheckpoint } from './CaptainEagleCheckpoint'
import { parseCommandActorCheckpoint } from './CareerCommandAuthority'
import type { PersonalActorCheckpoint, PersonalActorPosition } from './CareerPersonalSquadMission'
import type { CareerMissionOutcome, CareerMissionPhase } from './CareerMissionState'
import { parseTownFourGateSiegeCheckpoint, type TownFourGateSiegeCheckpoint } from './TownFourGateSiegeCheckpoint'
import { COMMANDER_FOUR_GATE_DEFENSE_PREPARATION_SECONDS, commanderFourGateDefenseSlots } from './CommanderFourGateDefenseRoster'
import { parseCommanderCavalryEscort, type CommanderCavalryEscortCheckpoint } from './CommanderCavalryEscort'
import { townRoster } from '../town/TownRules'
import { TOWN_HR_OFFICER_ID } from '../town/TownHRLayout'
import { TOWN_PLAYABLE_WORLD_BOUND } from '../town/TownBounds'

export const COMMANDER_FOUR_GATE_DEFENSE_SURVIVAL_SECONDS = 15 * 60
export type CommanderFourGateDefenseVictoryReason = 'elimination' | 'survival'

export type CommanderFourGateDefensePhase = 'DEPLOYING' | 'PREPARING' | 'SPAWNING' | 'ATTACKING' | 'RESULT'
export type NativeTownGuardCombatStats = Pick<NonNullable<BattleStatsSnapshot['nativeDefenders']>, 'damageDealt' | 'damageTaken' | 'kills'>
export interface CommanderFourGateDefenseState {
  version: 1
  /** Absent means the accepted 210-person army; never infer from current rank/count. */
  rosterVersion?: CommanderTownRosterVersion
  /** Accepted native defenders outside official command; casualties live in actors. */
  autonomousActorIds?: string[]
  nativeCombatStats?: NativeTownGuardCombatStats
  phase: CommanderFourGateDefensePhase
  preparationRemainingSeconds: number
  /** Active combat only, bounded at the survival deadline. */
  combatElapsedSeconds: number
  victoryReason?: CommanderFourGateDefenseVictoryReason
  /** True only when the complete enemy roster can enter combat (also retained in legacy full PREPARING saves). */
  deploymentComplete: boolean
  attackStarted: boolean
  /** Includes casualties already accounted for by this accepted mission, never mount identities. */
  registeredTargetActorIds: string[]
  siege?: TownFourGateSiegeCheckpoint
  /** Absent legacy ATTACKING saves retain their already released attack orders. */
  cavalryEscort?: CommanderCavalryEscortCheckpoint
  /** Independent actor and mount HP/flight state; a dead mount does not kill its rider. */
  actors: Record<string, PersonalActorCheckpoint>
  player?: CaptainEagleCheckpoint['player']
}

/** Event-only aggregate: no additional scans, actor simulation or command/merit grant. */
export function recordNativeTownGuardCombat(stats: NativeTownGuardCombatStats, event: CombatEvent,
  nativeActorIds: ReadonlySet<string>, enemyActorIds: ReadonlySet<string>): void {
  if (event.type === 'damage_applied' && (nativeActorIds.has(event.target.targetId)
    || Boolean(event.target.ownerActorId && nativeActorIds.has(event.target.ownerActorId))) && enemyActorIds.has(event.source.actorId))
    stats.damageTaken += event.appliedDamage
  const target = event.target.targetId
  const enemyTarget = enemyActorIds.has(target) || event.type === 'damage_applied'
    && Boolean(event.target.ownerActorId && enemyActorIds.has(event.target.ownerActorId))
  if (!nativeActorIds.has(event.source.actorId) || !enemyTarget) return
  if (event.type === 'damage_applied') stats.damageDealt += event.appliedDamage
  if (event.type === 'actor_killed' && event.target.targetType === 'npc') stats.kills++
}

export function createCommanderFourGateDefenseState(): CommanderFourGateDefenseState {
  return { version: 1, rosterVersion: COMMANDER_TOWN_ROSTER_VERSION, autonomousActorIds: [...TOWN_AUTONOMOUS_GUARD_IDS], phase: 'DEPLOYING', combatElapsedSeconds: 0, preparationRemainingSeconds: COMMANDER_FOUR_GATE_DEFENSE_PREPARATION_SECONDS,
    deploymentComplete: false, attackStarted: false, registeredTargetActorIds: [], actors: {} }
}

/** Persist SPAWNING before creating any enemy or ramp. Native readiness starts the clock;
 * enemy deploymentComplete cannot be a prerequisite for this enemy-free preparation. */
export function advanceCommanderFourGateDefensePreparation(state: CommanderFourGateDefenseState,
  dt: number, allReady: boolean): CommanderFourGateDefenseState {
  if (!allReady || state.phase !== 'PREPARING' || state.attackStarted
    || !Number.isFinite(dt) || dt < 0) return state
  const remaining = Math.max(0, state.preparationRemainingSeconds - dt)
  // Repeated fractional frames must not leave a sub-nanosecond residue that adds
  // a whole rendered frame to the exact active-play deadline.
  const preparationRemainingSeconds = remaining < 1e-9 ? 0 : remaining
  if (preparationRemainingSeconds === 0) return { ...state, preparationRemainingSeconds,
    phase: 'SPAWNING', attackStarted: false, deploymentComplete: false }
  return preparationRemainingSeconds === state.preparationRemainingSeconds ? state : { ...state, preparationRemainingSeconds }
}

/** Called only for a frame that began in active combat; preparation and spawn time never count. */
export function advanceCommanderFourGateDefenseCombat(state: CommanderFourGateDefenseState,
  dt: number, ready: boolean): CommanderFourGateDefenseState {
  if (!ready || state.phase !== 'ATTACKING' || !state.attackStarted || !state.deploymentComplete
    || !Number.isFinite(dt) || dt < 0) return state
  const elapsed = Math.min(COMMANDER_FOUR_GATE_DEFENSE_SURVIVAL_SECONDS, state.combatElapsedSeconds + dt)
  const combatElapsedSeconds = COMMANDER_FOUR_GATE_DEFENSE_SURVIVAL_SECONDS - elapsed < 1e-9
    ? COMMANDER_FOUR_GATE_DEFENSE_SURVIVAL_SECONDS : elapsed
  return combatElapsedSeconds === state.combatElapsedSeconds ? state : { ...state, combatElapsedSeconds }
}

/** Final enemy death still wins ties. Otherwise a living ally must reach the active combat deadline. */
export function resolveCommanderFourGateDefenseOutcome(playerDead: boolean, registrationComplete: boolean,
  enemiesRemaining: number, aliveTownPeople: number, alivePersonal = 0,
  combatElapsedSeconds = 0): CareerMissionOutcome | null {
  if (registrationComplete && enemiesRemaining === 0) return 'victory'
  if (playerDead && aliveTownPeople === 0 && alivePersonal === 0) return 'failure'
  return registrationComplete && Number.isFinite(combatElapsedSeconds)
    && combatElapsedSeconds >= COMMANDER_FOUR_GATE_DEFENSE_SURVIVAL_SECONDS ? 'victory' : null
}

const finite = (value: unknown, max = 100000): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max
const safeId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9:_-]{1,200}$/.test(value)
  && !['__proto__', 'prototype', 'constructor'].includes(value)
const ids = (value: unknown, max: number): value is string[] => Array.isArray(value) && value.length <= max
  && value.every(safeId) && new Set(value).size === value.length
const point = (value: PersonalActorPosition | undefined): boolean => !!value && Number.isFinite(value.x) && Number.isFinite(value.z)
  && Math.abs(value.x) <= TOWN_PLAYABLE_WORLD_BOUND && Math.abs(value.z) <= TOWN_PLAYABLE_WORLD_BOUND
  && Number.isFinite(value.yaw) && (value.y === undefined || Number.isFinite(value.y) && Math.abs(value.y) <= 200)

function actorCheckpoint(value: unknown): PersonalActorCheckpoint | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as PersonalActorCheckpoint
  if (!['reserve', 'deployed', 'dead', 'exited'].includes(raw.status) || !finite(raw.hp)
    || (raw.status === 'dead') !== (raw.hp === 0) || !point(raw.position)
    || raw.ammo !== undefined && !finite(raw.ammo) || raw.shieldImpact !== undefined && !finite(raw.shieldImpact)
    || raw.mount && (!finite(raw.mount.hp) || typeof raw.mount.mounted !== 'boolean' || !point(raw.mount.position)
      || raw.mount.hp === 0 && raw.mount.mounted)
    || raw.townRampartMounted !== undefined && (typeof raw.townRampartMounted !== 'boolean'
      || raw.townRampartMounted && raw.townRampartGarrison !== true)
    || raw.formation && (!point(raw.formation.position) || !Number.isFinite(raw.formation.commandId)
      || typeof raw.formation.reached !== 'boolean' || raw.formation.speedLimit !== undefined && !finite(raw.formation.speedLimit))) return undefined
  const parsed = parseCommandActorCheckpoint(raw)
  if (!parsed || raw.order !== undefined && !parsed.order || raw.fall !== undefined && !parsed.fall
    || raw.mount !== undefined && !parsed.mount || raw.mount?.flight !== undefined && !parsed.mount?.flight
    || raw.formation !== undefined && !parsed.formation
    || raw.townRampartMounted === true && parsed.townRampartMounted !== true
    || raw.formation?.arrivalOrder !== undefined && !parsed.formation?.arrivalOrder) return undefined
  return parsed
}

export interface CommanderFourGateDefenseParseContext {
  missionId: string
  faction: 'roman' | 'viking'
  phase: CareerMissionPhase
  targetActorIds: readonly string[]
  friendlyActorIds: readonly string[]
  civilianActorIds: readonly string[]
  personalActorIds?: readonly string[]
  personalActors?: Record<string, PersonalActorCheckpoint>
  deadTargetActorIds?: readonly string[]
}

/** Closed and bounded mission parser. Never reinterpret Commander V as the legacy 120-man roster. */
export function parseCommanderFourGateDefenseState(value: unknown,
  context: CommanderFourGateDefenseParseContext): CommanderFourGateDefenseState | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !safeId(context.missionId)) return undefined
  const raw = value as CommanderFourGateDefenseState
  const rosterVersion = raw.rosterVersion ?? 1
  if (rosterVersion !== 1 && rosterVersion !== COMMANDER_TOWN_ROSTER_VERSION) return undefined
  const autonomousActorIds = raw.autonomousActorIds ?? []
  if (!ids(autonomousActorIds, TOWN_AUTONOMOUS_GUARD_IDS.length)
    || (rosterVersion === 1 ? autonomousActorIds.length !== 0
      : autonomousActorIds.length !== TOWN_AUTONOMOUS_GUARD_IDS.length
        || autonomousActorIds.some(id => !TOWN_AUTONOMOUS_GUARD_IDS.includes(id)))) return undefined
  const nativeCombatStats = raw.nativeCombatStats
  if (nativeCombatStats !== undefined && (!nativeCombatStats || typeof nativeCombatStats !== 'object'
    || !finite(nativeCombatStats.damageDealt, Number.MAX_SAFE_INTEGER)
    || !finite(nativeCombatStats.damageTaken, Number.MAX_SAFE_INTEGER)
    || !Number.isSafeInteger(nativeCombatStats.kills) || nativeCombatStats.kills < 0
    || nativeCombatStats.kills > context.targetActorIds.length)) return undefined
  const combatElapsedSeconds = raw.combatElapsedSeconds === undefined ? 0 : raw.combatElapsedSeconds
  const slots = commanderFourGateDefenseSlots(context.missionId), targets = new Set(slots.map(slot => slot.actorId))
  if (context.targetActorIds.length !== targets.size || new Set(context.targetActorIds).size !== targets.size
    || context.targetActorIds.some(id => !targets.has(id))
    || raw.version !== 1 || !['DEPLOYING', 'PREPARING', 'SPAWNING', 'ATTACKING', 'RESULT'].includes(raw.phase)
    || !finite(combatElapsedSeconds, COMMANDER_FOUR_GATE_DEFENSE_SURVIVAL_SECONDS)
    || !raw.attackStarted && combatElapsedSeconds !== 0
    || raw.victoryReason !== undefined && !['elimination', 'survival'].includes(raw.victoryReason)
    || !finite(raw.preparationRemainingSeconds, COMMANDER_FOUR_GATE_DEFENSE_PREPARATION_SECONDS)
    || typeof raw.deploymentComplete !== 'boolean' || typeof raw.attackStarted !== 'boolean'
    || !ids(raw.registeredTargetActorIds, targets.size) || raw.registeredTargetActorIds.some(id => !targets.has(id))
    || !raw.actors || typeof raw.actors !== 'object' || Array.isArray(raw.actors) || Object.keys(raw.actors).length > 1024
    || raw.phase !== 'RESULT' && raw.phase !== context.phase
    || raw.phase === 'RESULT' && !['RESULT', 'VICTORY_LOCKED', 'FAILURE_LOCKED', 'RETURNING'].includes(context.phase)
    || raw.phase === 'DEPLOYING' && (raw.deploymentComplete || raw.attackStarted
      || raw.preparationRemainingSeconds !== COMMANDER_FOUR_GATE_DEFENSE_PREPARATION_SECONDS)
    || raw.phase === 'DEPLOYING' && (raw.registeredTargetActorIds.length !== 0 || raw.siege !== undefined)
    || raw.phase === 'PREPARING' && (raw.attackStarted || !raw.deploymentComplete
      && (raw.registeredTargetActorIds.length !== 0 || raw.siege !== undefined))
    || raw.phase === 'SPAWNING' && (raw.deploymentComplete || raw.attackStarted || raw.preparationRemainingSeconds !== 0)
    || raw.phase === 'ATTACKING' && (!raw.deploymentComplete || !raw.attackStarted || raw.preparationRemainingSeconds !== 0)
    || raw.attackStarted && (!raw.deploymentComplete || raw.preparationRemainingSeconds !== 0)
    || raw.deploymentComplete && raw.registeredTargetActorIds.length !== targets.size) return undefined
  // The actual Home Town adds this service resident beyond the base roster.
  // It is checkpointed as a person, never added to official military authority.
  const townIds = [TOWN_HR_OFFICER_ID, ...townRoster().filter(actor => actor.role !== 'cat').map(actor => actor.id),
    ...context.friendlyActorIds, ...context.civilianActorIds]
  const allowed = new Set([...townIds, ...targets, ...(context.personalActorIds ?? [])])
  if (allowed.size > 1024 || [...allowed].some(id => !safeId(id))) return undefined
  const actors: CommanderFourGateDefenseState['actors'] = {}
  for (const [id, saved] of Object.entries(raw.actors)) {
    if (!allowed.has(id)) return undefined
    const actor = actorCheckpoint(saved)
    if (!actor) return undefined
    actors[id] = actor
  }
  const dead = new Set(context.deadTargetActorIds ?? [])
  if (dead.size !== (context.deadTargetActorIds?.length ?? 0) || [...dead].some(id => !targets.has(id))) return undefined
  for (const target of slots) {
    const actor = actors[target.actorId]
    const registered = raw.registeredTargetActorIds.includes(target.actorId)
    if (registered && !actor || actor && !registered || dead.has(target.actorId) && !actor
      || actor && !['deployed', 'dead'].includes(actor.status) || actor && (actor.status === 'dead') !== dead.has(target.actorId)
      || actor && target.role === 'ranger' && !actor.mount
      || actor && target.role === 'lancer' && !actor.mount) return undefined
  }
  const nativeReady = raw.phase !== 'DEPLOYING'
  if (nativeReady && [...context.friendlyActorIds, ...autonomousActorIds, ...context.civilianActorIds].some(id => !actors[id])) return undefined
  const siege = raw.siege === undefined ? undefined : parseTownFourGateSiegeCheckpoint(raw.siege)
  if (raw.siege !== undefined && !siege || raw.deploymentComplete && !siege) return undefined
  const cavalryEscort = raw.cavalryEscort === undefined ? undefined : parseCommanderCavalryEscort(raw.cavalryEscort, context.missionId)
  if (raw.cavalryEscort !== undefined && !cavalryEscort) return undefined
  if (cavalryEscort) {
    if (!raw.attackStarted && (Object.values(cavalryEscort.actors).some(actor => actor.mode !== 'escort')
      || Object.values(cavalryEscort.groups).some(group => group.lastProgressDistance !== 0 || group.stallSeconds !== 0))) return undefined
    if (siege && siege.ramps.some(ramp => cavalryEscort.groups[ramp.assignment.id].lastProgressDistance > ramp.distance)) return undefined
    for (const [id, group] of Object.entries(cavalryEscort.groups)) {
      if (group.releaseReason === 'group-dead' && Object.entries(cavalryEscort.actors).some(([actorId, actor]) =>
        `town-siege-ramp:${actor.gateId}:${actor.side < 0 ? 'left' : 'right'}` === id && actors[actorId]?.status !== 'dead')) return undefined
    }
  }
  if (siege) {
    if (siege.faction === context.faction || Object.keys(siege.actors).some(id => !allowed.has(id))) return undefined
    for (const ramp of siege.ramps) {
      const crew = slots.filter(slot => slot.gateId === ramp.assignment.gateId && slot.side === ramp.assignment.side)
      const pushers = crew.filter(slot => slot.role === 'pusher').map(slot => slot.actorId)
      const assault = crew.filter(slot => slot.role === 'assault').map(slot => slot.actorId)
      if (ramp.assignment.pusherIds.some(id => !pushers.includes(id)) || ramp.assignment.assaultIds.some(id => !assault.includes(id))) return undefined
    }
    for (const [id, actor] of Object.entries(siege.actors)) {
      if (!actors[id] || actors[id].hp !== actor.hp || actors[id].status !== actor.status) return undefined
    }
    if (!raw.attackStarted && (siege.ramps.some(ramp => ramp.state !== 'DEPLOYING')
      || siege.gates.some(gate => gate.wallEventHandled || gate.cavalryEventHandled))) return undefined
  }
  const player = raw.player === undefined ? undefined : parseCaptainEagleCheckpoint({ actors: {}, ready: true, player: raw.player,
    playerStats: { damageDealt: 0, damageTaken: 0, kills: 0, structureDamage: 0, structuresDestroyed: 0, gateBreaches: 0 } })?.player
  if (raw.player !== undefined && (!player || !point(player.position) || !finite(player.hp) || !finite(player.stamina)
    || (player.hp === 0) !== player.dead || player.mount && (!point(player.mount.position) || !finite(player.mount.hp)))
    || nativeReady && !player
    || player?.mountActorId && (!allowed.has(player.mountActorId)
      || !(actors[player.mountActorId]?.mount || context.personalActorIds?.includes(player.mountActorId)
        && context.personalActors?.[player.mountActorId]?.mount))) return undefined
  if (raw.victoryReason !== undefined) {
    if (!raw.attackStarted || !raw.deploymentComplete || !['ATTACKING', 'RESULT'].includes(raw.phase)) return undefined
    const enemiesRemaining = targets.size - dead.size
    const living = (actor: PersonalActorCheckpoint | undefined): boolean => actor?.status === 'deployed' && (actor.hp ?? 0) > 0
    const allySurvives = player?.dead === false || townIds.some(id => living(actors[id]))
      || (context.personalActorIds ?? []).some(id => living(actors[id] ?? context.personalActors?.[id]))
    // Preserve already settled five-minute victories from the previous rules.
    // Active missions must still reach the current fifteen-minute deadline.
    const legacySurvivalResult = raw.phase === 'RESULT' && combatElapsedSeconds === 300
    if (raw.victoryReason === 'elimination' ? enemiesRemaining !== 0
      : enemiesRemaining === 0 || !legacySurvivalResult && combatElapsedSeconds < COMMANDER_FOUR_GATE_DEFENSE_SURVIVAL_SECONDS || !allySurvives) return undefined
  }
  return { version: 1, rosterVersion, ...(rosterVersion === 2 ? { autonomousActorIds: [...autonomousActorIds] } : {}), phase: raw.phase, preparationRemainingSeconds: raw.preparationRemainingSeconds,
    ...(nativeCombatStats ? { nativeCombatStats: { ...nativeCombatStats } } : {}),
    combatElapsedSeconds, ...(raw.victoryReason ? { victoryReason: raw.victoryReason } : {}),
    deploymentComplete: raw.deploymentComplete, attackStarted: raw.attackStarted,
    registeredTargetActorIds: [...raw.registeredTargetActorIds], actors, ...(siege ? { siege } : {}),
    ...(cavalryEscort ? { cavalryEscort } : {}), ...(player ? { player } : {}) }
}
