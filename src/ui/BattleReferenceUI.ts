import './battle-setup.css'
import { COMBAT_BALANCE } from '../combat/CombatBalance'
import { WEAPONS } from '../rpg/WeaponDatabase'
import { ARMORS } from '../rpg/ArmorDatabase'
import { T4_UNIT_PROFILES } from '../battle/T4HeroCatalog'
import { HERO_ASSETS } from '../world/HeroAssetCatalog'
import {
  getUnitPresetsForFaction,
  getTraitDescription,
  type BaseUnitTier as UnitTier,
} from '../battle/UnitPresetCatalog'

type ReferenceSubTab = 'viking' | 'roman' | 'heroes' | 'weapons' | 'shields' | 'balance'

export class BattleReferenceUI {
  private container: HTMLElement | null = null
  private activeSubTab: ReferenceSubTab = 'viking'
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
    this.container?.querySelectorAll<HTMLElement>('.reference-hero-link').forEach(button => {
      button.addEventListener('click', () => {
        const heroId = button.dataset.heroId
        if (!heroId) return
        this.activeSubTab = 'heroes'
        this._refreshSubTabs()
        requestAnimationFrame(() => {
          this.container?.querySelector<HTMLElement>(`#hero-card-${heroId}`)?.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
          })
        })
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
            const heroProfile = T4_UNIT_PROFILES[p.id]
            const heroAsset = HERO_ASSETS[heroProfile.visualAssetId]
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
                <button type="button" class="reference-hero-link" data-hero-id="${heroProfile.visualAssetId}">
                  <span>T4 英雄：<b>${heroAsset.nameZh}</b></span>
                  <em>查看介紹 →</em>
                </button>
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

    const heroEntries = [
      {
        id: 'viking-hero-t4' as const,
        mark: 'V',
        factionClass: 'viking',
        role: '維京 · T4 英雄',
        tags: ['強力進攻', '快速出手', '追擊'],
        description: '身經百戰的維京精銳，以強勁的攻擊和快速出手壓制敵人。適合帶頭進攻，或追擊脫離隊伍的敵兵。',
        note: '騎兵型態坐騎：黑貓',
      },
      {
        id: 'roman-hero-t4' as const,
        mark: 'SPQR',
        factionClass: 'roman',
        role: '羅馬 · T4 英雄',
        tags: ['堅守前線', '傷害減免', '強力反擊'],
        description: '羅馬軍團的精銳衛士，能承受更多攻擊，並以強力打擊迎戰敵人。適合配合友軍守住要道，或穩步推進戰線。',
        note: '騎兵型態坐騎：柯基',
      },
      {
        id: 'maki-archer-t4' as const,
        mark: 'R',
        factionClass: 'ranger',
        role: '雙陣營 · T4 弓兵英雄',
        tags: ['遠距接戰', '靈活移動', '弓身近戰'],
        description: '身手靈活的遠程獵手，擅長拉開距離、持續射擊。敵人逼近時，也能以弓身近戰應急，但保持距離更能發揮優勢。',
        note: '維京與羅馬的步弓兵共用英雄',
      },
    ]

    const renderHeroCards = () => `
      <div class="reference-hero-intro">
        <h3>英雄 <span>HEROES</span></h3>
        <p>T4 英雄擁有獨立的外觀與戰鬥特色。這裡只整理玩法定位；詳細數值仍以遊戲內戰鬥規則為準。</p>
      </div>
      <div class="reference-hero-grid">
        ${heroEntries.map(hero => {
          const asset = HERO_ASSETS[hero.id]
          return `
            <article id="hero-card-${hero.id}" class="reference-hero-card hero-${hero.factionClass}">
              <div class="reference-hero-visual" aria-hidden="true">
                <span class="reference-hero-tier">T4</span>
                <strong>${hero.mark}</strong>
                <small>${hero.factionClass === 'viking' ? 'VIKING' : hero.factionClass === 'roman' ? 'ROMAN' : 'RANGER'}</small>
              </div>
              <div class="reference-hero-content">
                <div class="reference-hero-heading">
                  <h3>${asset.nameZh}</h3>
                  <span>${asset.nameEn}</span>
                </div>
                <div class="reference-hero-role">${hero.role}</div>
                <div class="reference-hero-tags">
                  ${hero.tags.map(tag => `<span>${tag}</span>`).join('')}
                </div>
                <p>${hero.description}</p>
                <div class="reference-hero-note">${hero.note}</div>
              </div>
            </article>
          `
        }).join('')}
      </div>
    `

    return `
        <div id="setup-reference-panel" class="setup-tab-panel active reference-page">
          <div class="reference-panel-heading">
            <h2>兵種、英雄與武器</h2><span>UNITS, HEROES &amp; WEAPONS</span>
          </div>

          <div class="reference-subtabs-nav">
            <button type="button" class="ref-subtab-btn ${this.activeSubTab === 'viking' ? 'active' : ''}" data-ref-subtab="viking">維京兵種</button>
            <button type="button" class="ref-subtab-btn ${this.activeSubTab === 'roman' ? 'active' : ''}" data-ref-subtab="roman">羅馬兵種</button>
            <button type="button" class="ref-subtab-btn ${this.activeSubTab === 'heroes' ? 'active' : ''}" data-ref-subtab="heroes">英雄</button>
            <button type="button" class="ref-subtab-btn ${this.activeSubTab === 'weapons' ? 'active' : ''}" data-ref-subtab="weapons">武器</button>
            <button type="button" class="ref-subtab-btn ${this.activeSubTab === 'shields' ? 'active' : ''}" data-ref-subtab="shields">盾牌</button>
            <button type="button" class="ref-subtab-btn ${this.activeSubTab === 'balance' ? 'active' : ''}" data-ref-subtab="balance">戰鬥數值</button>
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

            <!-- 4. 英雄 -->
            <div id="ref-subpanel-heroes" class="ref-subpanel ${this.activeSubTab === 'heroes' ? 'active' : ''}" data-ref-subpanel="heroes">
              ${renderHeroCards()}
            </div>

            <!-- 5. 武器 -->
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

            <!-- 6. 盾牌 -->
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
