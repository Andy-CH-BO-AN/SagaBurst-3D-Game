import './battle-setup.css'
import { COMBAT_BALANCE } from '../combat/CombatBalance'
import { WEAPONS } from '../rpg/WeaponDatabase'
import { ARMORS } from '../rpg/ArmorDatabase'
import {
  getUnitPresetsForFaction,
  getTraitDescription,
  type UnitTier,
} from '../battle/UnitPresetCatalog'

type ReferenceSubTab = 'balance' | 'viking' | 'roman' | 'weapons' | 'shields'

export class BattleReferenceUI {
  private container: HTMLElement | null = null
  private activeSubTab: ReferenceSubTab = 'balance'
  private onBackCallback: (() => void) | null = null

  mount(parent: HTMLElement = document.body, onBack?: () => void): void {
    this.destroy()
    this.onBackCallback = onBack ?? null
    const container = document.createElement('div')
    container.id = 'battle-reference-container'
    container.innerHTML = `
      <button type="button" class="setup-back-btn" id="reference-back">← 上一頁</button>
      <div class="setup-header">
        <h1 class="setup-title">SAGABURST</h1>
        <div class="setup-subtitle">UNITS & WEAPONS</div>
      </div>
      ${this._renderReferencePanel()}
    `
    parent.appendChild(container)
    this.container = container
    this._bindEvents()
    this._refreshSubTabs()
  }

  destroy(): void {
    this.container?.remove()
    this.container = null
  }

  private _bindEvents(): void {
    this.container?.querySelector('#reference-back')?.addEventListener('click', () => {
      this.onBackCallback?.()
    })
    this.container?.querySelectorAll<HTMLElement>('.ref-subtab-btn').forEach(button => {
      button.addEventListener('click', () => {
        const subTab = button.dataset.refSubtab as ReferenceSubTab | undefined
        if (!subTab) return
        this.activeSubTab = subTab
        this._refreshSubTabs()
      })
    })
  }

  private _refreshSubTabs(): void {
    if (!this.container) return
    this.container.querySelectorAll<HTMLElement>('.ref-subtab-btn').forEach(button => {
      button.classList.toggle('active', button.dataset.refSubtab === this.activeSubTab)
    })
    this.container.querySelectorAll<HTMLElement>('.ref-subpanel').forEach(panel => {
      panel.classList.toggle('active', panel.dataset.refSubpanel === this.activeSubTab)
    })
  }

  private _renderReferencePanel(): string {
    const vikingPresets = getUnitPresetsForFaction('viking')
    const romanPresets = getUnitPresetsForFaction('roman')

    const renderPresetList = (presets: typeof vikingPresets) => `
        <div class="reference-preset-grid">
          ${presets.map(p => {
            const hasShield = Object.values(p.tierLoadouts).some(l => !!l.shieldId)
            const isMounted = Object.values(p.tierLoadouts).some(l => !!l.mountId)
            return `
              <div class="reference-preset-card">
                <div class="reference-preset-header">
                  <h4 class="reference-preset-title">${p.nameZh} <span class="reference-preset-en">${p.nameEn}</span></h4>
                  <div class="reference-preset-badges">
                    <span class="reference-badge ${hasShield ? 'badge-shield' : 'badge-neutral'}">${hasShield ? '持盾' : '無盾'}</span>
                    <span class="reference-badge ${isMounted ? 'badge-mounted' : 'badge-neutral'}">${isMounted ? '騎乘' : '步兵'}</span>
                  </div>
                </div>
                <p class="reference-preset-desc">${p.description}</p>
                <div class="reference-preset-traits">
                  ${p.traits.map(t => `<div class="reference-trait-badge">${getTraitDescription(t)}</div>`).join('')}
                </div>
                <div class="reference-tiers">
                  ${([1, 2, 3] as UnitTier[]).map(t => {
                    const l = p.tierLoadouts[t]
                    const meleeName = l.meleeWeaponId ? (WEAPONS[l.meleeWeaponId]?.name ?? l.meleeWeaponId) : '無'
                    const rangedName = l.rangedWeaponId ? (WEAPONS[l.rangedWeaponId]?.name ?? l.rangedWeaponId) : null
                    const shieldName = l.shieldId ? (ARMORS[l.shieldId]?.name ?? l.shieldId) : null
                    return `
                      <div class="reference-tier-row">
                        <span class="ref-tier-tag">T${t}</span>
                        <div class="ref-tier-equip-list">
                          <span class="ref-equip-item">近戰: <b>${meleeName}</b></span>
                          ${rangedName ? `<span class="ref-equip-item">遠程: <b>${rangedName}</b></span>` : ''}
                          ${shieldName ? `<span class="ref-equip-item">盾牌: <b>${shieldName}</b></span>` : ''}
                        </div>
                      </div>
                    `
                  }).join('')}
                </div>
              </div>
            `
          }).join('')}
        </div>
      `

    return `
        <div id="setup-reference-panel" class="setup-tab-panel active reference-page">
          <div class="reference-panel-heading">
            <h2>兵種與戰鬥數值參考</h2><span>UNITS &amp; COMBAT BALANCE</span>
          </div>

          <div class="reference-subtabs-nav">
            <button type="button" class="ref-subtab-btn ${this.activeSubTab === 'balance' ? 'active' : ''}" data-ref-subtab="balance">戰鬥數值</button>
            <button type="button" class="ref-subtab-btn ${this.activeSubTab === 'viking' ? 'active' : ''}" data-ref-subtab="viking">維京兵種</button>
            <button type="button" class="ref-subtab-btn ${this.activeSubTab === 'roman' ? 'active' : ''}" data-ref-subtab="roman">羅馬兵種</button>
            <button type="button" class="ref-subtab-btn ${this.activeSubTab === 'weapons' ? 'active' : ''}" data-ref-subtab="weapons">武器</button>
            <button type="button" class="ref-subtab-btn ${this.activeSubTab === 'shields' ? 'active' : ''}" data-ref-subtab="shields">盾牌</button>
          </div>

          <div class="reference-subpanels-container">
            <!-- 1. 戰鬥數值 -->
            <div id="ref-subpanel-balance" class="ref-subpanel ${this.activeSubTab === 'balance' ? 'active' : ''}" data-ref-subpanel="balance">
              <div class="balance-rules-grid">
                <div class="balance-rule-card">
                  <h4>基礎生命值 Base HP</h4>
                  <p>NPC 預設 HP: <b>${COMBAT_BALANCE.hp.npcDefault}</b></p>
                  <p>玩家預設 HP: <b>${COMBAT_BALANCE.hp.playerDefault}</b></p>
                </div>
                <div class="balance-rule-card">
                  <h4>弓箭 Bow</h4>
                  <p>傷害倍率: <b>×${COMBAT_BALANCE.bow.damageMultiplier}</b></p>
                  <p>攻速倍率: <b>×${COMBAT_BALANCE.bow.attackRateMultiplier}</b> (冷卻約 ${(COMBAT_BALANCE.bow.baseCooldown / COMBAT_BALANCE.bow.attackRateMultiplier).toFixed(2)}s)</p>
                  <p>步兵射程: <b>${COMBAT_BALANCE.bow.footAttackRange}m</b> | 騎兵射程: <b>${COMBAT_BALANCE.bow.mountedAttackRange}m</b></p>
                </div>
                <div class="balance-rule-card">
                  <h4>標槍 Javelin</h4>
                  <p>傷害倍率: <b>×${COMBAT_BALANCE.javelin.damageMultiplier}</b></p>
                  <p>攻速倍率: <b>×${COMBAT_BALANCE.javelin.attackRateMultiplier}</b> (冷卻約 ${(COMBAT_BALANCE.javelin.baseCooldown / COMBAT_BALANCE.javelin.attackRateMultiplier).toFixed(2)}s)</p>
                  <p>步兵射程: <b>${COMBAT_BALANCE.javelin.footAttackRange}m</b> | 騎兵射程: <b>${COMBAT_BALANCE.javelin.mountedAttackRange}m</b></p>
                </div>
                <div class="balance-rule-card">
                  <h4>長槍 Lance</h4>
                  <p>步兵反騎: <b>×${COMBAT_BALANCE.lance.unmountedVsMountedDamageMultiplier}</b> (徒步持槍 vs 騎乘目標)</p>
                  <p>騎槍衝刺: <b>×${COMBAT_BALANCE.lance.mountedChargeDamageMultiplier}</b> (騎乘持槍且速度 &gt; ${COMBAT_BALANCE.lance.mountedChargeSpeedThreshold}m/s)</p>
                  <p>一般近戰: <b>依武器基礎傷害</b> (無普通 ×1.5 疊加)</p>
                </div>
                <div class="balance-rule-card">
                  <h4>狂戰士 Berserker</h4>
                  <p>觸發條件: <b>維京 + 步兵 + 單手劍 + 無盾</b></p>
                  <p>移動速度: <b>×${COMBAT_BALANCE.berserker.moveSpeedMultiplier}</b></p>
                  <p>近戰傷害: <b>×${COMBAT_BALANCE.berserker.meleeDamageMultiplier}</b></p>
                  <p>近戰攻速: <b>×${COMBAT_BALANCE.berserker.meleeAttackRateMultiplier}</b></p>
                </div>
                <div class="balance-rule-card">
                  <h4>戰馬撞擊 Mount Impact</h4>
                  <p>最低起撞速度: <b>${COMBAT_BALANCE.mountImpact.minSpeed}m/s</b></p>
                  <p>撞擊傷害: <b>${COMBAT_BALANCE.mountImpact.baseDamage}</b> + 速度 × <b>${COMBAT_BALANCE.mountImpact.speedDamageMultiplier}</b></p>
                  <p>衝刺撞擊加成: <b>×${COMBAT_BALANCE.mountImpact.sprintDamageMultiplier}</b></p>
                  <p>同一目標冷卻: <b>${COMBAT_BALANCE.mountImpact.sameTargetCooldown}s</b></p>
                </div>
              </div>
            </div>

            <!-- 2. 維京兵種 -->
            <div id="ref-subpanel-viking" class="ref-subpanel ${this.activeSubTab === 'viking' ? 'active' : ''}" data-ref-subpanel="viking">
              ${renderPresetList(vikingPresets)}
            </div>

            <!-- 3. 羅馬兵種 -->
            <div id="ref-subpanel-roman" class="ref-subpanel ${this.activeSubTab === 'roman' ? 'active' : ''}" data-ref-subpanel="roman">
              ${renderPresetList(romanPresets)}
            </div>

            <!-- 4. 武器 -->
            <div id="ref-subpanel-weapons" class="ref-subpanel ${this.activeSubTab === 'weapons' ? 'active' : ''}" data-ref-subpanel="weapons">
              <table class="reference-weapons-table">
                <thead>
                  <tr>
                    <th>名稱</th>
                    <th>階級</th>
                    <th>類型</th>
                    <th>基礎傷害</th>
                    <th>攻擊距離 / 遠程資訊</th>
                  </tr>
                </thead>
                <tbody>
                  ${Object.values(WEAPONS).map(w => {
                    const rangeInfo = w.range
                      ? `${w.range}m`
                      : (w.combatKind === 'bow'
                        ? `步兵 ${COMBAT_BALANCE.bow.footAttackRange}m / 騎兵 ${COMBAT_BALANCE.bow.mountedAttackRange}m`
                        : (w.combatKind === 'javelin'
                          ? `步兵 ${COMBAT_BALANCE.javelin.footAttackRange}m / 騎兵 ${COMBAT_BALANCE.javelin.mountedAttackRange}m`
                          : '—'))
                    const typeLabel = w.combatKind === 'sword' ? '單手劍 Sword'
                      : w.combatKind === 'lance' ? '長槍 Lance'
                      : w.combatKind === 'bow' ? '弓箭 Bow'
                      : '標槍 Javelin'
                    return `
                      <tr>
                        <td><b>${w.name}</b></td>
                        <td><span class="ref-tier-badge tier-${w.tier}">T${w.tier}</span></td>
                        <td>${typeLabel}</td>
                        <td><b>${w.damageMin === w.damageMax ? w.damageMax : `${w.damageMin}-${w.damageMax}`}</b></td>
                        <td>${rangeInfo}</td>
                      </tr>
                    `
                  }).join('')}
                </tbody>
              </table>
            </div>

            <!-- 5. 盾牌 -->
            <div id="ref-subpanel-shields" class="ref-subpanel ${this.activeSubTab === 'shields' ? 'active' : ''}" data-ref-subpanel="shields">
              <table class="reference-weapons-table">
                <thead>
                  <tr>
                    <th>名稱</th>
                    <th>階級</th>
                    <th>減傷</th>
                    <th>簡短說明</th>
                  </tr>
                </thead>
                <tbody>
                  ${Object.values(ARMORS).map(a => `
                    <tr>
                      <td><b>${a.name}</b></td>
                      <td><span class="ref-tier-badge tier-${a.tier}">T${a.tier}</span></td>
                      <td><b>${Math.round(a.damageReduction * 100)}%</b></td>
                      <td>${a.description}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>
    `
  }
}
