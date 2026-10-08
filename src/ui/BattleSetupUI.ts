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
  PlayerMountId,
  UnitTier,
  UnitTierCounts,
  MAX_CUSTOM_ARMY_SIZE,
  MAX_CUSTOM_T4_PER_SIDE,
  CUSTOM_BATTLE_UNIT_TIERS,
  PRESET_10V10,
  PRESET_25V25,
  PRESET_50V50,
  PRESET_100V100,
  PRESET_200V200,
  calculateArmyTotal,
  validateBattleConfig,
  validateBattleSquadAssignments,
  getDefaultBattleConfig,
  createEmptyBattleConfig,
  createDefaultPlayerLoadout,
  attachArmyAliases,
} from '../battle/BattleConfig'
import { COMBAT_BALANCE } from '../combat/CombatBalance'
import { ARMORS } from '../rpg/ArmorDatabase'
import { T4_RANGER_BOW_RANGED_ID, WEAPONS } from '../rpg/WeaponDatabase'
import {
  getUnitPresetsForFaction,
  type UnitPresetId,
} from '../battle/UnitPresetCatalog'
import { HERO_ASSET_IDS, HERO_ASSETS, getHeroFixedEquipment, type PlayerHeroId } from '../world/HeroAssetCatalog'
import { HERO_COMBAT_PROFILE_BY_ASSET, getT4HeroCombatModifiers } from '../battle/T4HeroCatalog'
import {
  MAX_COMMAND_SQUAD_SIZE,
  MAX_COMMAND_SQUADS,
  type SquadAssignment,
  type SquadId,
} from '../battle/CommandTarget'

export class BattleSetupUI {
  private config: BattleConfig
  private activeTab: 'army' | 'loadout' = 'army'
  private selectedSquadId: SquadId = 1
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
    if (!this.config.commandGrouping) {
      this.config.commandGrouping = 'preset'
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
    parent.appendChild(this.container)
    this._renderSetup()
  }

  destroy(): void {
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container)
    }
    this.container = null
  }

  private _renderSetup(): void {
    if (!this.container) return
    this.container.innerHTML = this._generateHtml()
    this._bindEvents()
    this._refreshView()
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
              <th>T4 HERO</th>
            </tr>
          </thead>
          <tbody>
            ${presets.map(p => `
              <tr class="unit-row" data-faction="${faction}" data-preset="${p.id}">
                <td class="unit-label" title="${p.description}">
                  ${p.nameEn} <span class="unit-zh">${p.nameZh}</span>
                </td>
                ${CUSTOM_BATTLE_UNIT_TIERS.map(t => `
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
      kind: 'melee' | 'ranged' | 'shield' | 'mount',
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
        <label class="campaign-loadout-field">玩家角色 / PLAYER CHARACTER
          <select id="battle-player-hero">
            <option value="">一般士兵 Standard</option>
            ${HERO_ASSET_IDS.map(id => `<option value="${id}">${HERO_ASSETS[id].nameZh} T4 · ${HERO_ASSETS[id].nameEn}</option>`).join('')}
          </select>
        </label>
        <p id="battle-fixed-equipment" hidden>遊俠固定使用 T4 弓作近戰，不攜帶盾牌。</p>
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
              { id: 'maki-ranger-bow-ranged', tier: 'T4', zh: '遊俠弓', en: 'RANGER BOW' },
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
            { id: 'round_shield_t1', tier: 'T1', zh: '基礎圓盾', en: `BASIC ROUND SHIELD (${ARMORS.round_shield_t1.shieldImpactMax} IMPACT)` },
            { id: 'round_shield_t2', tier: 'T2', zh: '鐵環圓盾', en: `IRON SHIELD (${ARMORS.round_shield_t2.shieldImpactMax} IMPACT)` },
            { id: 'round_shield_t3', tier: 'T3', zh: '狂戰士圓盾', en: `BERSERKER SHIELD (${ARMORS.round_shield_t3.shieldImpactMax} IMPACT)` },
          ], 'shield')}
          ${renderEquipmentGroup('羅馬', 'ROMAN', [
            { id: 'scutum_t1', tier: 'T1', zh: '基礎方盾', en: `BASIC SCUTUM (${ARMORS.scutum_t1.shieldImpactMax} IMPACT)` },
            { id: 'scutum_t2', tier: 'T2', zh: '軍團方盾', en: `LEGION SCUTUM (${ARMORS.scutum_t2.shieldImpactMax} IMPACT)` },
            { id: 'scutum_t3', tier: 'T3', zh: '百夫長方盾', en: `CENTURION SCUTUM (${ARMORS.scutum_t3.shieldImpactMax} IMPACT)` },
          ], 'shield')}
        </section>
        <section class="starting-state"><div class="loadout-category-heading"><h3>出戰方式</h3><span>STARTING STATE</span></div>
          <div class="starting-state-options" role="radiogroup" aria-label="Starting state">
            <button type="button" class="starting-state-card" role="radio" aria-checked="false" data-start-mounted="false"><b>徒步</b><small>ON FOOT</small></button>
            <button type="button" class="starting-state-card" role="radio" aria-checked="false" data-start-mounted="true"><b>騎乘</b><small>MOUNTED</small><i>✓</i></button>
          </div>
        </section>
        <section class="loadout-category"><div class="loadout-category-heading"><h3>坐騎</h3><span>MOUNT</span></div>
          ${renderEquipmentGroup('坐騎種類', 'MOUNT TYPE', [
            { id: 'black-cat', zh: '黑貓', en: 'BLACK CAT' },
            { id: 'corgi', zh: '柯基', en: 'CORGI' },
            { id: 'xongkoro', zh: '巨鷹英雄坐騎', en: 'xongkoro' },
            { id: 'horse', zh: '馬', en: 'HORSE' },
          ], 'mount')}
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

      <div class="setup-mode-section">
        <div class="mode-section-label">指揮分組 <small>COMMAND GROUPING</small></div>
        <div class="mode-btn-group">
          <button type="button" class="mode-btn" id="command-grouping-preset" data-command-grouping="preset">
            <span class="mode-btn-title">兵種</span>
            <span class="mode-btn-desc">UNIT PRESETS</span>
          </button>
          <button type="button" class="mode-btn" id="command-grouping-squad" data-command-grouping="squad">
            <span class="mode-btn-title">小隊</span>
            <span class="mode-btn-desc">SQUADS · UP TO 8</span>
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
              · T4: <span id="viking-t4-total">0</span> / ${MAX_CUSTOM_T4_PER_SIDE}
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
              · T4: <span id="roman-t4-total">0</span> / ${MAX_CUSTOM_T4_PER_SIDE}
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
        <button class="start-btn" id="btn-start-battle"><span id="btn-start-battle-label">開始戰鬥</span><small id="btn-start-battle-subtitle">START BATTLE</small></button>
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
    this.container.querySelector<HTMLSelectElement>('#battle-player-hero')?.addEventListener('change', event => {
      this.config.playerHeroId = (event.target as HTMLSelectElement).value as PlayerHeroId || null
      if (this.config.playerHeroId === 'maki-archer-t4'
        && WEAPONS[this.config.playerLoadout?.rangedWeaponId ?? '']?.combatKind !== 'bow') {
        this.config.playerLoadout!.rangedWeaponId = T4_RANGER_BOW_RANGED_ID
      }
      this._refreshView()
    })
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
      this.config.squadAssignments = undefined
      this._refreshView()
    })
    document.getElementById('faction-btn-roman')?.addEventListener('click', () => {
      this.config.playerFaction = 'roman'
      this.config.squadAssignments = undefined
      this._refreshView()
    })

    document.getElementById('command-grouping-preset')?.addEventListener('click', () => {
      this.config.commandGrouping = 'preset'
      this.config.squadAssignments = undefined
      this._refreshView()
    })
    document.getElementById('command-grouping-squad')?.addEventListener('click', () => {
      this.config.commandGrouping = 'squad'
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
        if (getHeroFixedEquipment(this.config.playerHeroId) && ['melee', 'shield'].includes(target.dataset.loadoutKind ?? '')) return
        const id = target.dataset.loadoutId || null
        if (this.config.playerHeroId === 'maki-archer-t4' && target.dataset.loadoutKind === 'ranged'
          && WEAPONS[id ?? '']?.combatKind !== 'bow') return
        switch (target.dataset.loadoutKind) {
          case 'melee': this.config.playerLoadout!.meleeWeaponId = id as PlayerMeleeWeaponId; break
          case 'ranged': this.config.playerLoadout!.rangedWeaponId = id as PlayerRangedWeaponId; break
          case 'shield': this.config.playerLoadout!.shieldId = id as PlayerShieldId | null; break
          case 'mount': this.config.playerLoadout!.mountId = id as PlayerMountId; break
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

    // Presets change army composition only; preserve battle mode, command grouping, spectator, faction, HP, and loadout.
    const applyPreset = (preset: BattleConfig) => {
      const currentMode = this.config.mode ?? 'formation'
      const currentCommandGrouping = this.config.commandGrouping ?? 'preset'
      const currentSpectator = this.config.spectator ?? false
      const currentFaction = this.config.playerFaction ?? 'viking'
      const currentHp = this.config.playerHp ?? COMBAT_BALANCE.hp.playerDefault
      const currentLoadout = this.config.playerLoadout
      const currentHero = this.config.playerHeroId
      this.config = JSON.parse(JSON.stringify(preset))
      attachArmyAliases(this.config.viking, 'viking')
      attachArmyAliases(this.config.roman, 'roman')
      this.config.mode = currentMode
      this.config.commandGrouping = currentCommandGrouping
      this.config.spectator = currentSpectator
      this.config.playerFaction = currentFaction
      this.config.playerHp = currentHp
      this.config.playerLoadout = currentLoadout
      this.config.playerHeroId = currentHero
      this.config.squadAssignments = undefined
      this._refreshView()
    }

    document.getElementById('preset-10')?.addEventListener('click', () => applyPreset(PRESET_10V10))
    document.getElementById('preset-25')?.addEventListener('click', () => applyPreset(PRESET_25V25))
    document.getElementById('preset-50')?.addEventListener('click', () => applyPreset(PRESET_50V50))
    document.getElementById('preset-100')?.addEventListener('click', () => applyPreset(PRESET_100V100))
    document.getElementById('preset-200')?.addEventListener('click', () => applyPreset(PRESET_200V200))
    document.getElementById('preset-reset')?.addEventListener('click', () => {
      const currentMode = this.config.mode ?? 'formation'
      const currentCommandGrouping = this.config.commandGrouping ?? 'preset'
      const currentSpectator = this.config.spectator ?? false
      const currentFaction = this.config.playerFaction ?? 'viking'
      const currentHp = this.config.playerHp ?? COMBAT_BALANCE.hp.playerDefault
      const currentLoadout = this.config.playerLoadout
      const currentHero = this.config.playerHeroId
      this.config = createEmptyBattleConfig()
      attachArmyAliases(this.config.viking, 'viking')
      attachArmyAliases(this.config.roman, 'roman')
      this.config.mode = currentMode
      this.config.commandGrouping = currentCommandGrouping
      this.config.spectator = currentSpectator
      this.config.playerFaction = currentFaction
      this.config.playerHp = currentHp
      this.config.playerLoadout = currentLoadout
      this.config.playerHeroId = currentHero
      this.config.squadAssignments = undefined
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
      if (!validation.valid || !this.onStartCallback) return

      if (this.config.commandGrouping === 'squad') {
        this.config.squadAssignments ??= []
        this.selectedSquadId = 1
        this._renderSquadSetup()
        return
      }

      this._launchBattle(this.config)
    })
  }

  private _renderSquadSetup(): void {
    if (!this.container) return
    const playerFaction = this.config.playerFaction ?? 'viking'
    const army = this.config[playerFaction] as Record<string, UnitTierCounts | undefined>
    const presets = new Map(
      getUnitPresetsForFaction(playerFaction).map(preset => [preset.id, preset]),
    )
    const rows: Array<{ presetId: UnitPresetId; tier: UnitTier; count: number; nameZh: string; nameEn: string }> = []
    for (const [presetKey, counts] of Object.entries(army)) {
      if (!counts) continue
      const presetId = presetKey as UnitPresetId
      const preset = presets.get(presetId)
      if (!preset) continue
      for (const tier of CUSTOM_BATTLE_UNIT_TIERS) {
        const count = counts[tier] ?? 0
        if (count <= 0) continue
        rows.push({ presetId, tier, count, nameZh: preset.nameZh, nameEn: preset.nameEn })
      }
    }

    const assignments = this.config.squadAssignments ?? []
    const totalArmy = calculateArmyTotal(army as any)
    const totalAssigned = assignments.reduce((sum, assignment) => sum + assignment.count, 0)
    const unassigned = Math.max(0, totalArmy - totalAssigned)
    const selectedTotal = this._squadTotal(this.selectedSquadId)
    const factionLabel = playerFaction === 'viking' ? '維京' : '羅馬'

    const squadButtons = Array.from({ length: MAX_COMMAND_SQUADS }, (_, index) => {
      const squadId = (index + 1) as SquadId
      const total = this._squadTotal(squadId)
      return `
        <button type="button"
          class="campaign-squad-card ${squadId === this.selectedSquadId ? 'active' : ''}"
          data-command-squad="${squadId}">
          <b>第 ${squadId} 隊</b>
          <span>${total} / ${MAX_COMMAND_SQUAD_SIZE}</span>
        </button>
      `
    }).join('')

    const allocationRows = rows.map(row => {
      const assignedHere = this._squadAssignmentCount(row.presetId, row.tier, this.selectedSquadId)
      const assignedEverywhere = this._squadAssignedUnitTotal(row.presetId, row.tier)
      const remaining = Math.max(0, row.count - assignedEverywhere)
      const canIncrease = remaining > 0 && selectedTotal < MAX_COMMAND_SQUAD_SIZE
      const maxDirectValue = Math.min(
        row.count - (assignedEverywhere - assignedHere),
        MAX_COMMAND_SQUAD_SIZE - (selectedTotal - assignedHere),
      )
      return `
        <div class="campaign-squad-unit-row">
          <div class="campaign-squad-unit-name">
            <b>${row.nameZh}</b>
            <span>${row.nameEn}</span>
            <small>T${row.tier} · 總兵力 ${row.count}</small>
          </div>
          <div class="campaign-squad-unit-remaining">
            <small>未分配</small>
            <b>${remaining}</b>
          </div>
          <div class="campaign-stepper campaign-squad-stepper">
            <button type="button" data-squad-dec="${row.presetId}" data-tier="${row.tier}" ${assignedHere <= 0 ? 'disabled' : ''}>−</button>
            <input type="number" min="0" max="${maxDirectValue}" value="${assignedHere}"
              data-squad-count="${row.presetId}" data-tier="${row.tier}" />
            <button type="button" data-squad-inc="${row.presetId}" data-tier="${row.tier}" ${canIncrease ? '' : 'disabled'}>＋</button>
          </div>
        </div>
      `
    }).join('')

    const baseValidation = validateBattleConfig(this.config)
    const squadValidation = validateBattleSquadAssignments(this.config)
    const canStart = baseValidation.valid && squadValidation.valid && unassigned === 0
    const validationMessage = unassigned > 0
      ? `尚有 ${unassigned} 名士兵未分配小隊`
      : squadValidation.valid
        ? ''
        : squadValidation.errors.join(' ｜ ')

    this.container.innerHTML = `
      <button type="button" class="setup-back-btn" id="battle-squad-back">← 返回軍隊配置</button>
      <div class="setup-header">
        <h1 class="setup-title">SAGABURST</h1>
        <div class="setup-subtitle">CUSTOM BATTLE · SQUAD ASSIGNMENT</div>
      </div>
      <div class="campaign-section-title">${factionLabel}小隊編組 <small>${playerFaction.toUpperCase()} PLAYER SQUADS</small></div>
      <div class="campaign-squad-summary">
        <div><small>玩家陣營兵力</small><b>${totalArmy}</b></div>
        <div><small>已分配</small><b>${totalAssigned}</b></div>
        <div class="${unassigned > 0 ? 'warning' : ''}"><small>未分配</small><b>${unassigned}</b></div>
        <div><small>單隊上限</small><b>${MAX_COMMAND_SQUAD_SIZE}</b></div>
      </div>
      <div class="campaign-squad-tabs">${squadButtons}</div>
      <section class="campaign-squad-editor">
        <div class="campaign-squad-editor-heading">
          <div><h2>第 ${this.selectedSquadId} 隊</h2><small>SQUAD ${this.selectedSquadId}</small></div>
          <strong>${selectedTotal} / ${MAX_COMMAND_SQUAD_SIZE}</strong>
        </div>
        <div class="campaign-squad-unit-list">${allocationRows}</div>
      </section>
      <div class="setup-validation-msg">${validationMessage}</div>
      <div class="campaign-actions">
        <button type="button" class="campaign-secondary-btn" id="battle-squad-back-bottom">← 返回軍隊配置</button>
        <button type="button" class="start-btn" id="battle-confirm-squads" ${canStart ? '' : 'disabled'}>
          <span>開始戰鬥</span><small>START BATTLE</small>
        </button>
      </div>
    `

    this.container.querySelectorAll<HTMLElement>('[data-command-squad]').forEach(button => {
      button.addEventListener('click', () => {
        const value = Number(button.dataset.commandSquad)
        if (value < 1 || value > MAX_COMMAND_SQUADS) return
        this.selectedSquadId = value as SquadId
        this._renderSquadSetup()
      })
    })
    this.container.querySelectorAll<HTMLElement>('[data-squad-inc]').forEach(button => {
      button.addEventListener('click', () => {
        this._adjustSquadAssignment(
          button.dataset.squadInc as UnitPresetId,
          Number(button.dataset.tier) as UnitTier,
          1,
        )
      })
    })
    this.container.querySelectorAll<HTMLElement>('[data-squad-dec]').forEach(button => {
      button.addEventListener('click', () => {
        this._adjustSquadAssignment(
          button.dataset.squadDec as UnitPresetId,
          Number(button.dataset.tier) as UnitTier,
          -1,
        )
      })
    })
    this.container.querySelectorAll<HTMLInputElement>('[data-squad-count]').forEach(input => {
      input.addEventListener('change', () => {
        const parsed = Number.parseInt(input.value, 10)
        this._setSquadAssignmentCount(
          input.dataset.squadCount as UnitPresetId,
          Number(input.dataset.tier) as UnitTier,
          Number.isFinite(parsed) ? parsed : 0,
        )
      })
    })

    const goBack = () => this._renderSetup()
    this.container.querySelector('#battle-squad-back')?.addEventListener('click', goBack)
    this.container.querySelector('#battle-squad-back-bottom')?.addEventListener('click', goBack)
    this.container.querySelector('#battle-confirm-squads')?.addEventListener('click', () => {
      const currentBase = validateBattleConfig(this.config)
      const currentSquads = validateBattleSquadAssignments(this.config)
      if (!currentBase.valid || !currentSquads.valid) return
      this._launchBattle(this.config)
    })
  }

  private _squadAssignmentCount(presetId: UnitPresetId, tier: UnitTier, squadId: SquadId): number {
    return (this.config.squadAssignments ?? []).find(assignment => (
      assignment.presetId === presetId
      && assignment.tier === tier
      && assignment.squadId === squadId
    ))?.count ?? 0
  }

  private _squadAssignedUnitTotal(presetId: UnitPresetId, tier: UnitTier): number {
    return (this.config.squadAssignments ?? [])
      .filter(assignment => assignment.presetId === presetId && assignment.tier === tier)
      .reduce((sum, assignment) => sum + assignment.count, 0)
  }

  private _squadTotal(squadId: SquadId): number {
    return (this.config.squadAssignments ?? [])
      .filter(assignment => assignment.squadId === squadId)
      .reduce((sum, assignment) => sum + assignment.count, 0)
  }

  private _adjustSquadAssignment(presetId: UnitPresetId, tier: UnitTier, delta: number): void {
    const current = this._squadAssignmentCount(presetId, tier, this.selectedSquadId)
    this._setSquadAssignmentCount(presetId, tier, current + delta)
  }

  private _setSquadAssignmentCount(presetId: UnitPresetId, tier: UnitTier, value: number): void {
    const playerFaction = this.config.playerFaction ?? 'viking'
    const army = this.config[playerFaction] as Record<string, UnitTierCounts | undefined>
    const deployed = army[presetId]?.[tier] ?? 0
    const current = this._squadAssignmentCount(presetId, tier, this.selectedSquadId)
    const assignedOtherSquads = this._squadAssignedUnitTotal(presetId, tier) - current
    const otherUnitsInSquad = this._squadTotal(this.selectedSquadId) - current
    const maxAllowed = Math.max(0, Math.min(
      deployed - assignedOtherSquads,
      MAX_COMMAND_SQUAD_SIZE - otherUnitsInSquad,
    ))
    const next = Math.max(0, Math.min(maxAllowed, Math.floor(value)))
    const assignments = this.config.squadAssignments ??= []
    const index = assignments.findIndex(assignment => (
      assignment.presetId === presetId
      && assignment.tier === tier
      && assignment.squadId === this.selectedSquadId
    ))

    if (next === 0) {
      if (index >= 0) assignments.splice(index, 1)
    } else if (index >= 0) {
      assignments[index].count = next
    } else {
      const assignment: SquadAssignment = {
        presetId,
        tier,
        squadId: this.selectedSquadId,
        count: next,
      }
      assignments.push(assignment)
    }
    this._renderSquadSetup()
  }

  private _launchBattle(config: BattleConfig): void {
    if (!this.onStartCallback) return
    if (typeof window !== 'undefined' && !window.location.search.includes('nolock')) {
      try {
        const canvasContainer = document.getElementById('canvas-container')
        const target = canvasContainer || document.body
        const p = target.requestPointerLock?.()
        if (p && typeof (p as any).catch === 'function') {
          ;(p as Promise<void>).catch(() => {})
        }
      } catch {
        // Pointer lock is optional during launch.
      }
    }
    this.destroy()
    this.onStartCallback(config)
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
    const t4Remaining = MAX_CUSTOM_T4_PER_SIDE - this._t4Total(faction) + oldVal
    const maxAllowed = Math.max(0, Math.min(MAX_CUSTOM_ARMY_SIZE - otherTotal, tier === 4 ? t4Remaining : MAX_CUSTOM_ARMY_SIZE))
    const clamped = Math.max(0, Math.min(value, maxAllowed))

    if (army[preset]![tier] !== clamped) this.config.squadAssignments = undefined
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
      if (currentTotal >= MAX_CUSTOM_ARMY_SIZE || currentVal >= MAX_CUSTOM_ARMY_SIZE || (tier === 4 && this._t4Total(faction) >= MAX_CUSTOM_T4_PER_SIDE)) return
      army[preset]![tier] = currentVal + 1
      this.config.squadAssignments = undefined
    } else if (delta < 0) {
      if (currentVal <= 0) return
      army[preset]![tier] = currentVal - 1
      this.config.squadAssignments = undefined
    }

    this._refreshView()
  }

  private _refreshView(): void {
    if (!this.container) return

    for (const faction of ['viking', 'roman'] as const) {
      const army = this.config[faction] as Record<string, UnitTierCounts | undefined>
      const presets = getUnitPresetsForFaction(faction)
      for (const p of presets) {
        for (const t of CUSTOM_BATTLE_UNIT_TIERS) {
          const el = document.getElementById(`val-${faction}-${p.id}-${t}`) as HTMLInputElement | null
          if (el) el.value = String(army[p.id]?.[t] ?? 0)
        }
      }
      const t4Total = this._t4Total(faction)
      const t4El = document.getElementById(`${faction}-t4-total`)
      if (t4El) t4El.textContent = String(t4Total)
      this.container.querySelectorAll<HTMLButtonElement>(`.btn-inc[data-faction="${faction}"][data-tier="4"]`).forEach(button => {
        button.disabled = t4Total >= MAX_CUSTOM_T4_PER_SIDE || calculateArmyTotal(army) >= MAX_CUSTOM_ARMY_SIZE
      })
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

    const currentCommandGrouping = this.config.commandGrouping ?? 'preset'
    document.getElementById('command-grouping-preset')?.classList.toggle('active', currentCommandGrouping === 'preset')
    document.getElementById('command-grouping-squad')?.classList.toggle('active', currentCommandGrouping === 'squad')

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
    const startLabel = document.getElementById('btn-start-battle-label')
    const startSubtitle = document.getElementById('btn-start-battle-subtitle')
    const usesSquads = currentCommandGrouping === 'squad'
    if (startLabel) startLabel.textContent = usesSquads ? '選擇小隊' : '開始戰鬥'
    if (startSubtitle) startSubtitle.textContent = usesSquads ? 'ASSIGN SQUADS' : 'START BATTLE'

    const spectatorCheckbox = document.getElementById('spectator-checkbox') as HTMLInputElement | null
    if (spectatorCheckbox) {
      spectatorCheckbox.checked = Boolean(this.config.spectator)
    }

    const playerHpInput = document.getElementById('player-hp-input') as HTMLInputElement | null
    if (playerHpInput) {
      const heroProfile = this.config.playerHeroId ? getT4HeroCombatModifiers(HERO_COMBAT_PROFILE_BY_ASSET[this.config.playerHeroId]) : null
      playerHpInput.value = String(heroProfile?.maxHp ?? this.config.playerHp ?? COMBAT_BALANCE.hp.playerDefault)
      playerHpInput.disabled = Boolean(heroProfile)
    }

    const loadout = this.config.playerLoadout
    const fixedEquipment = getHeroFixedEquipment(this.config.playerHeroId)
    const fixedNotice = this.container.querySelector<HTMLElement>('#battle-fixed-equipment')
    if (fixedNotice) fixedNotice.hidden = !fixedEquipment
    const heroSelect = this.container.querySelector<HTMLSelectElement>('#battle-player-hero')
    if (heroSelect) heroSelect.value = this.config.playerHeroId ?? ''
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
        const el = card as HTMLButtonElement
        const locked = (Boolean(fixedEquipment) && ['melee', 'shield'].includes(el.dataset.loadoutKind ?? ''))
          || (this.config.playerHeroId === 'maki-archer-t4' && el.dataset.loadoutKind === 'ranged'
            && WEAPONS[el.dataset.loadoutId ?? '']?.combatKind !== 'bow')
        el.disabled = locked
        el.setAttribute?.('aria-disabled', String(locked))
        const selected = !locked && ((el.dataset.loadoutKind === 'melee' && el.dataset.loadoutId === loadout.meleeWeaponId)
          || (el.dataset.loadoutKind === 'ranged' && el.dataset.loadoutId === loadout.rangedWeaponId)
          || (el.dataset.loadoutKind === 'shield' && el.dataset.loadoutId === (loadout.shieldId ?? ''))
          || (el.dataset.loadoutKind === 'mount' && el.dataset.loadoutId === (loadout.mountId ?? 'horse')))
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

  private _t4Total(faction: 'viking' | 'roman'): number {
    return Object.values(this.config[faction]).reduce((sum: number, counts) => sum + (counts?.[4] ?? 0), 0)
  }


}
