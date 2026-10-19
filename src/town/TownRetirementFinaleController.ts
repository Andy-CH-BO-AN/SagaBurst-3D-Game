import { cloneCareerProfile, type CareerProfile } from '../career/CareerProfile'
import {
  atCommanderRetirementRally, beginCommanderRetirementFinalStand, CareerRetirementFinaleOwner,
  COMMANDER_RETIREMENT_FINAL_STAND_SECONDS,
} from '../career/CareerRetirementFinale'
import { hasCompleteRetirementMobilizationCheckpoint } from '../career/CareerRetirementMobilization'
import type { NPC } from '../world/NPC'
import { Faction } from '../combat/CombatFaction'
import type { TownRetirementMobilizationController } from './TownRetirementMobilizationController'
import type { TownEagleGarrisonController } from './TownEagleGarrisonController'

interface FinaleDependencies {
  read(): CareerProfile
  publish(profile: CareerProfile): void
  /** Raw, dedicated retirement transaction. Must not recapture a latched ending. */
  save(profile: CareerProfile): boolean
  capture(profile: CareerProfile): void
  residents: readonly { npc: NPC; spec: { id: string } }[]
  mobilization: TownRetirementMobilizationController
  eagles: TownEagleGarrisonController
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
  private readonly attackers = new Set<NPC>()

  constructor(private readonly deps: FinaleDependencies) {
    const ids = new Set(deps.mobilization.formations?.flatMap(formation => formation.actorIds) ?? [])
    for (const { spec, npc } of deps.residents) if (ids.has(spec.id)) this.attackers.add(npc)
  }

  get active(): boolean { return this.deps.read().careerRetirement?.phase === 'final-stand' }
  get frozen(): boolean { return Boolean(this.owner.outcome) || this.completed }
  get remainingSeconds(): number {
    return Math.max(0, COMMANDER_RETIREMENT_FINAL_STAND_SECONDS - (this.deps.read().careerRetirement?.combatElapsedSeconds ?? 0))
  }
  owns(npc: NPC): boolean { return this.attackers.has(npc) }

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
      const next = beginCommanderRetirementFinalStand(snapshot)
      if (!next || !this.deps.save(next)) {
        this.retryRemaining = 1
        this.deps.failed('最後點名尚未保存，城鎮仍未進攻。請留在集合點重試。')
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

  /** Native damage may kill the player during the frame; resolve before generic outcomes. */
  afterCombat(position: { x: number; z: number }, dead: boolean): void {
    if (this.active && !this.frozen && dead) this.advance(0, position, true)
  }

  private advance(dt: number, position: { x: number; z: number }, dead: boolean): void {
    let current = this.deps.read()
    const terminal = dead || current.careerRetirement!.combatElapsedSeconds + dt >= COMMANDER_RETIREMENT_FINAL_STAND_SECONDS
    if (terminal) {
      current = cloneCareerProfile(current)
      this.deps.capture(current)
    }
    this.deps.publish(this.owner.advance(current, { deltaSeconds: dt, playerPosition: position, playerDead: dead }))
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
    const next = this.owner.fastForward(current)
    if (!next || !this.deps.save(next)) return false
    this.deps.publish(next)
    return true
  }
}
