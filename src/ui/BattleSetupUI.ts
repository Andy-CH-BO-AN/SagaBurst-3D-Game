/**
 * BattleSetupUI.ts
 * Lightweight, dependency-free DOM interface for Custom Battle configuration.
 * Immediate rendering without waiting for 3D GLB assets.
 */
import './battle-setup.css'
import {
  BattleConfig,
  BattleUnitType,
  UnitTier,
  PRESET_10V10,
  PRESET_25V25,
  PRESET_50V50,
  calculateArmyTotal,
  validateBattleConfig,
  getDefaultBattleConfig,
  createEmptyBattleConfig,
} from '../battle/BattleConfig'

export class BattleSetupUI {
  private config: BattleConfig
  private container: HTMLElement | null = null
  private onStartCallback: ((config: BattleConfig) => void) | null = null

  constructor(initialConfig?: BattleConfig) {
    this.config = initialConfig
      ? JSON.parse(JSON.stringify(initialConfig))
      : getDefaultBattleConfig()
  }

  mount(parent: HTMLElement = document.body, onStart: (config: BattleConfig) => void): void {
    this.onStartCallback = onStart
    this.container = document.createElement('div')
    this.container.id = 'battle-setup-container'
    this.container.innerHTML = this._generateHtml()
    parent.appendChild(this.container)

    this._bindEvents()
    this._refreshView()
  }

  destroy(): void {
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container)
    }
    this.container = null
  }

  private _generateHtml(): string {
    const renderTable = (faction: 'viking' | 'roman') => {
      const isViking = faction === 'viking'
      const rows: Array<{ type: BattleUnitType; title: string; sub: string }> = [
        { type: 'infantry', title: 'Infantry 步兵', sub: isViking ? '近戰步兵 (短劍/長劍/大劍)' : '軍團步兵 (短劍系列)' },
        { type: 'archer', title: 'Archer 遠程步兵', sub: isViking ? '諾德弓手 (長弓系列)' : '羅馬標槍兵 (標槍系列)' },
        { type: 'cavalry', title: 'Cavalry 騎兵', sub: isViking ? '長槍騎兵 (騎乘衝刺)' : '軍團騎兵 (長槍衝刺)' },
        { type: 'horseArcher', title: 'Horse Archer 騎射手', sub: isViking ? '騎乘弓手 (機動射擊)' : '騎乘標槍手 (機動遠程)' },
      ]

      return `
        <table class="unit-table">
          <thead>
            <tr>
              <th class="col-unit">UNIT TYPE</th>
              <th>T1</th>
              <th>T2</th>
              <th>T3</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => `
              <tr class="unit-row" data-faction="${faction}" data-unit="${r.type}">
                <td class="unit-label">
                  ${r.title}
                  <span class="unit-sublabel">${r.sub}</span>
                </td>
                ${([1, 2, 3] as UnitTier[]).map(t => `
                  <td>
                    <div class="stepper">
                      <button class="step-btn btn-dec" data-faction="${faction}" data-unit="${r.type}" data-tier="${t}">-</button>
                      <input type="number" min="0" max="50" class="step-input" id="val-${faction}-${r.type}-${t}" data-faction="${faction}" data-unit="${r.type}" data-tier="${t}" value="0" />
                      <button class="step-btn btn-inc" data-faction="${faction}" data-unit="${r.type}" data-tier="${t}">+</button>
                    </div>
                  </td>
                `).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
      `
    }

    return `
      <div class="setup-header">
        <h1 class="setup-title">SAGABURST</h1>
        <div class="setup-subtitle">CUSTOM BATTLE CONFIGURATION</div>
      </div>

      <div class="setup-main">
        <!-- VIKING COLUMN -->
        <div class="faction-card viking">
          <div class="faction-header">
            <span class="faction-name">VIKING CLANS</span>
            <span class="faction-total-badge">
              Total: <span id="viking-total" class="total-num">0</span> / 50
            </span>
          </div>
          ${renderTable('viking')}
        </div>

        <!-- ROMAN COLUMN -->
        <div class="faction-card roman">
          <div class="faction-header">
            <span class="faction-name">ROMAN LEGION</span>
            <span class="faction-total-badge">
              Total: <span id="roman-total" class="total-num">0</span> / 50
            </span>
          </div>
          ${renderTable('roman')}
        </div>
      </div>

      <div id="validation-msg" class="setup-validation-msg"></div>

      <div class="setup-presets">
        <button class="preset-btn" id="preset-10">10 VS 10</button>
        <button class="preset-btn" id="preset-25">25 VS 25</button>
        <button class="preset-btn" id="preset-50">50 VS 50</button>
        <button class="preset-btn" id="preset-reset">RESET</button>
      </div>

      <div class="setup-actions">
        <button class="start-btn" id="btn-start-battle">START BATTLE</button>
      </div>
    `
  }

  private _bindEvents(): void {
    if (!this.container) return

    // Stepper buttons
    this.container.querySelectorAll('.btn-inc').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLElement
        const faction = target.dataset.faction as 'viking' | 'roman'
        const unit = target.dataset.unit as BattleUnitType
        const tier = parseInt(target.dataset.tier || '1', 10) as UnitTier
        this._adjustUnitCount(faction, unit, tier, 1)
      })
    })

    this.container.querySelectorAll('.btn-dec').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLElement
        const faction = target.dataset.faction as 'viking' | 'roman'
        const unit = target.dataset.unit as BattleUnitType
        const tier = parseInt(target.dataset.tier || '1', 10) as UnitTier
        this._adjustUnitCount(faction, unit, tier, -1)
      })
    })

    // Number Inputs
    this.container.querySelectorAll('.step-input').forEach(el => {
      const input = el as HTMLInputElement
      input.addEventListener('input', () => {
        const faction = input.dataset.faction as 'viking' | 'roman'
        const unit = input.dataset.unit as BattleUnitType
        const tier = parseInt(input.dataset.tier || '1', 10) as UnitTier
        const raw = parseInt(input.value, 10)
        const val = isNaN(raw) ? 0 : Math.max(0, Math.min(50, raw))
        this._setUnitCount(faction, unit, tier, val)
      })

      input.addEventListener('blur', () => {
        const faction = input.dataset.faction as 'viking' | 'roman'
        const unit = input.dataset.unit as BattleUnitType
        const tier = parseInt(input.dataset.tier || '1', 10) as UnitTier
        input.value = String(this.config[faction][unit][tier] || 0)
      })
    })

    // Presets
    document.getElementById('preset-10')?.addEventListener('click', () => {
      this.config = JSON.parse(JSON.stringify(PRESET_10V10))
      this._refreshView()
    })
    document.getElementById('preset-25')?.addEventListener('click', () => {
      this.config = JSON.parse(JSON.stringify(PRESET_25V25))
      this._refreshView()
    })
    document.getElementById('preset-50')?.addEventListener('click', () => {
      this.config = JSON.parse(JSON.stringify(PRESET_50V50))
      this._refreshView()
    })
    document.getElementById('preset-reset')?.addEventListener('click', () => {
      this.config = createEmptyBattleConfig()
      this._refreshView()
    })

    // Start battle button
    document.getElementById('btn-start-battle')?.addEventListener('click', () => {
      const validation = validateBattleConfig(this.config)
      if (validation.valid && this.onStartCallback) {
        if (typeof window !== 'undefined' && !window.location.search.includes('nolock')) {
          try {
            document.body.requestPointerLock?.()
          } catch {
            // ignore
          }
        }
        this.destroy()
        this.onStartCallback(this.config)
      }
    })
  }

  private _setUnitCount(
    faction: 'viking' | 'roman',
    unit: BattleUnitType,
    tier: UnitTier,
    value: number
  ): void {
    const army = this.config[faction]
    const oldVal = army[unit][tier] || 0
    const otherTotal = calculateArmyTotal(army) - oldVal
    const maxAllowed = Math.max(0, 50 - otherTotal)
    const clamped = Math.max(0, Math.min(value, maxAllowed))

    army[unit][tier] = clamped
    this._refreshView()
  }

  private _adjustUnitCount(
    faction: 'viking' | 'roman',
    unit: BattleUnitType,
    tier: UnitTier,
    delta: number
  ): void {
    const army = this.config[faction]
    const currentVal = army[unit][tier] || 0
    const currentTotal = calculateArmyTotal(army)

    if (delta > 0) {
      if (currentTotal >= 50 || currentVal >= 50) return
      army[unit][tier] = currentVal + 1
    } else if (delta < 0) {
      if (currentVal <= 0) return
      army[unit][tier] = currentVal - 1
    }

    this._refreshView()
  }

  private _refreshView(): void {
    if (!this.container) return

    const units: BattleUnitType[] = ['infantry', 'archer', 'cavalry', 'horseArcher']
    const tiers: UnitTier[] = [1, 2, 3]

    for (const faction of ['viking', 'roman'] as const) {
      const army = this.config[faction]
      for (const u of units) {
        for (const t of tiers) {
          const el = document.getElementById(`val-${faction}-${u}-${t}`) as HTMLInputElement | null
          if (el) el.value = String(army[u][t] || 0)
        }
      }
    }

    const vTotal = calculateArmyTotal(this.config.viking)
    const rTotal = calculateArmyTotal(this.config.roman)

    const vTotalEl = document.getElementById('viking-total')
    const rTotalEl = document.getElementById('roman-total')
    if (vTotalEl) {
      vTotalEl.textContent = String(vTotal)
      vTotalEl.classList.toggle('error', vTotal > 50 || vTotal < 1)
    }
    if (rTotalEl) {
      rTotalEl.textContent = String(rTotal)
      rTotalEl.classList.toggle('error', rTotal > 50 || rTotal < 1)
    }

    const validation = validateBattleConfig(this.config)
    const msgEl = document.getElementById('validation-msg')
    const startBtn = document.getElementById('btn-start-battle') as HTMLButtonElement | null

    if (msgEl) {
      if (!validation.valid) {
        msgEl.textContent = validation.errors.join(' ｜ ')
      } else {
        msgEl.textContent = ''
      }
    }

    if (startBtn) {
      startBtn.disabled = !validation.valid
    }
  }
}
