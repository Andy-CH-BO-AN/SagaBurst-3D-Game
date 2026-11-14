import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Vector3 } from 'three'
import { createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { createCareerTutorialState, recordCareerTutorialOperation, recordCareerTutorialPurchase, CAREER_TUTORIAL_OPERATIONS } from '../../src/career/CareerTutorialState'
import { startCareerTutorial } from '../../src/career/CareerTutorial'
import { TownTutorialController, type TownTutorialHost } from '../../src/town/TownTutorialController'
import { getTownCommandWatchtowerLayout } from '../../src/town/TownCommandWatchtowerLayout'
import { townAuthoredRoster } from '../../src/town/TownRules'
import { TownScene } from '../../src/town/TownScene'
import { TownMissionBoard } from '../../src/town/TownMissionBoard'
import { storyDialogueOpen } from '../../src/career/CareerStoryGuidance'

class MockElement {
  id = ''
  className = ''
  private ownText = ''
  get textContent(): string { return this.ownText + this.children.map(child => child.textContent).join('') }
  set textContent(value: string) { this.ownText = value; this.children = [] }
  hidden = false
  disabled = false
  style: Record<string, string> = {}
  children: MockElement[] = []
  parent: MockElement | null = null
  onclick: (() => void) | null = null

  constructor(readonly tagName: string) {}

  setAttribute(): void {}
  getAttribute(name: string): string | null { return name === 'style' ? JSON.stringify(this.style) : null }
  get parentElement(): MockElement | null { return this.parent }
  closest(): MockElement | null { return this.hidden ? this : this.parent?.closest() ?? null }
  getBoundingClientRect() {
    const width = Number.parseFloat(this.style.width) || Math.min(500, window.innerWidth - 32)
    const left = this.style.left ? Number.parseFloat(this.style.left) : (window.innerWidth - width) / 2
    const top = Number.parseFloat(this.style.top) || 0
    return { left, right:left + width, top, bottom:top + 80, width, height:80 }
  }

  append(...children: MockElement[]): void {
    for (const child of children) {
      child.parent = this
      this.children.push(child)
    }
  }

  remove(): void {
    if (this.parent) {
      const idx = this.parent.children.indexOf(this)
      if (idx !== -1) this.parent.children.splice(idx, 1)
      this.parent = null
    }
  }

  querySelector<T extends MockElement = MockElement>(selector: string): T | null {
    return this.querySelectorAll<T>(selector)[0] ?? null
  }

  querySelectorAll<T extends MockElement = MockElement>(selector: string): T[] {
    const results: MockElement[] = []
    const tokens = selector.split(',').map(s => s.trim())
    const match = (el: MockElement): boolean => {
      return tokens.some(token => {
        if (token.startsWith('.')) {
          const cls = token.slice(1)
          return el.className.split(/\s+/).includes(cls)
        }
        return el.tagName.toLowerCase() === token.toLowerCase()
      })
    }
    const search = (el: MockElement) => {
      for (const child of el.children) {
        if (match(child)) results.push(child)
        search(child)
      }
    }
    search(this)
    return results as T[]
  }
}

function setupMockDOM() {
  const elements: MockElement[] = []
  const body = new MockElement('body')
  const doc = {
    body,
    querySelectorAll: () => [],
    createElement: (tag: string) => {
      const el = new MockElement(tag)
      elements.push(el)
      return el as unknown as HTMLElement
    },
  }
  vi.stubGlobal('document', doc)
  const addEventListener = vi.fn(), removeEventListener = vi.fn()
  const disconnectResize = vi.fn(), disconnectState = vi.fn()
  const viewport = { innerWidth:1366, innerHeight:768, addEventListener, removeEventListener }
  vi.stubGlobal('window', viewport)
  vi.stubGlobal('getComputedStyle', (el: MockElement) => ({ display:el.style.display ?? '', visibility:el.style.visibility ?? '', opacity:el.style.opacity ?? '1' }))
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect = disconnectResize })
  vi.stubGlobal('MutationObserver', class { observe() {} disconnect = disconnectState })
  return { body, elements, viewport, addEventListener, removeEventListener, disconnectResize, disconnectState }
}

function createHostHarness(initialProfile?: CareerProfile) {
  let profile = initialProfile ?? createCareerProfile('roman')
  if (!profile.tutorial) {
    profile.tutorial = createCareerTutorialState('recruit', true)
  }
  // Complete recruit training so town tutorial is available
  for (const op of CAREER_TUTORIAL_OPERATIONS.recruit.flat()) {
    recordCareerTutorialOperation(profile, 'recruit', op)
  }

  let closedCount = 0
  let recruitmentOpened = 0
  const servicesOpened: string[] = []
  let duelCount = 0
  const launches: { stage: string; replay: boolean }[] = []
  let failCommit = false

  const host: TownTutorialHost = {
    profile: () => profile,
    commit: next => {
      if (failCommit) return false
      profile = next
      return true
    },
    peaceful: () => true,
    blocked: () => false,
    playerPosition: () => new Vector3(0, 0, 0),
    playerHorse: () => false,
    cameraYaw: () => 0,
    npcPosition: id => {
      if (id === 'deployment') return new Vector3(10, 0, 10)
      if (id === 'merchant') return new Vector3(20, 0, 20)
      if (id === 'captain') return new Vector3(30, 0, 30)
      if (id === 'hr-officer') return new Vector3(40, 0, 40)
      if (id === 'ranger') return new Vector3(50, 0, 50)
      return null
    },
    tower: getTownCommandWatchtowerLayout(),
    roster: () => ({ contextId: 'town', members: townAuthoredRoster().map(a => ({ id: a.id, actorId: a.id, squadId: 1, state: 'deployed' as const, duty: a.duty })) }),
    launch: (stage, replay) => {
      launches.push({ stage, replay })
      return true
    },
    duel: () => { duelCount++ },
    closePanel: () => { closedCount++ },
    openRecruitmentPanel: () => { recruitmentOpened++ },
    openServices: id => { servicesOpened.push(id) },
    openPanel: (title, text) => {
      const p = new MockElement('div') as unknown as HTMLDivElement
      const h2 = new MockElement('h2')
      h2.textContent = title
      const pText = new MockElement('p')
      pText.textContent = text
      ;(p as unknown as MockElement).append(h2, pText)
      return p
    },
  }

  return {
    host,
    getProfile: () => profile,
    setProfile: (p: CareerProfile) => { profile = p },
    getClosedCount: () => closedCount,
    getRecruitmentOpened: () => recruitmentOpened,
    getServicesOpened: () => servicesOpened,
    getDuelCount: () => duelCount,
    getLaunches: () => launches,
    setFailCommit: (fail: boolean) => { failCommit = fail },
  }
}

describe('TownTutorialUX', () => {
  let dom: ReturnType<typeof setupMockDOM>

  beforeEach(() => {
    dom = setupMockDOM()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('keeps Sergeant mission tabs in normal services after bypassing a pending story invitation', () => {
    const profile = createCareerProfile('roman'); profile.rank = 'soldier'
    profile.careerStory!.events['veteran-squad-spar'] = { status: 'pending' }
    let panel = new MockElement('div')
    const board = new TownMissionBoard({ profile, tutorial: undefined, captainPatrol: undefined,
      defenseForce: () => ({ friendlyCombatants: 0 }), accept: vi.fn() })
    const scene = Object.create(TownScene.prototype) as TownScene
    const invitation = vi.fn()
    Object.assign(scene, { profile, missionBoard: board, player: { dead: false }, serviceAvailable: () => true,
      story: { hasDialogue: (id: string) => storyDialogueOpen(profile, id), renderDialogue: invitation },
      openPanel: () => { panel = new MockElement('div'); return panel }, tutorialBypass: true })
    const context = { townFaction: 'roman', npcRole: 'deployment', playerRank: 'soldier', firstMeet: false, promotionEligible: false } as const
    scene['openDeploymentPanel']('正式任務', context, false)
    Object.assign(scene, { tutorialBypass: false }) // The one-shot talk() bypass has ended before the next click.
    panel.querySelectorAll('button').find(button => button.textContent === '新兵任務')!.onclick!()
    expect(board.page).toBe('recruit')
    expect(panel.querySelectorAll('button').some(button => button.textContent === '士兵任務')).toBe(true)
    expect(invitation).not.toHaveBeenCalled()
    scene['openDeploymentPanel']('正式任務', context, false)
    expect(invitation).toHaveBeenCalledOnce()
  })

  it('可延後買武器直接開任務服務，日後實際購買仍只領一次獎勵', () => {
    const harness = createHostHarness(), ctrl = new TownTutorialController(harness.host)
    try {
      const panel = new MockElement('div')
      panel.append(new MockElement('h2'), new MockElement('p'))
      ctrl.renderDialogue(panel as unknown as HTMLElement, 'deployment')
      panel.querySelectorAll('button').find(button => button.textContent === '先空手接任務，稍後買武器')!.onclick!()
      expect(harness.getProfile().tutorial?.town.status).toBe('deferred')
      expect(harness.getServicesOpened()).toEqual(['deployment'])
      expect(ctrl.hasDialogue('deployment')).toBe(true)
      const before = harness.getProfile().availableMerit
      recordCareerTutorialPurchase(harness.getProfile(), 'weapon', 'gladius_rusty')
      ctrl.update(); ctrl.update()
      const awarded = harness.getProfile().availableMerit - before
      expect(awarded).toBeGreaterThan(0)
      expect(harness.getProfile().availableMerit).toBe(before + awarded)
      expect(harness.getProfile().tutorial?.town.status).toBe('deferred')
    } finally { ctrl.dispose() }
  })

  it('first talk to deployment presents recruit dialogue, handling later selection and acceptance', () => {
    const harness = createHostHarness()
    const ctrl = new TownTutorialController(harness.host)

    expect(ctrl.hasDialogue('deployment')).toBe(true)

    const panel = new MockElement('div') as unknown as HTMLElement
    const h2 = new MockElement('h2')
    const p = new MockElement('p')
    ;(panel as unknown as MockElement).append(h2, p)

    expect(ctrl.renderDialogue(panel, 'deployment')).toBe(true)
    expect(h2.textContent).toBe('士官長')
    expect(p.textContent).toContain('新兵，歡迎加入軍團！')

    const buttons = (panel as unknown as MockElement).querySelectorAll('button')
    expect(buttons.map(b => b.textContent)).toEqual(['好，我這就去', '我晚點再去', '先空手接任務，稍後買武器', '查看正式任務與其他服務'])

    // Escape hatch reaches the original Sergeant panel without advancing the tutorial
    buttons[3].onclick!()
    expect(harness.getServicesOpened()).toEqual(['deployment'])
    expect(harness.getProfile().tutorial?.town.step).toBe('report')

    // Click "我晚點再去" closes panel without advancing step and next talk still presents dialogue
    buttons[1].onclick!()
    expect(harness.getClosedCount()).toBe(1)
    expect(harness.getProfile().tutorial?.town.step).toBe('report')
    expect(ctrl.hasDialogue('deployment')).toBe(true)

    // Click accept advances to weapon step and updates hint
    buttons[0].onclick!()
    expect(harness.getClosedCount()).toBe(2)
    expect(harness.getProfile().tutorial?.town.step).toBe('weapon')

    ctrl.update()
    const hint = dom.elements.find(el => el.id === 'career-tutorial-hint')
    expect(hint?.textContent).toContain('前往武器店')

    ctrl.dispose()
  })

  it('weapon purchase awards 20 merit once and updates guide to return to deployment', () => {
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const harness = createHostHarness()
    const ctrl = new TownTutorialController(harness.host)

    // Advance to weapon step
    recordCareerTutorialOperation(harness.getProfile(), 'town', 'report')
    expect(harness.getProfile().tutorial?.town.step).toBe('weapon')

    const initialMerit = harness.getProfile().availableMerit

    // Buy a weapon
    recordCareerTutorialPurchase(harness.getProfile(), 'weapon', 'roman_sword_t1')

    ctrl.update()
    expect(harness.getProfile().tutorial?.town.step).toBe('duel-intro')
    const awardedMerit = harness.getProfile().availableMerit - initialMerit
    expect(awardedMerit).toBeGreaterThan(0)

    const hint = dom.elements.find(el => el.id === 'career-tutorial-hint')
    const notice = dom.elements.find(el => el.id === 'career-tutorial-notification')!
    expect(notice.textContent).toContain('軍功')
    expect(notice.hidden).toBe(false)
    expect(hint?.textContent).not.toContain('武器購買完成')
    expect(hint?.textContent).toContain('返回士官長')

    // Repeating update neither re-awards merit nor restarts the notification.
    now = 3499
    ctrl.update()
    expect(notice.hidden).toBe(false)
    now = 3500
    ctrl.update()
    expect(notice.hidden).toBe(true)
    expect(hint?.hidden).toBe(false)
    expect(hint?.textContent).toContain('返回士官長')
    expect(harness.getProfile().availableMerit).toBe(initialMerit + awardedMerit)

    ctrl.dispose()
  })

  it('accept duel-intro guides to captain, captain dialogue accepts and starts duel', () => {
    const harness = createHostHarness()
    const ctrl = new TownTutorialController(harness.host)

    // Set step to duel-intro
    recordCareerTutorialOperation(harness.getProfile(), 'town', 'report')
    recordCareerTutorialPurchase(harness.getProfile(), 'weapon', 'roman_sword_t1')
    recordCareerTutorialOperation(harness.getProfile(), 'town', 'weapon')

    expect(ctrl.hasDialogue('deployment')).toBe(true)

    const panel = new MockElement('div') as unknown as HTMLElement
    const h2 = new MockElement('h2')
    const p = new MockElement('p')
    ;(panel as unknown as MockElement).append(h2, p)

    ctrl.renderDialogue(panel, 'deployment')
    expect(p.textContent).toContain('我替你安排了一場與騎兵隊長的切磋')

    const buttons = (panel as unknown as MockElement).querySelectorAll('button')
    expect(buttons[0].textContent).toBe('當然，帶路吧！')

    // Accept duel challenge
    buttons[0].onclick!()
    expect(harness.getClosedCount()).toBe(1)
    expect(harness.getProfile().tutorial?.town.step).toBe('duel')

    ctrl.update()
    const hint = dom.elements.find(el => el.id === 'career-tutorial-hint')
    expect(hint?.textContent).toContain('挑戰騎兵隊長')

    // Now talk to captain
    expect(ctrl.hasDialogue('captain')).toBe(true)
    const captainPanel = new MockElement('div') as unknown as HTMLElement
    const capH2 = new MockElement('h2')
    const capP = new MockElement('p')
    ;(captainPanel as unknown as MockElement).append(capH2, capP)

    ctrl.renderDialogue(captainPanel, 'captain')
    expect(capH2.textContent).toBe('騎兵隊長')
    expect(capP.textContent).toContain('讓我看看你的實力')

    const capButtons = (captainPanel as unknown as MockElement).querySelectorAll('button')
    expect(capButtons[0].textContent).toBe('開始切磋')
    expect(capButtons[1].textContent).toBe('還沒準備好')

    capButtons[0].onclick!()
    expect(harness.getDuelCount()).toBe(1)

    ctrl.dispose()
  })

  it('save failure preserves dialogue with retry option and does not pretend accepted', () => {
    const harness = createHostHarness()
    const ctrl = new TownTutorialController(harness.host)

    const panel = new MockElement('div') as unknown as HTMLElement
    const h2 = new MockElement('h2')
    const p = new MockElement('p')
    ;(panel as unknown as MockElement).append(h2, p)

    ctrl.renderDialogue(panel, 'deployment')
    const buttons = (panel as unknown as MockElement).querySelectorAll('button')

    // Make save fail
    harness.setFailCommit(true)
    buttons[0].onclick!()

    // Panel is NOT closed!
    expect(harness.getClosedCount()).toBe(0)
    // Step is NOT advanced
    expect(harness.getProfile().tutorial?.town.step).toBe('report')

    // Error is displayed and button shows retry
    const errorEl = (panel as unknown as MockElement).querySelector('.town-save-error')
    expect(errorEl?.textContent).toContain('進度保存失敗')
    expect(buttons[0].textContent).toBe('重試')
    expect(buttons[0].disabled).toBe(false)

    // Rapid double click does not duplicate save while busy
    let commitsDuringBusy = 0
    harness.setFailCommit(false)
    const originalCommit = harness.host.commit
    harness.host.commit = p => {
      commitsDuringBusy++
      // while inside first commit, try clicking again
      buttons[0].onclick!()
      return originalCommit(p)
    }

    buttons[0].onclick!()

    expect(commitsDuringBusy).toBe(1)
    expect(harness.getClosedCount()).toBe(1)
    expect(harness.getProfile().tutorial?.town.step).toBe('weapon')

    ctrl.dispose()
  })

  it('missions intro accept advances to horse-intro, horse purchased awards 50 merit', () => {
    const harness = createHostHarness()
    const ctrl = new TownTutorialController(harness.host)

    // Complete report, weapon, duel-intro
    recordCareerTutorialOperation(harness.getProfile(), 'town', 'report')
    recordCareerTutorialPurchase(harness.getProfile(), 'weapon', 'roman_sword_t1')
    recordCareerTutorialOperation(harness.getProfile(), 'town', 'weapon')
    recordCareerTutorialOperation(harness.getProfile(), 'town', 'duel-intro')
    // Duel finish
    harness.getProfile().tutorial!.duelOutcome = 'victory'
    ctrl.update()
    expect(harness.getProfile().tutorial?.town.step).toBe('missions')

    // Talk to deployment
    expect(ctrl.hasDialogue('deployment')).toBe(true)
    const panel = new MockElement('div') as unknown as HTMLElement
    const h2 = new MockElement('h2')
    const p = new MockElement('p')
    ;(panel as unknown as MockElement).append(h2, p)
    ctrl.renderDialogue(panel, 'deployment')
    expect(p.textContent).toContain('接下來去接幾個正式任務，累積軍功')

    const buttons = (panel as unknown as MockElement).querySelectorAll('button')
    buttons[0].onclick!() // "明白，我去接任務"
    expect(harness.getClosedCount()).toBe(1)
    expect(harness.getProfile().tutorial?.town.step).toBe('horse-intro')

    // While settled missions < 2, no dialogue
    expect(ctrl.hasDialogue('deployment')).toBe(false)

    // Settle 2 missions and give enough merit for horse
    harness.getProfile().tutorial!.settledMissionIds = ['m1', 'm2']
    harness.getProfile().availableMerit = 500

    expect(ctrl.hasDialogue('deployment')).toBe(true)
    ctrl.renderDialogue(panel, 'deployment')
    expect(p.textContent).toContain('是時候給自己配備一匹真正的戰馬了')

    const horseButtons = (panel as unknown as MockElement).querySelectorAll('button')
    horseButtons[0].onclick!() // "好，我去挑選戰馬"
    expect(harness.getProfile().tutorial?.town.step).toBe('horse')

    // Buy horse
    harness.getProfile().tutorial!.purchases.horse = true
    const meritBefore = harness.getProfile().availableMerit
    ctrl.update()
    const awardedMerit = harness.getProfile().availableMerit - meritBefore
    expect(awardedMerit).toBeGreaterThan(0)
    expect(harness.getProfile().tutorial?.town.step).toBe('horse-use')
    expect(dom.elements.find(el => el.id === 'career-tutorial-notification')?.textContent).toContain('軍功')

    ctrl.dispose()
  })

  it('lets a story invitation take the arrow from a passive wait, but never from an accepted tutorial step', () => {
    const hint = () => dom.elements.find(el => el.id === 'career-tutorial-hint')!
    const harness = createHostHarness()
    const ctrl = new TownTutorialController({ ...harness.host, storyGuiding: () => true })
    // Accepted first step ("report to the Sergeant"): the tutorial keeps the arrow and the Sergeant's dialogue.
    ctrl.update()
    expect(ctrl.occupiesGuidance()).toBe(true)
    expect(hint().hidden).toBe(false); expect(hint().textContent).toContain('向士官長報到')
    // Waiting for the first two real missions asks for nothing now, so the story may speak instead.
    const profile = harness.getProfile()
    recordCareerTutorialOperation(profile, 'town', 'report')
    recordCareerTutorialPurchase(profile, 'weapon', 'roman_sword_t1')
    recordCareerTutorialOperation(profile, 'town', 'weapon')
    recordCareerTutorialOperation(profile, 'town', 'duel-intro')
    profile.tutorial!.duelOutcome = 'victory'
    ctrl.update() // Commits a clone: read the live profile again, not the one captured above.
    recordCareerTutorialOperation(harness.getProfile(), 'town', 'missions')
    expect(harness.getProfile().tutorial!.town.step).toBe('horse-intro')
    ctrl.update()
    expect(ctrl.occupiesGuidance()).toBe(false); expect(ctrl.hasDialogue('deployment')).toBe(false)
    expect(hint().hidden).toBe(true)
    const quiet = new TownTutorialController(harness.host)
    const quietHint = dom.elements.filter(el => el.id === 'career-tutorial-hint').at(-1)!
    quiet.update()
    expect(quietHint.hidden).toBe(false); expect(quietHint.textContent).toContain('完成正式戰鬥任務')
    quiet.dispose(); ctrl.dispose()
  })

  const dialoguePanel = () => {
    const panel = new MockElement('div')
    const body = new MockElement('p')
    panel.append(new MockElement('h2'), body)
    return { panel: panel as unknown as HTMLElement, buttons: () => panel.querySelectorAll('button') }
  }

  it('captain, HR, and commander dialogues accept and close correctly', () => {
    const harness = createHostHarness()
    const ctrl = new TownTutorialController(harness.host)

    // Captain dialogue (town recruit tutorial completed)
    harness.getProfile().tutorial!.town.status = 'completed'
    harness.getProfile().tutorial!.captain.status = 'available'
    expect(ctrl.hasDialogue('deployment')).toBe(true)

    const panel = new MockElement('div') as unknown as HTMLElement
    const h2 = new MockElement('h2')
    const p = new MockElement('p')
    ;(panel as unknown as MockElement).append(h2, p)

    ctrl.renderDialogue(panel, 'deployment')
    expect(p.textContent).toContain('恭喜你晉升為騎兵隊長')
    const captainButtons = (panel as unknown as MockElement).querySelectorAll('button')
    captainButtons[0].onclick!()
    expect(harness.getLaunches()).toEqual([{ stage: 'captain', replay: false }])

    // HR dialogue
    harness.getProfile().tutorial!.hr.status = 'available'
    expect(ctrl.hasDialogue('hr-officer')).toBe(true)
    ctrl.renderDialogue(panel, 'hr-officer')
    expect(p.textContent).toContain('在 HR Center，你可以招募專屬於你的私人戰友')
    const hrButtons = (panel as unknown as MockElement).querySelectorAll('button')
    hrButtons[0].onclick!() // "開始招募戰友"
    expect(harness.getProfile().tutorial?.hr.status).toBe('active')
    expect(harness.getRecruitmentOpened()).toBe(1)

    // Commander dialogue
    harness.getProfile().tutorial!.commander.status = 'available'
    expect(ctrl.hasDialogue('commander')).toBe(true)
    ctrl.renderDialogue(panel, 'commander')
    expect(p.textContent).toContain('登上指揮塔頂，你將俯瞰整個城鎮的四門防線')
    const cmdButtons = (panel as unknown as MockElement).querySelectorAll('button')
    cmdButtons[0].onclick!() // "前往指揮塔"
    expect(harness.getProfile().tutorial?.commander.status).toBe('active')

    // Captain duel dialogue keeps regular services/promotion entry (#455 merged)
    const duelPanel = dialoguePanel()
    harness.getProfile().tutorial!.town.status = 'active'
    harness.getProfile().tutorial!.town.step = 'duel'
    expect(ctrl.hasDialogue('captain')).toBe(true)
    ctrl.renderDialogue(duelPanel.panel, 'captain')
    const duelButtons = duelPanel.buttons()
    expect(duelButtons.map(b => b.textContent)).toEqual(['開始切磋', '還沒準備好', '任命／其他服務'])
    duelButtons[2].onclick!()
    expect(harness.getServicesOpened()).toContain('captain')
    expect(harness.getDuelCount()).toBe(0)

    ctrl.dispose()
  })

  it('review training is accessible and replay does not award duplicate merit', () => {
    const harness = createHostHarness()
    const ctrl = new TownTutorialController(harness.host)

    // Initially recruit is completed
    expect(ctrl.hasReviewOptions()).toBe(true)

    ctrl.openReviewPanel()
    // Host openPanel was called with '回顧訓練'
    // Now simulate replaying recruit: launch with replay=true
    expect(harness.getLaunches()).toEqual([])
    // Complete town as well
    harness.getProfile().tutorial!.town.status = 'completed'
    startCareerTutorial(harness.getProfile(), 'town', true)
    expect(harness.getProfile().tutorial?.town.replay).toBe(true)

    // Review content: only completed tutorials appear as replay options, uncompleted do not (#458 merged)
    const reviewContent = new MockElement('section') as unknown as HTMLElement
    const t = harness.getProfile().tutorial!
    t.recruit.status = 'completed'
    t.town.status = 'completed'
    t.captain.status = 'available' // not completed
    t.hr.status = 'locked'
    t.commander.status = 'locked'

    ctrl.renderReviewContent(reviewContent)
    const renderedButtons = (reviewContent as unknown as MockElement).querySelectorAll('button')
    const buttonTexts = renderedButtons.map(b => b.textContent)
    expect(buttonTexts).toEqual(['重播操作練習', '重播城鎮訓練'])
    expect(buttonTexts).not.toContain('重播隊長指揮演練')

    // Empty review content when no tutorials are completed
    t.recruit.status = 'active'
    t.town.status = 'active'
    const emptyReviewContent = new MockElement('section') as unknown as HTMLElement
    ctrl.renderReviewContent(emptyReviewContent)
    expect((emptyReviewContent as unknown as MockElement).querySelectorAll('button').length).toBe(0)

    ctrl.dispose()
  })

  it('never-started legacy stages stay opt-in, while skipped stages are guided and resume directly from the Sergeant', () => {
    const harness = createHostHarness()
    const ctrl = new TownTutorialController(harness.host)
    const t = harness.getProfile().tutorial!
    t.legacy = true
    t.recruit.status = 'completed'
    t.town.status = 'deferred'
    t.captain.status = 'deferred'
    t.commander.status = 'deferred'

    expect(ctrl.hasDialogue('deployment')).toBe(false)
    ctrl.update()
    expect(dom.elements.find(el => el.id === 'career-tutorial-hint')!.textContent).toBe('')
    const side = dialoguePanel()
    ctrl.appendPanel(side.panel, 'deployment')
    expect(side.buttons().map(b => b.textContent)).toEqual(['繼續新兵訓練', '繼續 30 人指揮演練', '繼續指揮塔訓練'])

    // A real skip keeps progress: the HUD points back to the Sergeant and the dialogue keeps the regular menu reachable.
    t.legacy = false
    t.captain.status = 'locked'; t.commander.status = 'locked'
    t.town.operations = ['report']; t.town.step = 'weapon'
    ctrl.update()
    expect(dom.elements.find(el => el.id === 'career-tutorial-hint')!.textContent).toContain('新手教學尚未完成返回士官長，繼續上次教學')
    expect(ctrl.hasDialogue('deployment')).toBe(true)
    const resume = dialoguePanel()
    ctrl.renderDialogue(resume.panel, 'deployment')
    expect(resume.buttons().map(b => b.textContent)).toEqual(['繼續上次教學', '稍後再說', '查看正式任務與其他服務'])
    resume.buttons()[2].onclick!()
    expect(harness.getServicesOpened()).toEqual(['deployment'])
    expect(harness.getProfile().tutorial!.town).toMatchObject({ status: 'deferred', step: 'weapon', operations: ['report'] })
    resume.buttons()[0].onclick!()
    expect(harness.getProfile().tutorial!.town).toMatchObject({ status: 'active', step: 'weapon', operations: ['report'] })
    const later = harness.getProfile().tutorial!
    later.town.status = 'completed'; later.town.step = 'complete'
    later.captain.status = 'deferred'; later.commander.status = 'deferred'

    // Captain/commander resume: tutorial NPC dialogue offers acceptance for deferred as well.
    const commander = dialoguePanel()
    expect(ctrl.hasDialogue('commander')).toBe(true)
    ctrl.renderDialogue(commander.panel, 'commander')
    commander.buttons()[0].onclick!()
    expect(harness.getProfile().tutorial?.commander.status).toBe('active')

    // Failed save keeps the status unchanged.
    harness.getProfile().tutorial!.hr.status = 'deferred'
    const hr = dialoguePanel()
    harness.setFailCommit(true)
    ctrl.renderDialogue(hr.panel, 'hr-officer')
    hr.buttons()[0].onclick!()
    expect(harness.getProfile().tutorial?.hr.status).toBe('deferred')

    ctrl.dispose()
  })

  it('does not nag a paused replay, and keeps the Sergeant dialogue on the HUD target when several are deferred', () => {
    const harness = createHostHarness()
    const ctrl = new TownTutorialController(harness.host)
    const t = harness.getProfile().tutorial!
    t.town.status = 'locked'
    t.recruit.status = 'deferred'; t.recruit.replay = true
    expect(ctrl.hasDialogue('deployment')).toBe(false)
    ctrl.update()
    expect(dom.elements.find(el => el.id === 'career-tutorial-hint')!.textContent).toBe('')

    t.recruit.status = 'completed'; t.recruit.replay = false
    t.town.status = 'deferred'; t.town.operations = []; t.town.step = 'report'
    t.captain.status = 'deferred'
    const lead = dialoguePanel()
    ctrl.renderDialogue(lead.panel, 'deployment')
    expect(lead.buttons().map(b => b.textContent)).toEqual(['繼續 30 人指揮演練', '稍後再訓練', '查看正式任務與其他服務'])

    // When Town is active and Captain is deferred, keep Sergeant dialogue on HUD target
    t.town.status = 'active'; t.town.operations = ['report']; t.town.step = 'weapon'
    ctrl.update()
    expect(dom.elements.find(el => el.id === 'career-tutorial-hint')!.textContent).toContain('前往武器店')
    expect(ctrl.hasDialogue('deployment')).toBe(false)
    const side = dialoguePanel()
    ctrl.appendPanel(side.panel, 'deployment')
    expect(side.buttons().map(b => b.textContent)).toContain('繼續 30 人指揮演練')

    ctrl.dispose()
  })

  it('resumes a paused replay from the review page with its progress, without re-guiding or re-clearing it', () => {
    const harness = createHostHarness()
    const ctrl = new TownTutorialController(harness.host)
    const t = harness.getProfile().tutorial!
    t.town.status = 'deferred'; t.town.replay = true; t.town.operations = ['report']; t.town.step = 'weapon'
    t.recruit.status = 'deferred'; t.recruit.replay = true
    ctrl.update()
    expect(dom.elements.find(el => el.id === 'career-tutorial-hint')!.textContent).toBe('')
    expect(ctrl.hasReviewOptions()).toBe(true)
    const review = dialoguePanel()
    ctrl.renderReviewContent(review.panel)
    expect(review.buttons().map(b => b.textContent)).toEqual(['繼續重播操作練習', '繼續重播城鎮訓練'])
    review.buttons()[0].onclick!()
    expect(harness.getLaunches()).toEqual([{ stage: 'recruit', replay: true }])
    review.buttons()[1].onclick!()
    expect(harness.getProfile().tutorial!.town).toMatchObject({ status: 'active', replay: true, step: 'weapon', operations: ['report'] })
    ctrl.dispose()
  })

  it('review replay stays open and shows an error when saving fails', () => {
    const harness = createHostHarness()
    const ctrl = new TownTutorialController(harness.host)
    harness.getProfile().tutorial!.town.status = 'completed'
    let reviewPanel: HTMLElement | undefined
    const openPanel = harness.host.openPanel!
    harness.host.openPanel = (title, text) => (reviewPanel = openPanel(title, text))

    ctrl.openReviewPanel()
    const replay = (reviewPanel as unknown as MockElement).querySelectorAll('button').find(b => b.textContent === '重播城鎮訓練')!
    harness.setFailCommit(true)
    replay.onclick!()
    expect(harness.getClosedCount()).toBe(0)
    expect((reviewPanel as unknown as MockElement).querySelector('.town-save-error')).not.toBeNull()
    expect(harness.getProfile().tutorial?.town.status).toBe('completed')

    harness.setFailCommit(false)
    replay.onclick!()
    expect(harness.getClosedCount()).toBe(1)
    expect(harness.getProfile().tutorial?.town.status).toBe('active')

    ctrl.dispose()
  })

  it('deferred navigation-only Town steps resume in place, and bypass keeps native service buttons', () => {
    const harness = createHostHarness()
    const ctrl = new TownTutorialController(harness.host)
    const t = harness.getProfile().tutorial!
    t.town.status = 'deferred'
    t.town.step = 'weapon'
    t.town.operations = ['report']

    const side = dialoguePanel()
    ctrl.appendPanel(side.panel, 'deployment')
    expect(side.buttons().map(b => b.textContent)).toEqual(['繼續上次教學', '稍後再說', '查看正式任務與其他服務'])
    side.buttons()[0].onclick!()
    const resumed = harness.getProfile().tutorial!.town
    expect(harness.getClosedCount()).toBe(1)
    expect([resumed.status, resumed.step, resumed.operations]).toEqual(['active', 'weapon', ['report']])
    ctrl.update()
    expect(dom.elements.find(el => el.id === 'career-tutorial-hint')!.textContent).toContain('前往武器店')

    // horse-intro without the purchase prerequisites: resume shows the current goal, never an empty panel.
    const later = harness.getProfile().tutorial!
    later.town.status = 'deferred'; later.town.step = 'horse-intro'; later.settledMissionIds = ['m1']
    const horse = dialoguePanel()
    ctrl.appendPanel(horse.panel, 'deployment')
    horse.buttons()[0].onclick!()
    expect(harness.getProfile().tutorial!.town.status).toBe('active')
    ctrl.update()
    expect(dom.elements.find(el => el.id === 'career-tutorial-hint')!.textContent).toContain('完成正式戰鬥任務')

    // Explicit regular-service open must not be cleared by tutorial dialogue (native appointment button stays).
    harness.getProfile().tutorial!.town.status = 'active'
    harness.getProfile().tutorial!.town.step = 'duel'
    const captain = dialoguePanel()
    ;(captain.panel as unknown as MockElement).append(Object.assign(new MockElement('button'), { textContent: '接受任命' }))
    expect(ctrl.hasDialogue('captain')).toBe(true)
    ctrl.appendPanel(captain.panel, 'captain', true)
    expect(captain.buttons().map(b => b.textContent)).toEqual(['接受任命'])
    ctrl.appendPanel(captain.panel, 'captain')
    expect(captain.buttons().map(b => b.textContent)).not.toContain('接受任命')

    ctrl.dispose()
  })

  it('restores the same objective after panels and clears notices on leaving peaceful town; disposal releases HUD resources', () => {
    const harness = createHostHarness()
    const ctrl = new TownTutorialController(harness.host)
    ctrl.update()
    const hint = dom.elements.find(el => el.id === 'career-tutorial-hint')!
    const root = hint.parent!
    const count = dom.elements.length
    harness.host.blocked = () => true
    ctrl.update()
    expect(root.hidden).toBe(true)
    harness.host.blocked = () => false
    ctrl.update()
    expect(root.hidden).toBe(false)
    expect(hint.textContent).toContain('向士官長報到')
    expect(dom.elements.length).toBe(count)

    recordCareerTutorialOperation(harness.getProfile(), 'town', 'report')
    recordCareerTutorialPurchase(harness.getProfile(), 'weapon', 'roman_sword_t1')
    ctrl.update()
    const notice = dom.elements.find(el => el.id === 'career-tutorial-notification')!
    expect(notice.hidden).toBe(false)
    // The host uses this same eligibility gate for official missions, duels and races.
    harness.host.peaceful = () => false
    ctrl.update()
    expect(root.hidden).toBe(true)
    harness.host.peaceful = () => true
    ctrl.update()
    expect(notice.hidden).toBe(true)
    expect(root.hidden).toBe(false)
    ctrl.dispose()
    expect(dom.body.children).toHaveLength(0)
    expect(dom.removeEventListener).toHaveBeenCalledWith('resize', dom.addEventListener.mock.calls[0][1])
    expect(dom.disconnectResize).toHaveBeenCalledOnce()
    expect(dom.disconnectState).toHaveBeenCalledOnce()
    const reentry = new TownTutorialController(harness.host)
    reentry.update()
    expect(dom.body.children).toHaveLength(2) // One HUD, one existing MissionGuide.
    reentry.dispose()
    expect(dom.body.children).toHaveLength(0)
  })

  it('keeps failed purchase progress visible through notification expiry and retries without duplicating rewards', () => {
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const harness = createHostHarness()
    const ctrl = new TownTutorialController(harness.host)
    recordCareerTutorialOperation(harness.getProfile(), 'town', 'report')
    recordCareerTutorialPurchase(harness.getProfile(), 'weapon', 'roman_sword_t1')
    ctrl.update() // A previous success notice is still pending when the next write fails.
    const merit = harness.getProfile().availableMerit
    for (const op of ['duel-intro', 'duel', 'missions', 'horse-intro']) recordCareerTutorialOperation(harness.getProfile(), 'town', op)
    recordCareerTutorialPurchase(harness.getProfile(), 'mount', 'horse')
    harness.setFailCommit(true)
    ctrl.update()
    const error = dom.elements.find(el => el.id === 'career-tutorial-error')!
    const notice = dom.elements.find(el => el.id === 'career-tutorial-notification')!
    expect(error.hidden).toBe(false)
    expect(error.textContent).toContain('自動重試')
    expect(notice.hidden).toBe(true)
    expect(harness.getProfile().availableMerit).toBe(merit)
    now = 5000
    ctrl.update()
    expect(error.hidden).toBe(false)
    expect(harness.getProfile().tutorial!.town.step).toBe('horse')
    now = 6500
    harness.setFailCommit(false)
    ctrl.update()
    expect(error.hidden).toBe(true)
    expect(notice.hidden).toBe(false)
    expect(notice.textContent).toContain('軍功')
    const awarded = harness.getProfile().availableMerit - merit
    expect(awarded).toBeGreaterThan(0)
    now = 10000
    ctrl.update()
    expect(notice.hidden).toBe(true)
    expect(harness.getProfile().availableMerit).toBe(merit + awarded)
    ctrl.dispose()
  })

})
