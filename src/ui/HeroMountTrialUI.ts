/** Pause and exit controls for the public hero-mount trial, including nolock input. */
export class HeroMountTrialUI {
  private readonly panel = document.createElement('div')
  private wasLocked = Boolean(document.pointerLockElement)
  visible = false

  constructor(private readonly actions: {
    onPause: () => void
    onResume: () => void
    onExit: () => void
    equipmentVisible: () => boolean
  }) {
    this.panel.id = 'hero-mount-trial-pause'
    this.panel.setAttribute('role', 'dialog')
    this.panel.setAttribute('aria-modal', 'true')
    this.panel.setAttribute('aria-labelledby', 'hero-mount-trial-pause-title')
    this.panel.style.cssText = 'position:fixed;inset:0;z-index:1100;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.65);backdrop-filter:blur(4px)'
    this.panel.innerHTML = `
      <div style="max-width:420px;padding:32px;text-align:center;color:#f1e2ce">
        <h2 id="hero-mount-trial-pause-title">試騎已暫停</h2>
        <p>要退出試騎並回到首頁嗎？</p>
        <div style="display:flex;gap:12px;justify-content:center">
          <button type="button" class="campaign-secondary-btn" id="hero-mount-trial-resume">繼續試騎</button>
          <button type="button" class="campaign-secondary-btn" id="hero-mount-trial-exit">退出試騎・回首頁</button>
        </div>
        <p>按 Esc 繼續試騎</p>
      </div>
    `
    this.panel.querySelector('#hero-mount-trial-resume')!.addEventListener('click', () => this.resume())
    this.panel.querySelector('#hero-mount-trial-exit')!.addEventListener('click', () => this.actions.onExit())
    document.body.appendChild(this.panel)
    window.addEventListener('keydown', this.keydown, true)
    document.addEventListener('pointerlockchange', this.pointerLockChanged)
  }

  private readonly keydown = (event: KeyboardEvent): void => {
    // Equipment keeps its existing Escape-to-close behavior first.
    if (!this.visible && (event.code !== 'Escape' || this.actions.equipmentVisible())) return
    event.stopImmediatePropagation()
    if (this.visible && event.code === 'Tab') {
      event.preventDefault()
      const resume = this.panel.querySelector<HTMLButtonElement>('#hero-mount-trial-resume')!
      const exit = this.panel.querySelector<HTMLButtonElement>('#hero-mount-trial-exit')!
      ;(document.activeElement === resume ? exit : resume).focus()
      return
    }
    if (event.code !== 'Escape') return
    event.preventDefault()
    if (event.repeat) return
    if (this.visible) this.resume()
    else this.open()
  }

  private readonly pointerLockChanged = (): void => {
    const locked = Boolean(document.pointerLockElement)
    // Browsers can consume Escape when releasing pointer lock without sending keydown.
    if (this.wasLocked && !locked && !this.actions.equipmentVisible()) this.open()
    this.wasLocked = locked
  }

  private open(): void {
    if (this.visible) return
    this.visible = true
    this.panel.style.display = 'flex'
    this.actions.onPause()
    if (document.pointerLockElement) document.exitPointerLock()
    this.panel.querySelector<HTMLButtonElement>('#hero-mount-trial-resume')!.focus()
  }

  private resume(): void {
    this.visible = false
    this.panel.style.display = 'none'
    this.actions.onResume()
  }
}
