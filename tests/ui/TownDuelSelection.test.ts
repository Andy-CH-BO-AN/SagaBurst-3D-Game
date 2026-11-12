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
  title = ''
  focus() {}
  click() { if (!this.disabled) this.onclick?.() }
  descendants(): Element[] { return this.children.flatMap(child => [child, ...child.descendants()]) }
  querySelector(tag: string) { return this.descendants().find(child => child.tag === tag) ?? null }
}
const dom = (element: Element) => element as unknown as HTMLElement

interface DuelSelectionEntry {
  profile: CareerProfile
  panel: HTMLElement
  duelActivity: 'duel' | 'race' | 'review'
  tutorial: { renderReviewContent(panel: HTMLElement): void }
  openDuelPage(panel: HTMLElement): void
  openDuelSelection(panel: HTMLElement): void
  duelArenaSelector(): HTMLElement
  duelArenaChoice: string | null
  duelSubjectKey: string
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
    profile, panel: dom(root), duelActivity: 'duel', duelSubjectKey: 'unarmed', acceptDuel: accept, acceptRace: vi.fn(),
    tutorial: { renderReviewContent: panel => {
      const heading = document.createElement('h3'); heading.textContent = 'Review'; panel.append(heading)
    } },
    openDuelPage: methods.openDuelPage, openDuelSelection: methods.openDuelSelection,
    duelArenaSelector: methods.duelArenaSelector, duelArenaChoice: null,
    openRacePage: methods.openRacePage, button: methods.button,
  }
  entry.openDuelPage(dom(root))
  const content = root.children[1]
  const rows = () => content.descendants().filter(node => node.tag === 'article')
  const buttons = () => content.descendants().filter(node => node.tag === 'button')
  return { root, content, rows, buttons, accept, entry, tabs: root.children[0].children }
}

afterEach(() => { vi.unstubAllGlobals() })

describe('Career Duel selection pages', () => {
  const find = (h: ReturnType<typeof selection>, label: string) => h.content.descendants().find(n => n.tag === 'button' && n.children[0]?.textContent === label)!
  const tierRows = (h: ReturnType<typeof selection>) => h.content.descendants().filter(n => n.tag === 'article')
  const actions = (row: Element) => (row.children[2]?.children ?? []).flatMap(c => c.tag === 'div' ? c.children.filter(n => n.tag === 'button') : [c])

  it('manages Duel tier unlocking, unarmed and armed class choices, and forwards selected class options', () => {
    const profile: CareerProfile = { ...createCareerProfile('roman'), duelHighestDefeatedTierByPreset: { roman_heavy_infantry: 3 }, unarmedDuelHighestDefeatedTier: 1 }
    const h = selection(profile)
    const presets = getUnitPresetsForFaction('roman')

    // Unarmed T1-T5 states: T1 completed, T2 available, T3-T5 locked
    expect(tierRows(h).map(r => r.className.split(' ')[1])).toEqual(['duel-tier-completed', 'duel-tier-available', 'duel-tier-locked', 'duel-tier-locked', 'duel-tier-locked'])
    actions(tierRows(h)[1])[0].click(); expect(h.accept).toHaveBeenCalledExactlyOnceWith(undefined, 2, 'unarmed'); h.accept.mockClear()
    expect(actions(tierRows(h)[2])).toHaveLength(0) // Locked tier cannot be challenged

    // Switch to heavy infantry: T1-T3 completed, T4 available with special classes, T5 locked
    find(h, presets[0].nameZh).click()
    expect(tierRows(h).map(r => r.className.split(' ')[1])).toEqual(['duel-tier-completed', 'duel-tier-completed', 'duel-tier-completed', 'duel-tier-available', 'duel-tier-locked'])
    actions(tierRows(h)[2])[0].click(); expect(h.accept).toHaveBeenCalledExactlyOnceWith('roman_heavy_infantry', 3, 'armed'); h.accept.mockClear()

    // T4 offers Praetorian Captain and Centurion
    expect(actions(tierRows(h)[3]).map(b => b.textContent)).toEqual(['挑戰 禁衛軍隊長', '挑戰 百夫長'])
    actions(tierRows(h)[3])[1].click()
    expect(h.accept).toHaveBeenCalledExactlyOnceWith('roman_heavy_infantry', 4, 'armed', 'centurion')
    expect(actions(tierRows(h)[4])).toHaveLength(0) // T5 locked
  })
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
  it('reports failed asset load or build without starting duel, retrying cleanly on success', async () => {
    // Unbuildable duel
    expect(await resume(true, false).deployActiveDuel()).toBe(false)
    expect(await resume(true, true).deployActiveDuel()).toBe(true)

    // Asset load failure with retry
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
