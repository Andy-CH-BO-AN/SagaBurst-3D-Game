import { cloneCareerProfile, type CareerProfile } from '../career/CareerProfile'
import {
  areAllRetirementEnemiesDefeated, atCommanderRetirementRally, beginCommanderRetirementFinalStand, CareerRetirementFinaleOwner,
  COMMANDER_RETIREMENT_FINAL_STAND_SECONDS,
} from '../career/CareerRetirementFinale'
import { hasCompleteRetirementMobilizationCheckpoint } from '../career/CareerRetirementMobilization'
import { personalMissionSourcePolicy, type PersonalSquadMission } from '../career/CareerPersonalSquadMission'
import type { CareerRetirementStats } from '../career/CareerRetirementState'
import { BattleStatsTracker } from '../combat/BattleStatsTracker'
import { CombatEventStream, type CombatActorRef, type CombatEvent } from '../combat/CombatAttribution'
import { emptyPersonalContribution } from '../combat/CommandMerit'
import type { NPC } from '../world/NPC'
import { Faction } from '../combat/CombatFaction'
import type { TownRetirementMobilizationController } from './TownRetirementMobilizationController'
import type { TownEagleGarrisonController } from './TownEagleGarrisonController'

type FinaleEnemy = Pick<NPC, 'combatantId' | 'dead' | 'combatOwnership' | 'setCommandAllegiance'
  | 'setCommandSquad' | 'releaseOutpostRampartGarrison' | 'beginTownHostility'>

interface FinaleDependencies {
  read(): CareerProfile
  publish(profile: CareerProfile): void
  /** Raw, dedicated retirement transaction. Must not recapture a latched ending. */
  save(profile: CareerProfile): boolean
  capture(profile: CareerProfile): void
  privateFightersAlive(): boolean
  privateSquad(): Readonly<PersonalSquadMission> | undefined
  residents: readonly { npc: FinaleEnemy; spec: { id: string } }[]
  mobilization: Pick<TownRetirementMobilizationController, 'formations' | 'reconcile'>
  eagles: Pick<TownEagleGarrisonController, 'beginRetirementFinalStand'>
  betray(restored: boolean): void
  complete(profile: CareerProfile): void
  failed(message: string): void
}

/** Dedicated finale runtime. Native actors/combat stay with their existing owners. */
export class TownRetirementFinaleController {
  private readonly owner = new CareerRetirementFinaleOwner()
  private started = false
  private completed = false
  private retryRemaining = 0
  private readonly events = new CombatEventStream()
  private tracker?: BattleStatsTracker
  private personalIds: ReadonlySet<string> = new Set()
  private acceptsPersonalSource: (source: CombatActorRef) => boolean = () => false
  private readonly attackers = new Set<FinaleEnemy>()
  private readonly expectedEnemyIds: ReadonlySet<string>
  private readonly enemiesById = new Map<string, FinaleEnemy>()

  constructor(private readonly deps: FinaleDependencies) {
    const ids = new Set(deps.mobilization.formations?.flatMap(formation => formation.actorIds) ?? [])
    this.expectedEnemyIds = ids
    for (const { spec, npc } of deps.residents) if (ids.has(spec.id)) {
      this.attackers.add(npc)
      this.enemiesById.set(spec.id, npc)
    }
  }

  get active(): boolean { return this.deps.read().careerRetirement?.phase === 'final-stand' }
  get frozen(): boolean { return Boolean(this.owner.outcome) || this.completed }
  get remainingSeconds(): number {
    return Math.max(0, COMMANDER_RETIREMENT_FINAL_STAND_SECONDS - (this.deps.read().careerRetirement?.combatElapsedSeconds ?? 0))
  }
  owns(npc: NPC): boolean { return this.attackers.has(npc) }

  get stats(): CareerRetirementStats {
    const saved = this.deps.read().retirementRuntime?.stats
    return {
      player: { ...emptyPersonalContribution(), damageTaken: 0, ...(this.tracker?.checkpoint() ?? saved?.player) },
      personal: { ...emptyPersonalContribution(), damageTaken: 0, ...(this.tracker?.commandCheckpoint() ?? saved?.personal) },
    }
  }

  /** Shares the native combat stream without mission attribution or reward settlement. */
  recordEvent(event: CombatEvent): void {
    if (this.started && this.active && !this.frozen) this.events.emit(event)
  }

  /** Called after resource capture replaces retirementRuntime, before any save/latch. */
  captureStats(profile: CareerProfile): void {
    if (profile.retirementRuntime) profile.retirementRuntime.stats = this.stats
  }

  dispose(): void { this.tracker?.freeze(); this.tracker?.dispose() }

  private startStats(): void {
    const profile = this.deps.read(), squad = this.deps.privateSquad()
    const owned = new Set(profile.personalSquad?.members.map(member => member.id) ?? [])
    // Use the runtime's accepted roster, not allegiance alone. Keep IDs after death so
    // already-fired private projectiles retain the same source policy as missions.
    const personalSquad = squad ? { ...squad, memberIds: squad.memberIds.filter(id => owned.has(id)) } : undefined
    this.personalIds = new Set(personalSquad?.memberIds ?? [])
    this.acceptsPersonalSource = personalMissionSourcePolicy({ personalSquad })
    const saved = profile.retirementRuntime?.stats
    this.tracker = new BattleStatsTracker(this.events, false, event => this.acceptStatsEvent(event), saved?.player, {
      acceptsSource: this.acceptsPersonalSource,
      initialMemberIds: [...this.personalIds],
      initialContribution: saved?.personal,
    })
  }

  private canonicalEnemy(id: string | undefined): boolean {
    return id !== undefined && this.expectedEnemyIds.has(id) && this.enemiesById.get(id)?.combatantId === id
  }

  private acceptStatsEvent(event: CombatEvent): boolean {
    if (event.type !== 'damage_applied' && event.type !== 'actor_killed') return false
    const { source, target } = event
    const friendlySource = source.actorType === 'player' && source.actorId === 'player'
      || this.acceptsPersonalSource(source)
    if (friendlySource) return target.allegiance === Faction.TOWN
      && (target.targetType === 'npc' && this.canonicalEnemy(target.targetId)
        || event.type === 'damage_applied' && target.targetType === 'mount' && this.canonicalEnemy(target.ownerActorId))
    // Incoming damage has its own ownership boundary. Mount HP is never soldier HP.
    return event.type === 'damage_applied' && source.actorType === 'npc'
      && source.allegiance === Faction.TOWN && this.canonicalEnemy(source.actorId)
      && (target.targetType === 'player' && target.targetId === 'player'
        || target.targetType === 'npc' && target.squadId === 'personal' && this.personalIds.has(target.targetId))
  }

  /** Entry/reload applies only a persisted final phase, after native checkpoint restore. */
  reconcile(): boolean {
    if (!this.active || this.started) return true
    const profile = this.deps.read()
    if (!profile.careerRetirement?.mobilization || !hasCompleteRetirementMobilizationCheckpoint(profile)
      || !this.deps.mobilization.reconcile() || !this.deps.mobilization.formations) return false
    this.beginBetrayal(true)
    return true
  }

  private beginBetrayal(restored: boolean): void {
    this.startStats()
    this.started = true
    this.deps.eagles.beginRetirementFinalStand()
    // Every canonical formation receives its order in this same pass. Native movement,
    // attack profiles, target selection and boarding determine natural arrival times.
    for (const npc of this.attackers) {
      npc.combatOwnership = undefined
      npc.setCommandAllegiance(Faction.TOWN)
      npc.setCommandSquad(undefined)
      npc.releaseOutpostRampartGarrison()
      npc.beginTownHostility()
    }
    this.deps.betray(restored)
  }

  /** Runs before combat. A terminal candidate freezes immediately, before any later damage. */
  beforeCombat(dt: number, position: { x: number; z: number }, dead: boolean): boolean {
    this.retryRemaining = Math.max(0, this.retryRemaining - Math.max(0, dt))
    if (this.frozen) { this.retryCompletion(); return true }
    const current = this.deps.read()
    if (current.careerRetirement?.phase === 'mobilizing' && !dead && atCommanderRetirementRally(position)) {
      if (this.retryRemaining > 0 || !this.deps.mobilization.reconcile()) return false
      const snapshot = cloneCareerProfile(current)
      this.deps.capture(snapshot)
      this.captureStats(snapshot)
      const next = beginCommanderRetirementFinalStand(snapshot)
      if (!next || !this.deps.save(next)) {
        this.retryRemaining = 1
        this.deps.failed('最後點名尚未保存，城鎮仍未進攻。請留在集合區重試。')
        return false
      }
      this.deps.publish(next)
      this.beginBetrayal(false)
      return true
    }
    if (!this.active) return false
    if (!this.reconcile()) return true
    this.advance(dt, position, dead)
    return this.frozen
  }

  /** Resolve both armies after native damage, before generic mission/death outcomes. */
  afterCombat(position: { x: number; z: number }, dead: boolean): void {
    if (this.active && !this.frozen) this.advance(0, position, dead)
  }

  private advance(dt: number, position: { x: number; z: number }, dead: boolean): void {
    let current = this.deps.read()
    const privateFightersAlive = this.deps.privateFightersAlive()
    const allTownEnemiesDefeated = areAllRetirementEnemiesDefeated(this.expectedEnemyIds, this.enemiesById)
    const terminal = dead && !privateFightersAlive || allTownEnemiesDefeated
      || current.careerRetirement!.combatElapsedSeconds + dt >= COMMANDER_RETIREMENT_FINAL_STAND_SECONDS
    if (terminal) {
      this.tracker?.freeze()
      current = cloneCareerProfile(current)
      this.deps.capture(current)
      this.captureStats(current)
    }
    this.deps.publish(this.owner.advance(current, { deltaSeconds: dt, playerPosition: position, playerDead: dead,
      privateFightersAlive, allTownEnemiesDefeated }))
    if (this.frozen) this.retryCompletion()
  }

  private retryCompletion(): void {
    if (this.completed || this.retryRemaining > 0) return
    const completed = this.owner.retryCompletion(profile => this.deps.save(profile))
    if (!completed) {
      this.retryRemaining = 1
      this.deps.failed('結局保存失敗，戰鬥已暫停；正在重試保存。')
      return
    }
    this.completed = true
    this.deps.publish(completed)
    this.deps.complete(completed)
  }

  /** This adapter and its caller both enforce the explicit development-only entry. */
  fastForwardForQa(): boolean {
    if (!import.meta.env.DEV || new URLSearchParams(location.search).get('careerQa') !== 'retirement' || this.frozen) return false
    const current = cloneCareerProfile(this.deps.read())
    this.deps.capture(current)
    this.captureStats(current)
    const next = this.owner.fastForward(current)
    if (!next || !this.deps.save(next)) return false
    this.deps.publish(next)
    return true
  }
}
