import './battle-setup.css'
import {
  DEFENSE_CAMPAIGN_TIMINGS,
  getDefenseCampaignStage,
  isCampaignStageId,
  type CampaignFaction,
  type CampaignStageId,
} from '../campaign/CampaignConfig'
import {
  getDefenseCampaignUnlockedStage,
  type DefenseCampaignSetupTarget,
} from '../campaign/CampaignProgress'
import {
  CAMPAIGN_DEFENDER_HERO_CAP,
  createDefaultDefenseArmy,
  createDefaultDefensePlayerLoadout,
  validateDefenseCampaignLaunchConfig,
  validateDefenseCampaignSquadAssignments,
  type DefenseCampaignLaunchConfig,
} from '../campaign/DefenseCampaignLaunch'
import {
  getUnitPresetsForFaction,
  type UnitPresetId,
  type BaseUnitTier,
  type UnitTier,
  BASE_UNIT_TIERS,
  CUSTOM_BATTLE_UNIT_TIERS,
} from '../battle/UnitPresetCatalog'
import {
  PLAYER_MELEE_SELECTION_IDS,
  PLAYER_RANGED_WEAPON_IDS,
  PLAYER_SHIELD_IDS,
  type PlayerLoadoutConfig,
  type PlayerMountId,
  type UnitTierCounts,
} from '../battle/BattleConfig'
import { HERO_ASSET_IDS, HERO_ASSETS, getHeroFixedEquipment, type PlayerHeroId } from '../world/HeroAssetCatalog'
import { T4_UNIT_PROFILES } from '../battle/T4HeroCatalog'
import { WEAPONS } from '../rpg/WeaponDatabase'
import { ARMORS } from '../rpg/ArmorDatabase'
import {
  MAX_COMMAND_SQUAD_SIZE,
  MAX_COMMAND_SQUADS,
  type CommandGroupingMode,
  type SquadAssignment,
  type SquadId,
} from '../battle/CommandTarget'

type CampaignSetupScreen = 'faction' | 'stage' | 'setup' | 'squad'

export class CampaignSetupUI {
  private container: HTMLElement | null = null
  private screen: CampaignSetupScreen = 'faction'
  private defenderFaction: CampaignFaction | null = null
  private stageId: CampaignStageId = 1
  private defenderArmy: Record<string, UnitTierCounts> = {}
  private playerLoadout: PlayerLoadoutConfig | null = null
  private playerHeroId: PlayerHeroId | null = null
  private commandGrouping: CommandGroupingMode = 'preset'
  private squadAssignments: SquadAssignment[] = []
  private selectedSquadId: SquadId = 1
  private onStartCallback: ((config: DefenseCampaignLaunchConfig) => void) | null = null
  private onBackCallback: (() => void) | null = null

  mount(
    parent: HTMLElement = document.body,
    onStart: (config: DefenseCampaignLaunchConfig) => void,
    onBack: () => void,
    initialTarget?: DefenseCampaignSetupTarget,
  ): void {
    this.destroy()
    this.onStartCallback = onStart
    this.onBackCallback = onBack
    this.screen = 'faction'
    this.defenderFaction = null
    this.stageId = 1
    this.defenderArmy = {}
    this.playerLoadout = null
    this.commandGrouping = 'preset'
    this.squadAssignments = []
    this.selectedSquadId = 1

    if (
      initialTarget
      && initialTarget.stageId <= getDefenseCampaignUnlockedStage(initialTarget.defenderFaction)
    ) {
      this.defenderFaction = initialTarget.defenderFaction
      this.stageId = initialTarget.stageId
      this.defenderArmy = createDefaultDefenseArmy(
        initialTarget.defenderFaction,
        initialTarget.stageId,
      )
      this.playerLoadout = createDefaultDefensePlayerLoadout(initialTarget.defenderFaction)
      this.screen = 'setup'
    }

    this.container = document.createElement('div')
    this.container.id = 'campaign-setup-container'
    parent.appendChild(this.container)
    this._render()
  }

  destroy(): void {
    this.container?.remove()
    this.container = null
  }

  private _render(): void {
    if (!this.container) return
    if (this.screen === 'faction') this._renderFactionSelect()
    else if (this.screen === 'stage') this._renderStageSelect()
    else if (this.screen === 'squad') this._renderSquadSetup()
    else this._renderStageSetup()
  }

  private _renderHeader(subtitle: string): string {
    return `
      <button type="button" class="setup-back-btn" id="campaign-page-back">← 上一頁</button>
      <div class="setup-header campaign-header">
        <h1 class="setup-title">SAGABURST</h1>
        <div class="setup-subtitle">${subtitle}</div>
      </div>
    `
  }

  private _renderFactionSelect(): void {
    if (!this.container) return
    this.container.innerHTML = `
      ${this._renderHeader('DEFENSE CAMPAIGN')}
      <div class="campaign-section-title">選擇防守陣營 <small>CHOOSE DEFENDER</small></div>
      <div class="campaign-faction-grid">
        <button type="button" class="campaign-faction-card roman" data-faction="roman">
          <strong>羅馬防守</strong>
          <span>ROMAN DEFENSE</span>
          <small>守住南方羅馬前哨站，抵禦維京攻勢</small>
        </button>
        <button type="button" class="campaign-faction-card viking" data-faction="viking">
          <strong>維京防守</strong>
          <span>VIKING DEFENSE</span>
          <small>守住北方維京前哨站，迎擊羅馬軍團</small>
        </button>
      </div>
      <div class="campaign-actions">
        <button type="button" class="campaign-secondary-btn" id="campaign-back-home">← 回首頁</button>
      </div>
    `

    this.container.querySelectorAll<HTMLElement>('[data-faction]').forEach(button => {
      button.addEventListener('click', () => {
        const faction = button.dataset.faction
        if (faction !== 'roman' && faction !== 'viking') return
        this.defenderFaction = faction
        this.stageId = 1
        this.defenderArmy = createDefaultDefenseArmy(faction, this.stageId)
        this.playerLoadout = createDefaultDefensePlayerLoadout(faction)
        this.squadAssignments = []
        this.selectedSquadId = 1
        this.screen = 'stage'
        this._render()
      })
    })
    const backHome = () => this.onBackCallback?.()
    this.container.querySelector('#campaign-back-home')?.addEventListener('click', backHome)
    this.container.querySelector('#campaign-page-back')?.addEventListener('click', backHome)
  }

  private _renderStageSelect(): void {
    if (!this.container || !this.defenderFaction) return
    const factionLabel = this.defenderFaction === 'roman' ? '羅馬防守' : '維京防守'
    const unlockedStage = getDefenseCampaignUnlockedStage(this.defenderFaction)
    const stageCards = Array.from({ length: 9 }, (_, index) => {
      const stageId = (index + 1) as CampaignStageId
      const playable = stageId <= unlockedStage
      const stage = getDefenseCampaignStage(stageId)
      const attackerTiers = this._attackerTierLabel(stage.attackerArmy.tierCounts)
      return `
        <button type="button"
          class="campaign-stage-card ${playable ? 'playable' : 'locked'}"
          data-stage="${stageId}"
          ${playable ? '' : 'disabled'}>
          <b>STAGE ${stageId}</b>
          <span>${playable ? `敵軍 ${stage.attackerArmy.totalUnits + 2} · ${attackerTiers} + T4 2` : '尚未解鎖'}</span>
          <small>${playable ? 'OUTPOST DEFENSE' : `CLEAR STAGE ${stageId - 1}`}</small>
        </button>
      `
    }).join('')

    this.container.innerHTML = `
      ${this._renderHeader('DEFENSE CAMPAIGN')}
      <div class="campaign-section-title">${factionLabel} <small>STAGE SELECT</small></div>
      <div class="campaign-stage-grid">${stageCards}</div>
      <div class="campaign-actions">
        <button type="button" class="campaign-secondary-btn" id="campaign-back-faction">← 重新選擇陣營</button>
      </div>
    `

    this.container.querySelectorAll<HTMLElement>('[data-stage]:not([disabled])').forEach(button => {
      button.addEventListener('click', () => {
        const value = Number(button.dataset.stage)
        if (!isCampaignStageId(value)) return
        this.stageId = value
        this.defenderArmy = createDefaultDefenseArmy(this.defenderFaction!, this.stageId)
        this.squadAssignments = []
        this.selectedSquadId = 1
        this.screen = 'setup'
        this._render()
      })
    })
    const backToFaction = () => {
      this.screen = 'faction'
      this._render()
    }
    this.container.querySelector('#campaign-back-faction')?.addEventListener('click', backToFaction)
    this.container.querySelector('#campaign-page-back')?.addEventListener('click', backToFaction)
  }

  private _renderStageSetup(): void {
    if (!this.container || !this.defenderFaction) return
    const stage = getDefenseCampaignStage(this.stageId)
    const presets = getUnitPresetsForFaction(this.defenderFaction)
    const total = this._armyTotal()
    const ordinaryTotal = total - this._tierTotal(4)
    const mounted = this._mountedTotal()
    const factionZh = this.defenderFaction === 'roman' ? '羅馬' : '維京'
    const fixedEquipment = getHeroFixedEquipment(this.playerHeroId)
    const loadout = this.playerLoadout
      ?? createDefaultDefensePlayerLoadout(this.defenderFaction)
    this.playerLoadout = loadout
    const validation = validateDefenseCampaignLaunchConfig(this._buildLaunchConfig())
    const tier2Total = this._tierTotal(2)
    const tier3Total = this._tierTotal(3)
    const heroTotal = this._tierTotal(4)
    const upperTierPoolCap = stage.defenderDeployment.upperTierPoolCap
    const tier3Cap = stage.defenderDeployment.tierCapacity[3]
    const tierRuleText = upperTierPoolCap !== null
      ? tier3Cap < upperTierPoolCap
        ? `T2+T3 ≤ ${upperTierPoolCap} · T3 ≤ ${tier3Cap}`
        : `T2+T3 ≤ ${upperTierPoolCap}`
      : tier3Cap < stage.defenderDeployment.maxUnits
        ? `T3 ≤ ${tier3Cap}`
        : '依守軍總人數上限'
    const tierSummaryText = upperTierPoolCap !== null
      ? tier3Cap < upperTierPoolCap
        ? `T2+T3 ${tier2Total + tier3Total}/${upperTierPoolCap} · T3 ${tier3Total}/${tier3Cap}`
        : `T2+T3 ${tier2Total + tier3Total}/${upperTierPoolCap}`
      : tier3Cap < stage.defenderDeployment.maxUnits
        ? `T3 ${tier3Total}/${tier3Cap}`
        : `一般兵力 ${ordinaryTotal}/${stage.defenderDeployment.maxUnits}`
    const rows = presets.map(preset => {
      const counts = this.defenderArmy[preset.id] ?? { 1: 0, 2: 0, 3: 0 }
      const mountedUnit = Boolean(preset.tierLoadouts[2].mountId || preset.tierLoadouts[3].mountId)
      const heroName = HERO_ASSETS[T4_UNIT_PROFILES[preset.id].visualAssetId].nameZh

      const renderTierControl = (tier: UnitTier): string => {
        const value = counts[tier] ?? 0
        const tierCap = tier === 4 ? CAMPAIGN_DEFENDER_HERO_CAP : stage.defenderDeployment.tierCapacity[tier]
        const incrementDisabled = value >= this._maxAllowedTierCount(preset.id, tier)

        return `
          <div class="campaign-tier-control">
            <span class="campaign-tier-label" title="${tier === 4 ? heroName : ''}">T${tier}</span>
            <div class="campaign-stepper">
              <button type="button" data-testid="campaign-${preset.id}-t${tier}-dec" data-dec="${preset.id}" data-tier="${tier}">−</button>
              <input type="number" min="0" max="${tierCap}"
                value="${value}" data-testid="campaign-${preset.id}-t${tier}-count" data-count="${preset.id}" data-tier="${tier}" />
              <button type="button" data-testid="campaign-${preset.id}-t${tier}-inc" data-inc="${preset.id}" data-tier="${tier}"
                ${incrementDisabled ? 'disabled' : ''}>＋</button>
            </div>
          </div>
        `
      }

      return `
        <div class="campaign-unit-row">
          <div class="campaign-unit-name">
            <b>${preset.nameZh}</b>
            <span>${preset.nameEn}</span>
            ${mountedUnit ? '<small>騎兵</small>' : '<small>步兵</small>'}
          </div>
          <div class="campaign-tier-controls">
            ${renderTierControl(1)}
            ${renderTierControl(2)}
            ${renderTierControl(3)}
            ${renderTierControl(4)}
          </div>
        </div>
      `
    }).join('')

    this.container.innerHTML = `
      ${this._renderHeader(`DEFENSE CAMPAIGN · STAGE ${this.stageId}`)}
      <div class="setup-mode-section campaign-command-grouping-section">
        <div class="mode-section-label">指揮分組 <small>COMMAND GROUPING</small></div>
        <div class="mode-btn-group">
          <button type="button" class="mode-btn ${this.commandGrouping === 'preset' ? 'active' : ''}" id="campaign-command-grouping-preset">
            <span class="mode-btn-title">兵種</span>
            <span class="mode-btn-desc">UNIT PRESETS</span>
          </button>
          <button type="button" class="mode-btn ${this.commandGrouping === 'squad' ? 'active' : ''}" id="campaign-command-grouping-squad">
            <span class="mode-btn-title">小隊</span>
            <span class="mode-btn-desc">SQUADS · UP TO 8</span>
          </button>
        </div>
      </div>
      <div class="campaign-stage-summary">
        <div><small>守方</small><b>${factionZh}</b></div>
        <div><small>守軍總數</small><b>${total}（一般 ${ordinaryTotal}/${stage.defenderDeployment.maxUnits} + T4 ${heroTotal}）</b></div>
        <div><small>TIER 配額</small><b>${tierSummaryText} · T4 ${heroTotal}/${CAMPAIGN_DEFENDER_HERO_CAP}</b></div>
        <div><small>一般騎兵上限</small><b>${mounted} / ${stage.defenderDeployment.cavalryCap ?? '不限'}</b></div>
        <div><small>部署時間</small><b>${DEFENSE_CAMPAIGN_TIMINGS.deploymentSeconds} 秒</b></div>
        <div><small>敵軍</small><b>${stage.attackerArmy.totalUnits + 2} · ${this._attackerTierLabel(stage.attackerArmy.tierCounts)} + T4 2</b></div>
      </div>

      <div class="campaign-setup-layout">
        <section class="campaign-army-editor">
          <h2>守軍配置 <small>DEFENDER DEPLOYMENT</small></h2>
          ${rows}
        </section>

        <aside class="campaign-rules-card">
          <h2>STAGE ${this.stageId}</h2>
          <p>本關一般守軍上限 <b>${stage.defenderDeployment.maxUnits} 人</b>；T4 英雄額外加入，不佔一般兵力與騎兵名額。</p>
          <p>Tier 配額：<b>${tierRuleText}</b>。</p>
          <p>守方可選 <b>${CAMPAIGN_DEFENDER_HERO_CAP} 名 T4 英雄</b>；攻方固定 <b>2 名 T4 英雄</b>。雙方英雄都增加總兵力。</p>
          <p>敵軍於部署結束後開始進攻。</p>
          <p>進攻開始 ${DEFENSE_CAMPAIGN_TIMINGS.reinforcementDelaySeconds} 秒後，獲得 <b>${stage.reinforcement.count} 名 T${stage.reinforcement.tier} ${this.defenderFaction === 'viking' ? '斧騎兵' : '刀騎兵'}</b>援軍。</p>
          <p>敵軍全滅會立即勝利，不需要等待援軍。</p>
          <p>玩家與原始守軍全滅會鎖定敗北；戰場仍可繼續模擬至援軍抵達。</p>
          <hr />
          <p><b>玩家裝備</b></p>
          <label class="campaign-loadout-field">
            <span>玩家角色 / PLAYER CHARACTER</span>
            <select id="campaign-player-hero">
              <option value="" ${!this.playerHeroId ? 'selected' : ''}>一般士兵 Standard</option>
              ${HERO_ASSET_IDS.map(id => `<option value="${id}" ${this.playerHeroId === id ? 'selected' : ''}>${HERO_ASSETS[id].nameZh} T4 · ${HERO_ASSETS[id].nameEn}</option>`).join('')}
            </select>
          </label>
          <label class="campaign-loadout-field">
            <span>近戰</span>
            <select id="campaign-player-melee" ${fixedEquipment ? 'disabled' : ''}>
              ${fixedEquipment ? '<option selected>T4 弓（近戰）</option>' : ''}
              ${PLAYER_MELEE_SELECTION_IDS.map(id => `
                <option value="${id}" ${!fixedEquipment && loadout.meleeWeaponId === id ? 'selected' : ''}>${WEAPONS[id]?.name ?? id}</option>
              `).join('')}
            </select>
          </label>
          <label class="campaign-loadout-field">
            <span>遠程</span>
            <select id="campaign-player-ranged">
              ${PLAYER_RANGED_WEAPON_IDS.map(id => `
                <option value="${id}" ${loadout.rangedWeaponId === id ? 'selected' : ''}>${WEAPONS[id]?.name ?? id}</option>
              `).join('')}
            </select>
          </label>
          <label class="campaign-loadout-field">
            <span>盾牌</span>
            <select id="campaign-player-shield" ${fixedEquipment ? 'disabled' : ''}>
              <option value="" ${fixedEquipment || loadout.shieldId === null ? 'selected' : ''}>無盾</option>
              ${PLAYER_SHIELD_IDS.map(id => `
                <option value="${id}" ${!fixedEquipment && loadout.shieldId === id ? 'selected' : ''}>${ARMORS[id]?.name ?? id}</option>
              `).join('')}
            </select>
          </label>
          <label class="campaign-mounted-toggle">
            <input type="checkbox" id="campaign-player-mounted" ${loadout.startMounted ? 'checked' : ''}/>
            玩家騎乘出戰
          </label>
          <label class="campaign-loadout-field">
            <span>坐騎</span>
            <select id="campaign-player-mount">
              <option value="black-cat" ${loadout.mountId === 'black-cat' ? 'selected' : ''}>黑貓</option>
              <option value="corgi" ${loadout.mountId === 'corgi' ? 'selected' : ''}>柯基</option>
              <option value="horse" ${!loadout.mountId || loadout.mountId === 'horse' ? 'selected' : ''}>馬</option>
            </select>
          </label>
        </aside>
      </div>

      <div class="setup-validation-msg">${validation.valid ? '' : validation.errors.join(' ｜ ')}</div>
      <div class="campaign-actions">
        <button type="button" class="campaign-secondary-btn" id="campaign-back-stage">← 關卡選擇</button>
        <button type="button" class="start-btn" id="campaign-start-stage" ${validation.valid ? '' : 'disabled'}>
          <span>${this.commandGrouping === 'squad' ? '選擇小隊' : '開始戰役'}</span>
          <small>${this.commandGrouping === 'squad' ? 'ASSIGN SQUADS' : 'START CAMPAIGN'}</small>
        </button>
      </div>
    `

    this.container.querySelectorAll<HTMLElement>('[data-inc]').forEach(button => {
      button.addEventListener('click', () => {
        this._adjust(
          button.dataset.inc as UnitPresetId,
          Number(button.dataset.tier) as UnitTier,
          1,
        )
      })
    })
    this.container.querySelectorAll<HTMLElement>('[data-dec]').forEach(button => {
      button.addEventListener('click', () => {
        this._adjust(
          button.dataset.dec as UnitPresetId,
          Number(button.dataset.tier) as UnitTier,
          -1,
        )
      })
    })
    this.container.querySelectorAll<HTMLInputElement>('[data-count]').forEach(input => {
      input.addEventListener('change', () => {
        const parsed = Number.parseInt(input.value, 10)
        this._setTierCount(
          input.dataset.count as UnitPresetId,
          Number(input.dataset.tier) as UnitTier,
          Number.isFinite(parsed) ? parsed : 0,
        )
      })
    })
    this.container.querySelector('#campaign-command-grouping-preset')?.addEventListener('click', () => {
      this.commandGrouping = 'preset'
      this.squadAssignments = []
      this._render()
    })
    this.container.querySelector('#campaign-command-grouping-squad')?.addEventListener('click', () => {
      this.commandGrouping = 'squad'
      this._render()
    })
    this.container.querySelector('#campaign-player-melee')?.addEventListener('change', event => {
      if (!this.playerLoadout || getHeroFixedEquipment(this.playerHeroId)) return
      this.playerLoadout.meleeWeaponId = (event.target as HTMLSelectElement).value as PlayerLoadoutConfig['meleeWeaponId']
    })
    this.container.querySelector('#campaign-player-hero')?.addEventListener('change', event => {
      this.playerHeroId = (event.target as HTMLSelectElement).value as PlayerHeroId || null
      this._render()
    })
    this.container.querySelector('#campaign-player-ranged')?.addEventListener('change', event => {
      if (!this.playerLoadout) return
      this.playerLoadout.rangedWeaponId = (event.target as HTMLSelectElement).value as PlayerLoadoutConfig['rangedWeaponId']
    })
    this.container.querySelector('#campaign-player-shield')?.addEventListener('change', event => {
      if (!this.playerLoadout || getHeroFixedEquipment(this.playerHeroId)) return
      const value = (event.target as HTMLSelectElement).value
      this.playerLoadout.shieldId = value
        ? value as PlayerLoadoutConfig['shieldId']
        : null
    })
    this.container.querySelector('#campaign-player-mounted')?.addEventListener('change', event => {
      if (!this.playerLoadout) return
      this.playerLoadout.startMounted = (event.target as HTMLInputElement).checked
    })
    this.container.querySelector('#campaign-player-mount')?.addEventListener('change', event => {
      if (!this.playerLoadout) return
      this.playerLoadout.mountId = (event.target as HTMLSelectElement).value as PlayerMountId
    })
    const backToStage = () => {
      this.screen = 'stage'
      this._render()
    }
    this.container.querySelector('#campaign-back-stage')?.addEventListener('click', backToStage)
    this.container.querySelector('#campaign-page-back')?.addEventListener('click', backToStage)
    this.container.querySelector('#campaign-start-stage')?.addEventListener('click', () => {
      const config = this._buildLaunchConfig()
      const result = validateDefenseCampaignLaunchConfig(config)
      if (!result.valid || !this.onStartCallback) return

      if (this.commandGrouping === 'squad') {
        this.screen = 'squad'
        this.selectedSquadId = 1
        this._render()
        return
      }

      this._launchCampaign(config)
    })
  }

  private _renderSquadSetup(): void {
    if (!this.container || !this.defenderFaction) return

    const presets = new Map(
      getUnitPresetsForFaction(this.defenderFaction).map(preset => [preset.id, preset]),
    )
    const rows: Array<{ presetId: UnitPresetId; tier: UnitTier; count: number; nameZh: string; nameEn: string }> = []
    for (const [presetKey, counts] of Object.entries(this.defenderArmy)) {
      const presetId = presetKey as UnitPresetId
      const preset = presets.get(presetId)
      if (!preset) continue
      for (const tier of CUSTOM_BATTLE_UNIT_TIERS) {
        const count = counts[tier] ?? 0
        if (count <= 0) continue
        rows.push({ presetId, tier, count, nameZh: preset.nameZh, nameEn: preset.nameEn })
      }
    }

    const squadTotals = new Map<SquadId, number>()
    for (let id = 1; id <= MAX_COMMAND_SQUADS; id++) {
      squadTotals.set(id as SquadId, this._squadTotal(id as SquadId))
    }
    const totalAssigned = this.squadAssignments.reduce((sum, assignment) => sum + assignment.count, 0)
    const totalArmy = this._armyTotal()
    const unassigned = Math.max(0, totalArmy - totalAssigned)
    const selectedTotal = squadTotals.get(this.selectedSquadId) ?? 0

    const squadButtons = Array.from({ length: MAX_COMMAND_SQUADS }, (_, index) => {
      const squadId = (index + 1) as SquadId
      const total = squadTotals.get(squadId) ?? 0
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

    const config = this._buildLaunchConfig()
    const assignmentValidation = validateDefenseCampaignSquadAssignments(config)
    const canStart = unassigned === 0 && assignmentValidation.valid
    const validationMessage = unassigned > 0
      ? `尚有 ${unassigned} 名士兵未分配小隊`
      : assignmentValidation.valid
        ? ''
        : assignmentValidation.errors.join(' ｜ ')

    this.container.innerHTML = `
      ${this._renderHeader(`DEFENSE CAMPAIGN · STAGE ${this.stageId}`)}
      <div class="campaign-section-title">小隊編組 <small>SQUAD ASSIGNMENT</small></div>
      <div class="campaign-squad-summary">
        <div><small>總兵力</small><b>${totalArmy}</b></div>
        <div><small>已分配</small><b>${totalAssigned}</b></div>
        <div class="${unassigned > 0 ? 'warning' : ''}"><small>未分配</small><b>${unassigned}</b></div>
        <div><small>單隊上限</small><b>${MAX_COMMAND_SQUAD_SIZE}</b></div>
      </div>

      <div class="campaign-squad-tabs">${squadButtons}</div>

      <section class="campaign-squad-editor">
        <div class="campaign-squad-editor-heading">
          <div>
            <h2>第 ${this.selectedSquadId} 隊</h2>
            <small>SQUAD ${this.selectedSquadId}</small>
          </div>
          <strong>${selectedTotal} / ${MAX_COMMAND_SQUAD_SIZE}</strong>
        </div>
        <div class="campaign-squad-unit-list">${allocationRows}</div>
      </section>

      <div class="setup-validation-msg">${validationMessage}</div>
      <div class="campaign-actions">
        <button type="button" class="campaign-secondary-btn" id="campaign-back-setup">← 返回守軍配置</button>
        <button type="button" class="start-btn" id="campaign-confirm-squads" ${canStart ? '' : 'disabled'}>
          <span>開始戰役</span><small>START CAMPAIGN</small>
        </button>
      </div>
    `

    this.container.querySelectorAll<HTMLElement>('[data-command-squad]').forEach(button => {
      button.addEventListener('click', () => {
        const value = Number(button.dataset.commandSquad)
        if (value < 1 || value > MAX_COMMAND_SQUADS) return
        this.selectedSquadId = value as SquadId
        this._render()
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

    const backToSetup = () => {
      this.screen = 'setup'
      this._render()
    }
    this.container.querySelector('#campaign-back-setup')?.addEventListener('click', backToSetup)
    this.container.querySelector('#campaign-page-back')?.addEventListener('click', backToSetup)
    this.container.querySelector('#campaign-confirm-squads')?.addEventListener('click', () => {
      const launch = this._buildLaunchConfig()
      const baseValidation = validateDefenseCampaignLaunchConfig(launch)
      const squadValidation = validateDefenseCampaignSquadAssignments(launch)
      if (!baseValidation.valid || !squadValidation.valid) return
      this._launchCampaign(launch)
    })
  }

  private _squadAssignmentCount(presetId: UnitPresetId, tier: UnitTier, squadId: SquadId): number {
    return this.squadAssignments.find(assignment => (
      assignment.presetId === presetId
      && assignment.tier === tier
      && assignment.squadId === squadId
    ))?.count ?? 0
  }

  private _squadAssignedUnitTotal(presetId: UnitPresetId, tier: UnitTier): number {
    return this.squadAssignments
      .filter(assignment => assignment.presetId === presetId && assignment.tier === tier)
      .reduce((sum, assignment) => sum + assignment.count, 0)
  }

  private _squadTotal(squadId: SquadId): number {
    return this.squadAssignments
      .filter(assignment => assignment.squadId === squadId)
      .reduce((sum, assignment) => sum + assignment.count, 0)
  }

  private _adjustSquadAssignment(presetId: UnitPresetId, tier: UnitTier, delta: number): void {
    const current = this._squadAssignmentCount(presetId, tier, this.selectedSquadId)
    this._setSquadAssignmentCount(presetId, tier, current + delta)
  }

  private _setSquadAssignmentCount(presetId: UnitPresetId, tier: UnitTier, value: number): void {
    const deployed = this.defenderArmy[presetId]?.[tier] ?? 0
    const current = this._squadAssignmentCount(presetId, tier, this.selectedSquadId)
    const assignedOtherSquads = this._squadAssignedUnitTotal(presetId, tier) - current
    const otherUnitsInSquad = this._squadTotal(this.selectedSquadId) - current
    const maxAllowed = Math.max(0, Math.min(
      deployed - assignedOtherSquads,
      MAX_COMMAND_SQUAD_SIZE - otherUnitsInSquad,
    ))
    const next = Math.max(0, Math.min(maxAllowed, Math.floor(value)))
    const index = this.squadAssignments.findIndex(assignment => (
      assignment.presetId === presetId
      && assignment.tier === tier
      && assignment.squadId === this.selectedSquadId
    ))

    if (next === 0) {
      if (index >= 0) this.squadAssignments.splice(index, 1)
    } else if (index >= 0) {
      this.squadAssignments[index].count = next
    } else {
      this.squadAssignments.push({
        presetId,
        tier,
        squadId: this.selectedSquadId,
        count: next,
      })
    }
    this._render()
  }

  private _launchCampaign(config: DefenseCampaignLaunchConfig): void {
    if (!this.onStartCallback) return
    if (!window.location.search.includes('nolock')) {
      try {
        const target = document.getElementById('canvas-container') || document.body
        const promise = target.requestPointerLock?.()
        if (promise && typeof (promise as Promise<void>).catch === 'function') {
          ;(promise as Promise<void>).catch(() => {})
        }
      } catch {
        // Pointer lock is optional during launch.
      }
    }
    this.destroy()
    this.onStartCallback(config)
  }
  private _buildLaunchConfig(): DefenseCampaignLaunchConfig {
    const playerLoadout = this.playerLoadout
      ?? createDefaultDefensePlayerLoadout(this.defenderFaction!)
    return {
      type: 'defense',
      defenderFaction: this.defenderFaction!,
      stageId: this.stageId,
      defenderArmy: this._cloneArmy(),
      playerLoadout: { ...playerLoadout },
      playerHeroId: this.playerHeroId,
      commandGrouping: this.commandGrouping,
      squadAssignments: this.commandGrouping === 'squad'
        ? this.squadAssignments.map(assignment => ({ ...assignment }))
        : undefined,
    }
  }

  private _cloneArmy(): Record<string, UnitTierCounts> {
    const clone: Record<string, UnitTierCounts> = {}
    for (const [key, counts] of Object.entries(this.defenderArmy)) {
      clone[key] = { 1: counts[1], 2: counts[2], 3: counts[3], 4: counts[4] ?? 0 }
    }
    return clone
  }

  private _setTierCount(presetId: UnitPresetId, tier: UnitTier, value: number): void {
    const counts = this.defenderArmy[presetId] ?? { 1: 0, 2: 0, 3: 0 }
    const maxAllowed = this._maxAllowedTierCount(presetId, tier)

    const nextValue = Math.max(0, Math.min(maxAllowed, Math.floor(value)))
    if (counts[tier] !== nextValue) this.squadAssignments = []
    counts[tier] = nextValue
    this.defenderArmy[presetId] = counts
    this._render()
  }

  private _maxAllowedTierCount(presetId: UnitPresetId, tier: UnitTier): number {
    const stage = getDefenseCampaignStage(this.stageId)
    const rules = stage.defenderDeployment
    const counts = this.defenderArmy[presetId] ?? { 1: 0, 2: 0, 3: 0 }
    const current = counts[tier] ?? 0
    const ordinaryTotalWithoutCurrent = this._armyTotal() - this._tierTotal(4) - (tier === 4 ? 0 : current)
    const tierWithoutCurrent = this._tierTotal(tier) - current

    if (tier === 4) {
      return Math.max(0, CAMPAIGN_DEFENDER_HERO_CAP - tierWithoutCurrent)
    }

    let maxAllowed = Math.min(
      Math.max(0, rules.maxUnits - ordinaryTotalWithoutCurrent),
      Math.max(0, rules.tierCapacity[tier] - tierWithoutCurrent),
    )

    if (this.defenderFaction) {
      const preset = getUnitPresetsForFaction(this.defenderFaction)
        .find(candidate => candidate.id === presetId)
      if (preset?.tierLoadouts[tier].mountId && rules.cavalryCap !== null) {
        const mountedWithoutCurrent = this._mountedTotal() - current
        maxAllowed = Math.min(
          maxAllowed,
          Math.max(0, rules.cavalryCap - mountedWithoutCurrent),
        )
      }
    }

    const tierTotals = {
      1: this._tierTotal(1),
      2: this._tierTotal(2),
      3: this._tierTotal(3),
    }
    for (; maxAllowed >= 0; maxAllowed--) {
      const candidateTotals = {
        ...tierTotals,
        [tier]: tierWithoutCurrent + maxAllowed,
      }
      const upperTierPoolValid = rules.upperTierPoolCap === null
        || candidateTotals[2] + candidateTotals[3] <= rules.upperTierPoolCap
      if (upperTierPoolValid) {
        return maxAllowed
      }
    }
    return 0
  }

  private _adjust(presetId: UnitPresetId, tier: UnitTier, delta: number): void {
    const current = this.defenderArmy[presetId]?.[tier] ?? 0
    this._setTierCount(presetId, tier, current + delta)
  }

  private _attackerTierLabel(counts: Readonly<Record<BaseUnitTier, number>>): string {
    return ([1, 2, 3] as BaseUnitTier[])
      .filter(tier => counts[tier] > 0)
      .map(tier => `T${tier} ${counts[tier]}`)
      .join(' + ')
  }

  private _tierTotal(tier: UnitTier): number {
    let total = 0
    for (const counts of Object.values(this.defenderArmy)) {
      total += counts[tier] ?? 0
    }
    return total
  }

  private _armyTotal(): number {
    let total = 0
    for (const counts of Object.values(this.defenderArmy)) {
      total += counts[1] + counts[2] + counts[3] + (counts[4] ?? 0)
    }
    return total
  }

  private _mountedTotal(): number {
    if (!this.defenderFaction) return 0
    const presets = new Map(
      getUnitPresetsForFaction(this.defenderFaction).map(preset => [preset.id, preset]),
    )
    let total = 0
    for (const [presetId, counts] of Object.entries(this.defenderArmy)) {
      const preset = presets.get(presetId as UnitPresetId)
      if (!preset) continue
      for (const tier of BASE_UNIT_TIERS) {
        if (preset.tierLoadouts[tier].mountId) total += counts[tier] ?? 0
      }
    }
    return total
  }
}
