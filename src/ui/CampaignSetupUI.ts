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
  createDefaultDefenseArmy,
  createDefaultDefensePlayerLoadout,
  validateDefenseCampaignLaunchConfig,
  type DefenseCampaignLaunchConfig,
} from '../campaign/DefenseCampaignLaunch'
import {
  getUnitPresetsForFaction,
  type UnitPresetId,
} from '../battle/UnitPresetCatalog'
import {
  PLAYER_MELEE_WEAPON_IDS,
  PLAYER_RANGED_WEAPON_IDS,
  PLAYER_SHIELD_IDS,
  type PlayerLoadoutConfig,
  type UnitTier,
  type UnitTierCounts,
} from '../battle/BattleConfig'
import { WEAPONS } from '../rpg/WeaponDatabase'
import { ARMORS } from '../rpg/ArmorDatabase'

type CampaignSetupScreen = 'faction' | 'stage' | 'setup'

export class CampaignSetupUI {
  private container: HTMLElement | null = null
  private screen: CampaignSetupScreen = 'faction'
  private defenderFaction: CampaignFaction | null = null
  private stageId: CampaignStageId = 1
  private defenderArmy: Record<string, UnitTierCounts> = {}
  private playerLoadout: PlayerLoadoutConfig | null = null
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
          <span>${playable ? `敵軍 ${stage.attackerArmy.totalUnits} · ${attackerTiers}` : '尚未解鎖'}</span>
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
    const mounted = this._mountedTotal()
    const factionZh = this.defenderFaction === 'roman' ? '羅馬' : '維京'
    const loadout = this.playerLoadout
      ?? createDefaultDefensePlayerLoadout(this.defenderFaction)
    this.playerLoadout = loadout
    const validation = validateDefenseCampaignLaunchConfig(this._buildLaunchConfig())
    const tier2Total = this._tierTotal(2)
    const tier3Total = this._tierTotal(3)
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
        : `總數 ${total}/${stage.defenderDeployment.maxUnits}`
    const rows = presets.map(preset => {
      const counts = this.defenderArmy[preset.id] ?? { 1: 0, 2: 0, 3: 0 }
      const mountedUnit = Boolean(preset.tierLoadouts[2].mountId || preset.tierLoadouts[3].mountId)

      const renderTierControl = (tier: UnitTier): string => {
        const value = counts[tier] ?? 0
        const tierCap = stage.defenderDeployment.tierCapacity[tier]
        const incrementDisabled = value >= this._maxAllowedTierCount(preset.id, tier)

        return `
          <div class="campaign-tier-control">
            <span class="campaign-tier-label">T${tier}</span>
            <div class="campaign-stepper">
              <button type="button" data-dec="${preset.id}" data-tier="${tier}">−</button>
              <input type="number" min="0" max="${tierCap}"
                value="${value}" data-count="${preset.id}" data-tier="${tier}" />
              <button type="button" data-inc="${preset.id}" data-tier="${tier}"
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
          </div>
        </div>
      `
    }).join('')

    this.container.innerHTML = `
      ${this._renderHeader(`DEFENSE CAMPAIGN · STAGE ${this.stageId}`)}
      <div class="campaign-stage-summary">
        <div><small>守方</small><b>${factionZh}</b></div>
        <div><small>部署上限</small><b>${total} / ${stage.defenderDeployment.maxUnits}</b></div>
        <div><small>TIER 配額</small><b>${tierSummaryText}</b></div>
        <div><small>騎兵上限</small><b>${mounted} / ${stage.defenderDeployment.cavalryCap ?? '不限'}</b></div>
        <div><small>部署時間</small><b>${DEFENSE_CAMPAIGN_TIMINGS.deploymentSeconds} 秒</b></div>
        <div><small>敵軍</small><b>${stage.attackerArmy.totalUnits} · ${this._attackerTierLabel(stage.attackerArmy.tierCounts)}</b></div>
      </div>

      <div class="campaign-setup-layout">
        <section class="campaign-army-editor">
          <h2>守軍配置 <small>DEFENDER DEPLOYMENT</small></h2>
          ${rows}
        </section>

        <aside class="campaign-rules-card">
          <h2>STAGE ${this.stageId}</h2>
          <p>本關守軍上限 <b>${stage.defenderDeployment.maxUnits} 人</b>。</p>
          <p>Tier 配額：<b>${tierRuleText}</b>。</p>
          <p>敵軍於部署結束後開始進攻。</p>
          <p>進攻開始 ${DEFENSE_CAMPAIGN_TIMINGS.reinforcementDelaySeconds} 秒後，獲得 <b>${stage.reinforcement.count} 名 T${stage.reinforcement.tier} 刀騎兵</b>援軍。</p>
          <p>敵軍全滅會立即勝利，不需要等待援軍。</p>
          <p>玩家與原始守軍全滅會鎖定敗北；戰場仍可繼續模擬至援軍抵達。</p>
          <hr />
          <p><b>玩家裝備</b></p>
          <label class="campaign-loadout-field">
            <span>近戰</span>
            <select id="campaign-player-melee">
              ${PLAYER_MELEE_WEAPON_IDS.map(id => `
                <option value="${id}" ${loadout.meleeWeaponId === id ? 'selected' : ''}>${WEAPONS[id]?.name ?? id}</option>
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
            <select id="campaign-player-shield">
              <option value="" ${loadout.shieldId === null ? 'selected' : ''}>無盾</option>
              ${PLAYER_SHIELD_IDS.map(id => `
                <option value="${id}" ${loadout.shieldId === id ? 'selected' : ''}>${ARMORS[id]?.name ?? id}</option>
              `).join('')}
            </select>
          </label>
          <label class="campaign-mounted-toggle">
            <input type="checkbox" id="campaign-player-mounted" ${loadout.startMounted ? 'checked' : ''}/>
            玩家騎馬出戰
          </label>
        </aside>
      </div>

      <div class="setup-validation-msg">${validation.valid ? '' : validation.errors.join(' ｜ ')}</div>
      <div class="campaign-actions">
        <button type="button" class="campaign-secondary-btn" id="campaign-back-stage">← 關卡選擇</button>
        <button type="button" class="start-btn" id="campaign-start-stage" ${validation.valid ? '' : 'disabled'}>
          <span>開始戰役</span><small>START CAMPAIGN</small>
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
    this.container.querySelector('#campaign-player-melee')?.addEventListener('change', event => {
      if (!this.playerLoadout) return
      this.playerLoadout.meleeWeaponId = (event.target as HTMLSelectElement).value as PlayerLoadoutConfig['meleeWeaponId']
    })
    this.container.querySelector('#campaign-player-ranged')?.addEventListener('change', event => {
      if (!this.playerLoadout) return
      this.playerLoadout.rangedWeaponId = (event.target as HTMLSelectElement).value as PlayerLoadoutConfig['rangedWeaponId']
    })
    this.container.querySelector('#campaign-player-shield')?.addEventListener('change', event => {
      if (!this.playerLoadout) return
      const value = (event.target as HTMLSelectElement).value
      this.playerLoadout.shieldId = value
        ? value as PlayerLoadoutConfig['shieldId']
        : null
    })
    this.container.querySelector('#campaign-player-mounted')?.addEventListener('change', event => {
      if (!this.playerLoadout) return
      this.playerLoadout.startMounted = (event.target as HTMLInputElement).checked
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
    })
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
    }
  }

  private _cloneArmy(): Record<string, UnitTierCounts> {
    const clone: Record<string, UnitTierCounts> = {}
    for (const [key, counts] of Object.entries(this.defenderArmy)) {
      clone[key] = { 1: counts[1], 2: counts[2], 3: counts[3] }
    }
    return clone
  }

  private _setTierCount(presetId: UnitPresetId, tier: UnitTier, value: number): void {
    const counts = this.defenderArmy[presetId] ?? { 1: 0, 2: 0, 3: 0 }
    const maxAllowed = this._maxAllowedTierCount(presetId, tier)

    counts[tier] = Math.max(0, Math.min(maxAllowed, Math.floor(value)))
    this.defenderArmy[presetId] = counts
    this._render()
  }

  private _maxAllowedTierCount(presetId: UnitPresetId, tier: UnitTier): number {
    const stage = getDefenseCampaignStage(this.stageId)
    const rules = stage.defenderDeployment
    const counts = this.defenderArmy[presetId] ?? { 1: 0, 2: 0, 3: 0 }
    const current = counts[tier] ?? 0
    const totalWithoutCurrent = this._armyTotal() - current
    const tierWithoutCurrent = this._tierTotal(tier) - current

    let maxAllowed = Math.min(
      Math.max(0, rules.maxUnits - totalWithoutCurrent),
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

  private _attackerTierLabel(counts: Readonly<Record<UnitTier, number>>): string {
    return ([1, 2, 3] as UnitTier[])
      .filter(tier => counts[tier] > 0)
      .map(tier => `T${tier} ${counts[tier]}`)
      .join(' + ')
  }

  private _tierTotal(tier: UnitTier): number {
    let total = 0
    for (const counts of Object.values(this.defenderArmy)) {
      total += counts[tier]
    }
    return total
  }

  private _armyTotal(): number {
    let total = 0
    for (const counts of Object.values(this.defenderArmy)) {
      total += counts[1] + counts[2] + counts[3]
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
      for (const tier of [1, 2, 3] as const) {
        if (preset.tierLoadouts[tier].mountId) total += counts[tier]
      }
    }
    return total
  }
}
