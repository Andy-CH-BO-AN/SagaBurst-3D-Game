import type { TownTutorialController } from './TownTutorialController'
import { MOUNTED_RACES, raceStageOpponentLabel, type RaceId } from '../career/CareerRaceState'
import { HEAVY_FIELD_MISSION_CATALOG, getHeavyFieldMissionAvailability } from '../career/HeavyFieldMission'
import { HERO_COMBAT_PROFILES, type HeroCombatProfileId } from '../battle/HeroCombatProfile'
import { townAssaultObjectiveRoster, townRoster, townName } from './TownRules'
import { CAVALRY_SWEEP_BANDITS } from '../career/CavalrySweep'
import { CAPTAIN_MISSION_CATALOG, CAPTAIN_PATROL_COMMAND_ID, CAPTAIN_EAGLE_BATTLE_ID, getCaptainMissionAvailability } from '../career/CaptainMissionCatalog'
import type { CaptainPatrolCommandController } from '../career/CaptainPatrolCommandController'
import { getDefenseCampaignStage } from '../campaign/CampaignConfig'
import { isCareerOutpostReliefUnlocked, resolveCareerReliefMount, isCareerOutpostUnlocked, CAREER_OUTPOST_STAGES, type CareerOutpostStageId } from '../career/CareerOutpostMission'
import { selectTownDialogue, type DialogueContext } from '../career/CareerTownDialogue'
import { CAREER_RANKS, CAREER_RANK_LABELS, type CareerProfile, type CareerRank } from '../career/CareerProfile'
import { availableCareerMissionsForPage, defaultCareerMissionPage, isCareerMissionPageUnlocked, getRecruitMissionTemplate, type CareerMissionPage } from '../career/CareerMissionCatalog'
import { VETERAN_MISSION_CATALOG, getVeteranMissionAvailability } from '../career/VeteranMission'
import { COMMANDER_MISSION_CATALOG, getCommanderMissionAvailability } from '../career/CommanderMissionCatalog'
import { HERO_CLASS_NAMES } from '../career/CareerHeroClasses'
import { careerDuelSubjectRules, careerDuelProgressLabel, careerDuelTierEntries, type CareerDuelSubject } from '../career/CareerDuelSelection'
import type { CareerDuelTier } from '../career/CareerDuelState'
import { DUEL_ARENA_IDS, DUEL_ARENA_LABELS, defaultDuelArenaForFaction, type DuelArenaId } from '../arena/DuelArenaCatalog'
import { ARENA_TRIAL_DEFINITIONS, ARENA_TRIAL_TIERS, arenaTrialGroupsLabel, arenaTrialTeamSizes, isArenaTrialUnlocked, type ArenaTrialTier } from '../career/CareerArenaTrials'
import { getUnitPresetsForFaction, type UnitPresetId } from '../battle/UnitPresetCatalog'

/** A mission the player chose on the board; the scene runs the matching accept transaction. */
export type MissionBoardRequest =
  | { kind: 'mission' | 'veteran' | 'captain' | 'commander' | 'heavy-field'; templateId: string }
  | { kind: 'outpost'; stageId: CareerOutpostStageId }
  | { kind: 'outpost-relief' }
  | { kind: 'duel'; presetId: UnitPresetId | undefined; tier: CareerDuelTier; mode: 'armed' | 'unarmed'; classId?: HeroCombatProfileId }
  | { kind: 'race'; raceId: RaceId }
  | { kind: 'arena-trial'; tier: ArenaTrialTier; arena: DuelArenaId }

export type MissionBoardPage = CareerMissionPage | 'duel' | 'trial'

/** What the board reads from Town; it never writes the profile itself. */
export interface MissionBoardHost {
  readonly profile: CareerProfile
  readonly tutorial: Pick<TownTutorialController, 'renderReviewContent'> | undefined
  readonly captainPatrol: Pick<CaptainPatrolCommandController, 'selectAvailableSquad' | 'unavailableReason'> | undefined
  /** Friendly force shown on Town defense rows. */
  defenseForce(): { friendlyCombatants: number }
  accept(request: MissionBoardRequest): void
}

export interface MissionBoardView {
  readonly context: DialogueContext
  readonly firstOutpost: boolean
  /** Rebuilds the whole Sergeant dialogue, e.g. after a tab change. */
  reopen(): void
}

function button(parent: HTMLElement, label: string, action: () => void): HTMLButtonElement {
  const b = document.createElement('button'); b.textContent = label; b.className = 'town-button'; b.onclick = action; parent.append(b); return b
}

/**
 * The Sergeant's mission board: rank tabs, 1v1 (Duel / Racing / review) and Arena Squad Trial pages,
 * plus the selections kept while the board is re-rendered. Rendering only; every accept transaction
 * stays with the Town scene behind {@link MissionBoardHost.accept}.
 */
export class TownMissionBoard {
  /** Selected tab; cleared on promotion so the new rank opens on its default page. */
  page?: MissionBoardPage
  private trialArenaChoice: DuelArenaId | null = null
  private duelActivity: 'duel' | 'race' | 'review' = 'duel'
  /** The Duel list entry kept across re-renders and returns: 'unarmed' or a unit preset ID. */
  private duelSubjectKey = 'unarmed'
  /** Arena chosen on the Duel page; kept across subject/tier changes and reset when the page is reopened. */
  private duelArenaChoice: DuelArenaId | null = null

  constructor(private readonly host: MissionBoardHost) {}

  /** Arena for a new formal duel: the player's choice on the Duel page, else the faction default. */
  get selectedDuelArena(): DuelArenaId { return this.duelArenaChoice ?? defaultDuelArenaForFaction(this.host.profile.faction) }

  /** Renders the tab bar and the selected page under the Sergeant's dialogue. */
  render(panel: HTMLElement, view: MissionBoardView): void {
    const { context, firstOutpost } = view
    const defaultPage = defaultCareerMissionPage(this.host.profile)
    const requestedPage = this.page ?? defaultPage
    const selectedPage = requestedPage !== 'duel' && requestedPage !== 'trial' && !isCareerMissionPageUnlocked(this.host.profile, requestedPage) ? defaultPage : requestedPage
    this.page = selectedPage
    const tabs = document.createElement('nav'); tabs.className = 'town-mission-tabs'; tabs.setAttribute('aria-label', '任務分類')
    for (const [page, label] of [['recruit', '新兵任務'], ['soldier', '士兵任務'], ['veteran', '老兵任務'], ['captain', '隊長任務'], ['commander', '指揮官任務'], ['duel', '1v1 單挑'], ['trial', '競技場軍團試煉']] as const) {
      const tab = document.createElement('button'); tab.className = 'town-button'; tab.textContent = label
      tab.setAttribute('aria-pressed', String(page === selectedPage))
      tab.disabled = page !== 'duel' && page !== 'trial' && !isCareerMissionPageUnlocked(this.host.profile, page)
      if (tab.disabled) tab.textContent += ` · 需晉升為${CAREER_RANK_LABELS[page as CareerRank]}`
      tab.onclick = () => { this.page = page; view.reopen() }
      tabs.append(tab)
    }
    panel.append(tabs)
    if (selectedPage === 'duel') { this.renderOneVOnePage(panel); return }
    if (selectedPage === 'trial') { this.renderArenaTrialPage(panel); return }
    if (selectedPage === 'veteran') { this.renderVeteranPage(panel); return }
    if (selectedPage === 'captain') { this.renderCaptainPage(panel); return }
    if (selectedPage === 'commander') { this.renderCommanderPage(panel); return }
    if (selectedPage === 'soldier') {
      if (firstOutpost) {
        const outpost = document.createElement('p'); outpost.className = 'town-summary'
        outpost.textContent = selectTownDialogue(context, 'soldierFirstOutpost')
        panel.append(outpost)
      }
      if (this.host.profile.rank !== 'recruit') {
        const heading = document.createElement('h3'); heading.textContent = '前哨防守'; panel.append(heading)
        for (const stageId of CAREER_OUTPOST_STAGES) {
          const stage = getDefenseCampaignStage(stageId)
          const unlocked = isCareerOutpostUnlocked(this.host.profile, stageId)
          const completed = this.host.profile.completedOutpostStages?.includes(stageId)
          const row = document.createElement('article'); row.className = 'town-product'
          const title = document.createElement('strong'); title.textContent = '前哨防守 ' + ['I', 'II', 'III'][stageId - 1]
          const details = document.createElement('small'); details.style.whiteSpace = 'pre-line'
          details.textContent = `守軍最多 ${stage.defenderDeployment.maxUnits} 人（你另外加入）｜敵方 ${stage.attackerArmy.totalUnits} 人\n${completed ? '已完成，可重複挑戰' : unlocked ? '可接取' : '需要晉升為士兵'}`
          row.append(title, details)
          if (unlocked) button(row, '接受防守任務', () => this.host.accept({ kind: 'outpost', stageId }))
          panel.append(row)
        }
      }
      const relief = document.createElement('article'); relief.className = 'town-product'
      const reliefTitle = document.createElement('strong'); reliefTitle.textContent = '騎兵救援'
      const reliefDetails = document.createElement('small')
      const reliefUnlocked = isCareerOutpostReliefUnlocked(this.host.profile)
      const reliefMountReady = Boolean(resolveCareerReliefMount(this.host.profile))
      reliefDetails.style.whiteSpace = 'pre-line'
      reliefDetails.textContent = !reliefUnlocked ? '需要晉升為士兵' : !reliefMountReady ? '需要一匹可使用的自有坐騎' : '我方 50 騎（含你）｜敵方 60 人\n目標：殲滅全部敵軍。你戰死後可繼續觀戰。'
      relief.append(reliefTitle, reliefDetails)
      if (reliefUnlocked && reliefMountReady) button(relief, '接受騎兵救援', () => this.host.accept({ kind: 'outpost-relief' }))
      panel.append(relief)
    }
    const missions = availableCareerMissionsForPage(this.host.profile, selectedPage)
    const defenseForce = this.host.defenseForce()
    if (selectedPage === 'recruit' && !resolveCareerReliefMount(this.host.profile)) {
      const row = document.createElement('article'); row.className = 'town-product'
      const title = document.createElement('strong'); title.textContent = '騎兵清剿'
      const details = document.createElement('small'); details.style.whiteSpace = 'pre-line'
      details.textContent = `${getRecruitMissionTemplate('career-cavalry-sweep')?.briefing ?? ''}\n需要一匹可使用的自有坐騎（可到馬店購買）。`
      row.append(title, details)
      const locked = document.createElement('button'); locked.textContent = '需要坐騎'; locked.disabled = true; row.append(locked)
      panel.append(row)
    }
    const list = document.createElement('div'); list.className = 'town-products'; panel.append(list)
    for (const template of missions) {
      if (!('risk' in template)) continue
      const row = document.createElement('article'); row.className = 'town-product'
      const title = document.createElement('strong'); title.textContent = template.name
      const details = document.createElement('small')
      const force = (friendly: number, enemy: string) => `我方：${friendly} 人（含你）\n敵方：${enemy}`
      details.textContent = template.kind === 'cavalry-sweep'
        ? `${template.briefing}\n${force(template.friendlyCombatants, `${CAVALRY_SWEEP_BANDITS} 名盜匪`)}\n你只能跟隨騎兵隊行動，無指揮權。`
        : template.kind === 'enemy-town-assault'
        ? `${template.briefing}\n我方：${template.friendlyCombatants} 人（含你）\n敵方：${townName(this.host.profile.faction === 'roman' ? 'viking' : 'roman')}全體守軍（${townAssaultObjectiveRoster(townRoster()).length} 人）\n你無指揮權。`
        : template.kind === 'town-defense'
        ? `${template.briefing}\n我方：${defenseForce.friendlyCombatants} 人（含你），守衛${townName(this.host.profile.faction)}\n敵方：${template.enemyCount} 人（T3 騎兵與 4 名 T4 隊長）\n平民死亡超過 ${template.maxCivilianDeaths} 人即失敗 · 風險：${template.risk}`
        : template.kind === 'bandit' ? `${template.briefing}\n${force(template.friendlyCombatants, `${template.banditCount} 名盜匪`)}\n風險：${template.risk}` : template.briefing
      details.style.whiteSpace = 'pre-line'
      row.append(title, details)
      button(row, '接受任務', () => this.host.accept({ kind: 'mission', templateId: template.id }))
      list.append(row)
    }
    if (selectedPage === 'recruit') {
      const summary = document.createElement('p'); summary.className = 'town-summary'
      summary.textContent = '可自由選擇不同難度的剿匪與騎兵清剿任務；晉升至更高軍階後可解鎖更多進階作戰。'
      panel.append(summary)
    }
  }
  private renderVeteranPage(panel: HTMLElement): void {
    for (const definition of VETERAN_MISSION_CATALOG) {
      const row = document.createElement('article'); row.className = 'town-product'
      const title = document.createElement('strong'); title.textContent = definition.name
      const details = document.createElement('small'); details.style.whiteSpace = 'pre-line'
      details.textContent = `${definition.briefing}\n我方：${definition.friendlyCombatants} 人（含你）\n敵方：${definition.enemyCombatants} 人\n你無指揮權；戰死後可觀戰。`
      const availability = getVeteranMissionAvailability(this.host.profile, definition.id)
      const accept = document.createElement('button'); accept.className = 'town-button'
      accept.textContent = availability.unlocked ? '接受任務' : availability.reason ?? '目前無法接取'
      accept.disabled = !availability.unlocked
      accept.onclick = () => this.host.accept({ kind: 'veteran', templateId: definition.id })
      row.append(title, details, accept); panel.append(row)
    }
    this.appendHeavyFieldRows(panel, 'veteran')
  }
  private appendCommandHowTo(panel: HTMLElement): void {
    const tip = document.createElement('p'); tip.className = 'town-summary'
    tip.textContent = '指揮方式：戰鬥中按 Q 進入命令模式，滾輪選擇部隊、中鍵確認，再選擇攻擊、防禦等命令。'
    panel.append(tip)
  }
  private renderCaptainPage(panel: HTMLElement): void {
    this.appendCommandHowTo(panel)
    const defenseForce = this.host.defenseForce()
    for (const definition of CAPTAIN_MISSION_CATALOG) {
      const availability = getCaptainMissionAvailability(this.host.profile, definition.id)
      const patrol = definition.id === CAPTAIN_PATROL_COMMAND_ID ? this.host.captainPatrol?.selectAvailableSquad() : null
      const row = document.createElement('article'); row.className = 'town-product'
      const title = document.createElement('strong'); title.textContent = definition.name
      const details = document.createElement('small'); details.style.whiteSpace = 'pre-line'
      const state = definition.id === CAPTAIN_PATROL_COMMAND_ID && !patrol ? this.host.captainPatrol?.unavailableReason ?? '巡邏隊還沒有集合完畢，請稍後再接取任務。'
        : definition.id === CAPTAIN_EAGLE_BATTLE_ID ? `你目前有 ${this.host.profile.personalSquad?.members.length ?? 0} 名私兵會一同參戰（依原本裝備參加空戰或地面作戰）。`
        : '正式部隊與私兵可分別下令；兩者的有效戰績都會計入軍功。'
      const briefing = definition.briefing
      const force = definition.kind === 'town-defense'
        ? `\n我方：${defenseForce.friendlyCombatants} 人（含你）\n敵方：${definition.enemyCombatants} 人` : ''
      details.textContent = `${briefing}${force}\n${state}`
      const accept = document.createElement('button'); accept.className = 'town-button'
      accept.disabled = !availability.unlocked || definition.id === CAPTAIN_PATROL_COMMAND_ID && !patrol
      accept.textContent = availability.unlocked ? accept.disabled ? '巡邏隊暫時不可用' : '接受任務' : availability.reason ?? '目前無法接取'
      accept.onclick = () => this.host.accept({ kind: 'captain', templateId: definition.id })
      row.append(title, details, accept); panel.append(row)
    }
    this.appendHeavyFieldRows(panel, 'captain')
  }
  private renderCommanderPage(panel: HTMLElement): void {
    this.appendCommandHowTo(panel)
    for (const definition of COMMANDER_MISSION_CATALOG) {
      const availability = getCommanderMissionAvailability(this.host.profile, definition.id)
      const row = document.createElement('article'); row.className = 'town-product'
      const title = document.createElement('strong'); title.textContent = definition.name
      const details = document.createElement('small'); details.style.whiteSpace = 'pre-line'
      const survival = '你戰死後可繼續觀戰，只要仍有友軍存活，戰鬥就會繼續。'
      details.textContent = `${definition.briefing}\n${survival}`
      const accept = document.createElement('button'); accept.className = 'town-button'
      accept.disabled = !availability.unlocked
      accept.textContent = availability.unlocked ? '接受任務' : availability.reason ?? '目前無法接取'
      accept.onclick = () => this.host.accept({ kind: 'commander', templateId: definition.id })
      row.append(title, details, accept); panel.append(row)
    }
  }
  private appendHeavyFieldRows(panel: HTMLElement, minRank: 'soldier' | 'veteran' | 'captain'): void {
    for (const definition of HEAVY_FIELD_MISSION_CATALOG.filter(entry => entry.minRank === minRank)) {
      const availability = getHeavyFieldMissionAvailability(this.host.profile, definition.id)
      const row = document.createElement('article'); row.className = 'town-product'
      const title = document.createElement('strong'); title.textContent = definition.name
      const details = document.createElement('small'); details.style.whiteSpace = 'pre-line'
      details.textContent = `${definition.briefing}\n我方：${definition.friendlyCombatants} 人（含你）\n敵方：${definition.enemyCombatants} 人\n${CAREER_RANKS.indexOf(this.host.profile.rank) >= CAREER_RANKS.indexOf('captain') ? '你可以帶私兵並下令。' : '你無指揮權。'}風險：${definition.risk}`
      const accept = document.createElement('button'); accept.className = 'town-button'
      accept.textContent = availability.unlocked ? '接受任務' : availability.reason ?? '目前無法接取'
      accept.disabled = !availability.unlocked
      accept.onclick = () => this.host.accept({ kind: 'heavy-field', templateId: definition.id })
      row.append(title, details, accept); panel.append(row)
    }
  }
  private renderOneVOnePage(panel: HTMLElement): void {
    this.duelArenaChoice = null
    const activities = [['duel', '單挑 Duel'], ['race', '繞城賽馬 Racing'], ['review', '重溫入伍旅程']] as const
    const tabs = document.createElement('nav'); tabs.className = 'town-mission-tabs'; tabs.style.position = 'static'
    tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', '1 v 1 對決種類')
    const content = document.createElement('section'); content.id = 'town-one-v-one-content'
    content.setAttribute('role', 'tabpanel')
    const buttons = activities.map(([activity, label]) => {
      const tab = document.createElement('button'); tab.className = 'town-button'; tab.textContent = label
      tab.id = `town-one-v-one-${activity}`; tab.setAttribute('role', 'tab')
      tab.setAttribute('aria-controls', content.id)
      tab.onclick = () => { this.duelActivity = activity; render() }
      tab.onkeydown = event => {
        const index = activities.findIndex(([id]) => id === activity)
        const next = event.key === 'ArrowRight' ? (index + 1) % activities.length
          : event.key === 'ArrowLeft' ? (index + activities.length - 1) % activities.length
          : event.key === 'Home' ? 0 : event.key === 'End' ? activities.length - 1 : null
        if (next === null) return
        event.preventDefault(); this.duelActivity = activities[next][0]; render(); buttons[next].focus()
      }
      tabs.append(tab); return tab
    })
    const render = () => {
      buttons.forEach((tab, index) => {
        const selected = activities[index][0] === this.duelActivity
        tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1
        if (selected) content.setAttribute('aria-labelledby', tab.id)
      })
      content.replaceChildren()
      if (this.duelActivity === 'race') this.renderRacePage(content)
      else if (this.duelActivity === 'review') {
        if (this.host.tutorial) this.host.tutorial.renderReviewContent(content)
        else {
          const heading = document.createElement('h3'); heading.textContent = '重溫入伍旅程'; content.append(heading)
          const desc = document.createElement('p'); desc.className = 'town-summary'
          desc.textContent = '目前尚無已完成的訓練課程可供重溫。'
          content.append(desc)
        }
      }
      else this.openDuelSelection(content)
      panel.scrollTop = 0
      content.scrollTop = 0
    }
    panel.append(tabs, content); render()
  }
  /**
   * One page, two columns: the left list picks WHAT to fight as (bare fists or a unit type) and the right ladder shows its
   * T1–T5 state. A T4/T5 class is chosen on the tier row itself, so every Duel is at most three clicks and no step replaces the page.
   */
  private openDuelSelection(panel: HTMLElement, selectedKey = this.duelSubjectKey): void {
    this.duelSubjectKey = selectedKey
    const presets = getUnitPresetsForFaction(this.host.profile.faction)
    const subjectOf = (key: string): CareerDuelSubject => {
      const preset = key === 'unarmed' ? undefined : presets.find(p => p.id === key)
      return preset ? { kind: 'unit', preset } : { kind: 'unarmed' }
    }
    const subjects: [string, CareerDuelSubject][] = [['unarmed', { kind: 'unarmed' }], ...presets.map(preset => [preset.id, { kind: 'unit', preset }] as [string, CareerDuelSubject])]
    if (!subjects.some(([key]) => key === selectedKey)) selectedKey = this.duelSubjectKey = 'unarmed'
    const root = document.createElement('div'); root.className = 'duel-picker'
    const list = document.createElement('div'); list.className = 'duel-picker-list'; list.setAttribute('role', 'group'); list.setAttribute('aria-label', '對手種類')
    const ladder = document.createElement('section'); ladder.className = 'duel-picker-ladder'
    const rows = new Map<string, HTMLButtonElement>()
    const renderLadder = () => {
      const subject = subjectOf(this.duelSubjectKey), unarmed = subject.kind === 'unarmed'
      ladder.replaceChildren()
      const heading = document.createElement('h3'); heading.textContent = unarmed ? '🥊 空手對戰' : `${subject.preset.nameZh} · 單挑等級`
      const rules = document.createElement('p'); rules.className = 'duel-rules'; rules.textContent = careerDuelSubjectRules(subject)
      ladder.append(heading, rules)
      for (const entry of careerDuelTierEntries(this.host.profile, subject)) {
        const row = document.createElement('article'); row.className = `duel-tier duel-tier-${entry.status}`
        const head = document.createElement('div'); head.className = 'duel-tier-head'
        const title = document.createElement('strong'); title.textContent = `T${entry.tier}`
        const state = document.createElement('span'); state.className = 'duel-tier-state'
        state.textContent = entry.status === 'completed' ? '✓ 已完成' : entry.status === 'available' ? '可挑戰' : '🔒 未解鎖'
        head.append(title, state)
        const details = document.createElement('small')
        details.textContent = entry.status === 'locked' ? entry.requirement! : `對手：${entry.opponent}`
        row.append(head, details)
        if (entry.status !== 'locked') {
          const actions = document.createElement('div'); actions.className = 'duel-tier-actions'
          if (entry.classes.length) for (const option of entry.classes) {
            const profile = HERO_COMBAT_PROFILES[option.combatProfileId]
            const choice = document.createElement('div'); choice.className = 'duel-class'
            button(choice, `挑戰 ${HERO_CLASS_NAMES[option.combatProfileId].zh}`, () => this.host.accept({ kind: 'duel', presetId: subject.kind === 'unit' ? subject.preset.id : undefined, tier: entry.tier, mode: 'armed', classId: option.combatProfileId }))
            const stats = document.createElement('small'); stats.textContent = `生命 ${profile.maxHp} · 傷害 ×${profile.damageMultiplier} · 承傷 ×${profile.damageTakenMultiplier}`
            choice.append(stats); actions.append(choice)
          } else button(actions, entry.status === 'completed' ? '再次挑戰' : '接受單挑', () => this.host.accept({ kind: 'duel', presetId: unarmed ? undefined : subject.preset.id, tier: entry.tier, mode: unarmed ? 'unarmed' : 'armed' }))
          row.append(actions)
        }
        ladder.append(row)
      }
    }
    for (const [key, subject] of subjects) {
      const unarmed = subject.kind === 'unarmed'
      const button = document.createElement('button'); button.className = 'town-button duel-subject'
      const name = document.createElement('span'); name.textContent = unarmed ? '🥊 空手對戰' : subject.preset.nameZh
      const progress = document.createElement('small'); progress.textContent = `${careerDuelProgressLabel(this.host.profile, subject)}`
      button.append(name, progress)
      button.onclick = () => {
        this.duelSubjectKey = key
        rows.forEach((b, k) => b.setAttribute('aria-pressed', String(k === key)))
        renderLadder()
      }
      button.setAttribute('aria-pressed', String(key === this.duelSubjectKey)); rows.set(key, button); list.append(button)
    }
    renderLadder()
    root.append(list, ladder)
    panel.replaceChildren(this.duelArenaSelector(), root)
  }
  /** Single choice above the ladder; any culture may fight in either arena, which never changes rules or rewards. */
  private duelArenaSelector(): HTMLElement {
    const bar = document.createElement('div'); bar.className = 'duel-arena-select'
    bar.setAttribute('role', 'radiogroup'); bar.setAttribute('aria-label', '單挑場地')
    const label = document.createElement('strong'); label.textContent = '單挑場地'; bar.append(label)
    const options = DUEL_ARENA_IDS.map(id => {
      const option = document.createElement('button')
      option.className = 'town-button duel-arena-option'
      option.setAttribute('role', 'radio'); option.textContent = DUEL_ARENA_LABELS[id]
      option.onclick = () => { this.duelArenaChoice = id; sync() }
      bar.append(option); return { id, option }
    })
    const selected = () => this.duelArenaChoice ?? defaultDuelArenaForFaction(this.host.profile.faction)
    const sync = () => options.forEach(({ id, option }) => {
      const checked = id === selected()
      option.setAttribute('aria-checked', String(checked)); option.tabIndex = checked ? 0 : -1
    })
    sync()
    return bar
  }
  private renderRacePage(panel: HTMLElement): void {
    const racing = document.createElement('h3'); racing.textContent = 'Mounted Circuit Racing · 繞城賽馬'; panel.append(racing)
    for (const race of MOUNTED_RACES) {
      const row = document.createElement('article'); row.className = 'town-product'
      const name = document.createElement('strong'); name.textContent = `${race.name} · 指揮官 · ${raceStageOpponentLabel(race)}`
      const details = document.createElement('small')
      details.textContent = `指揮官 ${race.sprint ? 'Sprint' : 'Normal（不衝刺）'} · 玩家可衝刺 · 勝利 ${race.merit} 軍功 · ${this.host.profile.completedRaceIds?.includes(race.id) ? '已完成' : '未完成'}`
      const accept = button(row, '接受賽馬', () => this.host.accept({ kind: 'race', raceId: race.id }))
      accept.disabled = Boolean(this.host.profile.activeRace || this.host.profile.activeMission || this.host.profile.activeOutpostMission)
      row.prepend(name, details); panel.append(row)
    }
  }
  /** Independent of 1v1 and racing: its own board, its own saved mission, its own settlement. */
  private renderArenaTrialPage(panel: HTMLElement): void {
    const content = document.createElement('section'); content.id = 'town-arena-trial-content'
    const render = (): void => {
      const arena = this.trialArenaChoice ?? defaultDuelArenaForFaction(this.host.profile.faction)
      content.replaceChildren()
      const intro = document.createElement('p'); intro.className = 'town-summary'
      intro.textContent = '同陣營隊伍切磋：在競技場與己方軍團對陣另一支同文化部隊。倒地者只是退出本場，戰後恢復，不造成永久傷亡或戰俘；可重複挑戰並取得軍功。'
      const arenas = document.createElement('div'); arenas.setAttribute('role', 'group'); arenas.setAttribute('aria-label', '試煉場地')
      for (const id of DUEL_ARENA_IDS) {
        const choice = document.createElement('button'); choice.className = 'town-button'; choice.textContent = DUEL_ARENA_LABELS[id]
        choice.setAttribute('aria-pressed', String(id === arena))
        choice.onclick = () => { this.trialArenaChoice = id; render() }
        arenas.append(choice)
      }
      content.append(intro, arenas)
      for (const tier of ARENA_TRIAL_TIERS) {
        const definition = ARENA_TRIAL_DEFINITIONS[tier], sizes = arenaTrialTeamSizes(tier)
        const row = document.createElement('article'); row.className = 'duel-tier'; row.dataset.trialTier = String(tier)
        const head = document.createElement('div'); head.className = 'duel-tier-head'
        const title = document.createElement('strong'); title.textContent = `T${tier} ${definition.label}`
        const unlocked = isArenaTrialUnlocked(this.host.profile, tier)
        const state = document.createElement('span'); state.className = 'duel-tier-state'; state.textContent = unlocked ? '可挑戰' : `🔒 需晉升為${CAREER_RANK_LABELS[definition.requiredRank]}`
        head.append(title, state)
        const details = document.createElement('small'); details.style.whiteSpace = 'pre-line'
        details.textContent = `我方 ${sizes.friendly} 人（含你）：${arenaTrialGroupsLabel(definition.friendly)}\n對手 ${sizes.enemy} 人：${arenaTrialGroupsLabel(definition.enemy)}`
        row.append(head, details)
        if (unlocked) button(row, '接受試煉', () => this.host.accept({ kind: 'arena-trial', tier, arena }))
        content.append(row)
      }
    }
    panel.append(content); render()
  }}
