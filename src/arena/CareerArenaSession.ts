import { claimCareerMission, clearCareerMission, cloneCareerProfile, type CareerProfile } from '../career/CareerProfile'
import type { CareerProfileStore } from '../career/CareerProfileStore'
import { resolveCareerPlayerMaxHp } from '../career/CareerPlayerProfile'
import type { ActiveCareerMission, CareerMissionOutcome } from '../career/CareerMissionState'
import type { PlayerBattleStats } from '../combat/BattleStatsTracker'
import type { SoundManager } from '../audio/SoundManager'
import { DEFAULT_PLAYER_MAX_HP, type Player } from '../player/Player'
import type { PlayerInput } from '../player/PlayerInput'
import { canAwardPlayerSkillProgression, type SkillProgressionAward } from '../rpg/CombatSkillProgression'
import type { SkillManager } from '../rpg/SkillManager'

/** Seconds between best-effort skill saves while nothing levels up. */
const SKILL_FLUSH_SECONDS = 5

/** A decided arena result and the stats it was decided with, held until its save succeeds. */
export interface ArenaSettlement {
  readonly outcome: CareerMissionOutcome
  readonly player: PlayerBattleStats
  /** Stats the merit is paid on; `undefined` lets the claim use its own default. */
  readonly merit: PlayerBattleStats | undefined
}

export type ArenaSessionPlayer = Pick<Player, 'dead' | 'spectatorOnly' | 'hp' | 'setMaxHp' | 'setHp' | 'clearTownAction'> & { blockingLevel: number }

/** The modal the session writes save-failure prompts and retry buttons into. */
export interface ArenaSessionPanel {
  readonly isOpen: boolean
  show(title: string, text: string): void
  button(label: string, action: () => void): void
  close(): void
}

export interface CareerArenaSessionHost<S extends ArenaSettlement> {
  /** Player-facing name of the event in save-failure wording, e.g. 單挑 or 試煉. */
  readonly noun: string
  readonly panel: ArenaSessionPanel
  readonly store: Pick<CareerProfileStore, 'save'>
  readonly skills: SkillManager
  readonly sound: SoundManager
  readonly input: Pick<PlayerInput, 'clear'>
  player(): ArenaSessionPlayer
  /** Runs once a claim is really about to be attempted (not when already settled). */
  onClaiming?(): void
  /** Adds scene-specific fields to the profile that is claimed, in the same save transaction. */
  stageClaim?(staged: CareerProfile, settlement: S): void
  /** Adjusts the cleared profile before the return-to-Town save. */
  prepareReturn?(next: CareerProfile, active: ActiveCareerMission): void
  openResult(result: NonNullable<ActiveCareerMission['result']>): void
  /** Disposes the scene and hands control back to Town. */
  leave(): void
}

/** The centred modal both Career arena scenes use for results and save retries. */
export class ArenaPanel implements ArenaSessionPanel {
  private element: HTMLElement | null = null

  constructor(private readonly id: string) {}

  get isOpen(): boolean { return this.element !== null }

  show(title: string, text: string): void {
    this.close()
    const panel = document.createElement('section')
    panel.id = this.id
    panel.className = 'town-panel'
    panel.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:10002;min-width:340px;max-width:560px;background:#1b1712f0;color:#f2eadb;border:1px solid #8a6f45;border-radius:10px;padding:20px 22px;font:15px/1.6 system-ui;white-space:pre-line'
    const heading = document.createElement('h2')
    heading.textContent = title
    heading.style.margin = '0 0 10px'
    const body = document.createElement('p')
    body.textContent = text
    panel.append(heading, body)
    document.body.append(panel)
    this.element = panel
  }

  button(label: string, action: () => void): void {
    if (!this.element) return
    const button = document.createElement('button')
    button.className = 'town-button'
    button.textContent = label
    button.style.marginRight = '8px'
    button.onclick = action
    this.element.append(button)
  }

  close(): void { this.element?.remove(); this.element = null }
}

/**
 * The Career save transactions shared by the arena scenes: profile commits, skill XP
 * persistence, claiming a decided result exactly once (a failed save freezes that same
 * settlement until the player retries) and clearing the mission on the way back to Town.
 * Combat routing and result wording stay with each scene.
 */
export class CareerArenaSession<S extends ArenaSettlement> {
  readonly panel: ArenaSessionPanel
  private currentProfile: CareerProfile
  private pending: S | null = null
  private isSettled = false
  private skillsDirty = false

  constructor(profile: CareerProfile, private readonly host: CareerArenaSessionHost<S>) {
    this.currentProfile = profile
    this.panel = host.panel
  }

  get profile(): CareerProfile { return this.currentProfile }
  get settled(): boolean { return this.isSettled }
  /** A decided result whose save failed; combat stays frozen while it is set. */
  get pendingSettlement(): S | null { return this.pending }

  commit(next: CareerProfile): boolean {
    if (!this.host.store.save(next)) return false
    this.currentProfile = next
    return true
  }

  awardSkillXp({ skill, xp }: SkillProgressionAward): void {
    const player = this.host.player()
    if (xp <= 0 || !canAwardPlayerSkillProgression({ dead: player.dead, spectatorOnly: player.spectatorOnly, observer: false })) return
    const skills = this.host.skills
    const levels = skills.addXp(skill, xp, this.host.sound)
    player.blockingLevel = skills.skillState.blocking.level
    this.skillsDirty = true
    if (levels > 0) {
      this.flushSkills()
      const before = player.hp
      const maxHp = resolveCareerPlayerMaxHp(this.currentProfile, DEFAULT_PLAYER_MAX_HP)
      player.setMaxHp(maxHp, false)
      player.setHp(Math.min(maxHp, before + levels))
    }
  }

  flushSkills(): void {
    if (!this.skillsDirty) return
    const next = cloneCareerProfile(this.currentProfile)
    next.skills = this.host.skills.skillState
    if (this.commit(next)) this.skillsDirty = false
  }

  /** Per-frame best-effort skill save on a fixed cadence of scene time. */
  tickSkillFlush(elapsed: number, dt: number): void {
    if (this.skillsDirty && elapsed % SKILL_FLUSH_SECONDS < dt) this.flushSkills()
  }

  /** Saves the decided result, or the one already frozen by an earlier failed save. */
  finish(capture: () => S): void {
    if (this.isSettled) return
    this.flushSkills()
    const active = this.currentProfile.activeMission
    if (!active || active.result) return
    this.host.onClaiming?.()
    const settlement = this.pending ?? capture()
    const staged = cloneCareerProfile(this.currentProfile)
    this.host.stageClaim?.(staged, settlement)
    const claim = claimCareerMission(staged, active.id, settlement.outcome, settlement.player, settlement.merit)
    if (!this.commit(claim.profile)) {
      this.pending = settlement
      // Release the pointer and held keys so the retry button is clickable at once.
      this.releaseControls()
      this.panel.show(`${this.host.noun}結算尚未保存`, '保存失敗；軍功尚未入帳，結果保留在競技場。')
      this.panel.button('重試保存結算', () => { this.panel.close(); this.finish(capture) })
      return
    }
    this.pending = null
    this.isSettled = true
    this.releaseControls()
    this.host.openResult(this.currentProfile.activeMission!.result!)
  }

  /** Marks a result as shown (a reload of an already-claimed mission included). */
  markSettled(): void { this.isSettled = true }

  addReturnButton(): void {
    this.panel.button(`返回 ${this.currentProfile.faction === 'roman' ? 'vinum 村' : 'økse 村'}`, () => this.returnToTown())
  }

  /** Clears the claimed mission exactly like a Town return; a failed save keeps the arena for retry. */
  returnToTown(): void {
    const active = this.currentProfile.activeMission
    if (!active) { this.host.leave(); return }
    const next = clearCareerMission(this.currentProfile, active.id)
    this.host.prepareReturn?.(next, active)
    if (!this.commit(next)) {
      this.panel.show('返回狀態尚未保存', `${this.host.noun}結算仍安全保留。請重試保存後返回小鎮。`)
      this.panel.button('重試返回小鎮', () => this.returnToTown())
      return
    }
    this.host.leave()
  }

  private releaseControls(): void {
    this.host.input.clear()
    this.host.player().clearTownAction()
    document.exitPointerLock?.()
  }
}
