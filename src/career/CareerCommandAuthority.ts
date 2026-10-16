import type { CharacterFaction } from '../world/CharacterVisuals'
import type { CombatActorRef } from '../combat/CombatAttribution'
import { emptyPersonalContribution, type PersonalCombatContribution } from '../combat/CommandMerit'
import { clonePersonalMission, type PersonalActorCheckpoint, type PersonalActorPosition } from './CareerPersonalSquadMission'
import { parseFallingRiderSnapshot } from '../movement/FallingRider'
import { parseEagleFlightSnapshot } from '../movement/EagleFlightController'
import type { TacticalOrder } from '../battle/TacticalOrder'
import { MAX_COMMAND_SQUADS, MAX_COMMAND_SQUAD_SIZE, type SquadId } from '../battle/CommandTarget'
import { Faction, type CombatOwnership } from '../combat/CombatFaction'
import type { CareerRank } from './CareerProfile'

export interface OfficialCommandSquad {
  squadId: SquadId
  actorIds: string[]
  contribution?: PersonalCombatContribution
}

/** Saved membership, rather than shared faction or soldier appearance, grants command and merit. */
export interface OfficialCommandAuthority {
  type: 'mission-official' | 'town-command'
  missionId?: string
  townFaction: CharacterFaction
  squadId: 1
  actorIds: string[]
  /** Only a newly accepted, formally appointed Commander receives this grant. */
  commandRank?: 'commander'
  squads?: OfficialCommandSquad[]
  /** An empty list keeps native mission AI; commands explicitly transfer squad ownership. */
  commandedSquadIds?: SquadId[]
  contribution: PersonalCombatContribution
  members?: Record<string, PersonalActorCheckpoint>
}

export interface TownCommandSquadState extends OfficialCommandAuthority {
  type: 'town-command'
  /** Peaceful Commander ownership is exact per actor; native Return/Refit actors are never claimed implicitly. */
  commandedActorIds?: string[]
  /** Native owners retain physical Patrol return/refit state; Town command only checkpoints the handoff. */
  nativeReturnStates?: Record<string, TownCommandNativeReturnState>
  /** Saved service requests remain pending until the native owner finishes physical repair. */
  refittingActorIds?: string[]
  state: 'TRAINING' | 'FOLLOWING' | 'RETURNING'
  authorized: boolean
  sceneKey: string
}

export type TownCommandNativeReturnState = 'RETURN_TO_BARRACKS' | 'REFIT' | 'REJOIN_PATROL'

const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const nonnegative = (value: unknown): number => finite(value) ? Math.max(0, value) : 0
const orders: readonly TacticalOrder[] = ['follow', 'attack', 'charge', 'defend', 'formation']
function parsePosition(value: unknown): PersonalActorPosition | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Partial<PersonalActorPosition>
  return finite(raw.x) && finite(raw.z) && finite(raw.yaw)
    ? { x: raw.x, z: raw.z, yaw: raw.yaw, ...(finite(raw.y) ? { y: raw.y } : {}) } : undefined
}

/** Official actor IDs use the same actor state schema without HR membership restrictions. */
export function parseCommandActorCheckpoint(value: unknown): PersonalActorCheckpoint | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Partial<PersonalActorCheckpoint>
  const status = raw.status && ['reserve', 'deployed', 'dead', 'exited'].includes(raw.status) ? raw.status : 'reserve'
  const point = parsePosition(raw.position)
  const mountPoint = parsePosition(raw.mount?.position)
  const formationPoint = parsePosition(raw.formation?.position)
  const fall = parseFallingRiderSnapshot(raw.fall)
  const flight = parseEagleFlightSnapshot(raw.mount?.flight)
  return { status,
    ...(point ? { position: point } : {}),
    ...(finite(raw.hp) ? { hp: nonnegative(raw.hp) } : {}),
    ...(raw.boarding === true ? { boarding: true } : {}),
    ...(typeof raw.eaglePadId === 'string' && raw.eaglePadId.length <= 100 ? { eaglePadId: raw.eaglePadId } : {}),
    ...(fall ? { fall } : {}),
    ...(finite(raw.ammo) ? { ammo: Math.floor(nonnegative(raw.ammo)) } : {}),
    ...(finite(raw.shieldImpact) ? { shieldImpact: nonnegative(raw.shieldImpact) } : {}),
    ...(raw.order && orders.includes(raw.order) ? { order: raw.order } : {}),
    ...(raw.outpostRampartGarrison === true ? { outpostRampartGarrison: true } : {}),
    ...(raw.townRampartGarrison === true ? { townRampartGarrison: true } : {}),
    ...(mountPoint && finite(raw.mount?.hp) ? { mount: { hp: nonnegative(raw.mount.hp), mounted: raw.mount.mounted === true,
      position: mountPoint, ...(flight ? { flight } : {}) } } : {}),
    ...(formationPoint && finite(raw.formation?.commandId) ? { formation: {
      commandId: raw.formation.commandId, position: formationPoint, reached: raw.formation.reached === true,
      ...(finite(raw.formation.speedLimit) ? { speedLimit: nonnegative(raw.formation.speedLimit) } : {}),
      ...(raw.formation.arrivalOrder && orders.includes(raw.formation.arrivalOrder) ? { arrivalOrder: raw.formation.arrivalOrder } : {}),
    } } : {}),
  }
}

function parseMembers(ids: readonly string[], raw: unknown): Record<string, PersonalActorCheckpoint> {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const members: Record<string, PersonalActorCheckpoint> = {}
  for (const id of ids) {
    members[id] = parseCommandActorCheckpoint(value[id]) ?? { status: 'reserve' }
  }
  return members
}

function parseContribution(raw: Partial<PersonalCombatContribution> | undefined): PersonalCombatContribution {
  const contribution = emptyPersonalContribution()
  for (const key of Object.keys(contribution) as (keyof PersonalCombatContribution)[]) {
    contribution[key] = finite(raw?.[key]) ? nonnegative(raw[key]) : 0
  }
  if (finite(raw?.damageTaken)) contribution.damageTaken = nonnegative(raw.damageTaken)
  contribution.kills = Math.floor(contribution.kills)
  contribution.structuresDestroyed = Math.floor(contribution.structuresDestroyed)
  contribution.gateBreaches = Math.floor(contribution.gateBreaches)
  return contribution
}

export function parseOfficialCommandAuthority(value: unknown): OfficialCommandAuthority | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Partial<OfficialCommandAuthority>
  const commander = raw.commandRank === 'commander'
  if ((raw.type !== 'mission-official' && raw.type !== 'town-command') || raw.squadId !== 1
    || (raw.townFaction !== 'roman' && raw.townFaction !== 'viking')
    || !Array.isArray(raw.actorIds) || raw.actorIds.length > (commander ? MAX_COMMAND_SQUADS * MAX_COMMAND_SQUAD_SIZE : 100)
    || !raw.actorIds.every(validId) || new Set(raw.actorIds).size !== raw.actorIds.length) return undefined
  let squads: OfficialCommandSquad[] | undefined
  if (commander || raw.squads !== undefined || raw.commandRank !== undefined) {
    if (!commander
      || (raw.type === 'mission-official' && !validId(raw.missionId))
      || (raw.type === 'town-command' && raw.missionId !== undefined)
      || !Array.isArray(raw.squads) || raw.squads.length > MAX_COMMAND_SQUADS) return undefined
    squads = []
    const squadIds = new Set<number>(), actorIds = new Set<string>()
    for (const squad of raw.squads) {
      if (!squad || !Number.isInteger(squad.squadId) || squad.squadId < 1 || squad.squadId > MAX_COMMAND_SQUADS
        || squadIds.has(squad.squadId) || !Array.isArray(squad.actorIds) || !squad.actorIds.length
        || squad.actorIds.length > MAX_COMMAND_SQUAD_SIZE) return undefined
      squadIds.add(squad.squadId)
      for (const id of squad.actorIds) {
        if (!validId(id) || actorIds.has(id) || !raw.actorIds.includes(id)) return undefined
        actorIds.add(id)
      }
      squads.push({ squadId: squad.squadId, actorIds: [...squad.actorIds],
        ...(squad.contribution ? { contribution: parseContribution(squad.contribution) } : {}) })
    }
    if (actorIds.size !== raw.actorIds.length) return undefined
  }
  const knownSquads = new Set(squads?.map(squad => squad.squadId) ?? [1])
  if (raw.commandedSquadIds !== undefined && (!Array.isArray(raw.commandedSquadIds)
    || raw.commandedSquadIds.some(id => !knownSquads.has(id))
    || new Set(raw.commandedSquadIds).size !== raw.commandedSquadIds.length)) return undefined
  if (raw.type === 'town-command' && raw.commandedSquadIds !== undefined) return undefined
  return { type: raw.type, squadId: 1, townFaction: raw.townFaction, actorIds: [...raw.actorIds], contribution: parseContribution(raw.contribution),
    ...(commander ? { commandRank: 'commander', squads } : {}),
    ...(raw.commandedSquadIds ? { commandedSquadIds: [...raw.commandedSquadIds] } : {}),
    ...(validId(raw.missionId) ? { missionId: raw.missionId } : {}),
    ...(raw.members ? { members: parseMembers(raw.actorIds, raw.members) } : {}) }
}

/** Reading an old save never manufactures Commander membership from a current rank. */
export function officialCommandSquads(authority: OfficialCommandAuthority): readonly OfficialCommandSquad[] {
  return authority.commandRank === 'commander' && authority.squads ? authority.squads
    : [{ squadId: 1, actorIds: authority.actorIds }]
}

export function officialActorSquadId(authority: OfficialCommandAuthority, actorId: string): SquadId | undefined {
  if (!authority.actorIds.includes(actorId)) return undefined
  return officialCommandSquads(authority).find(squad => squad.actorIds.includes(actorId))?.squadId
}

export function officialCommandIsPlayerControlled(authority: OfficialCommandAuthority, actorId: string): boolean {
  const squadId = officialActorSquadId(authority, actorId)
  if (squadId === undefined) return false
  return authority.commandedSquadIds ? authority.commandedSquadIds.includes(squadId) : authority.commandRank !== 'commander'
}

/** Peaceful Commander Town authority claims only actors whose native owner completed a saved handoff. */
export function townCommandIsPlayerControlled(authority: TownCommandSquadState, actorId: string): boolean {
  return authority.commandRank === 'commander'
    ? Boolean(authority.authorized && authority.commandedActorIds?.includes(actorId))
    : Boolean(authority.authorized && authority.actorIds.includes(actorId))
}

/** Mission acceptance supplies stable production groups, before saving or touching live actors. */
export function createMissionCommandAuthority(missionId: string, townFaction: CharacterFaction, rank: CareerRank,
  captainActorIds: readonly string[], commanderSquads: readonly OfficialCommandSquad[]): OfficialCommandAuthority {
  const commander = rank === 'commander'
  const authority = parseOfficialCommandAuthority({ type: 'mission-official', missionId, townFaction, squadId: 1,
    actorIds: commander ? commanderSquads.flatMap(squad => squad.actorIds) : [...captainActorIds],
    contribution: emptyPersonalContribution(),
    ...(commander ? { commandRank: 'commander', squads: commanderSquads, commandedSquadIds: [] } : {}),
  })
  if (!authority) throw new Error('Invalid accepted mission command roster')
  return authority
}

export interface OfficialCommandActor {
  combatantId: string
  squadId?: SquadId | 'personal' | 'civilians'
  faction: Faction
  combatOwnership?: CombatOwnership
  dead: boolean
}

/** Callers validate mission/scene, army townFaction and runtime readiness. Appearance is not army allegiance (e.g. a Roman Ranger). */
export function officialCommandAcceptsActor(authority: OfficialCommandAuthority, actor: OfficialCommandActor): boolean {
  const saved = authority.members?.[actor.combatantId]
  return !actor.dead && saved?.status !== 'exited' && saved?.status !== 'dead' && saved?.hp !== 0
    && (actor.faction === Faction.TOWN || actor.faction === Faction.PLAYER)
    && actor.combatOwnership === authority.type
    && actor.squadId === officialActorSquadId(authority, actor.combatantId)
    && officialActorSquadId(authority, actor.combatantId) !== undefined
}

export function parseTownCommandSquad(value: unknown): TownCommandSquadState | undefined {
  const authority = parseOfficialCommandAuthority(value)
  if (!authority || authority.type !== 'town-command') return undefined
  const raw = value as Partial<TownCommandSquadState>
  if (raw.commandedActorIds !== undefined && (authority.commandRank !== 'commander'
    || !Array.isArray(raw.commandedActorIds) || raw.commandedActorIds.some(id => !authority.actorIds.includes(id))
    || new Set(raw.commandedActorIds).size !== raw.commandedActorIds.length)) return undefined
  if (raw.refittingActorIds !== undefined && (!Array.isArray(raw.refittingActorIds)
    || raw.refittingActorIds.some(id => !authority.actorIds.includes(id))
    || new Set(raw.refittingActorIds).size !== raw.refittingActorIds.length)) return undefined
  const nativeStates = raw.nativeReturnStates
  if (nativeStates !== undefined && (authority.commandRank !== 'commander' || !nativeStates || typeof nativeStates !== 'object'
    || Array.isArray(nativeStates) || Object.entries(nativeStates).some(([id, state]) => !authority.actorIds.includes(id)
      || !['RETURN_TO_BARRACKS', 'REFIT', 'REJOIN_PATROL'].includes(state)))) return undefined
  if (raw.commandedActorIds?.some(id => Object.prototype.hasOwnProperty.call(nativeStates ?? {}, id))) return undefined
  return { ...authority, type: 'town-command', authorized: raw.authorized === true,
    ...(authority.commandRank === 'commander' ? { commandedActorIds: [...(raw.commandedActorIds ?? [])] } : {}),
    ...(raw.refittingActorIds?.length ? { refittingActorIds: [...raw.refittingActorIds] } : {}),
    ...(nativeStates && Object.keys(nativeStates).length ? { nativeReturnStates: { ...nativeStates } } : {}),
    state: raw.state === 'FOLLOWING' || raw.state === 'RETURNING' ? raw.state : 'TRAINING',
    sceneKey: typeof raw.sceneKey === 'string' && raw.sceneKey.length <= 200 ? raw.sceneKey : 'town-home' }
}

export function cloneOfficialCommandAuthority<T extends OfficialCommandAuthority>(value: T): T {
  return { ...value, actorIds: [...value.actorIds], contribution: { ...value.contribution },
    ...(value.squads ? { squads: value.squads.map(squad => ({ ...squad, actorIds: [...squad.actorIds],
      ...(squad.contribution ? { contribution: { ...squad.contribution } } : {}) })) } : {}),
    ...(value.commandedSquadIds ? { commandedSquadIds: [...value.commandedSquadIds] } : {}),
    ...(value.members ? { members: Object.fromEntries(Object.entries(value.members).map(([id, actor]) => {
      const alias = 'personal:checkpoint'
      return [id, clonePersonalMission({ squadId: 'personal', memberIds: [alias], sceneKey: '', state: 'ACTIVE',
        contribution: emptyPersonalContribution(), members: { [alias]: actor } }).members[alias]]
    })) } : {}) }
}

export function cloneTownCommandSquad(value: TownCommandSquadState): TownCommandSquadState {
  const clone = cloneOfficialCommandAuthority(value)
  if (value.commandedActorIds) clone.commandedActorIds = [...value.commandedActorIds]
  if (value.refittingActorIds) clone.refittingActorIds = [...value.refittingActorIds]
  if (value.nativeReturnStates) clone.nativeReturnStates = { ...value.nativeReturnStates }
  return clone
}

/** Delayed attacks retain accepted membership after death; visual characterFaction never grants or denies army ownership. */
export function officialMissionSourcePolicy(authority: OfficialCommandAuthority): (source: CombatActorRef) => boolean {
  const squads = new Map(officialCommandSquads(authority).flatMap(squad => squad.actorIds.map(id => [id, squad.squadId] as const)))
  return source => authority.type === 'mission-official' && source.actorType === 'npc'
    && (source.allegiance === Faction.PLAYER || source.allegiance === Faction.TOWN)
    && (authority.commandRank === 'commander' ? source.ownership === 'mission-official' : source.ownership !== 'player-personal')
    && squads.has(source.actorId) && source.squadId === squads.get(source.actorId)
}
