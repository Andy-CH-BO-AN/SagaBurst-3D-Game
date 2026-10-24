import type { CareerRaceSession, RaceRider } from '../career/CareerRaceState'
import { MOUNTED_RACES } from '../career/CareerRaceState'
import { RACE_LINES, legalRaceStart } from '../career/CareerRaceRoute'

interface RaceHUDOptions {
  ready: boolean
  resultSaved: boolean
  saveFailed: boolean
  error: string
  distance: number | null
}

const MOUNT_NAMES = { horse: '戰馬', corgi: '柯基', 'black-cat': '黑貓', 'snow-leopard': '重甲雪豹' } as const
function setText(element: HTMLElement, value: string): void {
  if (element.textContent !== value) element.textContent = value
}
function raceTime(seconds: number): string {
  const tenths = Math.floor(Math.max(0, seconds) * 10)
  return `${String(Math.floor(tenths / 600)).padStart(2, '0')}:${String(Math.floor(tenths / 10) % 60).padStart(2, '0')}.${tenths % 10}`
}

/** Uses the campaign status frame and typography; racing owns its own content and lifecycle. */
export class CareerRaceHUD {
  readonly element = document.createElement('div')
  private readonly title: HTMLElement
  private readonly phase: HTMLElement
  private readonly timerLabel: HTMLElement
  private readonly timer: HTMLElement
  private readonly objective: HTMLElement
  private readonly mode: HTMLElement
  private readonly warning: HTMLElement
  private readonly racers: Array<{ status: HTMLElement; progress: HTMLProgressElement }>
  private readonly layoutObserver: ResizeObserver

  constructor() {
    const root = this.element
    root.id = 'career-race-hud'; root.className = 'campaign-status-hud'
    root.setAttribute('role', 'region'); root.setAttribute('aria-label', '繞城賽馬狀態')
    root.innerHTML = `
      <div class="campaign-hud-stage" data-title></div>
      <div class="campaign-hud-phase" data-phase></div>
      <div class="race-hud-clock"><span data-timer-label></span><strong data-timer></strong></div>
      <div class="race-hud-objective"><span>目前目標</span><strong data-objective></strong></div>
      <div class="campaign-hud-counts race-hud-racers">
        <div class="race-hud-rider race-hud-player"><div><span>玩家</span><strong data-status></strong></div><progress max="5" value="0" aria-label="玩家檢查點進度"></progress></div>
        <div class="race-hud-rider race-hud-opponent"><div><span>對手</span><strong data-status></strong></div><progress max="5" value="0" aria-label="對手檢查點進度"></progress></div>
      </div>
      <div class="campaign-hud-squads" data-mode></div>
      <div class="race-hud-warning" role="status" data-warning hidden></div>
    `
    this.title = root.querySelector('[data-title]')!
    this.phase = root.querySelector('[data-phase]')!
    this.timerLabel = root.querySelector('[data-timer-label]')!
    this.timer = root.querySelector('[data-timer]')!
    this.objective = root.querySelector('[data-objective]')!
    this.mode = root.querySelector('[data-mode]')!
    this.warning = root.querySelector('[data-warning]')!
    this.racers = [...root.querySelectorAll<HTMLElement>('.race-hud-rider')].map(row => ({
      status: row.querySelector<HTMLElement>('[data-status]')!, progress: row.querySelector<HTMLProgressElement>('progress')!,
    }))
    root.hidden = true
    document.body.append(root)
    this.layoutObserver = new ResizeObserver(() => {
      if (!root.hidden) document.body.style.setProperty('--career-race-hud-bottom', `${Math.ceil(root.getBoundingClientRect().bottom)}px`)
    })
    this.layoutObserver.observe(root)
  }

  update(session: CareerRaceSession | null, options: RaceHUDOptions): void {
    const root = this.element
    if (root.hidden !== !session) {
      root.hidden = !session
      if (!session) document.body.style.removeProperty('--career-race-hud-bottom')
    }
    if (!session) return
    const definition = MOUNTED_RACES.find(race => race.id === session.raceId)!
    const countdown = session.phase === 'countdown'
    const finishing = session.phase === 'finishing'
    const observing = session.player.dead || Boolean(session.player.dnf)
    const announced = Boolean(session.result && options.resultSaved)
    if (root.dataset.phase !== session.phase) root.dataset.phase = session.phase
    setText(this.title, `${definition.name} · 繞城賽馬`)
    setText(this.phase, !options.ready ? '賽手準備中'
      : session.phase === 'returning' ? '返回小鎮'
      : finishing ? '等待完賽'
      : session.result ? announced ? { win: '勝利 VICTORY', loss: '失敗 DEFEAT', draw: '平手 DRAW' }[session.result] : '結果保存中'
      : observing ? '觀戰中' : countdown ? '準備起跑' : session.phase === 'guiding' ? '前往起點' : '競速中')
    setText(this.timerLabel, countdown ? '起跑倒數' : '比賽時間')
    setText(this.timer, countdown ? String(Math.ceil(session.countdownSeconds))
      : session.phase === 'guiding' ? '—' : session.phase === 'racing' && session.elapsedSeconds < 1 ? 'GO' : raceTime(session.elapsedSeconds))
    const target = !options.ready ? options.error || '等待對手就緒'
      : session.phase === 'returning' ? '跟隨 Captain 返回鎮內 · Esc 可改為直接返回'
      : finishing ? session.player.finishSeconds !== undefined ? '玩家已完賽，等待對手返回終點' : `對手已完賽；下一站：${RACE_LINES[session.player.checkpoint]?.label ?? '完成'}`
      : session.result ? announced ? session.reason || '比賽結束' : '結果已鎖定，等待保存'
      : observing ? '等待對手合法完賽'
      : session.phase === 'guiding' ? session.guideFallback ? '自行前往北門起跑區' : '跟隨 Captain 前往北門'
      : countdown ? '留在北門內側起跑區' : `下一站：${RACE_LINES[session.player.checkpoint]?.label ?? '完成'}`
    const distance = (!session.result || finishing) && !observing && options.distance !== null ? ` · ${Math.round(options.distance)} m` : ''
    setText(this.objective, target + distance)
    setText(this.mode, `${session.opponent.actorId === 'commander' ? '指揮官' : '對手'}：${MOUNT_NAMES[definition.mount]} · ${definition.sprint ? '衝刺賽' : '一般速度'} · 玩家可 Shift 衝刺`)
    this.updateRider(session.player, 0); this.updateRider(session.opponent, 1)
    const warning = options.saveFailed && !options.ready ? '部署保存失敗；請重新載入以重試同場賽事。'
      : options.saveFailed ? '保存失敗，將重試；結果保存成功後才公布。'
      : countdown && !observing && !legalRaceStart(session.player.position) ? '搶跑！倒數結束前返回北門內側，否則判負。'
      : session.guideFallback && session.phase === 'guiding' && !observing ? 'Captain 無法引導，請依箭頭前往北門。'
      : ''
    setText(this.warning, warning)
    if (this.warning.hidden !== !warning) this.warning.hidden = !warning
  }

  private updateRider(rider: RaceRider, index: number): void {
    const row = this.racers[index]
    setText(row.status, rider.finishSeconds !== undefined ? `完賽 ${raceTime(rider.finishSeconds)}`
      : rider.dead ? '已陣亡' : rider.dnf ? 'DNF · 無法完賽' : `${rider.checkpoint} / 5 檢查點`)
    if (row.progress.value !== rider.checkpoint) row.progress.value = rider.checkpoint
  }

  dispose(): void {
    this.layoutObserver.disconnect(); this.element.remove()
    document.body.style.removeProperty('--career-race-hud-bottom')
  }
}
