interface TownActor {
  readonly townCategory?: string
}

interface OwnedActors<Actor> {
  readonly actors: readonly Actor[]
  owns(actor: Actor): boolean
}

interface TownActorGroups<Actor> {
  readonly mission: readonly Actor[]
  readonly field?: readonly Actor[]
  readonly ambient?: readonly Actor[]
  readonly command?: ReadonlySet<Actor>
  readonly external?: ReadonlySet<Actor>
  readonly patrol?: ReadonlySet<Actor>
  readonly personal?: OwnedActors<Actor>
  readonly airPatrol?: OwnedActors<Actor>
  readonly outskirts?: OwnedActors<Actor>
}

type TownActorMode = { kind: 'field'; veteran: boolean } | { kind: 'duel' } | { kind: 'defense' }

/** These checks are deliberately live: ownership may change after preparing the roster. */
interface TownActorOrders<Actor> {
  isRetirementEvacuating?(actor: Actor): boolean
  ownsPeacefulTravel?(actor: Actor): boolean
  isEscorting?(actor: Actor): boolean
  isMissionActor?(actor: Actor): boolean
}

export type TownActorUpdate = 'mission' | 'runtime' | 'retirement' | 'peace' | 'personal' | 'air-patrol' | 'outskirts' | 'escort'

/** One frame's simulation roster and precedence. Membership never grants command authority.
 * Mission controllers keep their phase rules; this module decides which existing
 * updater may advance an actor, including residents borrowed by several rosters.
 */
export class TownActorUpdates<Actor extends TownActor> {
  readonly actors: readonly Actor[]
  private readonly active: ReadonlySet<Actor>
  private readonly mission: ReadonlySet<Actor>
  private readonly advanced = new Set<Actor>()

  constructor(
    private readonly mode: TownActorMode,
    private readonly groups: TownActorGroups<Actor>,
    private readonly orders: TownActorOrders<Actor> = {},
  ) {
    this.mission = new Set(groups.mission)
    const external = groups.external ?? []
    // Keep the established order: it also decides equal-distance combat ties.
    const actors = mode.kind === 'duel'
      ? [...groups.mission, ...(groups.field ?? []), ...(groups.ambient ?? []),
        ...(groups.outskirts?.actors ?? []), ...(groups.airPatrol?.actors ?? []), ...external, ...(groups.patrol ?? [])]
      : mode.kind === 'defense'
        ? [...groups.mission, ...(groups.command ?? []), ...(groups.ambient ?? []),
          ...(groups.outskirts?.actors ?? []), ...(groups.airPatrol?.actors ?? []), ...(groups.personal?.actors ?? []),
          ...external, ...(groups.patrol ?? [])]
        : [...groups.mission, ...(!mode.veteran ? external : []), ...(groups.ambient ?? []),
          ...(groups.outskirts?.actors ?? []), ...(groups.airPatrol?.actors ?? []), ...(groups.personal?.actors ?? []),
          ...external, ...(groups.patrol ?? []), ...(groups.command ?? [])]
    this.active = new Set(actors)
    this.actors = [...this.active]
  }

  /** Active residents are advanced by the same roster as their borrower, never twice. */
  updatePeaceResidents<Resident extends { npc: Actor }>(residents: readonly Resident[], update: (resident: Resident) => void): void {
    for (const resident of residents) {
      if (this.active.has(resident.npc) || this.advanced.has(resident.npc)) continue
      this.advanced.add(resident.npc)
      update(resident)
    }
  }

  /** Called immediately before simulation so a same-frame return/escort handoff wins. */
  take(actor: Actor, isResident = false): TownActorUpdate | undefined {
    if (!this.active.has(actor) || this.advanced.has(actor)) return undefined
    this.advanced.add(actor)
    const { mode, groups, orders } = this
    if (mode.kind === 'duel') {
      // Duel owns borrowed residents even when they also occur in a world roster.
      if (this.mission.has(actor)) return 'mission'
      return groups.outskirts?.owns(actor) ? 'outskirts' : 'runtime'
    }
    if (mode.kind === 'defense') {
      // Escort is movement ownership only; the actor stays in combat/hit grids.
      if (orders.isEscorting?.(actor)) return 'escort'
      const missionOwned = orders.isMissionActor?.(actor) ?? this.mission.has(actor)
      if (isResident && orders.ownsPeacefulTravel?.(actor)
        && (actor.townCategory === 'civilian' || !missionOwned)) return 'peace'
      if (groups.command?.has(actor) || groups.external?.has(actor) && !missionOwned) return 'runtime'
    } else if (orders.isRetirementEvacuating?.(actor)) return 'retirement'
    if (groups.command?.has(actor)) return 'runtime'
    if (groups.personal?.owns(actor)) return 'personal'
    if (groups.patrol?.has(actor)) return 'runtime'
    if (groups.airPatrol?.owns(actor)) return 'air-patrol'
    if (groups.outskirts?.owns(actor)) return 'outskirts'
    if (mode.kind === 'field' && mode.veteran && groups.external?.has(actor) && !this.mission.has(actor)) return 'runtime'
    return 'mission'
  }
}
