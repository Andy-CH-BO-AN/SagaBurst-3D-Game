/** Shared opening prompt for the squad trial and prison break. It never intercepts the canvas click. */
export class ArenaOpeningHUD {
  private readonly root = document.createElement('div')

  constructor() {
    this.root.id = 'arena-opening-hud'
    this.root.setAttribute('role', 'status')
    this.root.style.cssText = 'position:fixed;top:42%;left:50%;transform:translate(-50%,-50%);width:calc(100% - 40px);z-index:9994;text-align:center;color:#fff2d3;text-shadow:0 3px 8px #000,0 0 24px #000;pointer-events:none;font:800 clamp(28px,6vw,76px)/1.2 system-ui'
    this.root.hidden = true
    document.body.append(this.root)
  }

  update(phase: 'waiting' | 'countdown' | 'paused' | 'fight' | 'result', remaining: number): void {
    const hidden = phase !== 'waiting' && phase !== 'paused' && phase !== 'countdown'
    const text = phase === 'waiting' ? '點擊畫面開始' : phase === 'paused' ? '點擊畫面繼續' : phase === 'countdown' ? String(Math.ceil(remaining)) : ''
    if (this.root.hidden !== hidden) this.root.hidden = hidden
    if (this.root.textContent !== text) this.root.textContent = text
  }

  dispose(): void { this.root.remove() }
}
