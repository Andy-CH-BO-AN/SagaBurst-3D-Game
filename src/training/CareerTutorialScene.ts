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
  'horse-mounted': '靠近指定的普通練習馬，按 E 上馬。借用裝備與坐騎只在本場練習使用。',
  ride1: 'WASD 控制普通馬前進／轉向，騎過第一個黃色標記。Shift 可衝刺。',
  ride2: '騎過第二個黃色標記。這匹普通馬在地面移動，以 WASD 轉向。',
  ride3: '騎過第三個黃色標記。可放開前進鍵減速，E 可下馬。',
  dismounted: '按 E 完成一次下馬。練習馬失效或位置不合理時可按「重置」，免費安全回到起點。',
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
  dead: boolean
  onFoot: boolean
  mountedOnPracticeHorse: boolean
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
  readonly movementPoint = new THREE.Vector3(109, 0, 43)
  readonly ridePoints = [new THREE.Vector3(70, 0, 77), new THREE.Vector3(85, 0, 82), new THREE.Vector3(95, 0, 65)]

  constructor(readonly launch: CareerTutorialLaunch, private readonly actions: { returnToTown(): void; reset(): void }) {
    const loaded = this.store.loadChecked()
    if (!loaded.profile || loaded.error || loaded.profile.tutorial?.careerId !== launch.careerId
      || loaded.profile.tutorial.session?.id !== launch.sessionId || loaded.profile.tutorial.session.stage !== launch.stage) {
      throw new Error('教學與目前生涯角色不符，請返回城鎮後重試。')
    }
    this.profile = loaded.profile
    this.root.id = 'career-tutorial-scene'
    this.root.style.cssText = 'position:fixed;left:18px;top:88px;z-index:1102;width:min(420px,calc(100vw - 36px));background:#171411d9;color:#fff1cf;padding:14px;border:1px solid #b49968;border-radius:7px;font:15px/1.55 system-ui'
    const title = document.createElement('strong'); title.textContent = launch.stage === 'recruit' ? '新兵操作訓練' : '隊長指揮訓練 · 30 名 AI'
    this.leave.textContent = '稍後繼續 · 返回城鎮'; this.leave.onclick = () => this.returnToTown()
    this.reset.textContent = '安全重置演練'; this.reset.onclick = () => actions.reset()
    this.retry.textContent = '重試保存'; this.retry.hidden = true; this.retry.onclick = () => { const next = this.pending; this.pending = undefined; this.retry.hidden = true; next?.() }
    for (const button of [this.leave, this.reset, this.retry]) button.style.cssText = 'margin:8px 8px 0 0;padding:7px;cursor:pointer'
    this.root.append(title, this.text, this.status, document.createElement('br'), this.leave, this.reset, this.retry)
    for (const event of ['mousedown', 'mouseup', 'wheel', 'click']) this.root.addEventListener(event, e => e.stopPropagation())
    document.body.append(this.root)
    this.render()
  }

  get step(): string { return this.profile.tutorial![this.launch.stage].step }
  get complete(): boolean { return this.step === 'complete' }
  get engagementEnabled(): boolean { return this.launch.stage === 'captain' && ['attack', 'charge', 'back', 'complete'].includes(this.step) }

  operation(event: string): void {
    if (this.disposed || this.pending || this.complete) return
    const result = commitCareerTutorial(this.store, this.launch.careerId,
      next => recordCareerTutorialOperation(next, this.launch.stage, event), this.launch.sessionId)
    if (result.ok) { this.profile = result.profile; this.status.textContent = '進度已保存'; this.render(); return }
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

  combat(event: CombatEvent): void {
    if (this.launch.stage !== 'recruit' || event.type !== 'damage_applied' || event.appliedDamage <= 0
      || event.source.actorType !== 'player' || event.source.actorId !== 'player' || event.target.targetType !== 'training') return
    if (this.step === 'melee-hit-1' && event.method === 'melee' && event.target.targetId === 'training:0') this.operation('melee-hit')
    if (this.step === 'bow-hit' && event.method === 'projectile' && event.target.targetId === 'training:10'
      && event.weaponId && WEAPONS[event.weaponId]?.combatKind === 'bow') this.operation('bow-hit')
  }

  update(frame: TutorialSceneFrame, dt: number): void {
    if (this.disposed) return
    this.root.hidden = frame.hidden
    if (frame.hidden) { this.guide.hide(); return }
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
    if (this.step === 'horse-mounted' && frame.mountedOnPracticeHorse) this.operation('horse-mounted')
    const rideIndex = ['ride1', 'ride2', 'ride3'].indexOf(this.step)
    if (rideIndex >= 0 && frame.mountedOnPracticeHorse && Math.hypot(frame.position.x - this.ridePoints[rideIndex].x, frame.position.z - this.ridePoints[rideIndex].z) < 3.2) this.operation(`ride${rideIndex + 1}`)
    let target: THREE.Vector3 | null = null, label = ''
    if (this.step === 'look') { target = this.movementPoint; label = '移動練習標記' }
    else if (this.step === 'melee-hit-1') { target = new THREE.Vector3(100, 0, 40); label = '0m 近戰假人' }
    else if (this.step === 'bow-hit') { target = new THREE.Vector3(100 + Math.sin(-1.05) * 10, 0, 40 - Math.cos(-1.05) * 10); label = '10m 射擊假人' }
    else if (this.step === 'horse-mounted') { target = frame.horsePosition ?? null; label = '指定普通練習馬 · 靠近按 E' }
    else if (rideIndex >= 0) { target = this.ridePoints[rideIndex]; label = `騎乘標記 ${rideIndex + 1}/3` }
    this.guide.updateRace(frame.position, frame.cameraYaw, target, label)
  }

  returnToTown(): void {
    if (this.disposed) return
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
      ? state.replay ? '重播完成。不重複發放軍功，也不增加正式任務紀錄。'
        : this.launch.stage === 'recruit' ? '全部操作已完成並保存，100 軍功已入帳。累積軍功決定任命資格，可用軍功用於消費；達門檻後仍須找 NPC 正式接受任命。'
          : '指揮訓練已完成並保存。返回同一生涯角色後可前往 HR 建立私人小隊；本次不增加正式任務、擊殺或技能 XP。'
      : (this.launch.stage === 'recruit' ? RECRUIT_HINTS : CAPTAIN_HINTS)[this.step] ?? '依目前標記完成操作。'
    if (this.launch.stage === 'recruit' && this.step === 'melee-hit-1') this.text.textContent += ` 已命中 ${state.operations.includes('melee-hit-1') ? 1 : 0}/2。`
    this.leave.textContent = this.complete ? '前往城鎮' : '稍後繼續 · 返回城鎮'
    if (state.replay && !this.complete) this.status.textContent = '重播：不重複領獎'
  }

  dispose(): void { this.disposed = true; this.pending = undefined; this.guide.dispose(); this.root.remove() }
}
