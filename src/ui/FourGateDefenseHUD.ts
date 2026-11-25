import { buildFourGateHudView, FOUR_GATE_HUD_RAMP_STATUS_LABELS, type FourGateHudRampStatus, type FourGateHudSource, type FourGateHudView } from '../career/FourGateDefenseHudModel'
import './four-gate-defense-hud.css'

/** 低高度攻城車剪影：斜面車身、兩輪與前端衝角；已摧毀時另加叉號。 */
const RAMP_ICON = `<svg viewBox="0 0 24 14" aria-hidden="true" focusable="false">
  <path class="fg-ramp-body" d="M2 9 L15 3 L22 3 L22 9 Z"/>
  <path class="fg-ramp-beam" d="M14 3 L22 1.2" />
  <circle class="fg-ramp-wheel" cx="6" cy="11" r="2.1"/><circle class="fg-ramp-wheel" cx="17" cy="11" r="2.1"/>
  <path class="fg-ramp-x" d="M4 1.5 L20 12.5 M20 1.5 L4 12.5"/>
</svg>`
const RAMP_MARK: Readonly<Record<FourGateHudRampStatus, string>> = { absent: '·', staged: '', docked: '▲', abandoned: '‖', destroyed: '×' }

const GATE_ORDER = ['north', 'east', 'south', 'west'] as const

interface GateNodes {
  root: HTMLElement; count: HTMLElement; fill: HTMLElement; status: HTMLElement
  ramps: [HTMLElement, HTMLElement]; rampMarks: [HTMLElement, HTMLElement]
}

/** 四門守城戰比分板：只依 view 更新文字／class／寬度，建立一次後不重建 DOM，不攔截輸入。 */
export class FourGateDefenseHUD {
  readonly element = document.createElement('div')
  private readonly friendly: HTMLElement
  private readonly enemy: HTMLElement
  private readonly clock: HTMLElement
  private readonly phase: HTMLElement
  private readonly hint: HTMLElement
  private readonly balance: HTMLElement
  private readonly gates = new Map<string, GateNodes>()
  private last = ''
  private disposed = false

  constructor(parent: HTMLElement = document.body) {
    const root = this.element
    root.id = 'four-gate-defense-hud'
    root.setAttribute('role', 'status')
    root.setAttribute('aria-label', '四門守城戰況')
    root.innerHTML = `
      <div class="fg-score">
        <div class="fg-side fg-friendly"><span class="fg-caption">我方</span><strong data-friendly>0</strong></div>
        <div class="fg-center"><strong class="fg-clock" data-clock>00:00</strong><span class="fg-phase"><span data-phase></span><em data-hint></em></span></div>
        <div class="fg-side fg-enemy"><span class="fg-caption">敵軍</span><strong data-enemy>0</strong></div>
      </div>
      <div class="fg-balance" aria-hidden="true"><i data-balance></i></div>
      <div class="fg-gates">${GATE_ORDER.map(id => `
        <div class="fg-gate" data-gate="${id}" data-status="intact">
          <div class="fg-gate-head"><span class="fg-gate-name"></span><span class="fg-gate-count"></span></div>
          <div class="fg-gate-bar" aria-hidden="true"><i></i></div>
          <div class="fg-gate-foot">
            <span class="fg-ramps">
              <span class="fg-ramp" data-ramp="left" data-ramp-status="absent">${RAMP_ICON}<b></b></span>
              <span class="fg-ramp" data-ramp="right" data-ramp-status="absent">${RAMP_ICON}<b></b></span>
            </span>
            <span class="fg-gate-status"></span>
          </div>
        </div>`).join('')}
      </div>`
    this.friendly = root.querySelector('[data-friendly]')!
    this.enemy = root.querySelector('[data-enemy]')!
    this.clock = root.querySelector('[data-clock]')!
    this.phase = root.querySelector('[data-phase]')!
    this.hint = root.querySelector('[data-hint]')!
    this.balance = root.querySelector('[data-balance]')!
    for (const id of GATE_ORDER) {
      const node = root.querySelector<HTMLElement>(`[data-gate="${id}"]`)!
      const ramps = [...node.querySelectorAll<HTMLElement>('.fg-ramp')] as [HTMLElement, HTMLElement]
      this.gates.set(id, { root: node, count: node.querySelector('.fg-gate-count')!, fill: node.querySelector('.fg-gate-bar i')!,
        status: node.querySelector('.fg-gate-status')!, ramps, rampMarks: [ramps[0].querySelector('b')!, ramps[1].querySelector('b')!] })
    }
    parent.append(root)
    document.body.classList.add('four-gate-hud-active')
  }

  update(source: FourGateHudSource): void { this.render(buildFourGateHudView(source)) }

  render(view: FourGateHudView): void {
    if (this.disposed) return
    // 畫面不變就不碰 DOM，避免每個 frame 重新排版。
    const key = JSON.stringify(view)
    if (key === this.last) return
    this.last = key
    this.friendly.textContent = String(view.friendly)
    this.enemy.textContent = String(view.enemy)
    this.clock.textContent = view.clock
    this.phase.textContent = view.label
    this.hint.textContent = view.hint
    this.balance.style.width = `${view.friendlyPercent}%`
    for (const gate of view.gates) {
      const nodes = this.gates.get(gate.id)
      if (!nodes) continue
      nodes.root.dataset.status = gate.status
      nodes.root.querySelector('.fg-gate-name')!.textContent = gate.name
      nodes.count.textContent = gate.count
      nodes.fill.style.width = `${gate.percent}%`
      nodes.status.textContent = gate.statusLabel
      gate.ramps.forEach((status, index) => {
        const ramp = nodes.ramps[index]
        ramp.dataset.rampStatus = status
        const side = index === 0 ? '左' : '右'
        ramp.title = `${side}攻城車：${FOUR_GATE_HUD_RAMP_STATUS_LABELS[status]}`
        ramp.setAttribute('aria-label', ramp.title)
        nodes.rampMarks[index].textContent = RAMP_MARK[status]
      })
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.element.remove()
    document.body.classList.remove('four-gate-hud-active')
  }
}
