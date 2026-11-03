import type { CharacterFaction } from '../world/CharacterVisuals'
import { publicAssetUrl } from '../assets/publicAssetUrl'
import { CAREER_TUTORIAL_REWARD_AMOUNTS } from '../career/CareerTutorialState'
import './faction-selection.css'

interface FactionSelectionUIOptions {
  initialFaction?: CharacterFaction
  onStart: (faction: CharacterFaction) => Promise<void>
  onBack: () => void
  backLabel?: string
}

const symbols = {
  heart: '<path d="M12 21S3 15.6 3 8.8C3 3.6 9.4 2.2 12 6c2.6-3.8 9-2.4 9 2.8C21 15.6 12 21 12 21Z"/>',
  shield: '<path d="m12 2 8 3v7c0 5-8 10-8 10S4 17 4 12V5Z"/><path d="M12 3v17"/>',
  ranks: '<path d="m4 9 8-6 8 6M4 15l8-6 8 6M4 21l8-6 8 6"/>',
  axes: '<path d="m4 21 13-17M20 21 7 4M13 3l6 1 2 5-6-1M11 3 5 4 3 9l6-1"/>',
  speed: '<path d="m4 5 7 7-7 7m9-14 7 7-7 7"/>',
  boot: '<path d="M8 3h8l-1 9 6 4v5H3v-5l5-3Z"/><path d="M8 7h7M8 11h7"/>',
  coin: '<ellipse cx="12" cy="6" rx="9" ry="4"/><path d="M3 6v6c0 5 18 5 18 0V6M3 12v6c0 5 18 5 18 0v-6"/>',
  town: '<path d="M3 21V5h4v4h3V3h4v6h3V5h4v16ZM9 21v-7h6v7"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
} as const
const icon = (name: keyof typeof symbols): string => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${symbols[name]}</svg>`

const factions = {
  roman: {
    name: '羅馬', english: 'ROMAN', title: '穩守陣線，伺機反擊',
    description: '以堅實防守迎接敵人的攻勢，穩住陣線，再把握時機反擊。',
    features: [
      ['heart', '較高生命', 'T1–T3 一般士兵，同階生命值較高。'],
      ['shield', '堅實方盾', 'T1–T3 一般方盾，衝擊耐久出色。'],
      ['ranks', '穩健作戰', '掌握交戰節奏，防守後再進攻。'],
    ],
    fit: '喜歡格擋、穩住陣線，再尋找反擊機會。',
    note: '盾牌需自行購買與裝備，僅命中盾面時格擋；方盾並非全身減傷。',
    alt: '羅馬戰士持短劍與方盾的陣營形象',
  },
  viking: {
    name: '維京', english: 'VIKING', title: '奮勇突擊，突破敵陣',
    description: '主動接敵，以迅猛的近戰攻勢壓迫對手，在進攻與防守之間做出選擇。',
    features: [
      ['axes', '狂戰士', '符合條件時，展現更猛烈的近戰攻勢。'],
      ['speed', '近戰爆發', '狂戰士狀態提升近戰傷害與攻擊速率。'],
      ['boot', '積極突擊', '狂戰士狀態提升移動速度，適合主動接敵。'],
    ],
    fit: '喜歡主動進攻，用近戰壓力突破敵人的防線。',
    note: '狂戰士條件：徒步、未裝備盾牌，並以劍或戰斧近戰。持盾、騎乘、長矛與遠程武器不適用。',
    alt: '維京戰士持戰斧與圓盾的陣營形象',
  },
} as const

/** Owns entry presentation only; the existing entry owner creates, saves and launches. */
export class FactionSelectionUI {
  private readonly root = document.createElement('section')
  private readonly events = new AbortController()
  private readonly radios: HTMLInputElement[]
  private readonly submit: HTMLButtonElement
  private readonly back: HTMLButtonElement
  private readonly error: HTMLParagraphElement
  private readonly committedNotice: HTMLParagraphElement
  private faction: CharacterFaction
  private busy = false
  private committed = false
  private disposed = false
  private generation = 0

  constructor(options: FactionSelectionUIOptions) {
    this.faction = options.initialFaction ?? 'roman'
    this.root.id = 'career-faction-selection'
    this.root.setAttribute('aria-labelledby', 'career-faction-title')
    this.root.innerHTML = `
      <div class="career-faction-shell">
        <header class="career-faction-header">
          <button type="button" class="career-faction-back">← <span></span></button>
          <p class="career-faction-eyebrow">CAREER · 從新兵開始</p>
          <h1 id="career-faction-title">選擇你的陣營</h1>
          <p class="career-faction-subtitle">從一名新兵開始，帶領你的軍隊走向勝利。</p>
        </header>
        <form class="career-faction-form">
          <fieldset class="career-faction-choices">
            <legend class="career-faction-sr-only">選擇陣營</legend>
            ${(['roman', 'viking'] as const).map(faction => this.card(faction)).join('')}
          </fieldset>
          <div class="career-faction-action">
            <button class="career-faction-start" type="submit"><span></span>${icon('speed')}</button>
            <p class="career-faction-commit" hidden>角色已保存；重試將繼續本次新兵訓練。</p>
            <p class="career-faction-error" role="alert" tabindex="-1" hidden></p>
            <p class="career-faction-caption">陣營形象展示 · 你將從新兵開始，裝備需在城鎮自行購買。</p>
          </div>
        </form>
        <footer class="career-faction-footer">
          <section class="career-faction-next" aria-labelledby="career-faction-next-title">
            <h2 id="career-faction-next-title">接下來的流程</h2>
            <ol class="career-faction-steps">
              <li>${icon('axes')}<span><strong>操作訓練</strong><small>熟悉基本操作</small></span></li>
              <li>${icon('coin')}<span><strong>領取 ${CAREER_TUTORIAL_REWARD_AMOUNTS.recruit} 軍功</strong><small>完成後一次領取</small></span></li>
              <li>${icon('town')}<span><strong>進入城鎮</strong><small>購買第一把武器</small></span></li>
            </ol>
            <p>訓練裝備免費借用，僅供練習；完成後進入城鎮，購買自己的裝備。</p>
          </section>
          <section class="career-faction-growth" aria-labelledby="career-faction-growth-title">
            <h2 id="career-faction-growth-title">你的成長之路</h2>
            <ol class="career-faction-ranks">${['新兵', '士兵', '老兵', '隊長', '指揮官'].map((rank, index) => `<li><span class="career-faction-rank-badge" aria-hidden="true">${icon(index < 3 ? 'ranks' : 'shield')}<b>${['I', 'II', 'III', 'IV', 'V'][index]}</b></span><span>${rank}</span></li>`).join('')}</ol>
          </section>
        </footer>
        <p class="career-faction-style-note">羅馬偏穩守，維京偏突擊。玩法風格由你決定，陣營不限制武器或戰術。</p>
      </div>`
    this.radios = Array.from(this.root.querySelectorAll<HTMLInputElement>('input[name="career-faction"]'))
    this.submit = this.root.querySelector<HTMLButtonElement>('.career-faction-start')!
    this.back = this.root.querySelector<HTMLButtonElement>('.career-faction-back')!
    this.back.querySelector('span')!.textContent = options.backLabel ?? '返回主選單'
    this.error = this.root.querySelector<HTMLParagraphElement>('.career-faction-error')!
    this.committedNotice = this.root.querySelector<HTMLParagraphElement>('.career-faction-commit')!
    for (const radio of this.radios) {
      radio.addEventListener('change', () => {
        if (!radio.checked || this.busy || this.committed || this.disposed) return
        this.faction = radio.value as CharacterFaction
        this.render()
      }, { signal: this.events.signal })
    }
    this.back.addEventListener('click', () => {
      if (!this.busy && !this.disposed) options.onBack()
    }, { signal: this.events.signal })
    this.root.querySelector('form')!.addEventListener('submit', event => {
      event.preventDefault()
      if (this.busy || this.disposed) return
      const generation = ++this.generation
      this.error.hidden = true; this.error.textContent = ''
      this.setBusy(true)
      // Invoke directly so the existing launch can retain this user activation.
      let task: Promise<void>
      try { task = options.onStart(this.faction) }
      catch (error) { task = Promise.reject(error) }
      void task.catch(() => {
        if (!this.disposed && generation === this.generation && this.error.hidden) {
          this.showError('無法準備新兵訓練，請重試。')
        }
      }).finally(() => {
        if (!this.disposed && generation === this.generation) this.setBusy(false)
      })
    }, { signal: this.events.signal })
    this.render()
  }

  private card(faction: CharacterFaction): string {
    const data = factions[faction]
    return `<div class="career-faction-option career-faction-${faction}">
      <input type="radio" name="career-faction" id="career-faction-${faction}" value="${faction}" aria-labelledby="career-faction-${faction}-name" aria-describedby="career-faction-${faction}-style career-faction-${faction}-note">
      <label class="career-faction-card" for="career-faction-${faction}">
        <span class="career-faction-portrait"><span class="career-faction-standard" aria-hidden="true">${icon(faction === 'roman' ? 'shield' : 'axes')}</span><img src="${publicAssetUrl(`ui/career/${faction}-faction.webp`)}" alt="${data.alt}" width="640" height="800" draggable="false"></span>
        <span class="career-faction-copy">
          <span class="career-faction-selection">${icon('check')}<span></span></span>
          <span class="career-faction-name" id="career-faction-${faction}-name">${data.name}<span lang="en">${data.english}</span></span>
          <strong class="career-faction-motto" id="career-faction-${faction}-style">${data.title}</strong>
          <span class="career-faction-description">${data.description}</span>
          <span class="career-faction-features">${data.features.map(([symbol, title, detail]) => `<span class="career-faction-feature"><span class="career-faction-feature-icon">${icon(symbol)}</span><span><strong>${title}</strong><span>${detail}</span></span></span>`).join('')}</span>
          <span class="career-faction-fit"><strong>適合的玩家</strong><span>${data.fit}</span></span>
          <span class="career-faction-rule" id="career-faction-${faction}-note">${data.note}</span>
        </span>
      </label>
    </div>`
  }

  mount(parent: HTMLElement): void { if (!this.disposed) parent.append(this.root) }
  setVisible(visible: boolean): void { if (!this.disposed) this.root.hidden = !visible }
  setBusy(busy: boolean): void { if (!this.disposed) { this.busy = busy; this.render() } }
  setCommittedFaction(faction: CharacterFaction): void {
    if (this.disposed) return
    this.committed = true; this.faction = faction
    this.committedNotice.hidden = false
    this.back.querySelector('span')!.textContent = '返回主選單'
    this.render()
  }
  showError(message: string): void {
    if (this.disposed) return
    this.error.textContent = message; this.error.hidden = false
    this.error.focus({ preventScroll: true })
    this.error.scrollIntoView({ block: 'nearest' })
  }
  private render(): void {
    for (const radio of this.radios) {
      const selected = radio.value === this.faction
      radio.checked = selected; radio.disabled = this.busy || this.committed
      const card = radio.nextElementSibling!
      card.setAttribute('data-selected', String(selected))
      card.querySelector('.career-faction-selection span')!.textContent = selected ? '已選擇' : '選擇陣營'
    }
    this.root.setAttribute('aria-busy', String(this.busy))
    this.submit.disabled = this.busy; this.back.disabled = this.busy
    this.submit.querySelector('span')!.textContent = this.busy ? '正在準備新兵訓練…' : `加入${factions[this.faction].name}・開始新兵訓練`
  }
  dispose(): void {
    if (this.disposed) return
    this.disposed = true; this.generation++
    this.events.abort(); this.root.remove()
  }
}
