import type { CampaignGateState } from '../campaign/CampaignGate'
import type { CampaignFaction } from '../campaign/CampaignConfig'
import type {
  DefenseCampaignRuntimeSnapshot,
} from '../campaign/DefenseCampaignRuntime'
import type { BattleStatsSnapshot } from '../combat/BattleStatsTracker'
import { renderBattleStats } from './BattleStatsView'

export type DefenseCampaignResult = 'victory' | 'defeat'

export class DefenseCampaignHUD {
  private readonly root: HTMLElement
  private readonly stageEl: HTMLElement
  private readonly phaseEl: HTMLElement
  private readonly timerEl: HTMLElement
  private readonly gateEl: HTMLElement
  private readonly defenderEl: HTMLElement
  private readonly attackerEl: HTMLElement
  private resultShown = false

  constructor(
    private readonly stageId: number,
    private readonly defenderFaction: CampaignFaction,
    private readonly options: { reinforcementsEnabled?: boolean; returnToTown?: boolean; relief?: boolean; meritAwarded?: () => number } = {},
  ) {
    const root = document.createElement('div')
    root.id = 'defense-campaign-hud'
    root.innerHTML = `
      <div class="campaign-hud-stage">${this.options.relief ? '' : 'STAGE '}<span data-stage></span></div>
      <div class="campaign-hud-phase" data-phase></div>
      <div class="campaign-hud-gate" data-gate></div>
      <div class="campaign-hud-counts">
        <span class="${defenderFaction}" data-defender></span>
        <span class="campaign-hud-vs">VS</span>
        <span class="${defenderFaction === 'roman' ? 'viking' : 'roman'}" data-attacker></span>
      </div>
    `
    document.body.appendChild(root)
    this.root = root
    this.stageEl = root.querySelector('[data-stage]')!
    this.phaseEl = root.querySelector('[data-phase]')!
    this.gateEl = root.querySelector('[data-gate]')!
    const timer = document.createElement('div')
    timer.id = 'defense-campaign-countdown'
    root.appendChild(timer)
    this.timerEl = timer
    this.defenderEl = root.querySelector('[data-defender]')!
    this.attackerEl = root.querySelector('[data-attacker]')!
    this.stageEl.textContent = this.options.relief ? 'Outpost Relief · 騎兵救援' : String(this.stageId)
  }

  updateGate(state: CampaignGateState, unlocked: boolean, canOperate: boolean): void {
    this.gateEl.textContent = state === 'destroyed'
      ? '營門已損毀'
      : !canOperate
        ? `營門${state === 'open' ? '已開啟' : '已關閉'}`
        : !unlocked
          ? '營門鎖定 · 敵軍開始進場後可開門'
          : state === 'open' ? '[G] 關門' : '[G] 開門'
  }

  update(
    snapshot: DefenseCampaignRuntimeSnapshot,
    defenderAlive: number,
    attackerAlive: number,
    defenderFaction: CampaignFaction,
    reinforcementSpawned: boolean,
  ): void {
    const defenderName = defenderFaction === 'roman' ? 'ROMAN' : 'VIKING'
    const attackerName = defenderFaction === 'roman' ? 'VIKING' : 'ROMAN'
    this.defenderEl.textContent = `${defenderName}: ${defenderAlive}`
    this.attackerEl.textContent = `${attackerName}: ${attackerAlive}`

    if (snapshot.phase === 'victory') {
      this.phaseEl.textContent = 'VICTORY'
      this.timerEl.textContent = '敵軍已全滅'
      return
    }

    if (snapshot.phase === 'defeat' && this.options.reinforcementsEnabled === false) {
      this.phaseEl.textContent = 'DEFEAT'
      this.timerEl.textContent = '戰鬥結束'
      return
    }

    const defeatLocked = snapshot.phase === 'defeat'
    if (snapshot.activePhase === 'deployment') {
      this.phaseEl.textContent = defeatLocked
        ? 'DEFEAT LOCKED · DEPLOYMENT'
        : '部署階段 · DEPLOYMENT'
      this.timerEl.textContent = `敵軍進攻：${Math.ceil(snapshot.deploymentRemainingSeconds)}s`
    } else {
      this.phaseEl.textContent = defeatLocked
        ? 'DEFEAT LOCKED · ASSAULT'
        : this.options.relief ? '騎兵救援 · 殲滅剩餘敵軍' : '攻城戰 · ASSAULT'
      this.timerEl.textContent = this.options.reinforcementsEnabled === false
        ? `戰鬥時間：${Math.floor(snapshot.assaultElapsedSeconds)}s`
        : reinforcementSpawned
        ? `戰鬥時間：${Math.floor(snapshot.assaultElapsedSeconds)}s · 援軍已全數抵達`
        : snapshot.reinforcementTriggered
          ? '援軍進場中…'
          : `援軍：${Math.ceil(snapshot.reinforcementRemainingSeconds)}s`
    }
  }

  showResult(
    result: DefenseCampaignResult,
    onReplay: () => void,
    onHome: () => void,
    allowObserve = false,
    onNext?: () => void,
    stats?: BattleStatsSnapshot,
    showSquadStats = false,
  ): void {
    if (this.resultShown) return
    this.resultShown = true

    if (document.pointerLockElement) document.exitPointerLock()

    const modal = document.createElement('div')
    modal.id = 'campaign-result-modal'
    const victory = result === 'victory'
    const statsHtml = renderBattleStats(stats, showSquadStats)
    const victoryMessage = this.options.relief ? 'Outpost 救援完成，剩餘敵軍已全數殲滅。' : this.options.returnToTown
      ? (this.stageId < 3 ? `Outpost ${['I', 'II', 'III'][this.stageId - 1]} 完成，下一個 Outpost 已解鎖。` : 'Outpost Duty 三關全部完成。')
      : this.stageId < 9
      ? `敵軍已全數殲滅，STAGE ${this.stageId + 1} 已解鎖。`
      : '敵軍已全數殲滅，Defense Campaign 全部通關。'
    modal.innerHTML = `
      <div class="campaign-result-card">
        <h1 class="${victory ? 'victory' : 'defeat'}">${victory ? 'VICTORY' : 'DEFEAT'}</h1>
        <p>${
          victory
            ? victoryMessage
            : allowObserve
              ? '玩家與原始守軍全滅。戰場仍會繼續模擬。'
              : '守方已全數陣亡，戰役結束。'
        }</p>
        ${this.options.returnToTown ? `<p>Career 軍功 +${this.options.meritAwarded?.() ?? 0}（已保存）</p>` : ''}
        ${statsHtml}
        <div class="campaign-result-actions">
          ${!victory && allowObserve ? '<button type="button" id="campaign-result-observe">繼續觀戰</button>' : ''}
          ${victory && onNext
            ? `<button type="button" id="campaign-result-next">下一關 STAGE ${this.stageId + 1} →</button>`
            : ''}
          ${this.options.returnToTown ? '' : `<button type="button" id="campaign-result-replay">重玩 STAGE ${this.stageId}</button>`}
          <button type="button" id="campaign-result-home">${this.options.returnToTown ? `返回 ${this.defenderFaction === 'roman' ? 'vinum 村' : 'økse 村'}` : '回首頁'}</button>
        </div>
      </div>
    `
    document.body.appendChild(modal)

    modal.querySelector('#campaign-result-observe')?.addEventListener('click', () => {
      modal.remove()
      this.resultShown = false
    })
    modal.querySelector('#campaign-result-next')?.addEventListener('click', () => onNext?.())
    modal.querySelector('#campaign-result-replay')?.addEventListener('click', onReplay)
    modal.querySelector('#campaign-result-home')?.addEventListener('click', onHome)
  }

  destroy(): void {
    this.root.remove()
    this.timerEl.remove()
    document.getElementById('campaign-result-modal')?.remove()
  }
}
