import { squadDisplayOrder, type SquadId as OfficialSquadId, type SquadIdentity as SquadId } from '../battle/CommandTarget'
import { emptyPersonalContribution, mergePersonalMerit, type PersonalCombatContribution } from './CommandMerit'
import type { CombatActorRef } from './CombatAttribution'
import type { Player } from '../player/Player'
import { Faction, type NPC } from '../world/NPC'
import type {
  CombatEvent,
  CombatEventStream,
} from './CombatAttribution'

export interface PlayerBattleStats {
  damageDealt: number
  damageTaken: number
  kills: number
  structureDamage: number
  structuresDestroyed: number
  gateBreaches: number
  survived: boolean
}

export type PlayerBattleStatsCheckpoint = Omit<PlayerBattleStats, 'survived'>

export interface SquadBattleStats {
  squadId: SquadId
  damageDealt: number
  damageTaken: number
  kills: number
  structureDamage: number
  structuresDestroyed: number
  gateBreaches: number
  startingMembers: number
  survivors: number
  casualties: number
}

export interface BattleStatsSnapshot {
  player: PlayerBattleStats
  squads: SquadBattleStats[]
  meritPlayer?: PlayerBattleStats
  /** Native allies have no command squad and contribute no player command merit. */
  nativeDefenders?: { startingMembers: number; survivors: number; casualties: number; damageDealt: number; damageTaken: number; kills: number }
}

export interface PlayerCommandMeritPolicy {
  acceptsSource(source: CombatActorRef): boolean
  acceptsEvent?(event: CombatEvent): boolean
  initialContribution?: PersonalCombatContribution
  initialMemberIds?: readonly string[]
  departedSurvivors?(): readonly string[]
  official?: {
    initialSquads?: readonly { squadId: OfficialSquadId; memberIds: readonly string[]; contribution?: PersonalCombatContribution }[]
    acceptsSource(source: CombatActorRef): boolean
    initialContribution?: PersonalCombatContribution
    initialMemberIds?: readonly string[]
    departedSurvivors?(): readonly string[]
  }
}

interface MutableCombatTotals {
  damageDealt: number
  damageTaken: number
  kills: number
  structureDamage: number
  structuresDestroyed: number
  gateBreaches: number
}

interface MutableSquadTotals extends MutableCombatTotals {
  startingMembers: number
}

function emptyCombatTotals(): MutableCombatTotals {
  return {
    damageDealt: 0,
    damageTaken: 0,
    kills: 0,
    structureDamage: 0,
    structuresDestroyed: 0,
    gateBreaches: 0,
  }
}

function emptySquadTotals(): MutableSquadTotals {
  return {
    ...emptyCombatTotals(),
    startingMembers: 0,
  }
}

/**
 * Streaming battle aggregate.
 *
 * Combat events are consumed and discarded immediately. The tracker never keeps
 * an event log, so runtime memory depends on the player + official/private squad counters,
 * not battle duration or hit count.
 */
export class BattleStatsTracker {
  private readonly playerTotals: MutableCombatTotals
  private readonly squads = new Map<SquadId, MutableSquadTotals>()
  private readonly registeredSquadActors = new Map<string, SquadId>()
  private readonly unsubscribe: () => void
  private readonly commandContribution: PersonalCombatContribution
  private readonly officialContribution: PersonalCombatContribution
  private readonly officialSquadIds = new Set<OfficialSquadId>()
  private frozen = false

  constructor(
    events: CombatEventStream,
    private readonly trackStructureStats = true,
    private readonly acceptEvent: (event: CombatEvent) => boolean = () => true,
    initialPlayerTotals: Partial<PlayerBattleStatsCheckpoint> = {},
    private readonly commandMerit?: PlayerCommandMeritPolicy,
  ) {
    const value = (input: number | undefined): number => Number.isFinite(input) && (input ?? 0) > 0 ? input! : 0
    this.playerTotals = {
      damageDealt: value(initialPlayerTotals.damageDealt),
      damageTaken: value(initialPlayerTotals.damageTaken),
      kills: Math.floor(value(initialPlayerTotals.kills)),
      structureDamage: value(initialPlayerTotals.structureDamage),
      structuresDestroyed: Math.floor(value(initialPlayerTotals.structuresDestroyed)),
      gateBreaches: Math.floor(value(initialPlayerTotals.gateBreaches)),
    }
    this.commandContribution = { ...emptyPersonalContribution(), ...commandMerit?.initialContribution }
    this.officialContribution = { ...emptyPersonalContribution(), ...commandMerit?.official?.initialContribution }
    if (commandMerit) {
      const personal = this._squad('personal')
      Object.assign(personal, this.commandContribution)
      for (const id of commandMerit.initialMemberIds ?? []) this.registeredSquadActors.set(id, 'personal')
      personal.startingMembers = commandMerit.initialMemberIds?.length ?? 0
      if (commandMerit.official) {
        const squads = commandMerit.official.initialSquads ?? [{ squadId: 1 as const,
          memberIds: commandMerit.official.initialMemberIds ?? [], contribution: this.officialContribution }]
        for (const squad of squads) {
          this.officialSquadIds.add(squad.squadId)
          const official = this._squad(squad.squadId)
          if (squad.contribution) Object.assign(official, squad.contribution)
          for (const id of squad.memberIds) {
            if (this.registeredSquadActors.has(id)) continue
            this.registeredSquadActors.set(id, squad.squadId)
            official.startingMembers++
          }
        }
      }
    }
    this.unsubscribe = events.subscribe(event => this._onEvent(event))
  }

  checkpoint(): PlayerBattleStatsCheckpoint {
    return { ...this.playerTotals }
  }

  commandCheckpoint(): PersonalCombatContribution {
    const damageTaken = this.squads.get('personal')?.damageTaken ?? 0
    return { ...this.commandContribution, ...(damageTaken > 0 ? { damageTaken } : {}) }
  }
  officialCommandCheckpoint(): PersonalCombatContribution {
    const damageTaken = [...this.officialSquadIds].reduce((sum, id) => sum + (this.squads.get(id)?.damageTaken ?? 0), 0)
    return { ...this.officialContribution, ...(damageTaken > 0 ? { damageTaken } : {}) }
  }
  officialSquadCheckpoints(): { squadId: OfficialSquadId; contribution: PersonalCombatContribution }[] {
    return [...this.officialSquadIds].map(squadId => {
      const { startingMembers: _members, ...totals } = this._squad(squadId)
      return { squadId, contribution: { ...totals } }
    })
  }
  freeze(): void { this.frozen = true }

  registerNpc(npc: NPC, friendly = npc.faction === Faction.PLAYER): void {
    if (
      !friendly
      || npc.squadId === undefined
      || this.registeredSquadActors.has(npc.combatantId)
    ) {
      return
    }

    this.registeredSquadActors.set(npc.combatantId, npc.squadId)
    this._squad(npc.squadId).startingMembers++
  }

  snapshot(npcs: readonly NPC[], player: Player): BattleStatsSnapshot {
    // Survivors are intentionally calculated only when a result snapshot is
    // requested. Do not turn this into a per-frame 200v200 scan.
    const survivorsBySquad = new Map<SquadId, number>()
    for (const npc of npcs) {
      const squadId = this.registeredSquadActors.get(npc.combatantId)
      if (squadId === undefined || npc.dead) continue
      survivorsBySquad.set(
        squadId,
        (survivorsBySquad.get(squadId) ?? 0) + 1,
      )
    }
    const departed = this.commandMerit?.departedSurvivors?.().filter(id => this.registeredSquadActors.has(id)) ?? []
    if (departed.length) survivorsBySquad.set('personal', (survivorsBySquad.get('personal') ?? 0) + new Set(departed).size)
    const liveIds = new Set(npcs.filter(npc => !npc.dead).map(npc => npc.combatantId))
    for (const id of new Set(this.commandMerit?.official?.departedSurvivors?.() ?? [])) {
      const squadId = this.registeredSquadActors.get(id)
      if (typeof squadId === 'number' && this.officialSquadIds.has(squadId) && !liveIds.has(id)) {
        survivorsBySquad.set(squadId, (survivorsBySquad.get(squadId) ?? 0) + 1)
      }
    }

    const squads = [...this.squads.entries()]
      .sort(([a], [b]) => squadDisplayOrder(a) - squadDisplayOrder(b))
      .map(([squadId, totals]) => {
        const survivors = Math.min(
          totals.startingMembers,
          survivorsBySquad.get(squadId) ?? 0,
        )
        return {
          squadId,
          damageDealt: totals.damageDealt,
          damageTaken: totals.damageTaken,
          kills: totals.kills,
          structureDamage: totals.structureDamage,
          structuresDestroyed: totals.structuresDestroyed,
          gateBreaches: totals.gateBreaches,
          startingMembers: totals.startingMembers,
          survivors,
          casualties: Math.max(0, totals.startingMembers - survivors),
        }
      })

    return {
      player: {
        ...this.playerTotals,
        survived: !player.dead,
      },
      squads,
      ...(this.commandMerit ? { meritPlayer: mergePersonalMerit({ ...this.playerTotals, survived: !player.dead }, this.commandContribution, this.officialContribution) } : {}),
    }
  }

  dispose(): void {
    this.unsubscribe()
  }

  private _onEvent(event: CombatEvent): void {
    if (this.frozen || !this.acceptEvent(event)) return
    const meritEvent = this.commandMerit?.acceptsEvent?.(event) ?? true
    const commandSource = event.source.actorType !== 'player' && this.commandMerit?.acceptsSource(event.source) && meritEvent
    const officialSource = event.source.actorType !== 'player' && !commandSource
      && this.commandMerit?.official?.acceptsSource(event.source) && meritEvent
    const contribution = commandSource ? this.commandContribution : officialSource ? this.officialContribution : undefined
    const squadSource = this._sourceCountsForSquad(event.source, Boolean(commandSource), Boolean(officialSource))
    if (event.type === 'damage_applied') {
      if (contribution) contribution.damageDealt += event.appliedDamage
      if (event.source.actorType === 'player') {
        this.playerTotals.damageDealt += event.appliedDamage
      }
      if (squadSource && event.source.squadId !== undefined) {
        this._squad(event.source.squadId).damageDealt += event.appliedDamage
      }

      if (event.target.targetId === 'player') {
        this.playerTotals.damageTaken += event.appliedDamage
      }
      if (this._targetCountsForSquad(event.target) && event.target.squadId !== undefined && event.target.targetType !== 'mount') {
        this._squad(event.target.squadId).damageTaken += event.appliedDamage
      }
      return
    }

    if (event.type === 'actor_killed') {
      if (contribution) contribution.kills++
      if (event.source.actorType === 'player') this.playerTotals.kills++
      if (squadSource && event.source.squadId !== undefined) this._squad(event.source.squadId).kills++
      return
    }

    if (!this.trackStructureStats) return

    if (event.type === 'structure_damaged') {
      if (contribution) contribution.structureDamage += event.appliedDamage
      if (event.source.actorType === 'player') {
        this.playerTotals.structureDamage += event.appliedDamage
      }
      if (squadSource && event.source.squadId !== undefined) {
        this._squad(event.source.squadId).structureDamage += event.appliedDamage
      }
      return
    }

    if (event.type === 'structure_destroyed') {
      const gate = event.target.structureKind === 'gate'
      if (contribution) {
        contribution.structuresDestroyed++
        if (gate) contribution.gateBreaches++
      }
      if (event.source.actorType === 'player') {
        this.playerTotals.structuresDestroyed++
        if (gate) this.playerTotals.gateBreaches++
      }
      if (squadSource && event.source.squadId !== undefined) {
        const squad = this._squad(event.source.squadId)
        squad.structuresDestroyed++
        if (gate) squad.gateBreaches++
      }
    }
  }

  private _sourceCountsForSquad(source: CombatEvent['source'], personalSource: boolean, officialSource: boolean): boolean {
    if (this.commandMerit) {
      const registeredSquad = this.registeredSquadActors.get(source.actorId)
      // Command-owned squad totals are persisted next to their merit. An unrelated event,
      // borrowed ID or PLAYER allegiance must not bypass the same accepted source/event policy.
      if (source.squadId === 'personal' || registeredSquad === 'personal' || source.ownership === 'player-personal') {
        return personalSource && source.squadId === 'personal'
      }
      if (this.commandMerit.official && (source.ownership === 'mission-official'
        || typeof source.squadId === 'number' && this.officialSquadIds.has(source.squadId)
        || typeof registeredSquad === 'number' && this.officialSquadIds.has(registeredSquad))) {
        return officialSource && typeof source.squadId === 'number' && this.officialSquadIds.has(source.squadId)
      }
    }
    return source.allegiance === Faction.PLAYER || this.registeredSquadActors.has(source.actorId)
  }

  private _targetCountsForSquad(target: Extract<CombatEvent, { type: 'damage_applied' }>['target']): boolean {
    return target.allegiance === Faction.PLAYER || this.registeredSquadActors.has(target.targetId)
  }

  private _squad(squadId: SquadId): MutableSquadTotals {
    let totals = this.squads.get(squadId)
    if (!totals) {
      totals = emptySquadTotals()
      this.squads.set(squadId, totals)
    }
    return totals
  }
}
