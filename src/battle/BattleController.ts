/**
 * BattleController.ts
 * Manages live combat monitoring, army casualties, victory determination,
 * and sessionStorage-based page reload transitions (REMATCH / BACK TO SETUP).
 */
import { NPC, Faction } from '../world/NPC'
import { BattleConfig } from './BattleConfig'

export class BattleController {
  private readonly config: BattleConfig
  private battleEnded = false

  private initialVikingCount = 0
  private initialRomanCount = 0

  constructor(config: BattleConfig) {
    this.config = config
    this._createHud()
  }

  initCounts(npcs: NPC[]): void {
    this.initialVikingCount = npcs.filter(n => n.faction === Faction.PLAYER).length
    this.initialRomanCount = npcs.filter(n => n.faction === Faction.ENEMY).length
    this._updateHud(this.initialVikingCount, this.initialRomanCount)
  }

  update(npcs: NPC[]): void {
    if (this.battleEnded) return

    // Count living AI NPCs only (Player character is intentionally excluded)
    let vikingAlive = 0
    let romanAlive = 0

    for (const npc of npcs) {
      if (!npc.dead) {
        if (npc.faction === Faction.PLAYER) vikingAlive++
        else if (npc.faction === Faction.ENEMY) romanAlive++
      }
    }

    this._updateHud(vikingAlive, romanAlive)

    // Check victory conditions (Both sides must have initialized with > 0)
    if (this.initialRomanCount > 0 && romanAlive === 0) {
      this._endBattle('VIKING VICTORY', '#3498db', '維京軍團獲勝！')
    } else if (this.initialVikingCount > 0 && vikingAlive === 0) {
      this._endBattle('ROMAN VICTORY', '#e74c3c', '羅馬軍團獲勝！')
    }
  }

  private _createHud(): void {
    const hud = document.createElement('div')
    hud.id = 'battle-status-hud'
    hud.style.cssText = `
      position: fixed;
      top: 18px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      gap: 24px;
      align-items: center;
      padding: 8px 24px;
      background: rgba(14, 12, 10, 0.85);
      border: 1px solid rgba(212, 175, 55, 0.4);
      border-radius: 6px;
      color: #e5d8c3;
      font-family: 'Cinzel', 'Trajan Pro', Georgia, serif;
      font-size: 14px;
      letter-spacing: 0.1em;
      z-index: 100;
      pointer-events: none;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.7);
    `
    hud.innerHTML = `
      <div style="color: #5dade2; font-weight: bold;">VIKING: <span id="hud-viking-alive">--</span></div>
      <div style="color: #888; font-size: 11px;">VS</div>
      <div style="color: #e74c3c; font-weight: bold;">ROMAN: <span id="hud-roman-alive">--</span></div>
    `
    document.body.appendChild(hud)

  }

  private _updateHud(vikingAlive: number, romanAlive: number): void {
    const vEl = document.getElementById('hud-viking-alive')
    const rEl = document.getElementById('hud-roman-alive')
    if (vEl) vEl.textContent = `${vikingAlive} / ${this.initialVikingCount}`
    if (rEl) rEl.textContent = `${romanAlive} / ${this.initialRomanCount}`
  }

  private _endBattle(title: string, titleColor: string, subtitle: string): void {
    this.battleEnded = true
    if (document.pointerLockElement) {
      document.exitPointerLock()
    }

    const modal = document.createElement('div')
    modal.id = 'battle-result-modal'
    modal.style.cssText = `
      position: fixed;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: rgba(10, 8, 6, 0.85);
      backdrop-filter: blur(8px);
      z-index: 99999;
      color: #ede0cd;
      font-family: 'Cinzel', Georgia, serif;
      animation: fadeIn 0.8s ease-out;
    `

    modal.innerHTML = `
      <div style="
        border: 2px solid #8e7b65;
        background: radial-gradient(circle at center, #26201a 0%, #120e0b 100%);
        padding: 48px 64px;
        border-radius: 8px;
        text-align: center;
        box-shadow: 0 12px 48px rgba(0, 0, 0, 0.9), inset 0 0 30px rgba(0, 0, 0, 0.7);
        max-width: 500px;
        width: 90%;
      ">
        <h1 style="margin: 0 0 8px 0; font-size: 38px; letter-spacing: 0.15em; color: ${titleColor}; text-shadow: 0 0 20px ${titleColor}66;">${title}</h1>
        <p style="margin: 0 0 36px 0; font-size: 16px; color: #a99a86; letter-spacing: 0.08em;">${subtitle}</p>
        <div style="display: flex; gap: 20px; justify-content: center;">
          <button id="btn-rematch" style="
            padding: 12px 28px;
            background: #2b221a;
            color: #f1e2ce;
            border: 1px solid #d4af37;
            border-radius: 4px;
            font-size: 14px;
            letter-spacing: 0.12em;
            cursor: pointer;
            font-family: inherit;
            transition: all 0.2s;
          ">REMATCH</button>
          <button id="btn-back-setup" style="
            padding: 12px 28px;
            background: #1f1a16;
            color: #bbb;
            border: 1px solid #665a4c;
            border-radius: 4px;
            font-size: 14px;
            letter-spacing: 0.12em;
            cursor: pointer;
            font-family: inherit;
            transition: all 0.2s;
          ">BACK TO SETUP</button>
        </div>
      </div>
    `

    document.body.appendChild(modal)


    const rematchBtn = document.getElementById('btn-rematch')
    rematchBtn?.addEventListener('mouseenter', () => { rematchBtn.style.background = '#4a3828' })
    rematchBtn?.addEventListener('mouseleave', () => { rematchBtn.style.background = '#2b221a' })
    rematchBtn?.addEventListener('click', () => {
      try {
        sessionStorage.setItem('sagaburst_battle_config', JSON.stringify(this.config))
      } catch (e) {
        console.warn('sessionStorage error', e)
      }
      window.location.reload()
    })

    const backBtn = document.getElementById('btn-back-setup')
    backBtn?.addEventListener('mouseenter', () => { backBtn.style.background = '#382e25' })
    backBtn?.addEventListener('mouseleave', () => { backBtn.style.background = '#1f1a16' })
    backBtn?.addEventListener('click', () => {
      try {
        sessionStorage.removeItem('sagaburst_battle_config')
      } catch (e) {
        console.warn('sessionStorage error', e)
      }
      window.location.href = window.location.pathname
    })
  }
}
