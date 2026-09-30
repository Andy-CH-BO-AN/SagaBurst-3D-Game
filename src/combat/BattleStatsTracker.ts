import type { SquadId } from '../battle/CommandTarget'
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
 * an event log, so runtime memory depends on the player + <= 8 squad counters,
 * not battle duration or hit count.
 */
export class BattleStatsTracker {
  private readonly playerTotals = emptyCombatTotals()
  private readonly squads = new Map<SquadId, MutableSquadTotals>()
  private readonly registeredSquadActors = new Set<string>()
  private readonly unsubscribe: () => void

  constructor(
    events: CombatEventStream,
    private readonly trackStructureStats = true,
    private readonly acceptEvent: (event: CombatEvent) => boolean = () => true,
  ) {
    this.unsubscribe = events.subscribe(event => this._onEvent(event))
  }

  registerNpc(npc: NPC): void {
    if (
      npc.faction !== Faction.PLAYER
      || npc.squadId === undefined
      || this.registeredSquadActors.has(npc.combatantId)
    ) {
      return
    }

    this.registeredSquadActors.add(npc.combatantId)
    this._squad(npc.squadId).startingMembers++
  }

  snapshot(npcs: readonly NPC[], player: Player): BattleStatsSnapshot {
    // Survivors are intentionally calculated only when a result snapshot is
    // requested. Do not turn this into a per-frame 200v200 scan.
    const survivorsBySquad = new Map<SquadId, number>()
    for (const npc of npcs) {
      if (npc.faction !== Faction.PLAYER || npc.squadId === undefined || npc.dead) continue
      survivorsBySquad.set(
        npc.squadId,
        (survivorsBySquad.get(npc.squadId) ?? 0) + 1,
      )
    }

    const squads = [...this.squads.entries()]
      .sort(([a], [b]) => a - b)
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
    }
  }

  dispose(): void {
    this.unsubscribe()
  }

  private _onEvent(event: CombatEvent): void {
    if (!this.acceptEvent(event)) return
    if (event.type === 'damage_applied') {
      if (event.source.actorType === 'player') {
        this.playerTotals.damageDealt += event.appliedDamage
      }
      if (event.source.squadId !== undefined) {
        this._squad(event.source.squadId).damageDealt += event.appliedDamage
      }

      if (event.target.targetId === 'player') {
        this.playerTotals.damageTaken += event.appliedDamage
      }
      if (event.target.squadId !== undefined && event.target.targetType !== 'mount') {
        this._squad(event.target.squadId).damageTaken += event.appliedDamage
      }
      return
    }

    if (event.type === 'actor_killed') {
      if (event.source.actorType === 'player') this.playerTotals.kills++
      if (event.source.squadId !== undefined) this._squad(event.source.squadId).kills++
      return
    }

    if (!this.trackStructureStats) return

    if (event.type === 'structure_damaged') {
      if (event.source.actorType === 'player') {
        this.playerTotals.structureDamage += event.appliedDamage
      }
      if (event.source.squadId !== undefined) {
        this._squad(event.source.squadId).structureDamage += event.appliedDamage
      }
      return
    }

    if (event.type === 'structure_destroyed') {
      const gate = event.target.structureKind === 'gate'
      if (event.source.actorType === 'player') {
        this.playerTotals.structuresDestroyed++
        if (gate) this.playerTotals.gateBreaches++
      }
      if (event.source.squadId !== undefined) {
        const squad = this._squad(event.source.squadId)
        squad.structuresDestroyed++
        if (gate) squad.gateBreaches++
      }
    }
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
