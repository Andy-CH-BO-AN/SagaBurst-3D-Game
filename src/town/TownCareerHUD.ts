import '../ui/career-hud.css'

export interface TownCareerHudSquad {
  label: string
  alive: number
  total: number
  state: string
  showKey?: boolean
}

export interface TownCareerHudBanner {
  tone: 'mission' | 'alert' | 'info'
  title: string
  detail?: string
}

export interface TownCareerHudFinale {
  clock: string
  playerKills: number
  squadKills: number
  aliveSquad: number
  spectator: boolean
  notice?: string
}

export interface TownCareerHudState {
  mode: 'town' | 'coop' | 'finale'
  hidden: boolean
  faction: 'roman' | 'viking'
  location: string
  rankLabel: string
  availableMerit: number
  totalMerit: number
  squads?: readonly TownCareerHudSquad[]
  banner?: TownCareerHudBanner
  finale?: TownCareerHudFinale
}

/** Structured top-left Career status card (#town-hud) using memoized DOM updates. */
export class TownCareerHUD {
  readonly element = document.createElement('div')
  private readonly placeIcon = document.createElement('span')
  private readonly locationEl = document.createElement('strong')
  private readonly rankEl = document.createElement('span')
  private readonly meritRow = document.createElement('div')
  private readonly availableValue = document.createElement('strong')
  private readonly totalValue = document.createElement('strong')
  private readonly squadsEl = document.createElement('div')
  private readonly finaleEl = document.createElement('div')
  private readonly finaleClock = document.createElement('div')
  private readonly finalePlayerKills = document.createElement('strong')
  private readonly finaleSquadKills = document.createElement('strong')
  private readonly finaleAliveSquad = document.createElement('strong')
  private readonly bannerEl = document.createElement('div')
  private readonly bannerTitle = document.createElement('span')
  private readonly bannerDetail = document.createElement('span')
  private lastKey = ''
  private lastHidden: boolean | null = null

  constructor() {
    this.element.id = 'town-hud'

    const header = document.createElement('div')
    header.className = 'town-hud-header'
    const place = document.createElement('div')
    place.className = 'town-hud-place'
    this.placeIcon.className = 'sb-glyph sb-glyph-roman town-hud-place-icon'
    this.locationEl.className = 'town-hud-location'
    place.append(this.placeIcon, this.locationEl)
    this.rankEl.className = 'town-hud-rank'
    header.append(place, this.rankEl)

    this.meritRow.className = 'town-hud-merit'
    const availBox = this.createMetric('可用軍功', this.availableValue, false)
    const totalBox = this.createMetric('累積軍功', this.totalValue, true)
    this.meritRow.append(availBox, totalBox)

    this.squadsEl.className = 'town-hud-squads'
    this.squadsEl.hidden = true

    this.finaleEl.className = 'town-hud-finale'
    this.finaleEl.hidden = true
    this.finaleClock.className = 'town-hud-finale-clock'
    const finaleStats = document.createElement('div')
    finaleStats.className = 'town-hud-finale-stats'
    finaleStats.append(
      this.createFinaleStat('玩家擊殺', this.finalePlayerKills),
      this.createFinaleStat('小隊擊殺', this.finaleSquadKills),
      this.createFinaleStat('私人部隊', this.finaleAliveSquad),
    )
    this.finaleEl.append(this.finaleClock, finaleStats)

    this.bannerEl.className = 'town-hud-banner'
    this.bannerEl.hidden = true
    this.bannerTitle.className = 'town-hud-banner-title'
    this.bannerDetail.className = 'town-hud-banner-detail'
    this.bannerEl.append(this.bannerTitle, this.bannerDetail)

    this.element.append(header, this.meritRow, this.squadsEl, this.finaleEl, this.bannerEl)
  }

  private createMetric(labelText: string, valueEl: HTMLElement, muted: boolean): HTMLDivElement {
    const box = document.createElement('div')
    box.className = 'town-hud-metric'
    const label = document.createElement('span')
    label.className = 'town-hud-metric-label'
    label.textContent = labelText
    valueEl.className = muted ? 'town-hud-metric-value is-muted' : 'town-hud-metric-value'
    box.append(label, valueEl)
    return box
  }

  private createFinaleStat(labelText: string, valueEl: HTMLElement): HTMLDivElement {
    const stat = document.createElement('div')
    stat.className = 'town-hud-finale-stat'
    const label = document.createElement('small')
    label.textContent = labelText
    stat.append(label, valueEl)
    return stat
  }

  clear(): void {
    this.lastKey = ''
    this.lastHidden = true
    this.element.style.display = 'none'
  }

  render(state: TownCareerHudState): void {
    if (this.lastHidden !== state.hidden) {
      this.lastHidden = state.hidden
      this.element.style.display = state.hidden ? 'none' : ''
    }
    if (state.hidden) return

    const key = JSON.stringify(state)
    if (key === this.lastKey) return
    this.lastKey = key

    const iconClass = state.mode === 'coop'
      ? 'sb-glyph-coop'
      : state.faction === 'viking' ? 'sb-glyph-viking' : 'sb-glyph-roman'
    this.placeIcon.className = `sb-glyph ${iconClass} town-hud-place-icon`
    this.locationEl.textContent = state.location
    this.rankEl.textContent = state.rankLabel

    const isFinale = state.mode === 'finale' && Boolean(state.finale)
    this.meritRow.hidden = isFinale
    this.finaleEl.hidden = !isFinale

    if (isFinale && state.finale) {
      this.finaleClock.textContent = state.finale.clock
      this.finalePlayerKills.textContent = String(state.finale.playerKills)
      this.finaleSquadKills.textContent = String(state.finale.squadKills)
      this.finaleAliveSquad.textContent = String(state.finale.aliveSquad)
      this.squadsEl.hidden = true
    } else {
      this.availableValue.textContent = state.availableMerit.toLocaleString()
      this.totalValue.textContent = state.totalMerit.toLocaleString()
      this.renderSquads(state.squads ?? [])
    }

    if (state.banner) {
      this.bannerEl.hidden = false
      this.bannerEl.className = `town-hud-banner ${state.banner.tone === 'alert' ? 'is-alert' : state.banner.tone === 'mission' ? 'is-mission' : ''}`
      this.bannerTitle.textContent = state.banner.title
      const detail = state.banner.detail ?? ''
      this.bannerDetail.textContent = detail
      this.bannerDetail.hidden = !detail
    } else {
      this.bannerEl.hidden = true
      this.bannerTitle.textContent = ''
      this.bannerDetail.textContent = ''
    }
  }

  private renderSquads(squads: readonly TownCareerHudSquad[]): void {
    this.squadsEl.textContent = ''
    if (!squads.length) {
      this.squadsEl.hidden = true
      return
    }
    this.squadsEl.hidden = false
    for (const squad of squads) {
      const row = document.createElement('div')
      row.className = 'town-hud-squad-row'
      const name = document.createElement('span')
      name.className = 'town-hud-squad-name'
      const icon = document.createElement('span')
      icon.className = 'sb-glyph sb-glyph-squad'
      icon.style.width = '14px'
      icon.style.height = '14px'
      const label = document.createElement('span')
      label.textContent = squad.label
      name.append(icon, label)

      const meta = document.createElement('span')
      meta.className = 'town-hud-squad-meta'
      const count = document.createElement('strong')
      count.textContent = `${squad.alive}/${squad.total}`
      const state = document.createElement('span')
      state.textContent = squad.state
      meta.append(count, state)
      if (squad.showKey !== false) {
        const kbd = document.createElement('kbd')
        kbd.className = 'sb-kbd'
        kbd.textContent = 'Q'
        meta.append(kbd)
      }
      row.append(name, meta)
      this.squadsEl.append(row)
    }
  }

  dispose(): void {
    this.element.remove()
  }
}

const HINT_CACHE = new WeakMap<HTMLElement, string>()

/** Formats `#town-hint` with a tactile `[E]` keycap when the prompt starts with `'E '`, memoized by text. */
export function renderTownHint(el: HTMLElement, text: string): void {
  const prev = HINT_CACHE.get(el)
  if (prev === text) return
  HINT_CACHE.set(el, text)

  el.textContent = ''
  if (!text) {
    el.className = ''
    el.style.display = 'none'
    return
  }

  el.style.display = ''
  if (text.startsWith('E ')) {
    el.className = ''
    const kbd = document.createElement('kbd')
    kbd.className = 'sb-kbd'
    kbd.textContent = 'E'
    const label = document.createElement('span')
    label.textContent = text.slice(2)
    el.append(kbd, label)
  } else {
    el.className = text.includes('追擊') || text.includes('攻擊') ? 'is-alert' : ''
    const label = document.createElement('span')
    label.textContent = text
    el.append(label)
  }
}
