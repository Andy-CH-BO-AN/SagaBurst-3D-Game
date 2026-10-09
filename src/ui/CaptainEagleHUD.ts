import type { BattleStatsSnapshot } from '../combat/BattleStatsTracker'
import type { CareerMissionOutcome } from '../career/CareerMissionState'
import { renderBattleStats } from './BattleStatsView'

export class CaptainEagleHUD {
  private readonly root = document.createElement('div')
  private result?: HTMLElement

  constructor() {
    this.root.id = 'captain-eagle-hud'
    this.root.style.cssText = 'position:fixed;top:18px;left:50%;transform:translateX(-50%);padding:10px 20px;background:rgba(14,12,10,.85);border:1px solid #8e7b65;color:#e5d8c3;z-index:100;pointer-events:none;text-align:center'
    document.body.append(this.root)
  }

  update(ready: boolean, officialAlive: number, privateAlive: number, enemyAlive: number, pending: number): void {
    this.root.textContent = `Eagle Battle · 巨鷹空戰｜${ready ? '交戰中' : `部署中 ${pending} 人`}｜正式隊 ${officialAlive} · 私兵 ${privateAlive}｜敵軍 ${enemyAlive}`
  }

  showResult(outcome: CareerMissionOutcome, merit: number, stats: BattleStatsSnapshot, onReturn: () => void): void {
    this.showModal(`${outcome === 'victory' ? 'VICTORY · 勝利' : 'DEFEAT · 失敗'}`,
      `Career 軍功 +${merit}（已保存）`, '返回小鎮', onReturn, stats)
  }

  showSaveRetry(onRetry: () => void): void {
    this.showModal('結算尚未保存', '請重試保存軍功後返回小鎮。', '重試保存軍功', onRetry)
  }

  private showModal(title: string, message: string, action: string, onAction: () => void, stats?: BattleStatsSnapshot): void {
    if (document.pointerLockElement) document.exitPointerLock()
    this.result?.remove()
    const modal = document.createElement('div')
    modal.id = 'captain-eagle-result'
    modal.className = 'campaign-result-modal'
    modal.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(10,8,6,.85);z-index:99999;color:#ede0cd'
    modal.innerHTML = `<div class="campaign-result-card"><h1>${title}</h1><p>${message}</p>${renderBattleStats(stats, true)}<div class="campaign-result-actions"><button type="button">${action}</button></div></div>`
    modal.querySelector('button')!.addEventListener('click', onAction)
    document.body.append(modal)
    this.result = modal
  }

  destroy(): void { this.root.remove(); this.result?.remove() }
}
