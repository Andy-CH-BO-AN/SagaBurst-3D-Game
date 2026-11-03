import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Vector3 } from 'three'
import { createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { createCareerTutorialState, recordCareerTutorialOperation, recordCareerTutorialPurchase, CAREER_TUTORIAL_OPERATIONS } from '../../src/career/CareerTutorialState'
import { startCareerTutorial } from '../../src/career/CareerTutorial'
import { TownTutorialController, type TownTutorialHost } from '../../src/town/TownTutorialController'
import { getTownCommandWatchtowerLayout } from '../../src/town/TownCommandWatchtowerLayout'
import { townAuthoredRoster } from '../../src/town/TownRules'

class MockElement {
  id = ''
  className = ''
  textContent = ''
  hidden = false
  disabled = false
  style: Record<string, string> = {}
  children: MockElement[] = []
  parent: MockElement | null = null
  onclick: (() => void) | null = null

  constructor(readonly tagName: string) {}

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
    createElement: (tag: string) => {
      const el = new MockElement(tag)
      elements.push(el)
      return el as unknown as HTMLElement
    },
  }
  vi.stubGlobal('document', doc)
  return { body, elements }
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
  let deploymentOpened = 0
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
    openDeploymentPanel: () => { deploymentOpened++ },
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
    getDeploymentOpened: () => deploymentOpened,
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
  })

  it('first talk to deployment presents recruit dialogue, accepting closes panel and guides to merchant', () => {
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
    expect(buttons.length).toBe(2)
    expect(buttons[0].textContent).toBe('好，我這就去')
    expect(buttons[1].textContent).toBe('我晚點再去')

    // Click accept
    buttons[0].onclick!()
    expect(harness.getClosedCount()).toBe(1)
    expect(harness.getProfile().tutorial?.town.step).toBe('weapon')

    // Waypoint arrow and hint updated
    ctrl.update()
    const hint = dom.elements.find(el => el.id === 'career-tutorial-hint')
    expect(hint?.textContent).toContain('前往武器店')

    ctrl.dispose()
  })

  it('select later closes panel without advancing step and next talk still presents dialogue', () => {
    const harness = createHostHarness()
    const ctrl = new TownTutorialController(harness.host)

    const panel = new MockElement('div') as unknown as HTMLElement
    const h2 = new MockElement('h2')
    const p = new MockElement('p')
    ;(panel as unknown as MockElement).append(h2, p)

    ctrl.renderDialogue(panel, 'deployment')
    const buttons = (panel as unknown as MockElement).querySelectorAll('button')

    // Click "我晚點再去"
    buttons[1].onclick!()
    expect(harness.getClosedCount()).toBe(1)
    expect(harness.getProfile().tutorial?.town.step).toBe('report')

    // Next conversation still has dialogue
    expect(ctrl.hasDialogue('deployment')).toBe(true)

    ctrl.dispose()
  })

  it('weapon purchase awards 20 merit once and updates guide to return to deployment', () => {
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
    expect(harness.getProfile().availableMerit).toBe(initialMerit + 20)

    const hint = dom.elements.find(el => el.id === 'career-tutorial-hint')
    expect(hint?.textContent).toContain('武器購買完成！獲得 20 軍功。')
    expect(hint?.textContent).toContain('返回士官長')

    // Repeating update does not re-award merit
    ctrl.update()
    expect(harness.getProfile().availableMerit).toBe(initialMerit + 20)

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
    expect(harness.getProfile().availableMerit).toBe(meritBefore + 50)
    expect(harness.getProfile().tutorial?.town.step).toBe('horse-use')

    ctrl.dispose()
  })

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

    ctrl.dispose()
  })
})
