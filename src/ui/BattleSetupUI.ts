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
  BattleUnitType,
  UnitTier,
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
import { WEAPONS } from '../rpg/WeaponDatabase'
import { getUnitPresetsForFaction } from '../battle/UnitPresetCatalog'

export class BattleSetupUI {
  private config: BattleConfig
  private activeTab: 'army' | 'reference' | 'loadout' = 'army'
  private container: HTMLElement | null = null
  private onStartCallback: ((config: BattleConfig) => void) | null = null

  constructor(initialConfig?: BattleConfig) {
    this.config = initialConfig
      ? JSON.parse(JSON.stringify(initialConfig))
      : getDefaultBattleConfig()
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
    attachArmyAliases(this.config.viking, 'viking')
    attachArmyAliases(this.config.roman, 'roman')
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
                      <input type="number" min="0" max="${MAX_CUSTOM_ARMY_SIZE}" class="step-input" id="val-${faction}-${r.type}-${t}" data-faction="${faction}" data-unit="${r.type}" data-tier="${t}" value="0" />
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

    const renderReferencePanel = () => {
      const vikingPresets = getUnitPresetsForFaction('viking')
      const romanPresets = getUnitPresetsForFaction('roman')

      const renderPresetList = (presets: typeof vikingPresets) => `
        <div class="reference-preset-grid">
          ${presets.map(p => `
            <div class="reference-preset-card">
              <div class="reference-preset-header">
                <h4>${p.nameZh} (${p.nameEn})</h4>
                <span class="reference-preset-type">${p.faction}</span>
              </div>
              <p class="reference-preset-desc">${p.description}</p>
              <div class="reference-preset-traits">
                ${p.traits.map(t => `<span class="reference-trait-badge">${t}</span>`).join('')}
              </div>
              <div class="reference-tiers">
                ${([1, 2, 3] as UnitTier[]).map(t => {
                  const l = p.tierLoadouts[t]
                  return `
                    <div class="reference-tier-row">
                      <b>T${t}:</b>
                      <span>近戰: ${l.meleeWeaponId ? (WEAPONS[l.meleeWeaponId]?.name ?? l.meleeWeaponId) : '無'}</span>
                      ${l.rangedWeaponId ? `<span> | 遠程: ${WEAPONS[l.rangedWeaponId]?.name ?? l.rangedWeaponId}</span>` : ''}
                      ${l.shieldId ? `<span> | 盾牌: ${l.shieldId}</span>` : ''}
                      ${l.mountId ? `<span> | 騎乘: 是</span>` : ''}
                    </div>
                  `
                }).join('')}
              </div>
            </div>
          `).join('')}
        </div>
      `

      return `
        <div id="setup-reference-panel" class="setup-tab-panel reference-page">
          <div class="reference-panel-heading">
            <h2>兵種與戰鬥數值參考</h2><span>UNITS &amp; COMBAT BALANCE</span>
          </div>

          <section class="reference-section">
            <h3 class="reference-section-title">戰鬥平衡常數 COMBAT BALANCE (SSOT)</h3>
            <div class="balance-rules-grid">
              <div class="balance-rule-card">
                <h4>基礎生命值 Base HP</h4>
                <p>NPC 預設 HP: <b>${COMBAT_BALANCE.hp.npcDefault}</b></p>
                <p>玩家預設 HP: <b>${COMBAT_BALANCE.hp.playerDefault}</b></p>
              </div>
              <div class="balance-rule-card">
                <h4>弓箭 Bow</h4>
                <p>傷害倍率: <b>×${COMBAT_BALANCE.bow.damageMultiplier}</b></p>
                <p>攻速倍率: <b>×${COMBAT_BALANCE.bow.attackRateMultiplier}</b></p>
                <p>步兵射程: <b>${COMBAT_BALANCE.bow.footAttackRange}m</b> | 騎兵射程: <b>${COMBAT_BALANCE.bow.mountedAttackRange}m</b></p>
                <p>冷卻間隔: <b>${(COMBAT_BALANCE.bow.baseCooldown / COMBAT_BALANCE.bow.attackRateMultiplier).toFixed(2)}s</b></p>
              </div>
              <div class="balance-rule-card">
                <h4>標槍 Javelin</h4>
                <p>傷害倍率: <b>×${COMBAT_BALANCE.javelin.damageMultiplier}</b></p>
                <p>攻速倍率: <b>×${COMBAT_BALANCE.javelin.attackRateMultiplier}</b></p>
                <p>步兵射程: <b>${COMBAT_BALANCE.javelin.footAttackRange}m</b> | 騎兵射程: <b>${COMBAT_BALANCE.javelin.mountedAttackRange}m</b></p>
                <p>冷卻間隔: <b>${(COMBAT_BALANCE.javelin.baseCooldown / COMBAT_BALANCE.javelin.attackRateMultiplier).toFixed(2)}s</b></p>
              </div>
              <div class="balance-rule-card">
                <h4>長槍 Lance</h4>
                <p>步兵反騎: <b>×${COMBAT_BALANCE.lance.unmountedVsMountedDamageMultiplier}</b> (步兵持槍 vs 騎乘目標)</p>
                <p>騎槍衝刺: <b>×${COMBAT_BALANCE.lance.mountedChargeDamageMultiplier}</b> (騎乘持槍且速度 &gt; ${COMBAT_BALANCE.lance.mountedChargeSpeedThreshold}m/s)</p>
                <p>無一般普通額外倍率 (由武器 Base Damage 決定)</p>
              </div>
              <div class="balance-rule-card">
                <h4>狂戰士 Berserker</h4>
                <p>觸發條件: 維京 + 步兵 + 單手劍 + 無盾</p>
                <p>跑速倍率: <b>×${COMBAT_BALANCE.berserker.moveSpeedMultiplier}</b></p>
                <p>近戰傷害: <b>×${COMBAT_BALANCE.berserker.meleeDamageMultiplier}</b></p>
                <p>近戰攻速: <b>×${COMBAT_BALANCE.berserker.meleeAttackRateMultiplier}</b></p>
              </div>
              <div class="balance-rule-card">
                <h4>戰馬撞擊 Mount Impact</h4>
                <p>最低撞擊速度: <b>${COMBAT_BALANCE.mountImpact.minSpeed}m/s</b></p>
                <p>基礎傷害: <b>${COMBAT_BALANCE.mountImpact.baseDamage}</b> + 速度 × <b>${COMBAT_BALANCE.mountImpact.speedDamageMultiplier}</b></p>
                <p>衝刺衝撞倍率: <b>×${COMBAT_BALANCE.mountImpact.sprintDamageMultiplier}</b></p>
                <p>同一目標冷卻: <b>${COMBAT_BALANCE.mountImpact.sameTargetCooldown}s</b></p>
              </div>
            </div>
          </section>

          <section class="reference-section">
            <h3 class="reference-section-title">維京兵種預設 Archetypes (VIKING)</h3>
            ${renderPresetList(vikingPresets)}
          </section>

          <section class="reference-section">
            <h3 class="reference-section-title">羅馬兵種預設 Archetypes (ROMAN)</h3>
            ${renderPresetList(romanPresets)}
          </section>

          <section class="reference-section">
            <h3 class="reference-section-title">武器庫 WEAPONS REGISTRY</h3>
            <table class="reference-weapons-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>名稱</th>
                  <th>戰鬥類別</th>
                  <th>基礎傷害</th>
                  <th>攻擊距離</th>
                </tr>
              </thead>
              <tbody>
                ${Object.values(WEAPONS).map(w => `
                  <tr>
                    <td><code>${w.id}</code></td>
                    <td>${w.name}</td>
                    <td><b>${w.combatKind}</b></td>
                    <td>${w.damageMin}-${w.damageMax}</td>
                    <td>${w.range ? `${w.range}m` : '—'}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </section>
        </div>
      `
    }

    const renderLoadoutPanel = () => `
      <div id="setup-loadout-panel" class="setup-tab-panel loadout-page">
        <div class="loadout-panel-heading">
          <h2>玩家裝備</h2><span>PLAYER LOADOUT</span>
        </div>
        <div class="loadout-columns">
          <section class="loadout-category"><div class="loadout-category-heading"><h3>近戰武器</h3><span>MELEE</span></div>
            ${renderEquipmentGroup('維京', 'VIKING', [
              { id: 'rusty_dagger', tier: 'T1', zh: '風化長劍', en: 'WEATHERED SWORD' },
              { id: 'steel_sword', tier: 'T2', zh: '鋼製長劍', en: 'STEEL SWORD' },
              { id: 'runic_greatsword', tier: 'T3', zh: '符文長劍', en: 'RUNIC SWORD' },
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
            { id: 'round_shield_t1', tier: 'T1', zh: '圓盾', en: 'ROUND SHIELD' },
            { id: 'round_shield_t2', tier: 'T2', zh: '鐵框圓盾', en: 'IRON-RIMMED SHIELD' },
            { id: 'round_shield_t3', tier: 'T3', zh: '狂戰士圓盾', en: 'BERSERKER SHIELD' },
          ], 'shield')}
          ${renderEquipmentGroup('羅馬', 'ROMAN', [
            { id: 'scutum_t1', tier: 'T1', zh: '基礎方盾', en: 'BASIC SCUTUM' },
            { id: 'scutum_t2', tier: 'T2', zh: '軍團方盾', en: 'LEGION SCUTUM' },
            { id: 'scutum_t3', tier: 'T3', zh: '百夫長方盾', en: 'CENTURION SCUTUM' },
          ], 'shield')}
        </section>
        <section class="starting-state"><div class="loadout-category-heading"><h3>出戰方式</h3><span>STARTING STATE</span></div>
          <div class="starting-state-options" role="radiogroup" aria-label="Starting state">
            <button type="button" class="starting-state-card" role="radio" aria-checked="false" data-start-mounted="false"><b>徒步</b><small>ON FOOT</small></button>
            <button type="button" class="starting-state-card" role="radio" aria-checked="false" data-start-mounted="true"><b>騎馬</b><small>MOUNTED</small><i>✓</i></button>
          </div>
        </section>
        <section class="starting-state"><div class="loadout-category-heading"><h3>玩家生命值</h3><span>PLAYER HP</span></div>
          <div class="player-hp-control">
            <label for="player-hp-input">HP (1–9999):</label>
            <input type="number" id="player-hp-input" min="1" max="9999" value="${this.config.playerHp ?? COMBAT_BALANCE.hp.playerDefault}" class="player-hp-input" />
          </div>
        </section>
      </div>
    `

    return `
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
        <button type="button" id="setup-tab-reference" class="setup-tab" role="tab"><b>兵種與數值</b><small>UNITS &amp; REFERENCE</small></button>
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

        <div class="setup-presets">
          <button class="preset-btn" id="preset-10">10 VS 10</button>
          <button class="preset-btn" id="preset-25">25 VS 25</button>
          <button class="preset-btn" id="preset-50">50 VS 50</button>
          <button class="preset-btn" id="preset-100">100 VS 100</button>
          <button class="preset-btn" id="preset-200">200 VS 200</button>
          <button class="preset-btn" id="preset-reset">RESET</button>
        </div>

      </div>
      ${renderReferencePanel()}
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
        if (!faction || !unit) return
        const tier = parseInt(input.dataset.tier || '1', 10) as UnitTier
        const raw = parseInt(input.value, 10)
        const val = isNaN(raw) ? 0 : Math.max(0, Math.min(MAX_CUSTOM_ARMY_SIZE, raw))
        this._setUnitCount(faction, unit, tier, val)
      })

      input.addEventListener('blur', () => {
        const faction = input.dataset.faction as 'viking' | 'roman'
        const unit = input.dataset.unit as BattleUnitType
        if (!faction || !unit) return
        const tier = parseInt(input.dataset.tier || '1', 10) as UnitTier
        input.value = String(this.config[faction]?.[unit]?.[tier] || 0)
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
    document.getElementById('setup-tab-reference')?.addEventListener('click', () => {
      this.activeTab = 'reference'
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
      this.config.mode = currentMode
      this.config.spectator = currentSpectator
      this.config.playerFaction = currentFaction
      this.config.playerHp = currentHp
      this.config.playerLoadout = currentLoadout
      attachArmyAliases(this.config.viking, 'viking')
      attachArmyAliases(this.config.roman, 'roman')
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
      this.config.mode = currentMode
      this.config.spectator = currentSpectator
      this.config.playerFaction = currentFaction
      this.config.playerHp = currentHp
      this.config.playerLoadout = currentLoadout
      attachArmyAliases(this.config.viking, 'viking')
      attachArmyAliases(this.config.roman, 'roman')
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
    unit: BattleUnitType,
    tier: UnitTier,
    value: number
  ): void {
    const army = this.config[faction]
    if (!army[unit]) {
      army[unit] = { 1: 0, 2: 0, 3: 0 }
    }
    const oldVal = army[unit][tier] || 0
    const otherTotal = calculateArmyTotal(army) - oldVal
    const maxAllowed = Math.max(0, MAX_CUSTOM_ARMY_SIZE - otherTotal)
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
    if (!army[unit]) {
      army[unit] = { 1: 0, 2: 0, 3: 0 }
    }
    const currentVal = army[unit][tier] || 0
    const currentTotal = calculateArmyTotal(army)

    if (delta > 0) {
      if (currentTotal >= MAX_CUSTOM_ARMY_SIZE || currentVal >= MAX_CUSTOM_ARMY_SIZE) return
      army[unit][tier] = currentVal + 1
    } else if (delta < 0) {
      if (currentVal <= 0) return
      army[unit][tier] = currentVal - 1
    }

    this._refreshView()
  }

  private _refreshView(): void {
    if (!this.container) return

    attachArmyAliases(this.config.viking, 'viking')
    attachArmyAliases(this.config.roman, 'roman')

    const units: BattleUnitType[] = ['infantry', 'archer', 'cavalry', 'horseArcher']
    const tiers: UnitTier[] = [1, 2, 3]

    for (const faction of ['viking', 'roman'] as const) {
      const army = this.config[faction]
      for (const u of units) {
        for (const t of tiers) {
          const el = document.getElementById(`val-${faction}-${u}-${t}`) as HTMLInputElement | null
          if (el) el.value = String(army[u]?.[t] ?? 0)
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
    const referencePanel = document.getElementById('setup-reference-panel')
    const loadoutPanel = document.getElementById('setup-loadout-panel')
    const armyTab = document.getElementById('setup-tab-army')
    const referenceTab = document.getElementById('setup-tab-reference')
    const loadoutTab = document.getElementById('setup-tab-loadout')

    armyPanel?.classList.toggle('active', this.activeTab === 'army')
    referencePanel?.classList.toggle('active', this.activeTab === 'reference')
    loadoutPanel?.classList.toggle('active', this.activeTab === 'loadout')

    armyTab?.classList.toggle('active', this.activeTab === 'army')
    referenceTab?.classList.toggle('active', this.activeTab === 'reference')
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
