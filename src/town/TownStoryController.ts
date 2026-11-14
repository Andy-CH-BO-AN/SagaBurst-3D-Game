import type { Vector3 } from 'three'
import type { CareerProfile } from '../career/CareerProfile'
import { MissionGuide } from '../career/MissionGuide'
import { markCareerStoryEagleIntroSeen } from '../career/CareerStoryEvents'
import { cloneCareerProfile } from '../career/CareerProfile'
import { selectStoryGuidance, storyDialogueOpen, type StoryGuidance, type StoryGuidanceKey } from '../career/CareerStoryGuidance'
import { TownTutorialHUD } from './TownUI'

export interface TownStoryHost {
  profile(): CareerProfile
  commit(profile: CareerProfile): boolean
  peaceful(): boolean
  /** A panel, report or result screen is open. */
  blocked(): boolean
  playerPosition(): Vector3
  cameraYaw(): number
  npcPosition(id: string): Vector3 | null
  serviceAvailable(id: string): boolean
  /** Riding an owned, usable ordinary horse that the race entry rules accept. */
  raceHorseReady(): boolean
  /** An accepted tutorial stage owns the arrow and the Sergeant/Commander dialogue; story waits. */
  tutorialOccupied(): boolean
  acceptRace(): void
  acceptSpar(): void
  closePanel(): void
  /** Opens the NPC's original service panel, bypassing the story dialogue. */
  openServices(serviceId: string): void
}

const OPENING_MS = 7000
const SAVE_RETRY_MS = 3000

/**
 * Town story presentation: exactly one arrow at a time (invitation → appointment → first eagle) plus the two NPC
 * invitations. All qualification comes from the Career model; this class only draws it and forwards acceptance.
 */
export class TownStoryController {
  private readonly guide = new MissionGuide('career-story-guide')
  private readonly hud = new TownTutorialHUD('career-story')
  private readonly deferred = new Set<StoryGuidanceKey>()
  private readonly opened = new Set<StoryGuidanceKey>()
  private current: StoryGuidance | null = null
  private notice = ''
  private noticeUntil = 0
  private openingUnsaved = false
  private retryAfter = 0
  private busy = false

  constructor(private readonly host: TownStoryHost) {}

  /** True while this frame's arrow is the story's; the tutorial yields its passive or deferred hints meanwhile. */
  get guiding(): boolean { return this.current !== null }
  get currentKey(): StoryGuidanceKey | null { return this.current?.key ?? null }

  update(now = performance.now()): void {
    const h = this.host
    this.current = null
    if (!h.peaceful() || h.tutorialOccupied() || h.blocked()) { this.hide(); return }
    const guidance = selectStoryGuidance(h.profile(), {
      raceHorseReady: h.raceHorseReady(), deferred: this.deferred,
      available: npc => h.serviceAvailable(npc) && h.npcPosition(npc) !== null,
    })
    const target = guidance && h.npcPosition(guidance.npc)
    if (!guidance || !target) { this.hide(); return }
    this.current = guidance
    if (guidance.opening && !this.opened.has(guidance.key)) {
      // The opening line plays once, ever: the receipt is saved and a session-local flag covers a failed save.
      this.opened.add(guidance.key)
      this.notice = guidance.opening; this.noticeUntil = now + OPENING_MS
      this.openingUnsaved = true
    }
    if (this.openingUnsaved && now >= this.retryAfter) {
      const next = cloneCareerProfile(h.profile())
      markCareerStoryEagleIntroSeen(next)
      this.openingUnsaved = !h.commit(next)
      this.retryAfter = this.openingUnsaved ? now + SAVE_RETRY_MS : 0
    }
    this.hud.render(`${guidance.title}\n${guidance.detail}`, now < this.noticeUntil ? this.notice : '', '', false)
    this.guide.updateTutorial(h.playerPosition(), h.cameraYaw(), target, guidance.npcName, true)
  }

  private hide(): void {
    this.guide.hide()
    this.hud.render('', '', '', true)
  }

  /** The invitation dialogue of this NPC, shown before its ordinary services. */
  hasDialogue(serviceId: string): boolean {
    const h = this.host
    return h.peaceful() && !h.tutorialOccupied() && storyDialogueOpen(h.profile(), serviceId)
  }

  private button(parent: HTMLElement, label: string, action: () => void): HTMLButtonElement {
    const b = document.createElement('button')
    b.className = 'town-button'
    b.textContent = label
    b.onclick = action
    parent.append(b)
    return b
  }

  /** Dismissing keeps the invitation pending; the arrow steps aside for the rest of this scene. */
  private later(key: StoryGuidanceKey): void {
    this.deferred.add(key)
    this.current = null
    this.host.closePanel()
  }

  renderDialogue(panel: HTMLElement, serviceId: string): boolean {
    if (!this.hasDialogue(serviceId)) return false
    const h = this.host
    panel.querySelectorAll('button, nav, article, .town-mission-tabs, .town-products, .town-shop-tabs, .town-shop-categories').forEach(el => el.remove())
    const title = panel.querySelector('h2'), body = panel.querySelector('p')
    if (serviceId === 'commander') {
      if (title) title.textContent = h.profile().faction === 'roman' ? '羅馬指揮官' : '維京指揮官'
      const ready = h.raceHorseReady()
      if (body) body.textContent = '「聽說你買了戰馬。光有馬不夠，我想看看你騎得怎樣。\n\n沿著城牆繞一圈：隊長會帶你到北門，倒數後起跑，我騎馬與你同場。你可以按 Shift 衝刺，我不會。首場邀請賽有特別獎勵：勝利 +500 軍功，就算輸了也有 +29。」'
        + (ready ? '' : '\n\n（請先按 Tab → 坐騎，召喚並騎乘你的戰馬，再來找我。）')
      const accept = this.button(panel, '接受繞城賽馬', () => {
        if (this.busy) return
        this.busy = true; accept.disabled = true
        try { h.acceptRace() } finally { this.busy = false }
      })
      accept.disabled = !ready
      this.button(panel, '晚點再來', () => this.later('story:commander-circuit-race'))
      this.button(panel, '任命／其他服務', () => h.openServices('commander'))
      return true
    }
    if (title) title.textContent = '士官長'
    if (body) body.textContent = '「剛才打得不錯。幾個老兵說，你們新兵光會打仗還不夠，得學會一起打。去競技場，讓他們看看你們怎麼配合。」\n\n小隊切磋（T1 新兵試煉）：我方含你 20 人對 10 名 T2 士兵，全員步戰；你倒下後可以觀戰，我方全員倒下才算敗北。首場邀請賽有特別獎勵：勝利 +1,000 軍功，就算輸了也有 +100。'
    const accept = this.button(panel, '接受小隊切磋', () => {
      if (this.busy) return
      this.busy = true; accept.disabled = true
      try { h.acceptSpar() } finally { this.busy = false }
    })
    this.button(panel, '晚點再來', () => this.later('story:veteran-squad-spar'))
    this.button(panel, '查看正式任務與其他服務', () => h.openServices('deployment'))
    return true
  }

  dispose(): void {
    this.guide.dispose()
    this.hud.dispose()
  }
}
