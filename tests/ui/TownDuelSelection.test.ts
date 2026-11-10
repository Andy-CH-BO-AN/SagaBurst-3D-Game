import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { createCareerDuelMission, type CareerDuelTier } from '../../src/career/CareerDuelState'
import { getUnitPresetsForFaction, type UnitPresetId } from '../../src/battle/UnitPresetCatalog'
import { TownScene } from '../../src/town/TownScene'

// Only the DOM boundary is a double; invoke the real UI methods without a TownScene constructor.
class Element {
  className = ''; textContent = ''; id = ''; tabIndex = 0; disabled = false; scrollTop = 0
  style: Record<string, string> = {}
  attributes: Record<string, string> = {}
  children: Element[] = []
  onclick: (() => void) | null = null
  onkeydown: ((event: KeyboardEvent) => void) | null = null
  constructor(readonly tag: string) {}
  append(...children: Element[]) { this.children.push(...children) }
  prepend(...children: Element[]) { this.children.unshift(...children) }
  replaceChildren(...children: Element[]) { this.children = children }
  setAttribute(name: string, value: string) { this.attributes[name] = value }
  focus() { focused = this }
  click() { if (!this.disabled) this.onclick?.() }
  descendants(): Element[] { return this.children.flatMap(child => [child, ...child.descendants()]) }
  querySelector(tag: string) { return this.descendants().find(child => child.tag === tag) ?? null }
}
let focused: Element | null = null
const dom = (element: Element) => element as unknown as HTMLElement

interface DuelSelectionEntry {
  profile: CareerProfile
  panel: HTMLElement
  duelActivity: 'duel' | 'race' | 'review'
  tutorial: { renderReviewContent(panel: HTMLElement): void }
  openDuelPage(panel: HTMLElement): void
  openDuelSelection(panel: HTMLElement, presetId?: UnitPresetId, mode?: 'armed' | 'unarmed', classTier?: CareerDuelTier): void
  openRacePage(panel: HTMLElement): void
  button(parent: HTMLElement, label: string, action: () => void): HTMLButtonElement
  acceptDuel(presetId: UnitPresetId | undefined, tier: CareerDuelTier, mode?: 'armed' | 'unarmed', classId?: string): void
  acceptRace(id: string): void
}

function selection(profile: CareerProfile) {
  vi.stubGlobal('document', { createElement: (tag: string) => new Element(tag) })
  const root = new Element('div'), accept = vi.fn()
  // One narrow adapter for the private UI entry points; no world, actors, or rendering fixtures.
  const methods = TownScene.prototype as unknown as DuelSelectionEntry
  const entry: DuelSelectionEntry = {
    profile, panel: dom(root), duelActivity: 'duel', acceptDuel: accept, acceptRace: vi.fn(),
    tutorial: { renderReviewContent: panel => {
      const heading = document.createElement('h3'); heading.textContent = 'Review'; panel.append(heading)
    } },
    openDuelPage: methods.openDuelPage, openDuelSelection: methods.openDuelSelection,
    openRacePage: methods.openRacePage, button: methods.button,
  }
  entry.openDuelPage(dom(root))
  const content = root.children[1]
  const rows = () => content.descendants().filter(node => node.tag === 'article')
  const buttons = () => content.descendants().filter(node => node.tag === 'button')
  return { root, content, rows, buttons, accept, entry, tabs: root.children[0].children }
}

afterEach(() => { focused = null; vi.unstubAllGlobals() })

describe('Career Duel selection pages', () => {
  it('navigates units → tiers → units with independent unlocks and forwards only an enabled acceptance', () => {
    const profile: CareerProfile = { ...createCareerProfile('roman'), duelHighestDefeatedTierByPreset: { roman_heavy_infantry: 3 } }
    const before = JSON.stringify(profile), h = selection(profile)
    const presets = getUnitPresetsForFaction('roman')
    expect(h.buttons().map(button => button.textContent)).toEqual(['🥊 空手對戰 · Unarmed Duel', ...presets.map(preset => `${preset.nameEn} · ${preset.nameZh}`)])
    expect(h.rows()[0].children[1].textContent).toBe('T1 已解鎖 · T2 已解鎖 · T3 已解鎖 · T4 已解鎖 · T5 Locked')
    h.root.scrollTop = 500; h.content.scrollTop = 300
    h.buttons()[1].click()
    expect(h.root.scrollTop).toBe(0); expect(h.content.scrollTop).toBe(0)
    expect(focused).toBe(h.content.querySelector('h3'))
    expect(h.buttons()[0].textContent).toBe('← 返回兵種列表')
    expect(h.rows().map(row => row.children[0].textContent)).toEqual([
      'T1 Heavy Infantry', 'T2 Heavy Infantry', 'T3 Heavy Infantry', 'T4 Heavy Infantry', 'T5 Heavy Infantry',
    ])
    expect(h.rows().map(row => row.children[2].disabled)).toEqual([false, false, false, false, true])
    h.rows()[4].children[2].click(); expect(h.accept).not.toHaveBeenCalled()
    h.rows()[2].children[2].click(); expect(h.accept).toHaveBeenCalledExactlyOnceWith('roman_heavy_infantry', 3); h.accept.mockClear()
    // T4 adds a class step: Tier → class → accept, each step reversible without leaving the dialogue.
    h.rows()[3].children[2].click(); expect(h.accept).not.toHaveBeenCalled()
    expect(h.buttons()[0].textContent).toBe('← 返回等級列表')
    expect(h.rows().map(row => row.children[0].textContent)).toEqual(['禁衛軍隊長 Praetorian Captain · T4', '百夫長 Centurion · T4'])
    h.buttons()[0].click(); expect(h.rows()).toHaveLength(5)
    h.rows()[3].children[2].click(); h.rows()[1].children[2].click()
    expect(h.accept).toHaveBeenCalledExactlyOnceWith('roman_heavy_infantry', 4, 'armed', 'centurion')
    h.buttons()[0].click(); h.root.scrollTop = 400; h.buttons()[0].click()
    expect(h.root.scrollTop).toBe(0); expect(h.rows()).toHaveLength(presets.length)
    h.buttons()[2].click()
    expect(h.content.querySelector('h3')!.textContent).toContain(presets[1].nameZh)
    expect(h.rows().map(row => row.children[2].disabled)).toEqual([false, true, true, true, true])
    expect(JSON.stringify(profile)).toBe(before)
  })

  it('clears Viking tier content across Racing/Review tabs and preserves arrow/Home/End keyboard navigation', () => {
    const h = selection(createCareerProfile('viking')), presets = getUnitPresetsForFaction('viking')
    h.buttons().at(-1)!.click()
    expect(h.rows()).toHaveLength(5)
    h.root.scrollTop = 400; h.tabs[1].click()
    expect(h.root.scrollTop).toBe(0)
    expect(h.content.querySelector('h3')!.textContent).toContain('Racing')
    expect(h.buttons().every(button => button.textContent === '接受賽馬')).toBe(true)
    h.tabs[2].click(); expect(h.content.children.map(node => node.textContent)).toEqual(['Review'])
    const key = (index: number, value: string) => {
      const preventDefault = vi.fn()
      h.tabs[index].onkeydown!({ key: value, preventDefault } as unknown as KeyboardEvent)
      expect(preventDefault).toHaveBeenCalledOnce()
    }
    key(2, 'ArrowRight')
    expect(h.rows()).toHaveLength(presets.length)
    expect(h.buttons().map(button => button.textContent)).toEqual(['🥊 空手對戰 · Unarmed Duel', ...presets.map(preset => `${preset.nameEn} · ${preset.nameZh}`)])
    expect(h.tabs.map(tab => [tab.attributes['aria-selected'], tab.tabIndex])).toEqual([['true', 0], ['false', -1], ['false', -1]])
    expect(h.content.attributes['aria-labelledby']).toBe(h.tabs[0].id)
    expect(focused).toBe(h.tabs[0])
    key(0, 'End'); expect(focused).toBe(h.tabs[2])
    key(2, 'ArrowLeft'); expect(focused).toBe(h.tabs[1])
    key(1, 'Home'); expect(focused).toBe(h.tabs[0])
    expect(h.buttons()).toHaveLength(presets.length + 1)
    expect(h.accept).not.toHaveBeenCalled()
  })
})


it('空手頁面立即切到自己的 T1–T5，與武裝進度分開並送出明確模式', () => {
  const h = selection({ ...createCareerProfile('roman'), unarmedDuelHighestDefeatedTier: 1,
    duelHighestDefeatedTierByPreset: { roman_heavy_infantry: 4 } })
  h.buttons()[0].click()
  expect(h.content.querySelector('h3')!.textContent).toContain('空手對戰')
  expect(h.rows()).toHaveLength(5)
  expect(h.rows().map(row => row.children[2].disabled)).toEqual([false, false, true, true, true])
  expect(h.rows()[1].children[1].textContent).toContain('90 秒')
  h.rows()[2].children[2].click(); expect(h.accept).not.toHaveBeenCalled()
  h.rows()[1].children[2].click()
  expect(h.accept).toHaveBeenCalledExactlyOnceWith(undefined, 2, 'unarmed')
})

describe('Career Duel resume after a deployment failure', () => {
  interface ResumeEntry {
    disposed: boolean; profile: CareerProfile; panel: Element | null
    preloadDuelOpponent: ReturnType<typeof vi.fn>; duel: { startActiveMission: ReturnType<typeof vi.fn> }
    inventory: { prepareForCombat: ReturnType<typeof vi.fn> }; closePanel: ReturnType<typeof vi.fn>; returnToTown: ReturnType<typeof vi.fn>
    openPanel(title: string): void; button(parent: HTMLElement, label: string, action: () => void): void
    deployActiveDuel(): Promise<boolean>; showDuelDeployFailure(): void
  }
  const resume = (preload: boolean, start: boolean) => {
    vi.stubGlobal('document', { createElement: (tag: string) => new Element(tag) })
    const profile = createCareerProfile('roman'), proto = TownScene.prototype as unknown as ResumeEntry
    profile.activeMission = createCareerDuelMission({ ...profile, duelHighestDefeatedTierByPreset: { roman_heavy_infantry: 3 } }, 'roman_heavy_infantry', 4, 'captain', 'captain', 'resume', 'ranger', 'armed', 'centurion')!
    const entry: ResumeEntry = { disposed: false, profile, panel: null, preloadDuelOpponent: vi.fn(async () => preload), duel: { startActiveMission: vi.fn(() => start) },
      inventory: { prepareForCombat: vi.fn() }, closePanel: vi.fn(), returnToTown: vi.fn(),
      openPanel() { entry.panel = new Element('div') }, button: (parent, label, action) => { const b = new Element('button'); b.textContent = label; b.onclick = action; (parent as unknown as Element).append(b) },
      deployActiveDuel: proto.deployActiveDuel, showDuelDeployFailure: proto.showDuelDeployFailure }
    return entry
  }
  it('reports a failed asset load without starting the duel or touching the saved mission, then retries or cancels without settlement', async () => {
    const entry = resume(false, true), before = JSON.stringify(entry.profile.activeMission)
    expect(await entry.deployActiveDuel()).toBe(false)
    expect(entry.preloadDuelOpponent).toHaveBeenCalledWith('roman_heavy_infantry', 4, 'centurion'); expect(entry.duel.startActiveMission).not.toHaveBeenCalled()
    entry.showDuelDeployFailure()
    const [retry, cancel] = entry.panel!.children
    entry.preloadDuelOpponent.mockResolvedValue(true); retry.click(); await vi.waitFor(() => expect(entry.closePanel).toHaveBeenCalledOnce())
    expect(entry.duel.startActiveMission).toHaveBeenCalledOnce(); expect(entry.inventory.prepareForCombat).toHaveBeenCalledOnce()
    cancel.click(); expect(entry.returnToTown).toHaveBeenCalledExactlyOnceWith('direct')
    expect(JSON.stringify(entry.profile.activeMission)).toBe(before)
  })
  it('treats a duel that cannot be built as a failed deployment too', async () => {
    expect(await resume(true, false).deployActiveDuel()).toBe(false)
    expect(await resume(true, true).deployActiveDuel()).toBe(true)
  })
})

describe('Career Duel parked resident protection', () => {
  type Hits = { duel: { isParkedResident(target: unknown): boolean }; hitFieldNpc(...args: unknown[]): void; canHitTownMount(mount: unknown, source?: unknown): boolean }
  it('ignores damage from any source to a parked resident or its mount, while other targets keep normal handling', () => {
    const proto = TownScene.prototype as unknown as Hits
    const parkedNpc = { dead: false, takeDamage: vi.fn() }, parkedMount = { dead: false }, other = { dead: false }
    const self = { duel: { isParkedResident: (target: unknown) => target === parkedNpc || target === parkedMount },
      get retirementFinale() { throw new Error('reached normal damage handling') } } as unknown as Hits
    const hostile = { faction: 'enemy', unarmedContact: undefined }
    expect(() => proto.hitFieldNpc.call(self, parkedNpc, 50, 'melee', hostile)).not.toThrow()
    expect(parkedNpc.takeDamage).not.toHaveBeenCalled()
    expect(proto.canHitTownMount.call(self, parkedMount, hostile)).toBe(false)
    expect(() => proto.hitFieldNpc.call(self, other, 50, 'melee', hostile)).toThrow('normal damage handling')
  })
})
