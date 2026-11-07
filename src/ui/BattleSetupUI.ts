import { needsPlayerHpConfirmation, resolveOrdinaryPlayerBaseHp, resolveOrdinarySoldierTier } from '../combat/OrdinarySoldierProfile'
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
  ArmyConfig,
  createEmptyArmyConfig,
  MAX_CUSTOM_ARMY_SIZE,
  MAX_GROUND_CUSTOM_ARMY_SIZE,
  CustomBattleMapId,
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
import { WEAPONS } from '../rpg/WeaponDatabase'
import { ARMORS } from '../rpg/ArmorDatabase'
import {
  getUnitPresetsForFaction,
  BASE_UNIT_TIERS,
  type BaseUnitTier,
  type UnitPresetId,
} from '../battle/UnitPresetCatalog'
import { SETUP_PLAYER_HERO_IDS, HERO_ASSETS, isSetupPlayerHeroId } from '../world/HeroAssetCatalog'
import { HERO_COMBAT_PROFILE_BY_ASSET, getT4HeroCombatModifiers } from '../battle/T4HeroCatalog'
import {
  MAX_CUSTOM_BATTLE_COMMAND_SQUAD_SIZE,
  MAX_CUSTOM_BATTLE_COMMAND_SQUADS,
  type SquadAssignment,
  type SquadId,
} from '../battle/CommandTarget'

function getUnitRoleLabel(presetId: UnitPresetId, isAerial: boolean): { tag: string; icon: string } {
  if (isAerial) return { tag: '巨鷹騎射手', icon: '🦅' }
  switch (presetId) {
    case 'viking_berserker': return { tag: '狂戰斧盾', icon: '🪓' }
    case 'viking_spearman': return { tag: '長槍衛隊', icon: '🔱' }
    case 'viking_archer': return { tag: '諾德長弓', icon: '🏹' }
    case 'viking_sword_cavalry': return { tag: '突擊斧騎', icon: '🐎' }
    case 'viking_lancer': return { tag: '重裝騎槍', icon: '🐎' }
    case 'viking_horse_archer': return { tag: '游擊騎射', icon: '🐎' }
    case 'roman_heavy_infantry': return { tag: '軍團步兵', icon: '🛡️' }
    case 'roman_spearman': return { tag: '軍團槍兵', icon: '🔱' }
    case 'roman_archer': return { tag: '軍團弓手', icon: '🏹' }
    case 'roman_javelin_infantry': return { tag: '破陣標槍', icon: '🎯' }
    case 'roman_sword_cavalry': return { tag: '輔助劍騎', icon: '🐎' }
    case 'roman_lancer': return { tag: '重裝槍騎', icon: '🐎' }
    case 'roman_horse_archer': return { tag: '輔助騎射', icon: '🐎' }
    default: return { tag: '戰鬥單位', icon: '⚔️' }
  }
}

export class BattleSetupUI {
  private config: BattleConfig
  private activeTab: 'army' | 'loadout' = 'army'
  private activeEditFaction: 'viking' | 'roman' = 'viking'
  private selectedSquadId: SquadId = 1
  private container: HTMLElement | null = null
  private onStartCallback: ((config: BattleConfig) => void) | null = null
  private onBackCallback: (() => void) | null = null
  private _savedGroundViking?: ArmyConfig
  private _savedGroundRoman?: ArmyConfig
  private _savedAerialViking?: ArmyConfig
  private _savedAerialRoman?: ArmyConfig
  private _savedGroundMapId?: CustomBattleMapId

  constructor(initialConfig?: BattleConfig) {
    this.config = initialConfig
      ? JSON.parse(JSON.stringify(initialConfig))
      : getDefaultBattleConfig()
    attachArmyAliases(this.config.viking, 'viking')
    attachArmyAliases(this.config.roman, 'roman')
    if (this.config.battleType === 'aerial') {
      this._savedGroundMapId = this.config.mapId ?? 'original'
      this.config.mapId = 'original'
    } else {
      this._savedGroundMapId = this.config.mapId ?? 'original'
    }
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
    this.activeEditFaction = this.config.playerFaction ?? 'viking'
    if (this.config.playerHp === undefined) {
      this.config.playerHp = COMBAT_BALANCE.hp.playerDefault
      this.config.playerHpSource = 'default'
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

  getConfig(): BattleConfig {
    return this.config
  }

  switchBattleType(type: 'ground' | 'aerial'): void {
    if (type === 'ground') {
      if (this.config.battleType === 'ground') return
      this._savedAerialViking = JSON.parse(JSON.stringify(this.config.viking))
      this._savedAerialRoman = JSON.parse(JSON.stringify(this.config.roman))
      this.config.battleType = 'ground'
      if (this._savedGroundViking && this._savedGroundRoman) {
        this.config.viking = JSON.parse(JSON.stringify(this._savedGroundViking))
        this.config.roman = JSON.parse(JSON.stringify(this._savedGroundRoman))
      }
      this.config.mapId = this._savedGroundMapId ?? 'original'
      attachArmyAliases(this.config.viking, 'viking')
      attachArmyAliases(this.config.roman, 'roman')
      this.config.squadAssignments = undefined
      this._renderSetup()
    } else {
      if (this.config.battleType === 'aerial') return
      this._savedGroundViking = JSON.parse(JSON.stringify(this.config.viking))
      this._savedGroundRoman = JSON.parse(JSON.stringify(this.config.roman))
      this._savedGroundMapId = this.config.mapId ?? 'original'
      this.config.battleType = 'aerial'
      this.config.mapId = 'original'
      if (this._savedAerialViking && this._savedAerialRoman) {
        this.config.viking = JSON.parse(JSON.stringify(this._savedAerialViking))
        this.config.roman = JSON.parse(JSON.stringify(this._savedAerialRoman))
      } else {
        const vArmy = createEmptyArmyConfig('viking')
        const rArmy = createEmptyArmyConfig('roman')
        attachArmyAliases(vArmy, 'viking')
        attachArmyAliases(rArmy, 'roman')
        const vMax = this._getMaxArmyForFaction('viking')
        const rMax = this._getMaxArmyForFaction('roman')
        for (const t of CUSTOM_BATTLE_UNIT_TIERS) {
          vArmy.viking_archer[t] = Math.min(vMax, (this.config.viking as any).viking_archer?.[t] ?? (this.config.viking as any).archer?.[t] ?? 0)
          rArmy.roman_archer[t] = Math.min(rMax, (this.config.roman as any).roman_archer?.[t] ?? (this.config.roman as any).archer?.[t] ?? 0)
        }
        if (calculateArmyTotal(vArmy) === 0) vArmy.viking_archer[3] = Math.min(10, vMax)
        if (calculateArmyTotal(rArmy) === 0) rArmy.roman_archer[3] = Math.min(10, rMax)
        this.config.viking = vArmy
        this.config.roman = rArmy
      }
      attachArmyAliases(this.config.viking, 'viking')
      attachArmyAliases(this.config.roman, 'roman')
      this._clampAerialArmies()
      this.config.squadAssignments = undefined
      this._renderSetup()
    }
  }

  selectMap(mapId: CustomBattleMapId): void {
    this.config.mapId = mapId
    this._savedGroundMapId = mapId
    this._refreshView()
  }

  private _getMaxArmyForFaction(faction: 'viking' | 'roman'): number {
    if (this.config.battleType === 'aerial') {
      const isPlayer = (this.config.playerFaction ?? 'viking') === faction
      return (!this.config.spectator && isPlayer) ? 49 : 50
    }
    return MAX_GROUND_CUSTOM_ARMY_SIZE
  }

  private _clampAerialArmies(): void {
    if (this.config.battleType !== 'aerial') return
    for (const faction of ['viking', 'roman'] as const) {
      const maxAllowed = this._getMaxArmyForFaction(faction)
      const army = this.config[faction] as Record<string, UnitTierCounts | undefined>
      let total = calculateArmyTotal(army)
      if (total > maxAllowed) {
        const archerKey = `${faction}_archer`
        const counts = army[archerKey]
        if (counts) {
          for (const t of [5, 4, 3, 2, 1] as const) {
            while ((counts[t] ?? 0) > 0 && total > maxAllowed) {
              counts[t] = (counts[t] ?? 0) - 1
              total--
            }
          }
        }
        this.config.squadAssignments = undefined
      }
    }
  }

  private _renderSetup(): void {
    if (!this.container) return
    this.container.innerHTML = this._generateHtml()
    this._bindEvents()
    this._refreshView()
  }

  private _generateHtml(): string {
    const isAerial = this.config.battleType === 'aerial'
    const vMax = this._getMaxArmyForFaction('viking')
    const rMax = this._getMaxArmyForFaction('roman')

    const renderTable = (faction: 'viking' | 'roman') => {
      const allPresets = getUnitPresetsForFaction(faction)
      const presets = isAerial
        ? allPresets.filter(p => p.id === `${faction}_archer`)
        : allPresets
      const maxArmy = this._getMaxArmyForFaction(faction)

      return `
        <div class="roster-table-wrapper">
          <table class="unit-table">
            <thead>
              <tr>
                <th class="col-unit">兵種與戰術特性 <small>UNIT & ROLE</small></th>
                <th class="col-tier">
                  <span class="tier-tag">T1</span>
                  <div class="tier-name">新兵 <small>RECRUIT</small></div>
                </th>
                <th class="col-tier">
                  <span class="tier-tag">T2</span>
                  <div class="tier-name">老兵 <small>VETERAN</small></div>
                </th>
                <th class="col-tier">
                  <span class="tier-tag">T3</span>
                  <div class="tier-name">精銳 <small>ELITE</small></div>
                </th>
                <th class="col-tier">
                  <span class="tier-tag">T4</span>
                  <div class="tier-name">英雄 <small>CHAMPION</small></div>
                </th>
                <th class="col-tier">
                  <span class="tier-tag">T5</span>
                  <div class="tier-name">領袖 <small>COMMANDER</small></div>
                </th>
                <th class="col-total">小計 <small>SUB</small></th>
              </tr>
            </thead>
            <tbody>
              ${presets.map(p => {
                const role = getUnitRoleLabel(p.id, isAerial)
                const desc = isAerial
                  ? '巨鷹高空遠程部隊，於 35m–55m 高空翱翔並以長弓獵殺敵方空中單位。'
                  : p.description
                return `
                <tr class="unit-row" data-faction="${faction}" data-preset="${p.id}">
                  <td class="unit-label">
                    <div class="unit-cell-content">
                      <div class="unit-title-line">
                        <span class="unit-role-badge">${role.icon} ${role.tag}</span>
                        <strong class="unit-name-zh">${isAerial ? '鷹騎兵 (xongkoro)' : p.nameZh}</strong>
                        <span class="unit-name-en">${isAerial ? 'Eagle Rider' : p.nameEn}</span>
                      </div>
                      <div class="unit-desc" title="${desc}">${desc}</div>
                    </div>
                  </td>
                  ${CUSTOM_BATTLE_UNIT_TIERS.map(t => `
                    <td class="unit-tier-cell">
                      <div class="stepper">
                        <button type="button" class="step-btn btn-dec" data-faction="${faction}" data-preset="${p.id}" data-tier="${t}" aria-label="減少">−</button>
                        <input type="number" min="0" max="${maxArmy}" class="step-input" id="val-${faction}-${p.id}-${t}" data-faction="${faction}" data-preset="${p.id}" data-tier="${t}" value="0" />
                        <button type="button" class="step-btn btn-inc" data-faction="${faction}" data-preset="${p.id}" data-tier="${t}" aria-label="增加">＋</button>
                      </div>
                    </td>
                  `).join('')}
                  <td class="unit-subtotal-cell">
                    <span class="unit-subtotal-badge" id="row-total-${faction}-${p.id}">0 人</span>
                  </td>
                </tr>
              `}).join('')}
            </tbody>
          </table>
        </div>
      `
    }

    const renderEquipmentGroup = (
      title: string,
      subtitle: string,
      cards: Array<{ id: string | null; tier?: string; zh?: string; en?: string }>,
      kind: 'melee' | 'ranged' | 'shield' | 'mount',
    ) => `
      <section class="equipment-group">
        <div class="equipment-group-heading"><span>${title}</span><small>${subtitle}</small></div>
        <div class="equipment-card-grid">
          ${cards.map(card => {
            const item = card.id ? kind === 'shield' ? ARMORS[card.id] : WEAPONS[card.id] : undefined
            const [zh, ...en] = item?.name.split(' ') ?? []
            const tier = item ? `T${item.tier}` : card.tier
            return `
            <button type="button" class="loadout-card" role="radio" aria-checked="false"
              data-loadout-kind="${kind}" data-loadout-id="${card.id ?? ''}">
              <span class="loadout-card-top">${tier ? `<b>${tier}</b>` : '<b>—</b>'}</span>
              <span class="loadout-card-name">${zh ?? card.zh}</span>
              <span class="loadout-card-en">${item ? en.join(' ') : card.en}</span>${item?.type === 'shield' ? `<small>${item.shieldImpactMax} IMPACT</small>` : ''}
              <span class="loadout-card-check">✓</span>
            </button>
          `}).join('')}
        </div>
      </section>
    `

    const renderLoadoutPanel = () => `
      <div id="setup-loadout-panel" class="setup-tab-panel loadout-page ${this.activeTab === 'loadout' ? 'active' : ''}">
        <div class="loadout-hero-selector-bar">
          <label class="campaign-loadout-field" for="battle-player-hero">
            <span class="field-title">玩家出戰角色 / PLAYER HERO SELECTION</span>
            <select id="battle-player-hero">
              <option value="">一般士兵 Standard</option>
              ${BASE_UNIT_TIERS.map(tier => `<option value="${tier}">一般士兵 T${tier} · Standard</option>`).join('')}
              ${SETUP_PLAYER_HERO_IDS.map(id => `<option value="${id}">${HERO_ASSETS[id].nameZh} ${id.endsWith('t5') ? 'T5' : 'T4'} · ${HERO_ASSETS[id].nameEn}</option>`).join('')}
            </select>
          </label>
        </div>

        <div class="loadout-panel-heading">
          <h2>玩家個人裝備與坐騎配置</h2><span>PLAYER LOADOUT & MOUNT SETUP</span>
        </div>
        <div class="loadout-columns">
          <section class="loadout-category"><div class="loadout-category-heading"><h3>近戰主手武器</h3><span>MELEE WEAPONS</span></div>
            ${renderEquipmentGroup('維京戰斧', 'VIKING AXES', [
              { id: 'viking_axe_t1' },
              { id: 'viking_axe_t2' },
              { id: 'viking_axe_t3' },
            ], 'melee')}
            ${renderEquipmentGroup('羅馬佩劍', 'ROMAN BLADES', [
              { id: 'gladius_rusty' },
              { id: 'gladius_standard' },
              { id: 'centurion_blade' },
            ], 'melee')}
            ${renderEquipmentGroup('T4 英雄共用', 'SHARED T4', [
              { id: 'paladin_sword_t4' },
              { id: 'paladin_mace_t4' },
            ], 'melee')}
            ${renderEquipmentGroup('T5 領袖共用', 'SHARED T5', [
              { id: 'sword_t5' },
              { id: 'axe_t5' },
            ], 'melee')}
            ${renderEquipmentGroup('長槍與騎槍', 'LANCE & SPEARS', [
              { id: 'hunting_spear' },
              { id: 'steel_lance' },
              { id: 'heavy_lance' },
              { id: 'spear_t4' },
              { id: 'spear_t5' },
            ], 'melee')}
          </section>
          <section class="loadout-category"><div class="loadout-category-heading"><h3>遠程副手武器</h3><span>RANGED WEAPONS</span></div>
            ${renderEquipmentGroup('維京戰弓', 'VIKING BOWS', [
              { id: 'wooden_shortbow' },
              { id: 'recurve_longbow' },
              { id: 'elven_runebow' },
              { id: 'maki-ranger-bow-ranged' },
              { id: 'bow_t5' },
            ], 'ranged')}
            ${renderEquipmentGroup('羅馬軍團重標槍', 'ROMAN PILA', [
              { id: 'pilum_basic' },
              { id: 'pilum_standard' },
              { id: 'legionary_pilum' },
            ], 'ranged')}
          </section>
        </div>
        <section class="loadout-category shield-category"><div class="loadout-category-heading"><h3>護身盾牌</h3><span>SHIELDS</span></div>
          ${renderEquipmentGroup('通用與特殊盾牌', 'GENERAL SHIELDS', [
            { id: null, zh: '不攜帶盾牌', en: 'NO SHIELD' },
            { id: 'paladin_shield_t4' },
            { id: 'commander_shield_t5' },
            { id: 'roman_officer_shield_t4' },
            { id: 'viking_berserker_shield_t5' },
          ], 'shield')}
          ${renderEquipmentGroup('維京圓盾', 'VIKING ROUND SHIELDS', [
            { id: 'round_shield_t1' },
            { id: 'round_shield_t2' },
            { id: 'round_shield_t3' },
          ], 'shield')}
          ${renderEquipmentGroup('羅馬方盾', 'ROMAN SCUTA', [
            { id: 'scutum_t1' },
            { id: 'scutum_t2' },
            { id: 'scutum_t3' },
          ], 'shield')}
        </section>
        <section class="starting-state"><div class="loadout-category-heading"><h3>開戰方式</h3><span>STARTING DEPLOYMENT</span></div>
          <div class="starting-state-options" role="radiogroup" aria-label="Starting state">
            <button type="button" class="starting-state-card" role="radio" aria-checked="false" data-start-mounted="false"><b>徒步步戰</b><small>ON FOOT</small></button>
            <button type="button" class="starting-state-card" role="radio" aria-checked="false" data-start-mounted="true"><b>騎乘出征</b><small>MOUNTED</small><i>✓</i></button>
          </div>
        </section>
        <section class="loadout-category"><div class="loadout-category-heading"><h3>專屬戰鬥坐騎</h3><span>MOUNTS</span></div>
          ${renderEquipmentGroup('坐騎種類', 'MOUNT SELECTION', [
            { id: 'black-cat', zh: '黑貓戰騎', en: 'BLACK CAT' },
            { id: 'white-cat', zh: '白貓戰騎', en: 'WHITE CAT' },
            { id: 'orange-cat', zh: '橘貓戰騎', en: 'ORANGE CAT' },
            { id: 'serval', zh: '藪貓戰騎', en: 'SERVAL' },
            { id: 'caracal', zh: '獰貓戰騎', en: 'CARACAL' },
            { id: 'snow-leopard', zh: '重甲雪豹', en: 'ARMORED SNOW LEOPARD' },
            { id: 'corgi', zh: '戰甲柯基', en: 'CORGI' },
            { id: 'xongkoro', zh: '巨鷹英雄坐騎', en: 'XONGKORO EAGLE' },
            { id: 'horse', zh: '軍用戰馬', en: 'WAR HORSE' },
          ], 'mount')}
        </section>
      </div>
    `

    return `
      <button type="button" class="setup-back-btn" id="battle-setup-back">← 返回主選單</button>
      <div class="battle-setup-content">
        <header class="setup-header">
          <h1 class="setup-title">SAGABURST</h1>
          <div class="setup-subtitle">CUSTOM BATTLE CONFIGURATION 2.0</div>
        </header>

        <!-- Tactical Command Bar -->
        <section class="setup-tactical-toolbar" aria-label="Tactical configuration">
          <!-- Module 1: Mode & Map -->
          <div class="tactical-group group-mode-map">
            <div class="tactical-group-heading">
              <span>戰鬥模式與地圖</span>
              <small>MODE & MAP</small>
            </div>
            <div class="tactical-group-controls">
              <div class="segmented-control mode-type-control">
                <button type="button" class="mode-btn ${!isAerial ? 'active' : ''}" id="battle-type-ground" data-battle-type="ground">
                  <span class="mode-btn-title">地面戰鬥</span>
                  <span class="mode-btn-desc">300 VS 300</span>
                </button>
                <button type="button" class="mode-btn ${isAerial ? 'active' : ''}" id="battle-type-aerial" data-battle-type="aerial">
                  <span class="mode-btn-title">空中戰鬥</span>
                  <span class="mode-btn-desc">50 VS 50</span>
                </button>
              </div>

              <div class="segmented-control map-control" id="setup-map-section" style="${isAerial ? 'display: none;' : ''}">
                <button type="button" class="mode-btn map-btn ${(!this.config.mapId || this.config.mapId === 'original') ? 'active' : ''}" data-map-id="original">
                  <span class="mode-btn-title">原版戰場</span>
                  <span class="mode-btn-desc">ORIGINAL</span>
                </button>
                <button type="button" class="mode-btn map-btn ${this.config.mapId === 'bridge' ? 'active' : ''}" data-map-id="bridge">
                  <span class="mode-btn-title">橋頭戰場</span>
                  <span class="mode-btn-desc">BRIDGE</span>
                </button>
                <button type="button" class="mode-btn map-btn ${this.config.mapId === 'roman_town' ? 'active' : ''}" data-map-id="roman_town">
                  <span class="mode-btn-title">羅馬城鎮</span>
                  <span class="mode-btn-desc">ROMAN TOWN</span>
                </button>
                <button type="button" class="mode-btn map-btn ${this.config.mapId === 'snow' ? 'active' : ''}" data-map-id="snow">
                  <span class="mode-btn-title">雪地戰場</span>
                  <span class="mode-btn-desc">SNOW FIELD</span>
                </button>
                <button type="button" class="mode-btn map-btn ${this.config.mapId === 'viking_town' ? 'active' : ''}" data-map-id="viking_town">
                  <span class="mode-btn-title">維京城鎮</span>
                  <span class="mode-btn-desc">VIKING TOWN</span>
                </button>
              </div>
            </div>
          </div>

          <!-- Module 2: Tactics & Command -->
          <div class="tactical-group group-tactics">
            <div class="tactical-group-heading">
              <span>作戰方針與指揮</span>
              <small>TACTICS & COMMAND</small>
            </div>
            <div class="tactical-group-controls">
              <div class="segmented-control formation-control" id="setup-formation-section" style="${isAerial ? 'display: none;' : ''}">
                <button type="button" class="mode-btn" id="mode-btn-formation" data-mode="formation">
                  <span class="mode-btn-title">陣型戰</span>
                  <span class="mode-btn-desc">FORMATION</span>
                </button>
                <button type="button" class="mode-btn" id="mode-btn-scattered" data-mode="scattered">
                  <span class="mode-btn-title">散兵戰</span>
                  <span class="mode-btn-desc">SCATTERED</span>
                </button>
              </div>

              <div class="segmented-control command-control">
                <button type="button" class="mode-btn" id="command-grouping-preset" data-command-grouping="preset">
                  <span class="mode-btn-title">兵種指揮</span>
                  <span class="mode-btn-desc">PRESETS</span>
                </button>
                <button type="button" class="mode-btn" id="command-grouping-squad" data-command-grouping="squad">
                  <span class="mode-btn-title">小隊指揮</span>
                  <span class="mode-btn-desc">10 SQUADS MAX</span>
                </button>
              </div>
            </div>
          </div>

          <!-- Module 3: Allegiance -->
          <div class="tactical-group group-allegiance">
            <div class="tactical-group-heading">
              <span>玩家陣營歸屬</span>
              <small>PLAYER FACTION</small>
            </div>
            <div class="tactical-group-controls">
              <div class="segmented-control faction-control">
                <button type="button" class="mode-btn faction-btn-viking" id="faction-btn-viking" data-player-faction="viking">
                  <span class="mode-btn-title">維京陣營</span>
                  <span class="mode-btn-desc">VIKING CLANS</span>
                </button>
                <button type="button" class="mode-btn faction-btn-roman" id="faction-btn-roman" data-player-faction="roman">
                  <span class="mode-btn-title">羅馬陣營</span>
                  <span class="mode-btn-desc">ROMAN LEGION</span>
                </button>
              </div>
            </div>
          </div>
        </section>

        <!-- Navigation Tabs -->
        <div class="setup-tabs" role="tablist" aria-label="Battle setup sections">
          <button type="button" id="setup-tab-army" class="setup-tab ${this.activeTab === 'army' ? 'active' : ''}" role="tab">
            <b>軍隊編制 ARMY ROSTER</b>
            <small>配置雙方陣營與各階兵力</small>
          </button>
          <button type="button" id="setup-tab-loadout" class="setup-tab ${this.activeTab === 'loadout' ? 'active' : ''}" role="tab">
            <b>玩家裝備 PLAYER LOADOUT</b>
            <small>英雄角色、武裝、盾牌與坐騎</small>
          </button>
        </div>

        <!-- Army Setup Panel -->
        <div id="setup-army-panel" class="setup-tab-panel ${this.activeTab === 'army' ? 'active' : ''}">
          ${isAerial ? `
            <div class="aerial-info-banner">
              <div class="aerial-info-icon">🦅</div>
              <div class="aerial-info-text">
                <strong>空戰模式：巨鷹弓手高空對決 (50 VS 50)</strong>
                <span>${this.config.spectator ? '觀戰模式：雙方各 50 隻巨鷹 AI 於 35m–55m 高空廝殺。' : `參戰配置：己方 49 隻 AI 鷹騎兵 + 1 玩家（合計 50），敵方 50 隻 AI 鷹騎兵。`} 高空戰場固定於原版地圖，切回地面戰自動還原地圖選擇。</span>
              </div>
            </div>
          ` : ''}

          <!-- Army Overview Cards -->
          <div class="army-overview-grid">
            <div class="army-overview-card viking ${this.activeEditFaction === 'viking' ? 'active-edit' : ''}" id="overview-card-viking" role="button" tabindex="0" title="點擊切換編輯維京編制">
              <div class="overview-card-header">
                <div class="overview-faction-info">
                  <span class="overview-faction-icon">⚔️</span>
                  <div>
                    <h3 class="overview-faction-title">VIKING CLANS</h3>
                    <span class="overview-faction-sub">維京氏族軍團</span>
                  </div>
                </div>
                <div class="overview-badges">
                  <span class="overview-role-badge viking-badge" id="viking-role-badge">${this.config.playerFaction === 'viking' ? '👤 玩家所屬陣營' : '⚔️ 敵方軍團'}</span>
                  <span class="overview-edit-status">${this.activeEditFaction === 'viking' ? '● 正在編輯' : '點擊編輯'}</span>
                </div>
              </div>
              <div class="overview-card-body">
                <div class="overview-total-display">
                  <span class="overview-total-label">總編制兵力 TOTAL</span>
                  <span class="faction-total-badge">
                    <span id="viking-total" class="total-num">0 / ${vMax}</span>
                  </span>
                </div>
                <div class="overview-breakdown" id="viking-breakdown">
                  ${isAerial ? '鷹騎兵：0' : '步兵：0 ｜ 射手：0 ｜ 騎兵：0'}
                </div>
              </div>
            </div>

            <div class="army-overview-card roman ${this.activeEditFaction === 'roman' ? 'active-edit' : ''}" id="overview-card-roman" role="button" tabindex="0" title="點擊切換編輯羅馬編制">
              <div class="overview-card-header">
                <div class="overview-faction-info">
                  <span class="overview-faction-icon">🛡️</span>
                  <div>
                    <h3 class="overview-faction-title">ROMAN LEGION</h3>
                    <span class="overview-faction-sub">羅馬帝國軍團</span>
                  </div>
                </div>
                <div class="overview-badges">
                  <span class="overview-role-badge roman-badge" id="roman-role-badge">${this.config.playerFaction === 'roman' ? '👤 玩家所屬陣營' : '⚔️ 敵方軍團'}</span>
                  <span class="overview-edit-status">${this.activeEditFaction === 'roman' ? '● 正在編輯' : '點擊編輯'}</span>
                </div>
              </div>
              <div class="overview-card-body">
                <div class="overview-total-display">
                  <span class="overview-total-label">總編制兵力 TOTAL</span>
                  <span class="faction-total-badge">
                    <span id="roman-total" class="total-num">0 / ${rMax}</span>
                  </span>
                </div>
                <div class="overview-breakdown" id="roman-breakdown">
                  ${isAerial ? '鷹騎兵：0' : '步兵：0 ｜ 射手：0 ｜ 騎兵：0'}
                </div>
              </div>
            </div>
          </div>

          <!-- Roster Control Bar (Tabs + Presets) -->
          <div class="roster-control-bar">
            <div class="faction-edit-tabs" role="tablist" aria-label="Faction Roster Edit">
              <button type="button" class="faction-edit-tab ${this.activeEditFaction === 'viking' ? 'active' : ''}" id="edit-tab-viking" role="tab" data-faction="viking">
                <span class="edit-tab-icon">⚔️</span>
                <span class="edit-tab-title">維京軍團編制 <small>VIKING ROSTER</small></span>
                <span class="edit-tab-count" id="viking-tab-count">0 / ${vMax}</span>
              </button>
              <button type="button" class="faction-edit-tab ${this.activeEditFaction === 'roman' ? 'active' : ''}" id="edit-tab-roman" role="tab" data-faction="roman">
                <span class="edit-tab-icon">🛡️</span>
                <span class="edit-tab-title">羅馬軍團編制 <small>ROMAN ROSTER</small></span>
                <span class="edit-tab-count" id="roman-tab-count">0 / ${rMax}</span>
              </button>
            </div>

            <div class="setup-presets">
              <span class="presets-label">快速編制 <small>PRESETS</small>:</span>
              <button type="button" class="preset-btn" id="preset-10">10 VS 10</button>
              <button type="button" class="preset-btn" id="preset-25">25 VS 25</button>
              <button type="button" class="preset-btn" id="preset-50">50 VS 50</button>
              <button type="button" class="preset-btn" id="preset-100">100 VS 100</button>
              <button type="button" class="preset-btn" id="preset-200">200 VS 200</button>
              <button type="button" class="preset-btn preset-reset-btn" id="preset-reset">重置 RESET</button>
            </div>
          </div>

          <!-- Roster Tables for each Faction -->
          <div class="faction-roster-container">
            <div id="roster-panel-viking" class="faction-roster-panel ${this.activeEditFaction === 'viking' ? 'active' : ''}">
              ${renderTable('viking')}
            </div>
            <div id="roster-panel-roman" class="faction-roster-panel ${this.activeEditFaction === 'roman' ? 'active' : ''}">
              ${renderTable('roman')}
            </div>
          </div>

          <!-- Secondary Settings Card -->
          <div class="setup-secondary-settings">
            <div class="secondary-settings-heading">
              <h3>次要戰鬥設定 · 規則與狀態</h3>
              <small>SECONDARY SETTINGS & RULES</small>
            </div>
            <div class="secondary-settings-grid">
              <div class="secondary-setting-item">
                <label class="setting-label" for="player-hp-source">
                  <span>玩家生命值規則</span>
                  <small>PLAYER HP RULE</small>
                </label>
                <div class="player-hp-control">
                  <select id="player-hp-source" class="setting-select">
                    ${needsPlayerHpConfirmation(this.config) ? '<option value="" selected>舊設定未記錄來源，請確認</option>' : ''}
                    <option value="default" ${this.config.playerHpSource === 'default' ? 'selected' : ''}>依陣營／角色 Tier 自動決定</option>
                    <option value="custom" ${this.config.playerHpSource === 'custom' ? 'selected' : ''}>保留自訂生命值</option>
                  </select>
                  <div class="hp-input-group">
                    <input type="number" id="player-hp-input" min="1" max="9999" value="${resolveOrdinaryPlayerBaseHp(this.config.playerFaction ?? 'viking', resolveOrdinarySoldierTier(this.config.playerVisualTier), this.config)}" class="player-hp-input" />
                    <span class="hp-unit">HP</span>
                  </div>
                </div>
                <span class="setting-hint">預設依照角色 Tier 計算；若選擇英雄則使用英雄專屬戰鬥數值。</span>
              </div>

              <div class="secondary-setting-item">
                <label class="setting-label">
                  <span>觀戰模式設定</span>
                  <small>SPECTATOR MODE</small>
                </label>
                <div class="spectator-control">
                  <label class="spectator-toggle-label" for="spectator-checkbox">
                    <input type="checkbox" id="spectator-checkbox" />
                    <span>啟用純觀戰模式 (Spectator)</span>
                  </label>
                </div>
                <span class="setting-hint">勾選後玩家化身神之視角觀賞雙方 AI 廝殺，不親自參戰（空戰模式為 50v50）。</span>
              </div>

              <div class="secondary-setting-item secondary-nav-item">
                <label class="setting-label">
                  <span>個人武裝與英雄</span>
                  <small>EQUIPMENT & MOUNT</small>
                </label>
                <button type="button" class="btn-goto-loadout" id="btn-goto-loadout">
                  <span>配置玩家個人裝備 →</span>
                  <small>CUSTOMIZE PLAYER LOADOUT</small>
                </button>
                <span class="setting-hint">自訂玩家主手武器、副手遠程、防護盾牌及坐騎種類。</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Loadout Panel -->
        ${renderLoadoutPanel()}

        <!-- Launch Footer -->
        <footer class="setup-launch-footer">
          <div class="launch-footer-inner">
            <div class="launch-status-area">
              <div id="validation-msg" class="setup-validation-msg"></div>
            </div>
            <div class="launch-action-area">
              <button type="button" class="start-btn" id="btn-start-battle">
                <span id="btn-start-battle-label">開始戰鬥</span>
                <small id="btn-start-battle-subtitle">START BATTLE</small>
              </button>
            </div>
          </div>
        </footer>
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
      const heroId = (event.target as HTMLSelectElement).value
      const tier = Number(heroId) as BaseUnitTier
      const soldier = BASE_UNIT_TIERS.includes(tier)
      if (heroId !== '' && !soldier && !isSetupPlayerHeroId(heroId)) return
      this.config.playerHeroId = isSetupPlayerHeroId(heroId) ? heroId : null
      this.config.playerVisualTier = soldier ? tier : undefined
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

    // Battle Type buttons
    document.getElementById('battle-type-ground')?.addEventListener('click', () => {
      this.switchBattleType('ground')
    })
    document.getElementById('battle-type-aerial')?.addEventListener('click', () => {
      this.switchBattleType('aerial')
    })

    // Map selection buttons
    this.container.querySelectorAll('[data-map-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const mapId = (btn as HTMLElement).dataset.mapId as CustomBattleMapId
        if (mapId) {
          this.selectMap(mapId)
        }
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
      this.activeEditFaction = 'viking'
      this.config.squadAssignments = undefined
      this._clampAerialArmies()
      this._refreshView()
    })
    document.getElementById('faction-btn-roman')?.addEventListener('click', () => {
      this.config.playerFaction = 'roman'
      this.activeEditFaction = 'roman'
      this.config.squadAssignments = undefined
      this._clampAerialArmies()
      this._refreshView()
    })

    // Faction edit tabs
    this.container.querySelector('#edit-tab-viking')?.addEventListener('click', () => {
      this.activeEditFaction = 'viking'
      this._refreshView()
    })
    this.container.querySelector('#edit-tab-roman')?.addEventListener('click', () => {
      this.activeEditFaction = 'roman'
      this._refreshView()
    })

    // Overview cards click to switch edit faction
    this.container.querySelector('#overview-card-viking')?.addEventListener('click', () => {
      this.activeEditFaction = 'viking'
      this._refreshView()
    })
    this.container.querySelector('#overview-card-roman')?.addEventListener('click', () => {
      this.activeEditFaction = 'roman'
      this._refreshView()
    })

    // Quick jump to loadout
    this.container.querySelector('#btn-goto-loadout')?.addEventListener('click', () => {
      this.activeTab = 'loadout'
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

    document.getElementById('player-hp-source')?.addEventListener('change', event => {
      const source = (event.target as HTMLSelectElement).value
      if (source !== 'default' && source !== 'custom') return
      this.config.playerHpSource = source
      this._refreshView()
    })
    const hpInput = document.getElementById('player-hp-input') as HTMLInputElement | null
    hpInput?.addEventListener('input', () => {
      const raw = parseInt(hpInput.value, 10)
      const val = isNaN(raw) ? COMBAT_BALANCE.hp.playerDefault : Math.max(1, Math.min(9999, raw))
      this.config.playerHp = val
      this.config.playerHpSource = 'custom'
      this._refreshView()
    })
    hpInput?.addEventListener('blur', () => {
      if (this.config.playerHpSource !== 'custom') return
      const raw = parseInt(hpInput.value, 10)
      const val = isNaN(raw) ? COMBAT_BALANCE.hp.playerDefault : Math.max(1, Math.min(9999, raw))
      this.config.playerHp = val
      this.config.playerHpSource = 'custom'
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

    // Presets change army composition only; preserve battle mode, command grouping, spectator, faction, HP, loadout, battleType, mapId, and seed.
    const applyPreset = (preset: BattleConfig) => {
      const currentMode = this.config.mode ?? 'formation'
      const currentCommandGrouping = this.config.commandGrouping ?? 'preset'
      const currentSpectator = this.config.spectator ?? false
      const currentFaction = this.config.playerFaction ?? 'viking'
      const currentHp = this.config.playerHp
      const currentHpSource = this.config.playerHpSource
      const currentLoadout = this.config.playerLoadout
      const currentHero = this.config.playerHeroId
      const currentVisualTier = this.config.playerVisualTier
      const currentBattleType = this.config.battleType ?? 'ground'
      const currentMapId = currentBattleType === 'aerial' ? (this._savedGroundMapId ?? 'original') : (this.config.mapId ?? 'original')
      const currentSeed = this.config.seed

      if (currentBattleType === 'aerial') {
        const vMax = (!currentSpectator && currentFaction === 'viking') ? 49 : 50
        const rMax = (!currentSpectator && currentFaction === 'roman') ? 49 : 50
        const presetTotal = calculateArmyTotal(preset.viking)
        const vCount = Math.min(vMax, presetTotal)
        const rCount = Math.min(rMax, presetTotal)

        const vArmy = createEmptyArmyConfig('viking')
        const rArmy = createEmptyArmyConfig('roman')
        attachArmyAliases(vArmy, 'viking')
        attachArmyAliases(rArmy, 'roman')
        vArmy.viking_archer[3] = vCount
        rArmy.roman_archer[3] = rCount
        this.config.viking = vArmy
        this.config.roman = rArmy
      } else {
        this.config = JSON.parse(JSON.stringify(preset))
      }

      attachArmyAliases(this.config.viking, 'viking')
      attachArmyAliases(this.config.roman, 'roman')
      this.config.mode = currentMode
      this.config.commandGrouping = currentCommandGrouping
      this.config.spectator = currentSpectator
      this.config.playerFaction = currentFaction
      this.config.playerHp = currentHp
      this.config.playerHpSource = currentHpSource
      this.config.playerLoadout = currentLoadout
      this.config.playerHeroId = currentHero
      this.config.playerVisualTier = currentVisualTier
      this.config.battleType = currentBattleType
      this.config.mapId = currentBattleType === 'aerial' ? 'original' : currentMapId
      this._savedGroundMapId = currentMapId
      this.config.seed = currentSeed
      this.config.squadAssignments = undefined
      this._clampAerialArmies()
      this._renderSetup()
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
      const currentHp = this.config.playerHp
      const currentHpSource = this.config.playerHpSource
      const currentLoadout = this.config.playerLoadout
      const currentHero = this.config.playerHeroId
      const currentVisualTier = this.config.playerVisualTier
      const currentBattleType = this.config.battleType ?? 'ground'
      const currentMapId = currentBattleType === 'aerial' ? (this._savedGroundMapId ?? 'original') : (this.config.mapId ?? 'original')
      const currentSeed = this.config.seed
      this.config = createEmptyBattleConfig()
      attachArmyAliases(this.config.viking, 'viking')
      attachArmyAliases(this.config.roman, 'roman')
      this.config.mode = currentMode
      this.config.commandGrouping = currentCommandGrouping
      this.config.spectator = currentSpectator
      this.config.playerFaction = currentFaction
      this.config.playerHp = currentHp
      this.config.playerHpSource = currentHpSource
      this.config.playerLoadout = currentLoadout
      this.config.playerHeroId = currentHero
      this.config.playerVisualTier = currentVisualTier
      this.config.battleType = currentBattleType
      this.config.mapId = currentBattleType === 'aerial' ? 'original' : currentMapId
      this._savedGroundMapId = currentMapId
      this.config.seed = currentSeed
      this.config.squadAssignments = undefined
      this._renderSetup()
    })

    // Spectator checkbox
    const spectatorCheckbox = document.getElementById('spectator-checkbox') as HTMLInputElement | null
    spectatorCheckbox?.addEventListener('change', (e) => {
      this.config.spectator = (e.target as HTMLInputElement).checked
      this._clampAerialArmies()
      this._refreshView()
    })

    // Start battle button
    document.getElementById('btn-start-battle')?.addEventListener('click', () => {
      const validation = validateBattleConfig(this.config)
      if (!validation.valid || needsPlayerHpConfirmation(this.config) || !this.onStartCallback) return

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

    const squadButtons = Array.from({ length: MAX_CUSTOM_BATTLE_COMMAND_SQUADS }, (_, index) => {
      const squadId = (index + 1) as SquadId
      const total = this._squadTotal(squadId)
      return `
        <button type="button"
          class="campaign-squad-card ${squadId === this.selectedSquadId ? 'active' : ''}"
          data-command-squad="${squadId}">
          <b>第 ${squadId} 隊</b>
          <span>${total} / ${MAX_CUSTOM_BATTLE_COMMAND_SQUAD_SIZE}</span>
        </button>
      `
    }).join('')

    const allocationRows = rows.map(row => {
      const assignedHere = this._squadAssignmentCount(row.presetId, row.tier, this.selectedSquadId)
      const assignedEverywhere = this._squadAssignedUnitTotal(row.presetId, row.tier)
      const remaining = Math.max(0, row.count - assignedEverywhere)
      const canIncrease = remaining > 0 && selectedTotal < MAX_CUSTOM_BATTLE_COMMAND_SQUAD_SIZE
      const maxDirectValue = Math.min(
        row.count - (assignedEverywhere - assignedHere),
        MAX_CUSTOM_BATTLE_COMMAND_SQUAD_SIZE - (selectedTotal - assignedHere),
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
      <div class="battle-setup-content squad-setup-content">
        <header class="setup-header">
          <h1 class="setup-title">SAGABURST</h1>
          <div class="setup-subtitle">CUSTOM BATTLE · SQUAD ASSIGNMENT</div>
        </header>
        <div class="campaign-section-title">${factionLabel}小隊編組 <small>${playerFaction.toUpperCase()} PLAYER SQUADS</small></div>
        <div class="campaign-squad-hint" style="padding: 12px 18px; margin: 12px 0 18px; background: rgba(22,17,13,0.85); border: 1px solid rgba(212,175,55,0.3); border-radius: 6px; font-size: 14px; color: #dcd0bc; line-height: 1.6;">
          <b>全新小隊部署規則：</b><br/>
          • 總小隊數 ≤ 5 隊：全部部署於己方邊緣後排<br/>
          • 總小隊數 > 5 隊：小隊 1–5 部署於前排，小隊 6–10 部署於後排<br/>
          • 每排最多 5 個獨立小隊區塊，依隊數橫向置中。每隊最多 50 人。
        </div>
        <div class="campaign-squad-summary">
          <div><small>玩家陣營兵力</small><b>${totalArmy}</b></div>
          <div><small>已分配</small><b>${totalAssigned}</b></div>
          <div class="${unassigned > 0 ? 'warning' : ''}"><small>未分配</small><b>${unassigned}</b></div>
          <div><small>單隊上限</small><b>${MAX_CUSTOM_BATTLE_COMMAND_SQUAD_SIZE}</b></div>
        </div>
        <div class="campaign-squad-tabs">${squadButtons}</div>
        <section class="campaign-squad-editor">
          <div class="campaign-squad-editor-heading">
            <div><h2>第 ${this.selectedSquadId} 隊</h2><small>SQUAD ${this.selectedSquadId}</small></div>
            <strong>${selectedTotal} / ${MAX_CUSTOM_BATTLE_COMMAND_SQUAD_SIZE}</strong>
          </div>
          <div class="campaign-squad-unit-list">${allocationRows}</div>
        </section>
        <div class="setup-validation-msg ${unassigned > 0 || !squadValidation.valid ? 'invalid' : 'valid'}">${validationMessage}</div>
        <div class="campaign-actions">
          <button type="button" class="campaign-secondary-btn" id="battle-squad-back-bottom">← 返回軍隊配置</button>
          <button type="button" class="start-btn" id="battle-confirm-squads" ${canStart ? '' : 'disabled'}>
            <span>開始戰鬥</span><small>START BATTLE</small>
          </button>
        </div>
      </div>
    `

    this.container.querySelectorAll<HTMLElement>('[data-command-squad]').forEach(button => {
      button.addEventListener('click', () => {
        const value = Number(button.dataset.commandSquad)
        if (value < 1 || value > MAX_CUSTOM_BATTLE_COMMAND_SQUADS) return
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
      MAX_CUSTOM_BATTLE_COMMAND_SQUAD_SIZE - otherUnitsInSquad,
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
    if (!this.onStartCallback || needsPlayerHpConfirmation(this.config)) return
    config.battleType ??= 'ground'
    config.mapId ??= 'original'
    config.seed ??= Math.floor(Math.random() * 0x7fffffff)
    if (config.battleType === 'aerial' && !config.spectator && config.playerLoadout) {
      config.playerLoadout.mountId = 'xongkoro'
      config.playerLoadout.startMounted = true
    }
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
      army[preset] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
    }
    const maxArmy = this._getMaxArmyForFaction(faction)
    const oldVal = army[preset]![tier] || 0
    const otherTotal = calculateArmyTotal(army) - oldVal
    const maxAllowed = Math.max(0, maxArmy - otherTotal)
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
      army[preset] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
    }
    const currentVal = army[preset]![tier] || 0
    const currentTotal = calculateArmyTotal(army)
    const maxArmy = this._getMaxArmyForFaction(faction)

    if (delta > 0) {
      if (currentTotal >= maxArmy || currentVal >= maxArmy) return
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

    const isAerial = this.config.battleType === 'aerial'
    const vMax = this._getMaxArmyForFaction('viking')
    const rMax = this._getMaxArmyForFaction('roman')

    // 1. Update unit inputs, row subtotals, and stepper buttons
    for (const faction of ['viking', 'roman'] as const) {
      const army = this.config[faction] as Record<string, UnitTierCounts | undefined>
      const allPresets = getUnitPresetsForFaction(faction)
      const presets = isAerial ? allPresets.filter(p => p.id === `${faction}_archer`) : allPresets
      for (const p of presets) {
        let unitRowTotal = 0
        for (const t of CUSTOM_BATTLE_UNIT_TIERS) {
          const count = army[p.id]?.[t] ?? 0
          unitRowTotal += count
          const el = document.getElementById(`val-${faction}-${p.id}-${t}`) as HTMLInputElement | null
          if (el) el.value = String(count)
        }
        const rowTotalEl = document.getElementById(`row-total-${faction}-${p.id}`)
        if (rowTotalEl) {
          rowTotalEl.textContent = `${unitRowTotal} 人`
        }
      }
      const sideTotal = calculateArmyTotal(army)
      const maxForSide = this._getMaxArmyForFaction(faction)
      this.container.querySelectorAll<HTMLButtonElement>(`.btn-inc[data-faction="${faction}"]`).forEach(button => {
        button.disabled = sideTotal >= maxForSide
      })
    }

    const vTotal = calculateArmyTotal(this.config.viking)
    const rTotal = calculateArmyTotal(this.config.roman)

    // 2. Faction totals (Bugs fixed: NO duplicate denominator!)
    const vTotalEl = document.getElementById('viking-total')
    const rTotalEl = document.getElementById('roman-total')
    if (vTotalEl) {
      vTotalEl.textContent = `${vTotal} / ${vMax}`
      vTotalEl.classList.toggle('error', vTotal > vMax || vTotal < 1)
    }
    if (rTotalEl) {
      rTotalEl.textContent = `${rTotal} / ${rMax}`
      rTotalEl.classList.toggle('error', rTotal > rMax || rTotal < 1)
    }

    // 3. Tab count badges
    const vTabCount = document.getElementById('viking-tab-count')
    const rTabCount = document.getElementById('roman-tab-count')
    if (vTabCount) vTabCount.textContent = `${vTotal} / ${vMax}`
    if (rTabCount) rTabCount.textContent = `${rTotal} / ${rMax}`

    // 4. Army breakdown chips
    const vBreakdown = document.getElementById('viking-breakdown')
    const rBreakdown = document.getElementById('roman-breakdown')
    if (vBreakdown) {
      if (isAerial) {
        vBreakdown.textContent = `鷹騎兵：${vTotal} 隻`
      } else {
        const vArmy = this.config.viking as Record<string, UnitTierCounts | undefined>
        const vInf = (calculateArmyTotal({ berserker: vArmy.viking_berserker, spearman: vArmy.viking_spearman } as any))
        const vArc = (calculateArmyTotal({ archer: vArmy.viking_archer } as any))
        const vCav = (calculateArmyTotal({ sword_cavalry: vArmy.viking_sword_cavalry, lancer: vArmy.viking_lancer, horse_archer: vArmy.viking_horse_archer } as any))
        vBreakdown.textContent = `步兵：${vInf} ｜ 射手：${vArc} ｜ 騎兵：${vCav}`
      }
    }
    if (rBreakdown) {
      if (isAerial) {
        rBreakdown.textContent = `鷹騎兵：${rTotal} 隻`
      } else {
        const rArmy = this.config.roman as Record<string, UnitTierCounts | undefined>
        const rInf = (calculateArmyTotal({ heavy_infantry: rArmy.roman_heavy_infantry, spearman: rArmy.roman_spearman, javelin: rArmy.roman_javelin_infantry } as any))
        const rArc = (calculateArmyTotal({ archer: rArmy.roman_archer } as any))
        const rCav = (calculateArmyTotal({ sword_cavalry: rArmy.roman_sword_cavalry, lancer: rArmy.roman_lancer, horse_archer: rArmy.roman_horse_archer } as any))
        rBreakdown.textContent = `步兵：${rInf} ｜ 射手：${rArc} ｜ 騎兵：${rCav}`
      }
    }

    // 5. Active edit faction switching (Overview cards & Roster panels & Edit tabs)
    const activeFaction = this.activeEditFaction
    document.getElementById('overview-card-viking')?.classList.toggle('active-edit', activeFaction === 'viking')
    document.getElementById('overview-card-roman')?.classList.toggle('active-edit', activeFaction === 'roman')
    const vStatus = document.querySelector('#overview-card-viking .overview-edit-status')
    if (vStatus) vStatus.textContent = activeFaction === 'viking' ? '● 正在編輯' : '點擊編輯'
    const rStatus = document.querySelector('#overview-card-roman .overview-edit-status')
    if (rStatus) rStatus.textContent = activeFaction === 'roman' ? '● 正在編輯' : '點擊編輯'

    const vRoleBadge = document.getElementById('viking-role-badge')
    if (vRoleBadge) {
      vRoleBadge.textContent = this.config.playerFaction === 'viking' ? '👤 玩家所屬陣營' : '⚔️ 敵方軍團'
    }
    const rRoleBadge = document.getElementById('roman-role-badge')
    if (rRoleBadge) {
      rRoleBadge.textContent = this.config.playerFaction === 'roman' ? '👤 玩家所屬陣營' : '⚔️ 敵方軍團'
    }

    document.getElementById('edit-tab-viking')?.classList.toggle('active', activeFaction === 'viking')
    document.getElementById('edit-tab-roman')?.classList.toggle('active', activeFaction === 'roman')
    document.getElementById('roster-panel-viking')?.classList.toggle('active', activeFaction === 'viking')
    document.getElementById('roster-panel-roman')?.classList.toggle('active', activeFaction === 'roman')

    // 6. Update Battle Type buttons
    document.getElementById('battle-type-ground')?.classList.toggle('active', !isAerial)
    document.getElementById('battle-type-aerial')?.classList.toggle('active', isAerial)

    // Hide/show Map & Formation sections in Aerial mode
    const mapSection = document.getElementById('setup-map-section')
    if (mapSection) mapSection.style.display = isAerial ? 'none' : ''
    const formationSection = document.getElementById('setup-formation-section')
    if (formationSection) formationSection.style.display = isAerial ? 'none' : ''

    // Update Map buttons active state
    const currentMap = this.config.mapId ?? 'original'
    this.container.querySelectorAll<HTMLElement>('[data-map-id]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mapId === currentMap)
    })

    // 7. Update Battle Mode buttons active state
    const currentMode = this.config.mode ?? 'formation'
    document.getElementById('mode-btn-formation')?.classList.toggle('active', currentMode === 'formation')
    document.getElementById('mode-btn-scattered')?.classList.toggle('active', currentMode === 'scattered')

    // 8. Command grouping
    const currentCommandGrouping = this.config.commandGrouping ?? 'preset'
    document.getElementById('command-grouping-preset')?.classList.toggle('active', currentCommandGrouping === 'preset')
    document.getElementById('command-grouping-squad')?.classList.toggle('active', currentCommandGrouping === 'squad')

    // 9. Update Player Faction buttons & Overview role badges
    const currentFaction = this.config.playerFaction ?? 'viking'
    document.getElementById('faction-btn-viking')?.classList.toggle('active', currentFaction === 'viking')
    document.getElementById('faction-btn-roman')?.classList.toggle('active', currentFaction === 'roman')

    const isSpectator = Boolean(this.config.spectator)
    const vBadge = document.getElementById('viking-role-badge')
    const rBadge = document.getElementById('roman-role-badge')
    if (vBadge) {
      vBadge.textContent = isSpectator ? '👁️ 觀戰對象 SPECTATOR' : (currentFaction === 'viking' ? '👤 玩家所屬陣營 PLAYER' : '⚔️ 敵方軍團 ENEMY')
      vBadge.className = `overview-role-badge viking-badge ${isSpectator ? 'spectator' : (currentFaction === 'viking' ? 'player' : 'enemy')}`
    }
    if (rBadge) {
      rBadge.textContent = isSpectator ? '👁️ 觀戰對象 SPECTATOR' : (currentFaction === 'roman' ? '👤 玩家所屬陣營 PLAYER' : '⚔️ 敵方軍團 ENEMY')
      rBadge.className = `overview-role-badge roman-badge ${isSpectator ? 'spectator' : (currentFaction === 'roman' ? 'player' : 'enemy')}`
    }

    // 10. Validation & Start Button
    const validation = validateBattleConfig(this.config)
    const msgEl = document.getElementById('validation-msg')
    const startBtn = document.getElementById('btn-start-battle') as HTMLButtonElement | null
    const hpConfirmed = !needsPlayerHpConfirmation(this.config)

    if (msgEl) {
      if (!validation.valid) {
        msgEl.innerHTML = `<span class="validation-icon">⚠️</span> <span class="validation-text">無法開始戰鬥：${validation.errors.join(' ｜ ')}</span>`
        msgEl.className = 'setup-validation-msg invalid'
      } else if (!hpConfirmed) {
        msgEl.innerHTML = `<span class="validation-icon">⚠️</span> <span class="validation-text">舊設定未記錄來源，請先確認下方玩家生命值設定</span>`
        msgEl.className = 'setup-validation-msg invalid'
      } else {
        msgEl.innerHTML = `<span class="validation-icon">✓</span> <span class="validation-text">戰鬥配置就緒，可隨時展開戰役 BATTLE READY</span>`
        msgEl.className = 'setup-validation-msg valid'
      }
    }

    if (startBtn) {
      startBtn.disabled = !validation.valid || !hpConfirmed
    }
    const startLabel = document.getElementById('btn-start-battle-label')
    const startSubtitle = document.getElementById('btn-start-battle-subtitle')
    const usesSquads = currentCommandGrouping === 'squad'
    if (startLabel) startLabel.textContent = usesSquads ? '選擇小隊' : '開始戰鬥'
    if (startSubtitle) startSubtitle.textContent = usesSquads ? 'ASSIGN SQUADS' : 'START BATTLE'

    // 11. Spectator checkbox
    const spectatorCheckbox = document.getElementById('spectator-checkbox') as HTMLInputElement | null
    if (spectatorCheckbox) {
      spectatorCheckbox.checked = isSpectator
    }

    // 12. HP Source & Value
    const hpSource = document.getElementById('player-hp-source') as HTMLSelectElement | null
    if (hpSource) hpSource.value = this.config.playerHpSource ?? ''
    const playerHpInput = document.getElementById('player-hp-input') as HTMLInputElement | null
    if (playerHpInput) {
      const heroProfile = this.config.playerHeroId ? getT4HeroCombatModifiers(HERO_COMBAT_PROFILE_BY_ASSET[this.config.playerHeroId]) : null
      playerHpInput.value = String(heroProfile?.maxHp ?? resolveOrdinaryPlayerBaseHp(this.config.playerFaction ?? 'viking', resolveOrdinarySoldierTier(this.config.playerVisualTier), this.config))
      playerHpInput.disabled = Boolean(heroProfile)
    }

    // 13. Loadout Tab / Panel
    const loadout = this.config.playerLoadout
    const heroSelect = this.container.querySelector<HTMLSelectElement>('#battle-player-hero')
    if (heroSelect) heroSelect.value = this.config.playerHeroId ?? String(this.config.playerVisualTier ?? '')
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
        const selected = ((el.dataset.loadoutKind === 'melee' && el.dataset.loadoutId === loadout.meleeWeaponId)
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
}
