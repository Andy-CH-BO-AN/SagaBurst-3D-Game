type TutorialHUDRect = Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom' | 'width' | 'height'>

export function installTownStyles(): void {
  if (document.getElementById('town-styles')) return
  const style = document.createElement('style'); style.id = 'town-styles'
  style.textContent = `
    .town-panel { position:fixed; left:50%; top:50%; transform:translate(-50%,-50%); width:min(680px,calc(100vw - 48px)); box-sizing:border-box; max-height:85vh; overflow:auto; z-index:1000; padding:26px 30px; color:#f1e4cb; background:linear-gradient(125deg,#30291f,#181b1b); border:1px solid #95784f; border-top:4px solid #ba995e; border-radius:8px; box-shadow:0 24px 100px #000c; font:15px/1.65 system-ui }
    .town-mission-tabs { display:flex; gap:10px; margin:12px 0 18px; position:sticky; top:-26px; background:#25231f; padding:10px 0; z-index:1 }
    .town-mission-tabs .town-button { flex:1; margin:0 }
    .town-mission-tabs [aria-pressed="true"], .town-mission-tabs [aria-selected="true"] { background:#765c35; border-color:#f0cc86; color:#fff0c9 }
    .town-shop-tabs { display:flex; gap:10px; margin-top:14px }
    .town-shop-tabs .town-button { flex:1; margin:0 }
    .town-shop-tabs .town-button:disabled { opacity:1; background:#765c35; border-color:#f0cc86; color:#fff0c9 }
    .town-shop-categories[hidden] { display:none }
    .town-shop-categories .town-button { padding:10px 6px; font-size:13px }
    .town-shop-categories [aria-pressed="true"] { background:#765c35; border-color:#f0cc86; color:#fff0c9 }
    .town-purchase-products > h3 { display:flex; align-items:center; gap:12px; letter-spacing:.14em; font-size:14px }
    .town-purchase-products > h3::before,.town-purchase-products > h3::after { content:''; flex:1; height:1px; background:#95784f88 }
    .town-sale { grid-column:1 / -1; margin-top:14px; padding:12px; background:#0b101344; border:1px solid #95784f; border-radius:5px }
    .town-sale label { display:block; font-size:13px; color:#c4b69e }
    .town-sale-select { display:block; width:100%; max-width:100%; margin-right:0 }
    .town-panel h2 { margin:5px 0 16px; font:700 27px/1.3 Georgia,serif; color:#ffe5af }
    .town-panel p { margin:12px 0; white-space:pre-line }
    .town-eyebrow { font:11px/1.5 Georgia,serif; letter-spacing:.2em; color:#bb9e71 }
    .town-button { color:#ecd8ad; background:#453723; border:1px solid #947448; border-radius:4px; padding:9px 15px; margin:8px 9px 0 0; font:600 14px system-ui; cursor:pointer }
    .town-button:hover,.town-button:focus-visible { background:#665033; border-color:#eac683; outline:2px solid #be9a58; outline-offset:2px }
    .town-button:disabled { opacity:.5; cursor:default }
    .town-products > h3 { grid-column:1 / -1; margin:12px 0 0; color:#ffe5af; font-size:17px }
    .town-summary { background:#0b101344; border-left:3px solid #b3945e; padding:10px 14px; color:#c4b69e; font-size:13px }
    .town-products { display:grid; grid-template-columns:repeat(auto-fit,minmax(235px,1fr)); gap:10px; margin-top:16px }
    .town-product { border:1px solid #77654866; border-radius:5px; padding:12px; background:#0002; display:flex; flex-direction:column; align-items:flex-start }
    .town-product strong { font-size:14px; color:#ead7b2 } .town-product small { color:#b7a78c; margin-top:4px }
    .duel-arena-select { display:flex; align-items:center; gap:8px; margin:0 0 12px; padding:8px 10px; border:1px solid #6d5636; border-radius:8px; background:#20180f }
    .duel-arena-select > strong { color:#ffe5af; margin-right:6px }
    .duel-arena-option { min-width:120px }
    .duel-arena-option[aria-checked="true"] { background:#9a6526; border-color:#ffd38a; color:#fff; box-shadow:0 0 0 2px #ffd38a55 inset }
    .duel-picker { display:grid; grid-template-columns:190px 1fr; gap:16px; align-items:start }
    .duel-picker-list { display:flex; flex-direction:column; gap:6px; position:sticky; top:56px }
    .duel-subject { display:flex; justify-content:space-between; align-items:center; margin:0; text-align:left; width:100% }
    .duel-subject small { color:#b7a78c; font-weight:500; font-variant-numeric:tabular-nums }
    .duel-subject[aria-pressed="true"] { background:#765c35; border-color:#f0cc86; color:#fff0c9 }
    .duel-subject[aria-pressed="true"] small { color:#fff0c9 }
    .duel-picker-ladder > h3 { margin:0 0 10px; color:#ffe5af; font-size:17px }
    .duel-tier { border:1px solid #77654866; border-left:3px solid #947448; border-radius:5px; padding:8px 12px; margin-bottom:6px; background:#0002; display:grid; grid-template-columns:1fr auto; column-gap:12px; align-items:center }
    .duel-tier-completed { border-left-color:#8fb06a } .duel-tier-available { border-left-color:#eac683; background:#3a2d1a55 } .duel-tier-locked { opacity:.65 }
    .duel-tier-head { display:flex; justify-content:space-between; align-items:baseline }
    .duel-tier-head strong { font-size:15px; color:#ffe5af } .duel-tier-state { font-size:12px; color:#c4b69e }
    .duel-tier-completed .duel-tier-state { color:#a9c98a } .duel-tier-available .duel-tier-state { color:#eac683 }
    .duel-tier small { display:block; margin-top:4px; color:#b7a78c; white-space:pre-line; line-height:1.5 }
    .duel-rules { margin:0 0 10px; padding:8px 12px; background:#0b101344; border-left:3px solid #b3945e; color:#c4b69e; font-size:13px; line-height:1.5; white-space:pre-line }
    .duel-class small { display:block; margin:0 0 6px; color:#b7a78c; font-size:11px; text-align:center }
    .duel-tier-actions { display:flex; flex-direction:column; grid-row:1 / span 2; grid-column:2; gap:0 } .duel-tier-actions .town-button { margin:0 0 4px; white-space:nowrap } .duel-tier-actions .town-button:last-child { margin-bottom:0 } .duel-tier-head { justify-content:flex-start; gap:10px }
    .town-purchase-products { grid-template-columns:repeat(auto-fit,minmax(min(235px,100%),1fr)) }
    .town-purchase-quantity { margin-top:8px; max-width:100%; font-size:13px; color:#c4b69e }
    .town-purchase-select { box-sizing:border-box; max-width:100%; padding:5px 10px; color:#ead8b8; background:#332d24; border:1px solid #92754e; border-radius:4px; font:inherit }
    .town-purchase-select:focus-visible { outline:2px solid #be9a58; outline-offset:2px }
    .town-purchase-select:disabled { opacity:.5; cursor:default }
    .town-ambient { position:fixed; transform:translate(-50%,-100%); max-width:280px; z-index:95; background:#201d18e8; color:#ffe6b5; padding:8px 12px; border:1px solid #967950; border-radius:5px; font:14px/1.4 system-ui; pointer-events:none }
    #career-duel-hud { position:fixed; left:50%; top:12%; transform:translateX(-50%); z-index:94; pointer-events:none; text-align:center; color:#ffe5af; text-shadow:0 3px 8px #000,0 0 20px #000; font-family:system-ui }
    .duel-countdown-label { font-size:18px; font-weight:600; letter-spacing:.08em }
    .duel-countdown-value { font-size:clamp(48px,7vw,80px); font-weight:800; line-height:1.15; font-variant-numeric:tabular-nums }
    #career-entry { position:fixed; inset:0; overflow:auto; z-index:1000; padding:clamp(20px,5vh,60px) clamp(20px,6vw,100px); box-sizing:border-box; background:radial-gradient(ellipse at 30% 0,#473a28,#171b1f 65%); color:#ead8b8; font:16px/1.6 system-ui }
    #career-entry h1 { margin:5px 0; font:700 34px Georgia,serif }
    .career-tutorial-hud { position:fixed; left:50%; top:32vh; transform:translateX(-50%); width:min(500px,calc(100vw - 32px)); box-sizing:border-box; display:grid; gap:10px; pointer-events:none; z-index:93; color:#fff4d7; font:16px/1.45 system-ui; text-align:center; overflow-wrap:anywhere }
    .career-tutorial-hud[hidden], .career-tutorial-hud [hidden] { display:none }
    .career-tutorial-card { padding:12px 18px; border:1px solid #c4ab7666; border-radius:8px; background:rgb(20 27 28 / 70%); box-shadow:0 4px 18px #0003 }
    .career-tutorial-title { display:block; font-size:18px; font-weight:600 }
    .career-tutorial-detail { display:block; margin-top:4px }
    .career-tutorial-notification { color:#ffe2a0; border-color:#d6b369; background:rgb(39 32 18 / 75%); font-weight:600 }
    .career-tutorial-error { color:#ffd5cc; border-color:#e79583; background:rgb(54 22 19 / 90%); font-size:15px }
    .career-tutorial-critical { transform:none; text-align:left; z-index:936 }
    @media (max-height:700px), (max-width:600px) {
      .career-tutorial-hud { gap:6px; font-size:15px; line-height:1.3 }
      .career-tutorial-card { padding:7px 12px }
      .career-tutorial-detail { margin-top:2px }
    }
    @media (max-height:560px) {
      .career-tutorial-hud { gap:4px }
      .career-tutorial-card { padding:4px 10px }
      .career-tutorial-hud:has(.career-tutorial-notification:not([hidden])) .career-tutorial-detail { display:none }
    }
  `
  document.head.append(style)
}

/** Presentation only: progress/reward receipts remain owned by the tutorial controller. */
export class TownTutorialHUD {
  private readonly root = document.createElement('div')
  private readonly objective = document.createElement('div')
  private readonly title = document.createElement('strong')
  private readonly detail = document.createElement('span')
  private readonly notification = document.createElement('div')
  private readonly error = document.createElement('div')
  private resizeObserver?: ResizeObserver
  private stateObserver?: MutationObserver
  private blockers: HTMLElement[] = []
  private layoutState = ''
  private disposed = false

  constructor() {
    this.root.className = 'career-tutorial-hud'
    this.root.hidden = true
    this.objective.id = 'career-tutorial-hint'
    this.objective.className = 'career-tutorial-card'
    this.title.className = 'career-tutorial-title'
    this.detail.className = 'career-tutorial-detail'
    this.objective.append(this.title, this.detail)
    this.notification.id = 'career-tutorial-notification'
    this.notification.className = 'career-tutorial-card career-tutorial-notification'
    this.notification.setAttribute('role', 'status')
    this.error.id = 'career-tutorial-error'
    this.error.className = 'career-tutorial-card career-tutorial-error'
    this.error.setAttribute('role', 'alert')
    this.root.append(this.objective, this.notification, this.error)
    document.body.append(this.root)
    window.addEventListener('resize', this.layout)
  }

  render(objective: string, notification: string, error: string, blocked: boolean): void {
    const state = JSON.stringify([objective, notification, error, blocked])
    if (state === this.layoutState) return
    this.layoutState = state
    const [title, ...details] = objective.split('\n')
    if (this.title.textContent !== title) this.title.textContent = title
    const detail = details.join(' ')
    if (this.detail.textContent !== detail) this.detail.textContent = detail
    this.detail.hidden = !detail
    this.objective.hidden = !objective || Boolean(error)
    if (this.notification.textContent !== notification) this.notification.textContent = notification
    this.notification.hidden = !notification || Boolean(error)
    if (this.error.textContent !== error) this.error.textContent = error
    this.error.hidden = !error
    this.root.className = `career-tutorial-hud${error ? ' career-tutorial-critical' : ''}`
    this.root.hidden = blocked || !(objective || notification || error)
    // Town creates some HUD elements after the controller; bind once on the first update.
    if (!this.resizeObserver) this.observeHUD()
    this.layout()
  }

  private observeHUD(): void {
    this.blockers = Array.from(document.querySelectorAll<HTMLElement>(
      '#town-hud, #army-command-hud .army-command-targets, #army-command-hud .army-command-commands, #army-command-hud .army-command-feedback, #compass-container, #enemy-hud, #career-duel-hud, #career-race-hud, #town-hint, #controls-hint, .career-mission-guide, #town-pointer-prompt, #combat-equipment-hud'))
    this.resizeObserver = new ResizeObserver(this.layout)
    this.resizeObserver.observe(this.root)
    this.blockers.forEach(el => this.resizeObserver!.observe(el))
    // Compare attributes first: ArmyCommandUI can write the same state every frame.
    let previous = ''
    this.stateObserver = new MutationObserver(() => {
      const state = this.blockers.map(el => [el.hidden, el.className, el.getAttribute('style'), el.parentElement?.getAttribute('style'), el.parentElement?.hidden].join('|')).join(';')
      if (state !== previous) { previous = state; this.layout() }
    })
    for (const el of new Set(this.blockers.flatMap(el => [el, el.parentElement]).filter((el): el is HTMLElement => Boolean(el)))) {
      this.stateObserver.observe(el, { attributes: true, attributeFilter: ['class', 'style', 'hidden'] })
    }
  }

  private readonly layout = (): void => {
    if (this.disposed || this.root.hidden) return
    const width = window.innerWidth, height = window.innerHeight
    const blockers: TutorialHUDRect[] = this.blockers.filter(el => !el.closest('[hidden]') && getComputedStyle(el).display !== 'none'
      && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).opacity !== '0')
      .map(el => el.getBoundingClientRect()).filter(r => r.width > 0 && r.height > 0)
    // Reserve the aiming area even when the crosshair itself is hidden.
    blockers.push({ left:width / 2 - 28, right:width / 2 + 28, top:height / 2 - 28, bottom:height / 2 + 28, width:56, height:56 })
    if (!this.error.hidden) { this.placeError(blockers, width, height); return }
    this.root.style.left = ''; this.root.style.width = ''
    const rect = this.root.getBoundingClientRect()
    const limit = height / 2 - 28
    const preferred = Math.min(height * .32, limit - rect.height)
    const candidates = [preferred, 12, ...blockers.flatMap(r => [r.bottom + 12, r.top - rect.height - 12])]
    const top = candidates.filter(y => y >= 12 && y + rect.height <= limit
      && this.fits(rect.left, y, rect.width, rect.height, blockers))
      .sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred))[0]
    // Only noncritical guidance yields to a crowded command menu; its native width is untouched.
    this.root.style.visibility = top === undefined ? 'hidden' : ''
    this.root.style.top = `${top ?? 12}px`
  }

  private fits(x: number, y: number, width: number, height: number, blockers: TutorialHUDRect[]): boolean {
    return blockers.every(r => x + width + 12 <= r.left || x >= r.right + 12
      || y + height + 12 <= r.top || y >= r.bottom + 12)
  }

  /** Errors stand alone and may use a side gap; they never share the crowded objective stack. */
  private placeError(blockers: TutorialHUDRect[], width: number, height: number): void {
    const widths = [...new Set([Math.min(500, width - 24),
      ...blockers.flatMap(r => [Math.min(500, r.left - 24), Math.min(500, width - r.right - 24)]),
      Math.min(180, width - 24)])].filter(w => w >= Math.min(180, width - 24)).sort((a, b) => b - a)
    this.root.style.visibility = ''
    let fallback = { x:12, y:12, width:widths[0], overlap:Infinity }
    for (const cardWidth of widths) {
      this.root.style.width = `${cardWidth}px`
      const cardHeight = this.root.getBoundingClientRect().height
      const xs = [(width - cardWidth) / 2, 12, width - cardWidth - 12,
        ...blockers.flatMap(r => [r.right + 12, r.left - cardWidth - 12])]
      const ys = [Math.min(height * .32, height - cardHeight - 12), 12, height - cardHeight - 12,
        ...blockers.flatMap(r => [r.bottom + 12, r.top - cardHeight - 12])]
      for (const y of ys) for (const x of xs) {
        if (x < 12 || y < 12 || x + cardWidth > width - 12 || y + cardHeight > height - 12) continue
        // The aiming area is always protected, including the last-resort occupied-slot choice.
        if (!this.fits(x, y, cardWidth, cardHeight, [blockers[blockers.length - 1]])) continue
        if (this.fits(x, y, cardWidth, cardHeight, blockers)) {
          this.root.style.left = `${x}px`; this.root.style.top = `${y}px`
          return
        }
        // Even a completely occupied viewport must not silently discard a failed save.
        const overlap = blockers.reduce((sum, r) => sum + Math.max(0, Math.min(x + cardWidth, r.right) - Math.max(x, r.left))
          * Math.max(0, Math.min(y + cardHeight, r.bottom) - Math.max(y, r.top)), 0)
        if (overlap < fallback.overlap) fallback = { x, y, width:cardWidth, overlap }
      }
    }
    this.root.style.width = `${fallback.width}px`
    this.root.style.left = `${fallback.x}px`; this.root.style.top = `${fallback.y}px`
  }

  dispose(): void {
    this.disposed = true
    window.removeEventListener('resize', this.layout)
    this.resizeObserver?.disconnect()
    this.stateObserver?.disconnect()
    this.root.remove()
  }
}
