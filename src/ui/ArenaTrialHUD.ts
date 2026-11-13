export interface ArenaTrialHudState {
  phase: 'countdown' | 'fight' | 'result' | null
  countdown: number
  label: string
  friendly: { active: number; total: number }
  enemy: { active: number; total: number }
  remainingSeconds: number
  playerKnocked: boolean
}

/** Team counts, countdown and knock-out notice of an Arena Squad Trial; plain DOM, no layout dependencies. */
export class ArenaTrialHUD {
  private readonly root = document.createElement('div')
  private readonly counts = document.createElement('div')
  private readonly banner = document.createElement('div')
  private readonly notice = document.createElement('div')

  constructor() {
    this.root.id = 'arena-trial-hud'
    this.root.setAttribute('role', 'status')
    this.root.style.cssText = 'position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:9990;text-align:center;color:#f2eadb;font:16px/1.5 system-ui;pointer-events:none;text-shadow:0 1px 3px #000'
    this.counts.id = 'arena-trial-counts'
    this.counts.style.cssText = 'font-size:20px;font-weight:700'
    this.banner.id = 'arena-trial-banner'
    this.banner.style.cssText = 'font-size:46px;font-weight:800;margin-top:6px'
    this.notice.id = 'arena-trial-notice'
    this.notice.style.cssText = 'margin-top:6px;color:#ffd59a'
    this.root.append(this.counts, this.banner, this.notice)
    document.body.append(this.root)
    this.root.hidden = true
  }

  update(state: ArenaTrialHudState): void {
    this.root.hidden = state.phase === null || state.phase === 'result'
    if (this.root.hidden) return
    this.counts.textContent = `${state.label} · 我方 ${state.friendly.active}/${state.friendly.total}　敵方 ${state.enemy.active}/${state.enemy.total}`
    this.banner.textContent = state.phase === 'countdown' ? String(Math.ceil(state.countdown)) : state.remainingSeconds > 60 ? '' : `${Math.ceil(state.remainingSeconds)}s`
    this.notice.textContent = state.playerKnocked ? '你已被擊倒，正在觀戰；友軍仍可取勝' : ''
  }

  dispose(): void { this.root.remove() }
}
