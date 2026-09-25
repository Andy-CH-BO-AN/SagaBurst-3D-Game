/**
 * BattleSetupUI.ts
 * Lightweight, dependency-free DOM interface for Custom Battle configuration.
 * Immediate rendering without waiting for 3D GLB assets.
 */
import './battle-setup.css'
import {
  BattleConfig,
  PlayerMeleeWeaponId,
  PlayerRangedWeaponId,
  PlayerShieldId,
  UnitTier,
  UnitTierCounts,
  MAX_CUSTOM_ARMY_SIZE,
  PRESET_10V10,
  PRESET_25V25,
  PRESET_50V50,
  PRESET_100V100,
  PRESET_200V200,
  calculateArmyTotal,
  validateBattleConfig,
  getDefaultBattleConfig,
  createEmptyBattleConfig,
  createDefaultPlayerLoadout,
  attachArmyAliases,
} from '../battle/BattleConfig'
import { COMBAT_BALANCE } from '../combat/CombatBalance'
import { ARMORS } from '../rpg/ArmorDatabase'
import {
  getUnitPresetsForFaction,
  type UnitPresetId,
} from '../battle/UnitPresetCatalog'

export class BattleSetupUI {
  private config: BattleConfig
  private activeTab: 'army' | 'loadout' = 'army'
  private container: HTMLElement | null = null
  private onStartCallback: ((config: BattleConfig) => void) | null = null
  private onBackCallback: (() => void) | null = null

  constructor(initialConfig?: BattleConfig) {
    this.config = initialConfig
      ? JSON.parse(JSON.stringify(initialConfig))
      : getDefaultBattleConfig()
    attachArmyAliases(this.config.viking, 'viking')
    attachArmyAliases(this.config.roman, 'roman')
    if (!this.config.mode) {
      this.config.mode = 'formation'
    }
    if (this.config.spectator === undefined) {
      this.config.spectator = false
    }
    if (!this.config.playerFaction) {
      this.config.playerFaction = 'viking'
    }
    if (this.config.playerHp === undefined) {
      this.config.playerHp = COMBAT_BALANCE.hp.playerDefault
    }
    if (!this.config.playerLoadout) {
      this.config.playerLoadout = createDefaultPlayerLoadout()
    }
  }

  mount(
    parent: HTMLElement = document.body,
    onStart: (config: BattleConfig) => void,
    onBack?: () => void,
  ): void {
    this.onStartCallback = onStart
    this.onBackCallback = onBack ?? null
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
      const presets = getUnitPresetsForFaction(faction)

      return `
        <table class="unit-table">
          <thead>
            <tr>
              <th class="col-unit">PRESET / UNIT</th>
              <th>T1</th>
              <th>T2</th>
              <th>T3</th>
            </tr>
          </thead>
          <tbody>
            ${presets.map(p => `
              <tr class="unit-row" data-faction="${faction}" data-preset="${p.id}">
                <td class="unit-label">
                  ${p.nameEn} <span class="unit-zh">${p.nameZh}</span>
                </td>
                ${([1, 2, 3] as UnitTier[]).map(t => `
                  <td>
                    <div class="stepper">
                      <button type="button" class="step-btn btn-dec" data-faction="${faction}" data-preset="${p.id}" data-tier="${t}">-</button>
                      <input type="number" min="0" max="${MAX_CUSTOM_ARMY_SIZE}" class="step-input" id="val-${faction}-${p.id}-${t}" data-faction="${faction}" data-preset="${p.id}" data-tier="${t}" value="0" />
                      <button type="button" class="step-btn btn-inc" data-faction="${faction}" data-preset="${p.id}" data-tier="${t}">+</button>
                    </div>
                  </td>
                `).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
      `
    }

    const renderEquipmentGroup = (
      title: string,
      subtitle: string,
      cards: Array<{ id: string | null; tier?: string; zh: string; en: string }>,
      kind: 'melee' | 'ranged' | 'shield',
    ) => `
      <section class="equipment-group">
        <div class="equipment-group-heading"><span>${title}</span><small>${subtitle}</small></div>
        <div class="equipment-card-grid">
          ${cards.map(card => `
            <button type="button" class="loadout-card" role="radio" aria-checked="false"
              data-loadout-kind="${kind}" data-loadout-id="${card.id ?? ''}">
              <span class="loadout-card-top">${card.tier ? `<b>${card.tier}</b>` : '<b>—</b>'}</span>
              <span class="loadout-card-name">${card.zh}</span>
              <span class="loadout-card-en">${card.en}</span>
              <span class="loadout-card-check">✓</span>
            </button>
          `).join('')}
        </div>
      </section>
    `

    const renderLoadoutPanel = () => `
      <div id="setup-loadout-panel" class="setup-tab-panel loadout-page">
        <div class="loadout-panel-heading">
          <h2>玩家裝備</h2><span>PLAYER LOADOUT</span>
        </div>
        <div class="loadout-columns">
          <section class="loadout-category"><div class="loadout-category-heading"><h3>近戰武器</h3><span>MELEE</span></div>
            ${renderEquipmentGroup('維京', 'VIKING', [
              { id: 'viking_axe_t1', tier: 'T1', zh: '維京長斧', en: 'VIKING AXE' },
              { id: 'viking_axe_t2', tier: 'T2', zh: '精鋼維京長斧', en: 'STEEL VIKING AXE' },
              { id: 'viking_axe_t3', tier: 'T3', zh: '符文維京長斧', en: 'RUNIC VIKING AXE' },
            ], 'melee')}
            ${renderEquipmentGroup('羅馬', 'ROMAN', [
              { id: 'gladius_rusty', tier: 'T1', zh: '生鏽羅馬短劍', en: 'RUSTY GLADIUS' },
              { id: 'gladius_standard', tier: 'T2', zh: '制式羅馬短劍', en: 'STANDARD GLADIUS' },
              { id: 'centurion_blade', tier: 'T3', zh: '百夫長短劍', en: 'CENTURION BLADE' },
            ], 'melee')}
            ${renderEquipmentGroup('長槍', 'LANCE', [
              { id: 'hunting_spear', tier: 'T1', zh: '狩獵長槍', en: 'HUNTING SPEAR' },
              { id: 'steel_lance', tier: 'T2', zh: '鋼製長槍', en: 'STEEL LANCE' },
              { id: 'heavy_lance', tier: 'T3', zh: '重裝長槍', en: 'HEAVY LANCE' },
            ], 'melee')}
          </section>
          <section class="loadout-category"><div class="loadout-category-heading"><h3>遠程武器</h3><span>RANGED</span></div>
            ${renderEquipmentGroup('維京', 'VIKING', [
              { id: 'wooden_shortbow', tier: 'T1', zh: '木製短弓', en: 'WOODEN SHORTBOW' },
              { id: 'recurve_longbow', tier: 'T2', zh: '反曲長弓', en: 'RECURVE LONGBOW' },
              { id: 'elven_runebow', tier: 'T3', zh: '精靈符文弓', en: 'ELVEN RUNE BOW' },
            ], 'ranged')}
            ${renderEquipmentGroup('羅馬', 'ROMAN', [
              { id: 'pilum_basic', tier: 'T1', zh: '簡易標槍', en: 'BASIC PILUM' },
              { id: 'pilum_standard', tier: 'T2', zh: '制式標槍', en: 'STANDARD PILUM' },
              { id: 'legionary_pilum', tier: 'T3', zh: '軍團標槍', en: 'LEGIONARY PILUM' },
            ], 'ranged')}
          </section>
        </div>
        <section class="loadout-category shield-category"><div class="loadout-category-heading"><h3>盾牌</h3><span>SHIELD</span></div>
          ${renderEquipmentGroup('無盾', 'NONE', [{ id: null, zh: '不攜帶盾牌', en: 'NO SHIELD' }], 'shield')}
          ${renderEquipmentGroup('維京', 'VIKING', [
            { id: 'round_shield_t1', tier: 'T1', zh: '基礎圓盾', en: `BASIC ROUND SHIELD (-${Math.round(ARMORS.round_shield_t1.damageReduction * 100)}%)` },
            { id: 'round_shield_t2', tier: 'T2', zh: '鐵環圓盾', en: `IRON SHIELD (-${Math.round(ARMORS.round_shield_t2.damageReduction * 100)}%)` },
            { id: 'round_shield_t3', tier: 'T3', zh: '狂戰士圓盾', en: `BERSERKER SHIELD (-${Math.round(ARMORS.round_shield_t3.damageReduction * 100)}%)` },
          ], 'shield')}
          ${renderEquipmentGroup('羅馬', 'ROMAN', [
            { id: 'scutum_t1', tier: 'T1', zh: '基礎方盾', en: `BASIC SCUTUM (-${Math.round(ARMORS.scutum_t1.damageReduction * 100)}%)` },
            { id: 'scutum_t2', tier: 'T2', zh: '軍團方盾', en: `LEGION SCUTUM (-${Math.round(ARMORS.scutum_t2.damageReduction * 100)}%)` },
            { id: 'scutum_t3', tier: 'T3', zh: '百夫長方盾', en: `CENTURION SCUTUM (-${Math.round(ARMORS.scutum_t3.damageReduction * 100)}%)` },
          ], 'shield')}
        </section>
        <section class="starting-state"><div class="loadout-category-heading"><h3>出戰方式</h3><span>STARTING STATE</span></div>
          <div class="starting-state-options" role="radiogroup" aria-label="Starting state">
            <button type="button" class="starting-state-card" role="radio" aria-checked="false" data-start-mounted="false"><b>徒步</b><small>ON FOOT</small></button>
            <button type="button" class="starting-state-card" role="radio" aria-checked="false" data-start-mounted="true"><b>騎馬</b><small>MOUNTED</small><i>✓</i></button>
          </div>
        </section>
      </div>
    `

    return `
      <button type="button" class="setup-back-btn" id="battle-setup-back">← 上一頁</button>
      <div class="setup-header">
        <h1 class="setup-title">SAGABURST</h1>
        <div class="setup-subtitle">CUSTOM BATTLE CONFIGURATION</div>
      </div>

      <div class="setup-mode-section">
        <div class="mode-section-label">BATTLE MODE</div>
        <div class="mode-btn-group">
          <button type="button" class="mode-btn" id="mode-btn-formation" data-mode="formation">
            <span class="mode-btn-title">陣型戰</span>
            <span class="mode-btn-desc">FORMATION BATTLE</span>
          </button>
          <button type="button" class="mode-btn" id="mode-btn-scattered" data-mode="scattered">
            <span class="mode-btn-title">散兵戰</span>
            <span class="mode-btn-desc">SCATTERED BATTLE</span>
          </button>
        </div>
      </div>

      <div class="setup-mode-section">
        <div class="mode-section-label">玩家陣營 <small>PLAYER FACTION</small></div>
        <div class="mode-btn-group">
          <button type="button" class="mode-btn" id="faction-btn-viking" data-player-faction="viking">
            <span class="mode-btn-title">維京</span>
            <span class="mode-btn-desc">VIKING</span>
          </button>
          <button type="button" class="mode-btn" id="faction-btn-roman" data-player-faction="roman">
            <span class="mode-btn-title">羅馬</span>
            <span class="mode-btn-desc">ROMAN</span>
          </button>
        </div>
      </div>

      <div class="setup-tabs" role="tablist" aria-label="Battle setup sections">
        <button type="button" id="setup-tab-army" class="setup-tab" role="tab"><b>軍隊配置</b><small>ARMY SETUP</small></button>
        <button type="button" id="setup-tab-loadout" class="setup-tab" role="tab"><b>玩家裝備</b><small>PLAYER LOADOUT</small></button>
      </div>
      <div id="setup-army-panel" class="setup-tab-panel">

      <div class="setup-main">
        <!-- VIKING COLUMN -->
        <div class="faction-card viking">
          <div class="faction-header">
            <span class="faction-name">VIKING CLANS</span>
            <span class="faction-total-badge">
              Total: <span id="viking-total" class="total-num">0</span> / ${MAX_CUSTOM_ARMY_SIZE}
            </span>
          </div>
          ${renderTable('viking')}
        </div>

        <!-- ROMAN COLUMN -->
        <div class="faction-card roman">
          <div class="faction-header">
            <span class="faction-name">ROMAN LEGION</span>
            <span class="faction-total-badge">
              Total: <span id="roman-total" class="total-num">0</span> / ${MAX_CUSTOM_ARMY_SIZE}
            </span>
          </div>
          ${renderTable('roman')}
        </div>
      </div>

        <div class="setup-player-hp-panel">
          <div class="player-hp-control">
            <label for="player-hp-input">玩家生命值 PLAYER HP (1–9999):</label>
            <input type="number" id="player-hp-input" min="1" max="9999" value="${this.config.playerHp ?? COMBAT_BALANCE.hp.playerDefault}" class="player-hp-input" />
          </div>
        </div>

        <div class="setup-presets">
          <button class="preset-btn" id="preset-10">10 VS 10</button>
          <button class="preset-btn" id="preset-25">25 VS 25</button>
          <button class="preset-btn" id="preset-50">50 VS 50</button>
          <button class="preset-btn" id="preset-100">100 VS 100</button>
          <button class="preset-btn" id="preset-200">200 VS 200</button>
          <button class="preset-btn" id="preset-reset">RESET</button>
        </div>

      </div>
      ${renderLoadoutPanel()}

      <div id="validation-msg" class="setup-validation-msg"></div>

      <div class="setup-actions">
        <label class="spectator-toggle-label" for="spectator-checkbox">
          <input type="checkbox" id="spectator-checkbox" />
          <span>觀戰模式 Spectator</span>
        </label>
        <button class="start-btn" id="btn-start-battle"><span>開始戰鬥</span><small>START BATTLE</small></button>
      </div>
    `
  }

  private _bindEvents(): void {
    if (!this.container) return

    this.container.querySelector('#battle-setup-back')?.addEventListener('click', () => {
      this.onBackCallback?.()
    })

    // Stepper buttons
    this.container.querySelectorAll('.btn-inc').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLElement
        const faction = target.dataset.faction as 'viking' | 'roman'
        const preset = target.dataset.preset as UnitPresetId
        const tier = parseInt(target.dataset.tier || '1', 10) as UnitTier
        if (!faction || !preset) return
        this._adjustUnitCount(faction, preset, tier, 1)
      })
    })

    this.container.querySelectorAll('.btn-dec').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLElement
        const faction = target.dataset.faction as 'viking' | 'roman'
        const preset = target.dataset.preset as UnitPresetId
        const tier = parseInt(target.dataset.tier || '1', 10) as UnitTier
        if (!faction || !preset) return
        this._adjustUnitCount(faction, preset, tier, -1)
      })
    })

    // Number Inputs
    this.container.querySelectorAll('.step-input').forEach(el => {
      const input = el as HTMLInputElement
      input.addEventListener('input', () => {
        const faction = input.dataset.faction as 'viking' | 'roman'
        const preset = input.dataset.preset as UnitPresetId
        if (!faction || !preset) return
        const tier = parseInt(input.dataset.tier || '1', 10) as UnitTier
        const raw = parseInt(input.value, 10)
        const val = isNaN(raw) ? 0 : Math.max(0, Math.min(MAX_CUSTOM_ARMY_SIZE, raw))
        this._setUnitCount(faction, preset, tier, val)
      })

      input.addEventListener('blur', () => {
        const faction = input.dataset.faction as 'viking' | 'roman'
        const preset = input.dataset.preset as UnitPresetId
        if (!faction || !preset) return
        const tier = parseInt(input.dataset.tier || '1', 10) as UnitTier
        input.value = String((this.config[faction] as any)?.[preset]?.[tier] || 0)
      })
    })

    // Mode buttons
    document.getElementById('mode-btn-formation')?.addEventListener('click', () => {
      this.config.mode = 'formation'
      this._refreshView()
    })
    document.getElementById('mode-btn-scattered')?.addEventListener('click', () => {
      this.config.mode = 'scattered'
      this._refreshView()
    })

    // Faction buttons
    document.getElementById('faction-btn-viking')?.addEventListener('click', () => {
      this.config.playerFaction = 'viking'
      this._refreshView()
    })
    document.getElementById('faction-btn-roman')?.addEventListener('click', () => {
      this.config.playerFaction = 'roman'
      this._refreshView()
    })

    document.getElementById('setup-tab-army')?.addEventListener('click', () => {
      this.activeTab = 'army'
      this._refreshView()
    })
    document.getElementById('setup-tab-loadout')?.addEventListener('click', () => {
      this.activeTab = 'loadout'
      this._refreshView()
    })

    const hpInput = document.getElementById('player-hp-input') as HTMLInputElement | null
    hpInput?.addEventListener('input', () => {
      const raw = parseInt(hpInput.value, 10)
      const val = isNaN(raw) ? COMBAT_BALANCE.hp.playerDefault : Math.max(1, Math.min(9999, raw))
      this.config.playerHp = val
    })
    hpInput?.addEventListener('blur', () => {
      const raw = parseInt(hpInput.value, 10)
      const val = isNaN(raw) ? COMBAT_BALANCE.hp.playerDefault : Math.max(1, Math.min(9999, raw))
      this.config.playerHp = val
      hpInput.value = String(val)
    })

    this.container.querySelectorAll('.loadout-card').forEach(card => {
      card.addEventListener('click', () => {
        const target = card as HTMLElement
        const id = target.dataset.loadoutId || null
        switch (target.dataset.loadoutKind) {
          case 'melee': this.config.playerLoadout!.meleeWeaponId = id as PlayerMeleeWeaponId; break
          case 'ranged': this.config.playerLoadout!.rangedWeaponId = id as PlayerRangedWeaponId; break
          case 'shield': this.config.playerLoadout!.shieldId = id as PlayerShieldId | null; break
        }
        this._refreshView()
      })
    })
    this.container.querySelectorAll('.starting-state-card').forEach(card => {
      card.addEventListener('click', () => {
        this.config.playerLoadout!.startMounted = (card as HTMLElement).dataset.startMounted === 'true'
        this._refreshView()
      })
    })

    // Presets (Army composition only, strictly preserves selected Battle Mode, Spectator mode, and Player Faction)
    const applyPreset = (preset: BattleConfig) => {
      const currentMode = this.config.mode ?? 'formation'
      const currentSpectator = this.config.spectator ?? false
      const currentFaction = this.config.playerFaction ?? 'viking'
      const currentHp = this.config.playerHp ?? COMBAT_BALANCE.hp.playerDefault
      const currentLoadout = this.config.playerLoadout
      this.config = JSON.parse(JSON.stringify(preset))
      attachArmyAliases(this.config.viking, 'viking')
      attachArmyAliases(this.config.roman, 'roman')
      this.config.mode = currentMode
      this.config.spectator = currentSpectator
      this.config.playerFaction = currentFaction
      this.config.playerHp = currentHp
      this.config.playerLoadout = currentLoadout
      this._refreshView()
    }

    document.getElementById('preset-10')?.addEventListener('click', () => applyPreset(PRESET_10V10))
    document.getElementById('preset-25')?.addEventListener('click', () => applyPreset(PRESET_25V25))
    document.getElementById('preset-50')?.addEventListener('click', () => applyPreset(PRESET_50V50))
    document.getElementById('preset-100')?.addEventListener('click', () => applyPreset(PRESET_100V100))
    document.getElementById('preset-200')?.addEventListener('click', () => applyPreset(PRESET_200V200))
    document.getElementById('preset-reset')?.addEventListener('click', () => {
      const currentMode = this.config.mode ?? 'formation'
      const currentSpectator = this.config.spectator ?? false
      const currentFaction = this.config.playerFaction ?? 'viking'
      const currentHp = this.config.playerHp ?? COMBAT_BALANCE.hp.playerDefault
      const currentLoadout = this.config.playerLoadout
      this.config = createEmptyBattleConfig()
      attachArmyAliases(this.config.viking, 'viking')
      attachArmyAliases(this.config.roman, 'roman')
      this.config.mode = currentMode
      this.config.spectator = currentSpectator
      this.config.playerFaction = currentFaction
      this.config.playerHp = currentHp
      this.config.playerLoadout = currentLoadout
      this._refreshView()
    })

    // Spectator checkbox
    const spectatorCheckbox = document.getElementById('spectator-checkbox') as HTMLInputElement | null
    spectatorCheckbox?.addEventListener('change', (e) => {
      this.config.spectator = (e.target as HTMLInputElement).checked
    })

    // Start battle button
    document.getElementById('btn-start-battle')?.addEventListener('click', () => {
      const validation = validateBattleConfig(this.config)
      if (validation.valid && this.onStartCallback) {
        if (typeof window !== 'undefined' && !window.location.search.includes('nolock')) {
          try {
            const canvasContainer = document.getElementById('canvas-container')
            const target = canvasContainer || document.body
            const p = target.requestPointerLock?.()
            if (p && typeof (p as any).catch === "function") {
              ;(p as Promise<void>).catch(() => {})
            }
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
    preset: UnitPresetId,
    tier: UnitTier,
    value: number
  ): void {
    const army = this.config[faction] as Record<string, UnitTierCounts | undefined>
    if (!army[preset]) {
      army[preset] = { 1: 0, 2: 0, 3: 0 }
    }
    const oldVal = army[preset]![tier] || 0
    const otherTotal = calculateArmyTotal(army) - oldVal
    const maxAllowed = Math.max(0, MAX_CUSTOM_ARMY_SIZE - otherTotal)
    const clamped = Math.max(0, Math.min(value, maxAllowed))

    army[preset]![tier] = clamped
    this._refreshView()
  }

  private _adjustUnitCount(
    faction: 'viking' | 'roman',
    preset: UnitPresetId,
    tier: UnitTier,
    delta: number
  ): void {
    const army = this.config[faction] as Record<string, UnitTierCounts | undefined>
    if (!army[preset]) {
      army[preset] = { 1: 0, 2: 0, 3: 0 }
    }
    const currentVal = army[preset]![tier] || 0
    const currentTotal = calculateArmyTotal(army)

    if (delta > 0) {
      if (currentTotal >= MAX_CUSTOM_ARMY_SIZE || currentVal >= MAX_CUSTOM_ARMY_SIZE) return
      army[preset]![tier] = currentVal + 1
    } else if (delta < 0) {
      if (currentVal <= 0) return
      army[preset]![tier] = currentVal - 1
    }

    this._refreshView()
  }

  private _refreshView(): void {
    if (!this.container) return

    for (const faction of ['viking', 'roman'] as const) {
      const army = this.config[faction] as Record<string, UnitTierCounts | undefined>
      const presets = getUnitPresetsForFaction(faction)
      for (const p of presets) {
        for (const t of [1, 2, 3] as UnitTier[]) {
          const el = document.getElementById(`val-${faction}-${p.id}-${t}`) as HTMLInputElement | null
          if (el) el.value = String(army[p.id]?.[t] ?? 0)
        }
      }
    }

    const vTotal = calculateArmyTotal(this.config.viking)
    const rTotal = calculateArmyTotal(this.config.roman)

    const vTotalEl = document.getElementById('viking-total')
    const rTotalEl = document.getElementById('roman-total')
    if (vTotalEl) {
      vTotalEl.textContent = String(vTotal)
      vTotalEl.classList.toggle('error', vTotal > MAX_CUSTOM_ARMY_SIZE || vTotal < 1)
    }
    if (rTotalEl) {
      rTotalEl.textContent = String(rTotal)
      rTotalEl.classList.toggle('error', rTotal > MAX_CUSTOM_ARMY_SIZE || rTotal < 1)
    }

    const validation = validateBattleConfig(this.config)
    const msgEl = document.getElementById('validation-msg')
    const startBtn = document.getElementById('btn-start-battle') as HTMLButtonElement | null

    // Update Battle Mode buttons active state
    const currentMode = this.config.mode ?? 'formation'
    const formationBtn = document.getElementById('mode-btn-formation')
    const scatteredBtn = document.getElementById('mode-btn-scattered')
    if (formationBtn) {
      formationBtn.classList.toggle('active', currentMode === 'formation')
    }
    if (scatteredBtn) {
      scatteredBtn.classList.toggle('active', currentMode === 'scattered')
    }

    // Update Player Faction buttons active state
    const currentFaction = this.config.playerFaction ?? 'viking'
    const vikingBtn = document.getElementById('faction-btn-viking')
    const romanBtn = document.getElementById('faction-btn-roman')
    if (vikingBtn) {
      vikingBtn.classList.toggle('active', currentFaction === 'viking')
    }
    if (romanBtn) {
      romanBtn.classList.toggle('active', currentFaction === 'roman')
    }

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

    const spectatorCheckbox = document.getElementById('spectator-checkbox') as HTMLInputElement | null
    if (spectatorCheckbox) {
      spectatorCheckbox.checked = Boolean(this.config.spectator)
    }

    const playerHpInput = document.getElementById('player-hp-input') as HTMLInputElement | null
    if (playerHpInput) {
      playerHpInput.value = String(this.config.playerHp ?? COMBAT_BALANCE.hp.playerDefault)
    }

    const loadout = this.config.playerLoadout
    const armyPanel = document.getElementById('setup-army-panel')
    const loadoutPanel = document.getElementById('setup-loadout-panel')
    const armyTab = document.getElementById('setup-tab-army')
    const loadoutTab = document.getElementById('setup-tab-loadout')

    armyPanel?.classList.toggle('active', this.activeTab === 'army')
    loadoutPanel?.classList.toggle('active', this.activeTab === 'loadout')

    armyTab?.classList.toggle('active', this.activeTab === 'army')
    loadoutTab?.classList.toggle('active', this.activeTab === 'loadout')

    if (loadout) {
      this.container.querySelectorAll('.loadout-card').forEach(card => {
        const el = card as HTMLElement
        const selected = (el.dataset.loadoutKind === 'melee' && el.dataset.loadoutId === loadout.meleeWeaponId)
          || (el.dataset.loadoutKind === 'ranged' && el.dataset.loadoutId === loadout.rangedWeaponId)
          || (el.dataset.loadoutKind === 'shield' && el.dataset.loadoutId === (loadout.shieldId ?? ''))
        el.classList.toggle('selected', selected)
        el.setAttribute?.('aria-checked', String(selected))
      })
      this.container.querySelectorAll('.starting-state-card').forEach(card => {
        const el = card as HTMLElement
        const selected = (el.dataset.startMounted === 'true') === loadout.startMounted
        el.classList.toggle('selected', selected)
        el.setAttribute?.('aria-checked', String(selected))
      })
    }
  }


}
