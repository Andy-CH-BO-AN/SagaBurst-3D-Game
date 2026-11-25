import * as THREE from 'three'
import type { CareerProfile } from '../career/CareerProfile'
import { CareerProfileStore } from '../career/CareerProfileStore'
import { commitCareerTutorial, deferCareerTutorial, recordCareerTutorialOperation } from '../career/CareerTutorial'
import { CAREER_TUTORIAL_OPERATIONS } from '../career/CareerTutorialState'
import type { CareerTutorialLaunch } from '../career/CareerTutorialLaunch'
import { MissionGuide } from '../career/MissionGuide'
import type { CombatEvent } from '../combat/CombatAttribution'
import { WEAPONS } from '../rpg/WeaponDatabase'
import '../ui/career-hud.css'

interface TutorialStepSpec {
  icon: string
  title: string
  flow: readonly { key?: string; label: string }[]
  note?: string
}

const RECRUIT_STEPS: Record<string, TutorialStepSpec> = {
  look: {
    icon: 'move',
    title: '視角與移動練習',
    flow: [
      { key: '點擊', label: '鎖定視角' },
      { key: '滑鼠', label: '轉向' },
      { key: 'WASD', label: '走到黃標' },
    ],
  },
  equipment: {
    icon: 'bag',
    title: '裝備近戰武器',
    flow: [
      { key: 'Tab', label: '開啟裝備' },
      { label: '選近戰武器' },
      { key: 'Tab', label: '關閉' },
    ],
    note: '滾輪可快速切換武器',
  },
  'melee-hit-1': {
    icon: 'sword',
    title: '近戰實戰命中',
    flow: [
      { label: '靠近 0m 假人' },
      { key: '左鍵', label: '揮擊 2 次' },
    ],
    note: '有效命中兩次即可',
  },
  shield: {
    icon: 'shield',
    title: '舉盾防禦練習',
    flow: [
      { key: 'Tab', label: '裝盾並關閉' },
      { key: '長按右鍵', label: '舉盾' },
    ],
    note: '體力不足時先喘息恢復',
  },
  'bow-hit': {
    icon: 'bow',
    title: '弓箭射擊練習',
    flow: [
      { key: 'Tab', label: '換弓卸盾' },
      { key: '右鍵', label: '瞄準' },
      { key: '左鍵', label: '蓄力射 10m 假人' },
    ],
    note: '弓與盾不可並用 · 缺箭點「補給」',
  },
  'cat-mounted': {
    icon: 'mount',
    title: '騎乘代步黑貓',
    flow: [
      { label: '靠近黑貓' },
      { key: 'E', label: '上坐騎' },
    ],
    note: '借用坐騎加速前往馬匹區',
  },
  'horse-mounted': {
    icon: 'horse',
    title: '換乘普通練習馬',
    flow: [
      { label: '騎向練習馬' },
      { key: 'E', label: '下貓' },
      { key: 'E', label: '上馬' },
    ],
  },
  'mount-impact': {
    icon: 'charge',
    title: '戰馬衝撞假人',
    flow: [
      { key: 'W', label: '沿跑道加速' },
      { key: 'Shift', label: '衝刺撞擊 0m 假人' },
    ],
  },
  dismounted: {
    icon: 'check',
    title: '撞擊成功 · 下馬完成',
    flow: [
      { key: 'E', label: '下馬結算' },
    ],
    note: '位置不理想可按「重置」',
  },
}

const CAPTAIN_STEPS: Record<string, TutorialStepSpec> = {
  hud: {
    icon: 'squad',
    title: '認識指揮介面',
    flow: [
      { label: '查看左側小隊欄' },
      { label: '30 名演練 AI' },
    ],
    note: '演練傷亡不影響城防與私兵',
  },
  selected: {
    icon: 'flag',
    title: '選取指揮目標',
    flow: [
      { key: '1', label: '選第 1 隊' },
    ],
    note: '或按 Q 滾輪選隊・中鍵確認',
  },
  formation: {
    icon: 'formation',
    title: '部署部隊列陣',
    flow: [
      { key: '1', label: '第 1 隊' },
      { key: '4', label: '列陣' },
      { key: 'E / 左鍵', label: '地面確認' },
    ],
    note: 'Q 取消不算完成',
  },
  defend: {
    icon: 'shield',
    title: '原地防禦指令',
    flow: [
      { key: '1', label: '第 1 隊' },
      { key: '3', label: 'Defend 防禦' },
    ],
    note: '觀察與列陣後移動的差異',
  },
  attack: {
    icon: 'sword',
    title: '接敵攻擊指令',
    flow: [
      { key: '1', label: '第 1 隊' },
      { key: '1', label: 'Attack 攻擊' },
    ],
    note: '開放交戰 · 遠程保留射距',
  },
  charge: {
    icon: 'charge',
    title: '全軍衝鋒指令',
    flow: [
      { key: '1', label: '第 1 隊' },
      { key: '2', label: 'Charge 衝鋒' },
    ],
    note: '敵軍全滅仍可繼續下令',
  },
  back: {
    icon: 'back',
    title: '返回與模式切換',
    flow: [
      { key: '1', label: '開命令' },
      { key: 'Q', label: '返回上級' },
    ],
    note: '再按 Q 可切換指揮／換裝滾輪',
  },
}

export interface TutorialSceneFrame {
  position: THREE.Vector3
  cameraYaw: number
  cameraPitch: number
  inputLocked: boolean
  hidden: boolean
  paused: boolean
  dead: boolean
  onFoot: boolean
  mountedOnPracticeHorse: boolean
  /** The training ground's black cat; the transit mount before the practice horse. */
  mountedOnPracticeCat: boolean
  catPosition?: THREE.Vector3
  shieldRaised: boolean
  horsePosition?: THREE.Vector3
  friendlyCount: number
}

/** Persistence and presentation for the explicit scene session; Game owns all gameplay evidence. */
export class CareerTutorialScene {
  private readonly store = new CareerProfileStore()
  private profile: CareerProfile
  private readonly root = document.createElement('section')
  private readonly stagePill = document.createElement('span')
  private readonly replayPill = document.createElement('span')
  private readonly progressRail = document.createElement('div')
  private readonly progressCount = document.createElement('span')
  private readonly glyph = document.createElement('span')
  private readonly title = document.createElement('h3')
  private readonly flow = document.createElement('div')
  private readonly checklist = document.createElement('div')
  private readonly note = document.createElement('p')
  private readonly contextEl = document.createElement('p')
  private readonly status = document.createElement('small')
  private readonly retry = document.createElement('button')
  private readonly leave = document.createElement('button')
  private readonly reset = document.createElement('button')
  private readonly guide = new MissionGuide('career-tutorial-scene-guide')
  private pending?: () => void
  private equippedViaUi = false
  private previousYaw?: number
  private previousPitch?: number
  private looked = 0
  private hudVisibleSeconds = 0
  private disposed = false
  private returnQueued = false
  private contextHint = ''
  private statusTone: 'saved' | 'warn' | 'error' = 'saved'
  private inputLocked = false
  readonly movementPoint = new THREE.Vector3(109, 0, 43)
  /** The 0m dummy at the end of the 125m runway; the existing dummy takes repeated mount impacts. */
  readonly impactPoint = new THREE.Vector3(100, 0, 40)

  constructor(readonly launch: CareerTutorialLaunch, private readonly actions: { returnToTown(): void; reset(): void; clearInput(): void }) {
    const loaded = this.store.loadChecked()
    if (!loaded.profile || loaded.error || loaded.profile.tutorial?.careerId !== launch.careerId
      || loaded.profile.tutorial.session?.id !== launch.sessionId || loaded.profile.tutorial.session.stage !== launch.stage) {
      throw new Error('教學與目前生涯角色不符，請返回城鎮後重試。')
    }
    this.profile = loaded.profile
    this.root.id = 'career-tutorial-scene'
    this.root.className = 'cts-card'
    this.root.hidden = true

    const head = document.createElement('div')
    head.className = 'cts-head'
    this.stagePill.className = 'cts-stage-pill'
    this.stagePill.textContent = launch.stage === 'recruit' ? '新兵操作訓練' : '隊長指揮 · 30 AI'
    this.replayPill.className = 'cts-replay-pill'
    this.replayPill.textContent = '重播模式'
    this.replayPill.hidden = true
    this.progressRail.className = 'sb-progress-rail'
    this.progressCount.className = 'sb-progress-count'
    head.append(this.stagePill, this.replayPill, this.progressRail, this.progressCount)

    const body = document.createElement('div')
    body.className = 'cts-body'
    const hero = document.createElement('div')
    hero.className = 'cts-hero'
    this.glyph.className = 'sb-glyph sb-glyph-move cts-glyph'
    this.title.className = 'cts-title'
    hero.append(this.glyph, this.title)

    this.flow.className = 'sb-flow'
    this.checklist.className = 'sb-checklist'
    this.note.className = 'cts-note'
    this.contextEl.className = 'cts-context'
    this.contextEl.hidden = true
    body.append(hero, this.flow, this.checklist, this.note, this.contextEl)

    this.status.className = 'cts-status'
    this.status.hidden = true

    const footer = document.createElement('div')
    footer.className = 'cts-footer'
    const escHint = document.createElement('span')
    escHint.className = 'cts-esc-hint'
    const escKey = document.createElement('kbd')
    escKey.className = 'sb-kbd'
    escKey.textContent = 'Esc'
    const escText = document.createElement('span')
    escText.textContent = launch.stage === 'recruit' ? '游標／暫停' : '游標／點畫面返回'
    escHint.append(escKey, escText)

    const actionWrap = document.createElement('div')
    actionWrap.className = 'cts-actions'
    this.leave.className = 'cts-btn'
    this.leave.textContent = '稍後繼續 · 返回城鎮'
    this.leave.onclick = () => this.returnToTown()
    this.reset.className = 'cts-btn'
    this.reset.textContent = '安全重置演練'
    this.reset.onclick = () => { actions.clearInput(); actions.reset() }
    this.retry.className = 'cts-btn cts-btn-retry'
    this.retry.textContent = '重試保存'
    this.retry.hidden = true
    this.retry.onclick = () => {
      actions.clearInput()
      const next = this.pending
      this.pending = undefined
      this.retry.hidden = true
      this.syncCardClass()
      next?.()
    }
    actionWrap.append(this.reset, this.leave, this.retry)
    footer.append(escHint, actionWrap)

    this.root.append(head, body, this.status, footer)
    for (const event of ['mousedown', 'mouseup', 'wheel', 'click']) this.root.addEventListener(event, e => e.stopPropagation())
    document.body.append(this.root)
    this.render()
  }

  get step(): string { return this.profile.tutorial![this.launch.stage].step }
  get complete(): boolean { return this.step === 'complete' }
  get panelBottom(): number { return this.root.getBoundingClientRect().bottom }
  get engagementEnabled(): boolean { return this.launch.stage === 'captain' && ['attack', 'charge', 'back', 'complete'].includes(this.step) }

  private syncCardClass(): void {
    const classes = ['cts-card']
    if (this.inputLocked) classes.push('is-locked')
    if (!this.retry.hidden) classes.push('has-retry')
    if (this.complete) classes.push('is-complete')
    this.root.className = classes.join(' ')
  }

  private setStatus(text: string, tone: 'saved' | 'warn' | 'error' = 'saved'): void {
    this.statusTone = tone
    this.status.textContent = text
    this.status.hidden = !text
    this.status.className = tone === 'error'
      ? 'cts-status is-error'
      : tone === 'warn'
        ? 'cts-status is-warn'
        : 'cts-status'
  }

  operation(event: string): void {
    if (this.disposed || this.pending || this.complete) return
    const result = commitCareerTutorial(this.store, this.launch.careerId,
      next => recordCareerTutorialOperation(next, this.launch.stage, event), this.launch.sessionId)
    if (result.ok) {
      this.profile = result.profile
      this.contextHint = ''
      this.setStatus(event === 'mount-impact' ? '衝撞成功！進度已保存' : '進度已保存', 'saved')
      this.render()
      return
    }
    if (result.reason === 'rejected') return
    this.setStatus('尚未保存；完成與獎勵尚未提交，請重試。', 'error')
    this.pending = () => this.operation(event)
    this.retry.hidden = false
    this.syncCardClass()
  }

  equipmentSelected(): void { this.equippedViaUi = true }
  equipmentClosed(meleeEnabled: boolean): void {
    if (this.launch.stage === 'recruit' && this.step === 'equipment' && this.equippedViaUi && meleeEnabled) {
      this.operation('equipment'); this.equippedViaUi = false
    }
  }

  /** `ridingPracticeHorse` is read by Game at the moment of the hit; the event itself carries no mount identity. */
  combat(event: CombatEvent, ridingPracticeHorse = false): void {
    if (this.launch.stage !== 'recruit' || event.type !== 'damage_applied' || event.appliedDamage <= 0
      || event.source.actorType !== 'player' || event.source.actorId !== 'player' || event.target.targetType !== 'training') return
    if (this.step === 'melee-hit-1' && event.method === 'melee' && event.target.targetId === 'training:0') this.operation('melee-hit')
    if (this.step === 'mount-impact' && event.method === 'mount-impact' && ridingPracticeHorse
      && event.target.targetId === 'training:0') this.operation('mount-impact')
    if (this.step === 'bow-hit' && event.method === 'projectile' && event.target.targetId === 'training:10'
      && event.weaponId && WEAPONS[event.weaponId]?.combatKind === 'bow') this.operation('bow-hit')
  }

  update(frame: TutorialSceneFrame, dt: number): void {
    if (this.disposed) return
    if (this.complete && !this.returnQueued) {
      this.returnQueued = true
      // Finish the current Game frame before disposing its actors and renderer.
      queueMicrotask(() => { if (!this.disposed) this.returnToTown() })
    }
    this.root.hidden = frame.hidden
    if (frame.hidden) { this.guide.hide(); return }
    if (this.inputLocked !== frame.inputLocked) {
      this.inputLocked = frame.inputLocked
      this.syncCardClass()
    }
    this.positionBelowCompass()
    if (frame.paused) {
      this.previousYaw = this.previousPitch = undefined
      this.guide.hide(); return
    }
    if (frame.dead) {
      this.setStatus('演練中倒下不扣生涯軍功；可安全重置或返回城鎮。', 'warn')
      this.guide.hide(); return
    }
    if (this.launch.stage === 'captain') {
      if (this.step === 'hud' && frame.friendlyCount === 30 && frame.inputLocked) {
        this.hudVisibleSeconds += dt
        if (this.hudVisibleSeconds >= 2) this.operation('hud')
      }
      this.guide.hide(); return
    }
    if (!frame.inputLocked && !this.complete) {
      this.setStatus('點擊遊戲畫面取得滑鼠控制；Esc 可釋放游標。', 'warn')
      this.guide.hide(); return
    }
    if (this.statusTone === 'warn' && !this.pending) {
      this.setStatus(this.profile.tutorial![this.launch.stage].replay ? '重播：不重複領獎' : '', 'saved')
    }
    if (this.previousYaw !== undefined && this.previousPitch !== undefined) {
      this.looked += Math.min(.3, Math.abs(frame.cameraYaw - this.previousYaw) + Math.abs(frame.cameraPitch - this.previousPitch))
    }
    this.previousYaw = frame.cameraYaw; this.previousPitch = frame.cameraPitch
    if (this.step === 'look') {
      if (this.looked > .12 && !this.profile.tutorial!.recruit.operations.includes('look')) this.operation('look')
      if (frame.onFoot && Math.hypot(frame.position.x - this.movementPoint.x, frame.position.z - this.movementPoint.z) < 1.6
        && !this.profile.tutorial!.recruit.operations.includes('movement')) this.operation('movement')
    }
    if (this.step === 'shield' && frame.shieldRaised) this.operation('shield')
    if (this.step === 'cat-mounted' && frame.mountedOnPracticeCat) this.operation('cat-mounted')
    if (this.step === 'horse-mounted' && frame.mountedOnPracticeHorse) this.operation('horse-mounted')
    let target: THREE.Vector3 | null = null, label = ''
    if (this.step === 'look') { target = this.movementPoint; label = '移動練習標記' }
    else if (this.step === 'melee-hit-1') { target = new THREE.Vector3(100, 0, 40); label = '0m 近戰假人' }
    else if (this.step === 'bow-hit') { target = new THREE.Vector3(100 + Math.sin(-1.05) * 10, 0, 40 - Math.cos(-1.05) * 10); label = '10m 射擊假人' }
    else if (this.step === 'cat-mounted') { target = frame.catPosition ?? null; label = '最近的黑貓 · 按 E 騎乘' }
    else if (this.step === 'mount-impact' && frame.mountedOnPracticeHorse) { target = this.impactPoint; label = '衝撞假人 · W 加速 · Shift 衝刺' }
    else if (this.needsHorse(frame)) {
      // Resuming or resetting puts the player back at spawn: the black cat is the transit again, without undoing progress.
      if (this.needsCatTransit(frame)) { target = frame.catPosition ?? null; label = '最近的黑貓 · 按 E 騎乘' }
      else { target = frame.horsePosition ?? null; label = frame.mountedOnPracticeCat ? '指定普通練習馬' : '普通練習馬 · 按 E 上馬' }
    }
    this.setContextHint(this.mountHint(frame))
    this.guide.updateRace(frame.position, frame.cameraYaw, target, label)
  }

  /** Steps that all end at the practice horse, whether first time or after a resume/reset. */
  private needsHorse(frame: TutorialSceneFrame): boolean {
    return ['horse-mounted', 'mount-impact', 'dismounted'].includes(this.step) && !frame.mountedOnPracticeHorse
  }

  private distanceToHorse(frame: TutorialSceneFrame): number {
    return frame.horsePosition ? Math.hypot(frame.position.x - frame.horsePosition.x, frame.position.z - frame.horsePosition.z) : 0
  }

  /** On foot and far from the horse (and not already next to it): ride the nearest black cat there. */
  private needsCatTransit(frame: TutorialSceneFrame): boolean {
    return frame.onFoot && !!frame.catPosition && this.distanceToHorse(frame) > 12
  }

  /** Mounting steps depend on what the player is riding right now, so the base hint is refined every frame. */
  private mountHint(frame: TutorialSceneFrame): string {
    const otherMount = !frame.onFoot && !frame.mountedOnPracticeCat && !frame.mountedOnPracticeHorse
    if (this.step === 'cat-mounted') return otherMount ? '這不是黑貓。按 E 下騎，改騎最近的黑貓。' : ''
    if (!this.needsHorse(frame)) return ''
    if (frame.mountedOnPracticeCat) return this.distanceToHorse(frame) < 12 ? '已到達普通練習馬。按 E 下騎，改騎普通馬。' : '騎乘黑貓前往普通練習馬。'
    if (otherMount) return '這不是黑貓或普通馬。按 E 下騎，改騎指定的普通練習馬。'
    if (this.needsCatTransit(frame)) return '先騎最近的黑貓（按 E）前往普通練習馬，再改騎普通馬。'
    return this.step === 'dismounted' ? '靠近普通練習馬，按 E 上馬後再按 E 下馬。' : '靠近普通練習馬，按 E 上馬。'
  }

  private setContextHint(hint: string): void {
    if (hint === this.contextHint) return
    this.contextHint = hint
    this.render()
  }

  /** The existing scene update follows the live compass and wrapping HUD without another listener/RAF. */
  private positionBelowCompass(): void {
    const compass = document.getElementById('compass-container')
    if (!compass || typeof this.root.getBoundingClientRect !== 'function') return
    const anchor = compass.getBoundingClientRect(), bounds = this.root.getBoundingClientRect()
    const center = anchor.left + anchor.width / 2
    const left = center - bounds.width / 2, right = center + bounds.width / 2
    let top = anchor.bottom + 12
    const blockers = document.querySelectorAll<HTMLElement>('.army-command-targets, .army-command-commands, .army-command-feedback, #training-ground-ui .training-title, #training-ground-ui .training-actions, #training-ground-ui .training-damage')
    for (const element of blockers) {
      const style = getComputedStyle(element)
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue
      const rect = element.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0 && rect.left < right && rect.right > left
        && rect.top < top + bounds.height && rect.bottom > top) top = rect.bottom + 12
    }
    this.root.style.left = `${Math.round(center)}px`
    this.root.style.top = `${Math.round(top)}px`
    this.root.style.maxHeight = `${Math.max(100, window.innerHeight - top - 12)}px`
  }

  returnToTown(): void {
    if (this.disposed) return
    this.actions.clearInput()
    const result = commitCareerTutorial(this.store, this.launch.careerId,
      next => deferCareerTutorial(next, this.launch.stage), this.launch.sessionId)
    if (!result.ok) {
      this.setStatus('返回狀態尚未保存，仍留在本場。請重試。', 'error')
      this.pending = () => this.returnToTown()
      this.retry.hidden = false
      this.syncCardClass()
      return
    }
    this.actions.returnToTown()
  }

  private renderFlow(steps: readonly { key?: string; label: string }[]): void {
    this.flow.textContent = ''
    if (!steps.length) {
      this.flow.hidden = true
      return
    }
    this.flow.hidden = false
    steps.forEach((step, index) => {
      if (index > 0) {
        const sep = document.createElement('span')
        sep.className = 'sb-flow-sep'
        sep.textContent = '›'
        this.flow.append(sep)
      }
      const item = document.createElement('span')
      item.className = 'sb-flow-item'
      if (step.key) {
        const kbd = document.createElement('kbd')
        kbd.className = 'sb-kbd'
        kbd.textContent = step.key
        item.append(kbd)
      }
      const label = document.createElement('span')
      label.className = 'sb-flow-label'
      label.textContent = step.label
      item.append(label)
      this.flow.append(item)
    })
  }

  private renderChecks(checks: readonly { label: string; done: boolean }[]): void {
    this.checklist.textContent = ''
    if (!checks.length) {
      this.checklist.hidden = true
      return
    }
    this.checklist.hidden = false
    for (const check of checks) {
      const chip = document.createElement('span')
      chip.className = check.done ? 'sb-check-chip is-done' : 'sb-check-chip'
      const mark = document.createElement('span')
      mark.className = 'sb-check-mark'
      mark.textContent = check.done ? '✓' : '○'
      const label = document.createElement('span')
      label.textContent = check.label
      chip.append(mark, label)
      this.checklist.append(chip)
    }
  }

  private renderProgressRail(total: number, activeIndex: number, complete: boolean): void {
    this.progressRail.textContent = ''
    for (let i = 0; i < total; i++) {
      const seg = document.createElement('span')
      seg.className = complete || i < activeIndex
        ? 'sb-progress-seg is-done'
        : i === activeIndex
          ? 'sb-progress-seg is-active'
          : 'sb-progress-seg'
      this.progressRail.append(seg)
    }
    this.progressCount.textContent = `${complete ? total : activeIndex + 1}/${total}`
  }

  private render(): void {
    const state = this.profile.tutorial![this.launch.stage]
    const groups = CAREER_TUTORIAL_OPERATIONS[this.launch.stage]
    const total = groups.length
    const activeIndex = Math.max(0, groups.findIndex(group => group.some(op => !state.operations.includes(op))))
    this.replayPill.hidden = !state.replay
    this.renderProgressRail(total, activeIndex, this.complete)
    this.syncCardClass()

    if (this.complete) {
      this.glyph.className = 'sb-glyph sb-glyph-check cts-glyph'
      this.title.textContent = state.replay
        ? '重播完成 · 正在返回城鎮'
        : this.launch.stage === 'recruit'
          ? '訓練完成 · 100 軍功已入帳'
          : '指揮訓練完成 · 正在返回城鎮'
      this.renderFlow([])
      this.renderChecks([])
      this.note.textContent = state.replay
        ? '不重複發放軍功，也不計入正式任務'
        : this.launch.stage === 'recruit'
          ? '回城後前往武器店購買第一把武器'
          : '回城後可到人力資源中心招募私兵'
      this.note.hidden = false
      this.contextEl.hidden = true
      this.contextEl.textContent = ''
      this.leave.textContent = '前往城鎮'
      return
    }

    const spec = (this.launch.stage === 'recruit' ? RECRUIT_STEPS : CAPTAIN_STEPS)[this.step]
    this.glyph.className = `sb-glyph sb-glyph-${spec?.icon ?? 'move'} cts-glyph`
    this.title.textContent = spec?.title ?? '依目前標記完成操作'
    this.renderFlow(spec?.flow ?? [])

    const checks: { label: string; done: boolean }[] = []
    if (this.launch.stage === 'recruit' && this.step === 'look') {
      checks.push(
        { label: '轉動視角', done: state.operations.includes('look') },
        { label: '走到黃標', done: state.operations.includes('movement') },
      )
    } else if (this.launch.stage === 'recruit' && this.step === 'melee-hit-1') {
      checks.push(
        { label: '命中 1', done: state.operations.includes('melee-hit-1') },
        { label: '命中 2', done: state.operations.includes('melee-hit-2') },
      )
    }
    this.renderChecks(checks)

    this.note.textContent = spec?.note ?? ''
    this.note.hidden = !spec?.note

    if (this.contextHint) {
      this.contextEl.textContent = this.contextHint
      this.contextEl.hidden = false
    } else {
      this.contextEl.textContent = ''
      this.contextEl.hidden = true
    }

    this.leave.textContent = '稍後繼續 · 返回城鎮'
    if (state.replay && !this.status.textContent) {
      this.setStatus('重播：不重複領獎', 'saved')
    }
  }

  dispose(): void { this.disposed = true; this.pending = undefined; this.guide.dispose(); this.root.remove() }
}
