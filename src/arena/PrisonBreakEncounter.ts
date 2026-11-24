import type { Vector3 } from 'three'
import { commitPrisonBreakReturn, type MissionReturnHome } from '../career/CareerMissionReturnRecovery'
import {
  claimPrisonSword, crossedPrisonExit, prisonOutcome, prisonTaunt, settlePrisonBreak, PRISON_COOP_PARTNER, PRISON_SWORD_ID,
  type PrisonBreakState,
} from '../career/CareerPrisonBreak'
import { cloneCareerProfile, type CareerProfile } from '../career/CareerProfile'
import type { CareerMissionOutcome } from '../career/CareerMissionState'
import type { PlayerBattleStats } from '../combat/BattleStatsTracker'
import type { CoopMessage } from '../coop/CoopLink'
import type { InventoryManager } from '../rpg/InventoryManager'
import { WEAPONS } from '../rpg/WeaponDatabase'
import type { InteractionCandidate } from '../world/InteractionFocus'
import { InteractionFocus } from '../world/InteractionFocus'
import type { NPC } from '../world/NPC'
import type { ArenaPhase } from './ArenaOpeningGate'
import type { DuelArenaId } from './DuelArenaCatalog'

const PLAYER_HALF_HEIGHT = 0.95
/** The guest's pickup reach as seen on the host: the player's 2m prompt plus snapshot latency. */
const COOP_PRISON_PICKUP_RANGE = 3

export interface PrisonSwordProp { readonly position: Vector3; readonly visible: boolean }
/** The rendered cell block: swords on the floor and the gate. */
export interface PrisonBreakPropsPort {
  readonly swords: readonly PrisonSwordProp[]
  setSelectedSword(index: number | null): void
  syncSwords(state: PrisonBreakState): void
  setOpen(open: boolean, animate: boolean): void
}
export interface PrisonBody {
  readonly actorId: string
  readonly team: 'friendly' | 'enemy'
  readonly previousPosition: Vector3
  readonly npc: Pick<NPC, 'dead' | 'combatPosition' | 'battlefieldUnarmed' | 'applyCareerEquipment' | 'setTacticalOrder'>
}
export interface PrisonPlayerView { readonly position: Vector3; readonly previousPosition: Vector3; readonly dead: boolean }
export interface PrisonPartnerView { readonly combatPosition: Vector3; readonly previousPosition: Vector3 | null }
interface PendingSettlement { readonly outcome: CareerMissionOutcome; readonly escapedBy?: string; readonly player: PlayerBattleStats }

/** What the encounter needs from the arena scene: saves, pause UI, bodies and the few visible surfaces. */
export interface PrisonBreakHost {
  readonly arenaId: DuelArenaId
  /** 'player' on the host page, the co-op partner on a guest page. */
  readonly swordOwner: string
  readonly props: PrisonBreakPropsPort
  readonly hud: { hidden: boolean; textContent: string | null }
  readonly prompt: { show(text: string | null): void; notify(text: string): void } | undefined
  readonly inventory: Pick<InventoryManager, 'addWeapon' | 'equipWeapon' | 'meleeEnabled'>
  isGuest(): boolean
  phase(): ArenaPhase
  profile(): CareerProfile
  /** Replace the in-memory profile without saving (a guest mirror, or a settled result). */
  adoptProfile(next: CareerProfile): void
  /** Save and adopt `next`; false leaves everything as it was. */
  commit(next: CareerProfile): boolean
  /** Raw store write for a settlement the encounter stages itself. */
  save(next: CareerProfile): boolean
  captureProgress(): CareerProfile | null
  /** Freeze combat on a failed save: lock input and offer `retry`. */
  pauseForSave(retry: () => void): void
  savePending(): boolean
  panelOpen(): boolean
  guards(): { total: number; standing: number; friendlyAlive: number }
  bodies(): readonly PrisonBody[]
  player(): PrisonPlayerView
  partner(): PrisonPartnerView | null
  takePartnerRequests(): number[]
  inputLocked(): boolean
  cameraYaw(): number
  /** The host re-sends its prison state to the guest at once. */
  resyncCoop(): void
  playerStats(): PlayerBattleStats
  freezeForResult(): void
  showTaunt(line: string): void
  showUnsaved(retry: () => void): void
  /** A result is saved and adopted: mark settled, tell a co-op guest and show the result panel. */
  settled(): void
  townReturn(): readonly MissionReturnHome[]
}

/** Prison break rules in play: sword claims, HUD text, crossing results and the co-op mirror. The scene renders and delegates. */
export class PrisonBreakEncounter {
  private readonly focus = new InteractionFocus<PrisonSwordProp>()
  private pending: PendingSettlement | null = null
  private pendingProfile: CareerProfile | null = null
  private guestGuards: number | null = null
  private guestOutcome: CareerMissionOutcome | null = null
  private guestFighting = false
  constructor(private readonly host: PrisonBreakHost) {}

  /** A decided result whose save failed: combat stays frozen until the retry. */
  get settlementPending(): boolean { return this.pending !== null }

  private get state(): PrisonBreakState { return this.host.profile().activeMission!.prisonBreak! }

  clearPickupFocus(): void {
    this.focus.clear()
    this.host.prompt?.show(null)
    this.host.props.setSelectedSword(null)
  }

  private candidates(): InteractionCandidate<PrisonSwordProp>[] {
    const { host } = this, prison = this.state
    if (prison.gateOpen || (host.isGuest() ? !this.guestFighting : host.phase() !== 'fight') || host.savePending() || host.panelOpen()
      || host.player().dead || !host.inputLocked() || Object.values(prison.swords).includes(host.swordOwner)) return []
    return host.props.swords.filter(sword => sword.visible).map(sword => ({
      target: sword, position: sword.position, range: 2, action: 'equip',
      prompt: `[E] 拾起並裝備 · ${WEAPONS[PRISON_SWORD_ID].name}`,
    }))
  }

  updatePickupFocus(): void {
    const yaw = this.host.cameraYaw()
    const selected = this.focus.select(this.candidates(), this.host.player().position, { x: -Math.sin(yaw), z: -Math.cos(yaw) })
    this.host.props.setSelectedSword(selected ? this.host.props.swords.indexOf(selected.target) : null)
    this.host.prompt?.show(selected?.prompt ?? null)
  }

  /** A co-op guest's E press: the sword index to ask the host for, never a local claim. */
  requestedSword(pressed: boolean): number | null {
    const selected = this.focus.pressed(pressed, this.candidates(), this.host.player().position)
    return selected ? this.host.props.swords.indexOf(selected.target) : null
  }

  pickupSwords(pressed: boolean): void {
    const { host } = this, prison = this.state
    if (host.savePending() || prison.gateOpen) return
    const selected = this.focus.pressed(pressed, this.candidates(), host.player().position)
    // Preserve the existing sword order and player-before-NPC priority for each sword.
    for (let i = 0; i < host.props.swords.length; i++) {
      const mesh = host.props.swords[i]
      if (!mesh.visible) continue
      const npc = host.bodies().find(body => body.team === 'friendly' && !body.npc.dead && body.npc.battlefieldUnarmed && mesh.position.distanceTo(body.npc.combatPosition) < 1.4)
      const owner = selected?.target === mesh ? 'player' : npc?.actorId
      if (owner && !this.equipSword(i, owner)) return
    }
    for (const index of host.takePartnerRequests()) {
      const partner = host.partner(), mesh = host.props.swords[index]
      if (!partner || !mesh?.visible || mesh.position.distanceTo(partner.combatPosition) > COOP_PRISON_PICKUP_RANGE) continue
      if (!this.equipSword(index, PRISON_COOP_PARTNER)) return
    }
  }

  /** The claim is saved before any hand or world sword changes; a refused save pauses and retries the same claim. */
  private equipSword(index: number, owner: string): boolean {
    const { host } = this
    const claimed = claimPrisonSword(this.state, index, owner)
    if (!claimed) return true
    const next = cloneCareerProfile(host.profile()); next.activeMission!.prisonBreak = claimed
    if (!host.commit(next)) { host.pauseForSave(() => this.equipSword(index, owner)); return false }
    host.props.syncSwords(claimed)
    if (owner === 'player') this.armPlayer()
    // The guest arms itself from the next prison state, sent at once.
    else if (owner === PRISON_COOP_PARTNER) host.resyncCoop()
    else {
      const npc = host.bodies().find(body => body.actorId === owner)!.npc
      npc.battlefieldUnarmed = false
      npc.applyCareerEquipment({ meleeWeaponId: PRISON_SWORD_ID, rangedWeaponId: null, shieldId: null, mountId: null })
      npc.setTacticalOrder('attack')
    }
    return true
  }

  private armPlayer(): void {
    const { inventory } = this.host
    inventory.addWeapon(PRISON_SWORD_ID); inventory.equipWeapon(PRISON_SWORD_ID); inventory.meleeEnabled = true
    this.host.prompt?.notify(`已裝備 · ${WEAPONS[PRISON_SWORD_ID].name}`)
  }

  updateHud(): void {
    const { host } = this, prison = this.state, hud = host.hud
    hud.hidden = host.phase() === 'result'
    const { total, standing: hostStanding } = host.guards()
    // A co-op guest shows the host's count: its own page has only mirrors of the standing guards.
    const standing = host.isGuest() ? this.guestGuards ?? total : hostStanding
    hud.textContent = prison.gateOpen ? '鐵門已開｜穿過出口' : `越獄目標｜擊倒看守 ${total - standing}／${total}`
    if (host.isGuest() && this.guestOutcome) {
      hud.textContent = `${this.guestOutcome === 'victory' ? '逃出牢籠' : '逃脫失敗'}｜等待主機返回小鎮`
      return
    }
    if (host.player().dead) hud.textContent += '\n你已倒下，正在觀戰；友軍仍可逃脫（WASD 移動視角）'
  }

  /** The last guard fell: the gate opens in one commit with the final combat state. False when the save was refused. */
  openGateIfCleared(): boolean {
    const { host } = this
    if (host.guards().standing !== 0 || this.state.gateOpen) return true
    const next = host.captureProgress()!
    next.activeMission!.prisonBreak!.gateOpen = true
    if (!host.commit(next)) return false
    host.props.setOpen(true, true)
    return true
  }

  /** A living prisoner (or the co-op partner) crossing the open exit decides the result; true once it is settling. */
  resolveResult(): boolean {
    const { host } = this
    if (host.phase() === 'result') return false
    const half = (p: Vector3) => ({ x: p.x, y: p.y + PLAYER_HALF_HEIGHT, z: p.z })
    const friend = host.bodies().find(body => body.team === 'friendly' && !body.npc.dead
      && crossedPrisonExit(host.arenaId, half(body.previousPosition), half(body.npc.combatPosition)))
    const player = host.player()
    const playerCrossed = !player.dead && crossedPrisonExit(host.arenaId, player.previousPosition, player.position)
    // The co-op partner is one more living prisoner: its proxy crossing the exit frees the team.
    const partner = host.partner()
    const partnerCrossed = Boolean(partner?.previousPosition && crossedPrisonExit(host.arenaId, half(partner.previousPosition), half(partner.combatPosition)))
    const result = prisonOutcome({ playerDead: player.dead, friendlyAlive: host.guards().friendlyAlive,
      gateOpen: this.state.gateOpen, playerCrossed, friendlyCrossed: Boolean(friend) || partnerCrossed })
    if (!result) return false
    this.finish(result, playerCrossed ? 'player' : friend?.actorId ?? (partnerCrossed ? PRISON_COOP_PARTNER : undefined))
    return true
  }

  /** Settle once: a refused save freezes the decided outcome and the staged snapshot for the retry. */
  finish(outcome: CareerMissionOutcome, escapedBy?: string): void {
    const { host } = this
    // A settled encounter never writes or shows its result twice.
    if (!this.pendingProfile && this.state.result) return
    const firstAttempt = !this.pending
    if (this.pending) { outcome = this.pending.outcome; escapedBy = this.pending.escapedBy }
    // Freeze the final snapshot in memory. Exactly one write owns combat, receipt and reward.
    const staged = this.pendingProfile ?? host.captureProgress()
    if (!staged) return
    const state = staged.activeMission!.prisonBreak!
    host.freezeForResult()
    this.clearPickupFocus()
    if (firstAttempt && outcome === 'failure') {
      const line = prisonTaunt(state.captor, state.gateOpen, host.guards().standing)
      if (line) host.showTaunt(line)
    }
    const saved = settlePrisonBreak(staged, outcome, next => host.save(next), escapedBy)
    if (!saved) {
      this.pendingProfile = staged
      this.pending = { outcome, escapedBy, player: host.playerStats() }
      host.showUnsaved(() => this.finish(outcome, escapedBy))
      return
    }
    host.adoptProfile(saved); this.pending = null; this.pendingProfile = null
    host.settled()
  }

  /** Clears the settled encounter back to Town/HR; false keeps the arena for a retry. */
  commitReturn(): boolean {
    const { host } = this
    return Boolean(commitPrisonBreakReturn(host.profile(), host.profile().activeMission!.id, host.townReturn(), next => host.commit(next)))
  }

  /** Guest: apply the host's encounter to this page's in-memory copy only; the host alone saves it. */
  applyCoopState(message: CoopMessage): void {
    const { host } = this, prison = this.state
    const raw = message.swords
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof message.gateOpen !== 'boolean') return
    const swords: Record<string, string> = {}
    for (const [index, owner] of Object.entries(raw as Record<string, unknown>)) if (/^[0-5]$/.test(index) && typeof owner === 'string') swords[index] = owner
    this.guestGuards = typeof message.guards === 'number' && Number.isFinite(message.guards) ? Math.max(0, message.guards) : null
    this.guestOutcome = message.outcome === 'victory' || message.outcome === 'failure' ? message.outcome : null
    this.guestFighting = message.fight === true
    const opening = message.gateOpen && !prison.gateOpen
    if (!opening && JSON.stringify(swords) === JSON.stringify(prison.swords)) return
    const armed = !Object.values(prison.swords).includes(PRISON_COOP_PARTNER) && Object.values(swords).includes(PRISON_COOP_PARTNER)
    const next = cloneCareerProfile(host.profile()), state = next.activeMission!.prisonBreak!
    state.swords = swords
    state.gateOpen ||= message.gateOpen
    host.adoptProfile(next)
    host.props.syncSwords(state)
    if (opening) { host.props.setOpen(true, true); this.clearPickupFocus() }
    if (armed) this.armPlayer()
  }
}
