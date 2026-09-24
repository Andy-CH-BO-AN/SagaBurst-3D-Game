import type { CampaignFaction } from '../campaign/CampaignConfig'
import type {
  DefenseCampaignRuntimeSnapshot,
} from '../campaign/DefenseCampaignRuntime'

export type DefenseCampaignResult = 'victory' | 'defeat'

export class DefenseCampaignHUD {
  private readonly root: HTMLElement
  private readonly stageEl: HTMLElement
  private readonly phaseEl: HTMLElement
  private readonly timerEl: HTMLElement
  private readonly defenderEl: HTMLElement
  private readonly attackerEl: HTMLElement
  private resultShown = false

  constructor(
    private readonly stageId: number,
    defenderFaction: CampaignFaction,
  ) {
    const root = document.createElement('div')
    root.id = 'defense-campaign-hud'
    root.innerHTML = `
      <div class="campaign-hud-stage">STAGE <span data-stage></span></div>
      <div class="campaign-hud-phase" data-phase></div>
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
    const timer = document.createElement('div')
    timer.id = 'defense-campaign-countdown'
    document.body.appendChild(timer)
    this.timerEl = timer
    this.defenderEl = root.querySelector('[data-defender]')!
    this.attackerEl = root.querySelector('[data-attacker]')!
    this.stageEl.textContent = String(this.stageId)
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

    const defeatLocked = snapshot.phase === 'defeat'
    if (snapshot.activePhase === 'deployment') {
      this.phaseEl.textContent = defeatLocked
        ? 'DEFEAT LOCKED · DEPLOYMENT'
        : '部署階段 · DEPLOYMENT'
      this.timerEl.textContent = `敵軍進攻：${Math.ceil(snapshot.deploymentRemainingSeconds)}s`
    } else {
      this.phaseEl.textContent = defeatLocked
        ? 'DEFEAT LOCKED · ASSAULT'
        : '攻城戰 · ASSAULT'
      this.timerEl.textContent = reinforcementSpawned
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
  ): void {
    if (this.resultShown) return
    this.resultShown = true

    if (document.pointerLockElement) document.exitPointerLock()

    const modal = document.createElement('div')
    modal.id = 'campaign-result-modal'
    const victory = result === 'victory'
    const victoryMessage = this.stageId < 9
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
        <div class="campaign-result-actions">
          ${!victory && allowObserve ? '<button type="button" id="campaign-result-observe">繼續觀戰</button>' : ''}
          ${victory && onNext
            ? `<button type="button" id="campaign-result-next">下一關 STAGE ${this.stageId + 1} →</button>`
            : ''}
          <button type="button" id="campaign-result-replay">重玩 STAGE ${this.stageId}</button>
          <button type="button" id="campaign-result-home">回首頁</button>
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
