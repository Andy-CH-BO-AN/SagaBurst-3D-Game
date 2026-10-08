import * as THREE from 'three'
import type { PlayerHeroId } from '../world/HeroAssetCatalog'
import './training-ground.css'

export class TrainingGroundUI {
  private readonly root = document.createElement('section')
  private readonly labelRoot = document.createElement('div')
  private readonly listeners = new AbortController()
  private readonly projection = new THREE.Vector3()
  private readonly labelNodes: HTMLDivElement[] = []
  private readonly damage: HTMLElement
  private readonly pausePanel: HTMLElement
  private wasLocked = Boolean(document.pointerLockElement)
  paused = false

  constructor(private readonly actions: {
    onEquipment(): void; onRefill(): void; onReset(): void; onExit(): void
    onPause(): void; onResume(): void; equipmentVisible(): boolean
    onCharacter(heroId?: PlayerHeroId): void
  }, private readonly labels: readonly { text: string; position: THREE.Vector3 }[]) {
    this.root.id = 'training-ground-ui'
    this.root.innerHTML = `
      <div class="training-title"><strong>Training Ground · 訓練場</strong><small>自由練習 · 免費裝備與坐騎 · 不累積 XP</small></div>
      <div class="training-actions">
        <button type="button" data-training="equipment">武器 · Tab</button>
        <button type="button" data-training="refill">Refill · 補給</button>
        <button type="button" data-training="reset">Reset Training · 重置</button>
        <button type="button" data-training="exit">返回主選單</button>
      </div>
      <pre class="training-damage" role="status" aria-live="polite">最近命中：—</pre>
      <div class="training-pause" hidden role="dialog" aria-modal="true" aria-labelledby="training-pause-title">
        <div class="training-pause-card"><h2 id="training-pause-title">訓練暫停</h2>
          <p>WASD 移動 · Shift 加速 · Space 跳躍 · E 上下坐騎<br>左鍵近戰 · 右鍵瞄準／舉盾 · 瞄準時左鍵射擊<br>Tab 裝備 · Esc 暫停／繼續</p>
          <p>黃圈是射擊點，距離以旁邊 0m 假人中心為準。<br>沿黃線向後 125m 是衝撞跑道；藍圈是坐騎停放區。</p>
          <label>練習角色 <select aria-label="練習角色"><option value="">一般戰士 · 所有一般武器</option><option value="maki-archer-t4">T4 遊俠 · 正式持弓近戰</option></select></label>
          <p>切換角色會安全返回起點；遊俠沿用正式固定近戰弓與無盾裝備。</p>
          <button type="button" data-training="resume">繼續訓練</button>
          <button type="button" data-training="pause-refill">Refill · 補給</button>
          <button type="button" data-training="pause-reset">Reset Training · 重置</button>
          <button type="button" data-training="pause-exit">返回主選單</button>
        </div>
      </div>`
    this.damage = this.root.querySelector('.training-damage')!
    this.pausePanel = this.root.querySelector('.training-pause')!
    const bind = (id: string, action: () => void) => this.root.querySelector(`[data-training="${id}"]`)!.addEventListener('click', action, { signal: this.listeners.signal })
    bind('equipment', () => actions.onEquipment())
    bind('refill', () => actions.onRefill()); bind('pause-refill', () => actions.onRefill())
    bind('reset', () => actions.onReset()); bind('pause-reset', () => actions.onReset())
    bind('exit', () => actions.onExit()); bind('pause-exit', () => actions.onExit())
    bind('resume', () => this.resume())
    this.root.querySelector('select')!.addEventListener('change', event => {
      const id = (event.target as HTMLSelectElement).value
      actions.onCharacter(id === 'maki-archer-t4' ? id : undefined)
    }, { signal: this.listeners.signal })
    for (const event of ['mousedown', 'mouseup', 'wheel']) this.root.addEventListener(event, event => event.stopPropagation(), { signal: this.listeners.signal })
    this.labelRoot.id = 'training-labels'
    for (const { text } of labels) {
      const node = document.createElement('div'); node.className = 'training-world-label'; node.textContent = text; node.hidden = true
      this.labelRoot.append(node); this.labelNodes.push(node)
    }
    document.body.append(this.root, this.labelRoot)
    window.addEventListener('keydown', this.keydown, { capture: true, signal: this.listeners.signal })
    document.addEventListener('pointerlockchange', () => {
      const locked = Boolean(document.pointerLockElement)
      if (this.wasLocked && !locked && !actions.equipmentVisible()) this.pause()
      this.wasLocked = locked
    }, { signal: this.listeners.signal })
  }

  setDamage(text: string | null): void { this.damage.textContent = text ?? '最近命中：—' }
  pause(): void {
    if (this.paused) return
    this.paused = true; this.pausePanel.hidden = false; this.actions.onPause()
    if (document.pointerLockElement) document.exitPointerLock()
    this.root.querySelector<HTMLButtonElement>('[data-training="resume"]')!.focus()
  }
  resume(): void { this.paused = false; this.pausePanel.hidden = true; this.actions.onResume() }

  private readonly keydown = (event: KeyboardEvent): void => {
    if (this.actions.equipmentVisible()) return
    if (event.code === 'Escape') {
      event.preventDefault(); event.stopImmediatePropagation()
      if (!event.repeat) this.paused ? this.resume() : this.pause()
    } else if (this.paused && event.code === 'Tab') {
      const buttons = Array.from(this.pausePanel.querySelectorAll<HTMLElement>('button, select'))
      const index = buttons.indexOf(document.activeElement as HTMLElement)
      buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus()
      event.preventDefault(); event.stopImmediatePropagation()
    } else if (this.paused) event.stopImmediatePropagation()
  }

  updateLabels(camera: THREE.Camera): void {
    this.labels.forEach(({ position }, index) => {
      const p = this.projection.copy(position).project(camera), node = this.labelNodes[index]
      node.hidden = p.z < -1 || p.z > 1 || Math.abs(p.x) > 1.05 || Math.abs(p.y) > 1.05
      if (!node.hidden) { node.style.left = `${(p.x + 1) * window.innerWidth / 2}px`; node.style.top = `${(1 - p.y) * window.innerHeight / 2}px` }
    })
  }

  dispose(): void { this.listeners.abort(); this.root.remove(); this.labelRoot.remove() }
}
