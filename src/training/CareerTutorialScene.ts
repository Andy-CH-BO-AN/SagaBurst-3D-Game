import * as THREE from 'three'
import type { CareerProfile } from '../career/CareerProfile'
import { CareerProfileStore } from '../career/CareerProfileStore'
import { commitCareerTutorial, deferCareerTutorial, recordCareerTutorialOperation } from '../career/CareerTutorial'
import type { CareerTutorialLaunch } from '../career/CareerTutorialLaunch'
import { MissionGuide } from '../career/MissionGuide'
import type { CombatEvent } from '../combat/CombatAttribution'
import { WEAPONS } from '../rpg/WeaponDatabase'

const RECRUIT_HINTS: Record<string, string> = {
  look: '點擊畫面取得滑鼠控制，移動滑鼠轉動視角／角色朝向，再以 WASD 走到黃色標記。Esc 釋放游標後，重新點擊即可恢復。',
  equipment: '按 Tab 開啟裝備，點選一把近戰武器，再關閉裝備介面。可在 Tab 查看目前裝備；滾輪可切換武器。',
  'melee-hit-1': '走到 0m 近戰假人前，左鍵揮擊。實際有效命中兩次即可，不需要擊殺。',
  shield: '按 Tab 裝備盾牌並關閉介面，按住右鍵舉盾。HP 是生命；體力不足時先休息再移動／攻擊。',
  'bow-hit': '按 Tab 換弓並卸下盾牌：遠程武器與盾牌不能同時使用。按住右鍵瞄準 → 按住左鍵拉弓 → 放開左鍵射擊。命中 10m 假人一次。箭不足可點「補給」。',
  'cat-mounted': '前往最近的黑貓，按 E 騎乘。黑貓只是代步，用來快速前往普通練習馬；借用坐騎只在本場練習使用。',
  'horse-mounted': '騎黑貓前往普通練習馬，到達後按 E 下騎，再靠近普通馬按 E 改騎普通馬。',
  'mount-impact': '騎普通馬沿跑道衝向 0m 假人：W 加速、Shift 衝刺，實際撞中一次即可。',
  dismounted: '撞擊成功！按 E 下馬即可完成訓練。練習馬失效或位置不合理時可按「重置」，免費安全回到起點。',
}
const CAPTAIN_HINTS: Record<string, string> = {
  hud: '你現在可以指揮部隊。指揮 HUD 顯示一支小隊，共 30 名 AI；玩家另外計算。這些是演練副本，傷亡不影響城防或私兵。',
  selected: '按 1 選擇「第 1 隊」。也可按 Q 進入指揮模式，用滾輪選目標、中鍵確認。「選目標」與「下命令」是兩個層級。',
  formation: '選第 1 隊 → 4 Formation／列陣，移動視角把預覽放在合法地面，再按 E、左鍵或中鍵確認。Q 取消不算完成。',
  defend: '選第 1 隊 → 3 Defend／防禦。部隊守住位置，與剛才列陣後的移動做比較。',
  attack: '選第 1 隊 → 1 Attack／攻擊。部隊依現有兵種行為接敵，遠程兵保留射擊距離；此時開放演練交戰。',
  charge: '選第 1 隊 → 2 Charge／衝鋒。部隊積極接近敵軍並投入近戰；與 Attack 的兵種接敵方式不同。敵軍全滅也可繼續下令。',
  back: '按 1 打開小隊命令後按 Q 返回；再按 Q 可切換指揮／換武器模式。指揮模式的滾輪選目標／命令，換武器模式的滾輪切換裝備。',
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
  private readonly text = document.createElement('p')
  private readonly status = document.createElement('small')
  private readonly interactionHint = document.createElement('small')
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
    this.root.style.cssText = 'position:fixed;left:50%;top:0;transform:translateX(-50%);z-index:1102;width:min(440px,calc(100vw - 32px));box-sizing:border-box;overflow:auto;background:#171411e8;color:#fff1cf;padding:14px;border:1px solid #b49968;border-radius:7px;font:15px/1.55 system-ui'
    this.root.hidden = true
    const title = document.createElement('strong'); title.textContent = launch.stage === 'recruit' ? '新兵操作訓練' : '隊長指揮訓練 · 30 名 AI'
    this.leave.textContent = '稍後繼續 · 返回城鎮'; this.leave.onclick = () => this.returnToTown()
    this.reset.textContent = '安全重置演練'; this.reset.onclick = () => { actions.clearInput(); actions.reset() }
    this.retry.textContent = '重試保存'; this.retry.hidden = true; this.retry.onclick = () => { actions.clearInput(); const next = this.pending; this.pending = undefined; this.retry.hidden = true; next?.() }
    this.interactionHint.style.cssText = 'display:block;margin-top:6px;color:#e8d49d'
    this.interactionHint.textContent = launch.stage === 'recruit'
      ? 'Esc 顯示游標，可操作教學按鈕；點「繼續訓練」返回。'
      : 'Esc 顯示游標，可操作教學按鈕；點擊遊戲畫面返回指揮。'
    for (const button of [this.leave, this.reset, this.retry]) button.style.cssText = 'margin:8px 8px 0 0;padding:7px;cursor:pointer'
    this.root.append(title, this.text, this.status, this.interactionHint, this.leave, this.reset, this.retry)
    for (const event of ['mousedown', 'mouseup', 'wheel', 'click']) this.root.addEventListener(event, e => e.stopPropagation())
    document.body.append(this.root)
    this.render()
  }

  get step(): string { return this.profile.tutorial![this.launch.stage].step }
  get complete(): boolean { return this.step === 'complete' }
  get panelBottom(): number { return this.root.getBoundingClientRect().bottom }
  get engagementEnabled(): boolean { return this.launch.stage === 'captain' && ['attack', 'charge', 'back', 'complete'].includes(this.step) }

  operation(event: string): void {
    if (this.disposed || this.pending || this.complete) return
    const result = commitCareerTutorial(this.store, this.launch.careerId,
      next => recordCareerTutorialOperation(next, this.launch.stage, event), this.launch.sessionId)
    if (result.ok) { this.profile = result.profile; this.contextHint = ''; this.status.textContent = event === 'mount-impact' ? '衝撞成功！進度已保存' : '進度已保存'; this.render(); return }
    if (result.reason === 'rejected') return
    this.status.textContent = '尚未保存；完成與獎勵尚未提交，請重試。'
    this.pending = () => this.operation(event); this.retry.hidden = false
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
    this.positionBelowCompass()
    if (frame.paused) {
      this.previousYaw = this.previousPitch = undefined
      this.guide.hide(); return
    }
    if (frame.dead) {
      this.status.textContent = '演練中倒下不扣生涯軍功；可安全重置或返回城鎮。'
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
      this.status.textContent = '點擊遊戲畫面取得滑鼠控制；Esc 可釋放游標。'
      this.guide.hide(); return
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
    else if (this.step === 'cat-mounted') { target = frame.catPosition ?? null; label = '最近的黑貓 · 靠近按 E 騎乘' }
    else if (this.step === 'mount-impact' && frame.mountedOnPracticeHorse) { target = this.impactPoint; label = '衝撞假人 · W 加速 · Shift 衝刺' }
    else if (this.needsHorse(frame)) {
      // Resuming or resetting puts the player back at spawn: the black cat is the transit again, without undoing progress.
      if (this.needsCatTransit(frame)) { target = frame.catPosition ?? null; label = '最近的黑貓 · 靠近按 E 騎乘' }
      else { target = frame.horsePosition ?? null; label = frame.mountedOnPracticeCat ? '指定普通練習馬' : '普通練習馬 · 靠近按 E 上馬' }
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
    if (!compass) return
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
      this.status.textContent = '返回狀態尚未保存，仍留在本場。請重試。'
      this.pending = () => this.returnToTown(); this.retry.hidden = false; return
    }
    this.actions.returnToTown()
  }

  private render(): void {
    const state = this.profile.tutorial![this.launch.stage]
    this.text.textContent = this.complete
      ? state.replay ? '重播完成，正在返回城鎮。不重複發放軍功，也不增加正式任務紀錄。'
        : this.launch.stage === 'recruit' ? '訓練完成！100 軍功已入帳，正在返回城鎮。下一步：到城鎮武器店購買第一把武器；累積軍功達標後，還需找對應 NPC 接受任命才會晉升。'
          : '指揮訓練完成，正在返回城鎮。回到城鎮後，可到人力資源中心招募私兵；本次演練不計入正式任務、擊殺或技能經驗。'
      : this.contextHint || ((this.launch.stage === 'recruit' ? RECRUIT_HINTS : CAPTAIN_HINTS)[this.step] ?? '依目前標記完成操作。')
    if (this.launch.stage === 'recruit' && this.step === 'melee-hit-1') this.text.textContent += ` 已命中 ${state.operations.includes('melee-hit-1') ? 1 : 0}/2。`
    this.leave.textContent = this.complete ? '前往城鎮' : '稍後繼續 · 返回城鎮'
    if (state.replay && !this.complete) this.status.textContent = '重播：不重複領獎'
  }

  dispose(): void { this.disposed = true; this.pending = undefined; this.guide.dispose(); this.root.remove() }
}
