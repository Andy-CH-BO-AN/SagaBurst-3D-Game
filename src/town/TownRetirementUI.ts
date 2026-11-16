import romanEscaped from '../assets/retirement/roman_escaped.webp?url'
import romanFallen from '../assets/retirement/roman_fallen.webp?url'
import romanLegacy from '../assets/retirement/roman_legacy.webp?url'
import vikingEscaped from '../assets/retirement/viking_escaped.webp?url'
import vikingFallen from '../assets/retirement/viking_fallen.webp?url'
import vikingLegacy from '../assets/retirement/viking_legacy.webp?url'
import type { CareerProfile } from '../career/CareerProfile'
import { commanderRetirementEligibility } from '../career/CareerRetirement'
import './retirement-ending.css'

const RETIREMENT_DETAIL = '完成十場指揮官任務，並至少一次守住敵軍全線進攻後，即可申請退休。'
const RETIREMENT_DIALOGUE = '十場勝利。連敵軍的全線進攻，也沒能從你手中奪走這座城。\n\n你替這裡流的血已經夠多了。軍隊會記得你，城鎮也會記得你。\n\n交回軍令吧。帶上真正屬於你的士兵，到城外完成最後一次點名。\n\n謝謝你所做的一切。願你往後，不必再為任何人的命令拔劍。'
const RETIREMENT_CONFIRMATION = '退休將永久結束你的 Commander 生涯。\n\n你將失去城鎮部隊指揮權，私人部隊會隨你離開。\n\n此選擇將進入 Career 結局，無法撤回。'

function button(parent: HTMLElement, label: string, action: () => void): HTMLButtonElement {
  const button = document.createElement('button')
  button.className = 'town-button'; button.textContent = label; button.onclick = action
  parent.append(button)
  return button
}

/** Presentation only; acceptance still belongs to Town's save-first transaction. */
export function appendCommanderRetirementOption(panel: HTMLElement, profile: CareerProfile, actions: {
  available(): boolean
  openPanel(title: string, text: string): HTMLDivElement
  start(): boolean
  leave(): void
}): void {
  if (profile.rank !== 'commander') return
  // Recheck live service authority, not the profile captured by a removed dialog.
  const serviceButton = (parent: HTMLElement, label: string, action: () => void) =>
    button(parent, label, () => { if (actions.available()) action() })
  const eligibility = commanderRetirementEligibility(profile)
  const detail = document.createElement('p'); detail.className = 'town-summary'; detail.style.whiteSpace = 'pre-line'
  detail.textContent = `退休資格\n\n指揮官任務勝利：${eligibility.commanderVictories} / ${eligibility.requiredVictories}\n守住敵軍全線進攻：${eligibility.fourGateDefenseCompleted ? '已完成' : '未完成'}`
    + (eligibility.eligible ? '\n\n退休資格已完成\n你可以向前任指揮官申請退休。' : '')
  detail.title = RETIREMENT_DETAIL
  panel.append(detail)
  const apply = serviceButton(panel, '申請退休', () => {
    if (!eligibility.eligible || profile.careerRetirement) return
    const dialogue = actions.openPanel('前任指揮官', RETIREMENT_DIALOGUE)
    serviceButton(dialogue, '申請退休', () => {
      const confirmation = actions.openPanel('申請退休', RETIREMENT_CONFIRMATION)
      const status = document.createElement('p'); confirmation.append(status)
      const accept = serviceButton(confirmation, '接受退休', () => {
        if (accept.disabled) return
        accept.disabled = true
        if (!actions.start()) {
          status.textContent = '退休尚未完成。請確認目前沒有任務或競賽，並在存檔可用後重試。'
          accept.disabled = false
          return
        }
        actions.openPanel('申請退休', '城鎮軍令已交回。\n所有私人部隊已改為 Follow。\n前往北方地圖邊緣的退役集合區。')
      })
      serviceButton(confirmation, '暫時留下', actions.leave)
    })
    serviceButton(dialogue, '暫時留下', actions.leave)
  })
  apply.title = RETIREMENT_DETAIL
  apply.disabled = !eligibility.eligible || Boolean(profile.careerRetirement)
}

/** Visual variants do not add or change the persisted battle outcome. */
export function retirementEndingView(profile: CareerProfile) {
  const ENDINGS = {
    fallen: {
      images: { roman: romanFallen, viking: vikingFallen },
      title: '光榮退役',
      subtitle: '他曾守住四座城門，最後卻死在自己守護的城前。',
      body: '你曾替這座城守住四面城門。\n最後一次，沒有人替你守住退路。\n\n官方記錄宣稱，你在退役途中發動叛亂，最終被城鎮軍隊平定。\n\n軍冊上只留下四個字：\n\n光榮退役\n\n城鎮仍然安全。\n因為它最害怕的人，已經倒下。',
    },
    escaped: {
      images: { roman: romanEscaped, viking: vikingEscaped },
      title: '帶旗離城',
      subtitle: '你交出了軍權，卻從未失去追隨者。',
      body: '你曾替這座城守住四面城門。\n最後一次，城門在你身後關上。\n\n戰鬥結束時，你仍然站著。\n軍權被收回，願意追隨你的人卻沒有散去。\n\n他們想讓你的退休成為一場葬禮。\n你卻帶著自己的旗，活著離開。\n\n從此，你不再為城鎮而戰。\n你只為自己，以及曾選擇站在你身旁的人拔劍。',
    },
    legacy: {
      images: { roman: romanLegacy, viking: vikingLegacy },
      title: '旗幟不倒',
      subtitle: '指揮官沒能回來，但他們帶著他的意志走出了戰場。',
      body: '你曾替這座城守住四面城門。\n最後一次，你倒在了離城的路上。\n\n但願意追隨你的人沒有散去。\n他們撐過了追殺，或擊潰了全城的敵軍，讓你的旗仍然飄揚。\n\n你沒能活著離開。\n你的部隊卻帶著你的旗，走出了這場清算。',
    },
  } as const

  const state = profile.careerRetirement
  if (state?.phase !== 'completed' || !state.outcome) return null
  const variant = state.outcome === 'escaped' && profile.retirementRuntime?.player?.hp === 0 ? 'legacy' : state.outcome
  const battle = profile.retirementRuntime?.stats
  const metric = (value: number | undefined): string => typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value).toLocaleString('zh-TW') : '—'
  const seconds = state.combatElapsedSeconds
  return {
    ...ENDINGS[variant], variant,
    faction: profile.faction === 'viking' ? '維京' : '羅馬',
    imageUrl: ENDINGS[variant].images[profile.faction],
    stats: [
      ['指揮官任務勝利', metric(profile.careerMissionCompletionsByTier?.[5])],
      ['最後一戰玩家擊殺', metric(battle?.player?.kills)],
      ['最後一戰私人部隊擊殺', metric(battle?.personal?.kills)],
      ['玩家造成傷害', metric(battle?.player?.damageDealt)],
      ['玩家承受傷害', metric(battle?.player?.damageTaken)],
      ['私人部隊造成傷害', metric(battle?.personal?.damageDealt)],
      ['私人部隊承受傷害', metric(battle?.personal?.damageTaken)],
      ['最後一戰持續時間', typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0
        ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}` : '—'],
    ],
  }
}

let closeActiveEnding: (() => void) | undefined

/** DOM-only ending. The caller owns save replacement and scene transitions. */
export function showCommanderRetirementEnding(profile: CareerProfile, actions: {
  home(): void
  newCareer(): void
}): () => void {
  closeActiveEnding?.()
  const ending = retirementEndingView(profile)
  if (!ending) return () => {}
  document.exitPointerLock?.()
  let disposed = false
  const handlers: HTMLButtonElement[] = []
  const screen = document.createElement('section'); screen.id = 'career-retirement-ending'
  screen.className = `retirement-ending retirement-${profile.faction}`
  screen.setAttribute('aria-labelledby', 'retirement-ending-title')
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) => {
    const node = document.createElement(tag); node.className = className
    if (text !== undefined) node.textContent = text
    return node
  }
  const addButton = (parent: HTMLElement, label: string, action: () => void, className = '') => {
    const node = button(parent, label, () => { if (!disposed) action() })
    node.className = `retirement-button ${className}`; node.type = 'button'
    handlers.push(node); return node
  }
  const dispose = () => {
    if (disposed) return
    disposed = true
    for (const node of handlers) node.onclick = null
    copy.onanimationend = null
    screen.onkeydown = null; screen.remove()
    if (closeActiveEnding === dispose) closeActiveEnding = undefined
  }
  closeActiveEnding = dispose
  const hero = make('header', 'retirement-hero')
  const art = make('div', 'retirement-art')
  art.style.backgroundImage = `url("${ending.imageUrl}")`; art.setAttribute('aria-hidden', 'true')
  const copy = make('div', 'retirement-copy')
  const eyebrow = make('p', 'retirement-eyebrow', 'SAGABURST · THE FINAL CHAPTER')
  const title = make('h1', 'retirement-title', ending.title); title.id = 'retirement-ending-title'
  title.tabIndex = -1
  const subtitle = make('p', 'retirement-subtitle', ending.subtitle)
  copy.append(eyebrow, title, subtitle)
  const skip = addButton(hero, '略過動畫', () => {
    screen.setAttribute('data-motion', 'skipped'); skip.hidden = true
  }, 'retirement-skip')
  copy.onanimationend = event => {
    if (!disposed && event.target === copy && event.animationName === 'retirement-copy') skip.hidden = true
  }
  hero.append(art, copy)
  const content = make('div', 'retirement-content')
  const stats = make('section', 'retirement-stats')
  stats.setAttribute('aria-labelledby', 'retirement-stats-title')
  const statsTitle = make('h2', '', '最後的戰記'); statsTitle.id = 'retirement-stats-title'
  const caption = make('p', 'retirement-caption', `${ending.faction} · 生涯終章`)
  const grid = make('dl', 'retirement-stat-grid')
  for (const [label, value] of ending.stats) {
    const cell = make('div', 'retirement-stat')
    cell.append(make('dt', '', label), make('dd', '', value)); grid.append(cell)
  }
  stats.append(caption, statsTitle, grid)
  const story = make('details', 'retirement-story')
  story.append(make('summary', '', '閱讀完整故事'), make('p', '', ending.body))
  const controls = make('nav', 'retirement-controls'); controls.setAttribute('aria-label', '結局操作')
  addButton(controls, '返回主選單', () => { dispose(); actions.home() }, 'retirement-primary')
  const creator = addButton(controls, '開啟新生涯', () => {
    confirmation.hidden = false; cancel.focus()
  })
  const confirmation = make('div', 'retirement-confirmation'); confirmation.hidden = true
  confirmation.setAttribute('role', 'alertdialog'); confirmation.setAttribute('aria-modal', 'true')
  confirmation.setAttribute('aria-labelledby', 'retirement-confirm-title')
  confirmation.setAttribute('aria-describedby', 'retirement-confirm-warning')
  const card = make('div', 'retirement-confirm-card')
  const warningTitle = make('h2', '', '開啟新生涯？'); warningTitle.id = 'retirement-confirm-title'
  const warning = make('p', '', '開啟新生涯將取代目前的 Career 存檔。確認後選擇陣營，成功保存時才會取代；取消將保留這段生涯。')
  warning.id = 'retirement-confirm-warning'
  card.append(warningTitle, warning)
  const confirm = addButton(card, '確認，選擇陣營', () => { dispose(); actions.newCareer() }, 'retirement-primary')
  const cancel = addButton(card, '取消', () => { confirmation.hidden = true; creator.focus() })
  confirmation.append(card)
  screen.onkeydown = event => {
    if (confirmation.hidden) return
    if (event.key === 'Escape') { event.preventDefault(); confirmation.hidden = true; creator.focus() }
    if (event.key === 'Tab') {
      // Two controls in the modal; keep keyboard focus inside until resolved.
      event.preventDefault(); (document.activeElement === cancel ? confirm : cancel).focus()
    }
  }
  content.append(stats, story, controls)
  screen.append(hero, content, confirmation); document.body.append(screen)
  title.focus({ preventScroll: true })
  return dispose
}
