import { afterEach,describe,expect,it,vi } from 'vitest'
import { createCareerDuelMission } from '../../src/career/CareerDuelState'
import { acceptCareerOutpost } from '../../src/career/CareerOutpostMission'
import { changePersonalEquipment,recruitPersonalSquadMember } from '../../src/career/CareerPersonalSquad'
import { createCareerProfile,type CareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import type { PersonalSquadState } from '../../src/town/TownPersonalSquadController'
import { purchaseTownEquipment } from '../../src/town/TownRules'
import { TownScene } from '../../src/town/TownScene'
import { squadEquipmentUI,townEquipmentUI,type TownEquipmentMemberView,type TownEquipmentSquadView,type TownEquipmentUIBindings } from '../../src/town/TownSquadEquipmentUI'
import { type EquipmentSquadAdapter } from '../../src/ui/EquipmentUI'
import { MemoryStorage } from '../helpers/memoryStorage'

// DOM boundary only; profile, inventory and equipment changes use production code, with no actors.
class Element {
  className = ''; textContent = ''; value = ''; title = ''; disabled = false
  id = ''; type = ''; hidden = false; tabIndex = 0; inert = false
  classList = { add() {}, remove() {} }
  onkeydown: ((event: KeyboardEvent) => void) | null = null
  set innerHTML(_value: string) { this.children = [] }
  focus() {}
  dataset: Record<string, string> = {}
  style: Record<string, string> = {}
  attributes: Record<string, string> = {}
  children: Element[] = []
  options: { text: string; value: string }[] = []
  onchange: (() => void) | null = null
  onclick: (() => void) | null = null
  constructor(readonly tag: string) {}
  append(...children: Element[]) { this.children.push(...children) }
  appendChild(child: Element) { this.children.push(child) }
  getAttribute(name: string) { return this.attributes[name] ?? null }
  setAttribute(name: string, value: string) { this.attributes[name] = value }
  add(option: { text: string; value: string }) { this.options.push(option) }
  descendants(): Element[] { return this.children.flatMap(child => [child, ...child.descendants()]) }
}

function harness() {
  vi.stubGlobal('document', { createElement: (tag: string) => new Element(tag) })
  vi.stubGlobal('Option', class { constructor(readonly text: string, readonly value: string) {} })
  let profile: CareerProfile = { ...createCareerProfile('roman'), rank: 'captain', totalMerit: 60000, availableMerit: 60000,
    duelHighestDefeatedTierByPreset: { roman_heavy_infantry: 3 } }
  const store = new CareerProfileStore(new MemoryStorage())
  const save = (next: CareerProfile) => { if (!store.save(next)) return false; profile = next; return true }
  expect(recruitPersonalSquadMember(profile, 'captain', save).recruited).toBe(true)
  const purchase = purchaseTownEquipment(profile, 'maki-ranger-bow-ranged')
  expect(purchase.purchased).toBe(true)
  expect(save(purchase.profile)).toBe(true)
  const state: { state: PersonalSquadState } = { state: 'RESERVE' }
  const adapter = squadEquipmentUI(() => profile, () => state.state, (id, slot, item) =>
    changePersonalEquipment(() => profile, state, id, slot, item, save).changed ? '裝備已更新。' : '換裝失敗。')
  let root: Element
  function render() {
    root = new Element('div')
    // The renderer needs only append; this cast is confined to the DOM boundary.
    adapter.render(root as unknown as HTMLElement, render)
    return { notice: root.children[1].textContent, selects: root.descendants().filter(node => node.tag === 'select') }
  }
  return { render, adapter, state, store, read: () => profile, set: (next: CareerProfile) => { profile = next } }
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

interface RecruitmentTownCaller {
  profile: CareerProfile
  openRecruitmentPanel(response?: string): void
}

/** Real HR render, recruitment transaction, Town commit and serialization; no world or actors. */
function recruitmentHarness(rank: 'captain' | 'commander') {
  vi.stubGlobal('document', { createElement: (tag: string) => new Element(tag) })
  const profile: CareerProfile = { ...createCareerProfile('roman'), rank, totalMerit: 100000, availableMerit: 100000,
    townDialogueSeen: ['roman:hr-unlocked'] }
  const store = new CareerProfileStore(new MemoryStorage())
  expect(store.save(profile)).toBe(true)
  const save = vi.spyOn(store, 'save')
  let panel = new Element('div'), message = ''
  // The prototype seam omits render/actor state that neither this panel nor its commit consumes.
  const town = Object.assign(Object.create(TownScene.prototype) as RecruitmentTownCaller, {
    profile, store, skills: { skillState: profile.skills }, careerSkillSaveTimer: null,
    openPanel(_title: string, text: string) { message = text; panel = new Element('div'); return panel },
  })
  const commanderRow = () => panel.descendants().find(node => node.tag === 'article' && node.children[0]?.textContent === 'T5 Commander')!
  town.openRecruitmentPanel()
  return { town, store, save, row: commanderRow, message: () => message }
}

describe('Town HR recruitment controls', () => {

  it('explains the formal-rank requirement when a previously enabled Commander button becomes stale', () => {
    const h = recruitmentHarness('commander'), button = h.row().children[2]
    h.town.profile.rank = 'captain'
    button.onclick!()
    expect(h.save).not.toHaveBeenCalled()
    expect(h.town.profile.availableMerit).toBe(100000)
    expect(h.town.profile.personalSquad?.members ?? []).toHaveLength(0)
    expect(h.message()).toBe('需正式任命為 Commander 才能招募。')
    expect(h.row().children[2].disabled).toBe(true)
  })
})

describe('Town squad equipment availability and mission guidance', () => {

  it('unlocks when the mission is cleared and persists a selected Ranger Bow through the real equipment transaction', () => {
    const h = harness()
    h.set({ ...h.read(), activeMission: createCareerDuelMission(h.read(), 'roman_heavy_infantry', 4, 'opponent', 'referee', 'duel')! })
    h.render()
    const settled = { ...h.read() }; delete settled.activeMission; h.set(settled)
    const view = h.render()
    expect(view.selects.every(select => !select.disabled)).toBe(true)
    const ranged = view.selects.find(select => select.attributes['aria-label'] === 'T4 Captain #1 ranged')!
    expect(ranged.options.some(option => option.value === 'maki-ranger-bow-ranged')).toBe(true)
    ranged.value = 'maki-ranger-bow-ranged'; ranged.onchange!()
    expect(h.render().notice).toBe('裝備已更新。')
    expect(h.store.load()!.personalSquad!.members[0].equipment).toMatchObject({ ranged: 'maki-ranger-bow-ranged', shield: null })
    h.set(acceptCareerOutpost(h.read(), 1, 'next-outpost')!)
    expect(h.render().notice).toContain('任務尚未結算')
  })
})


/** Only the DOM boundary and domain callbacks are doubles; these cases own UI routing, not allocation rules. */
function townUIHarness(personal: EquipmentSquadAdapter = { render: vi.fn() }) {
  vi.stubGlobal('document', { createElement: (tag: string) => new Element(tag), getElementById: () => null })
  vi.stubGlobal('Option', class { constructor(readonly text: string, readonly value: string) {} })
  const civilian: TownEquipmentMemberView = { id: 'civilian-1', name: 'Civilian', tier: 1,
    equipment: { melee: { id: 'gladius', label: 'Gladius', tier: 1 }, ranged: { id: null, label: 'None' },
      shield: { id: null, label: 'None' }, mount: { id: null, label: 'None' } } }
  const names = ['北門步兵隊', '北門騎兵／指揮隊', '南門步兵隊', '南門騎兵隊', '東門步兵隊', '東門騎兵隊', '西門與機動部隊', '城鎮巨鷹巡邏隊']
  const squads: TownEquipmentSquadView[] = names.map((name, index) => ({ id: (index + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8,
    name, total: index === 7 ? 5 : 30, alive: 1, refittable: 1, members: [{ ...civilian, id: `soldier-${index + 1}`, name: 'Soldier' }] }))
  squads.push({ id: 'personal', name: 'HR 私兵', total: 1, alive: 1, refittable: 1, members: [] },
    { id: 'civilian', name: '平民／商人', total: 21, alive: 21, refittable: 20, members: [civilian,
      { ...civilian, id: 'merchant', name: 'Merchant', tier: 4, readOnly: true,
        fixedEquipment: ['T4 Sword', 'T4 Mace', 'T4 Shield'],
        equipment: { ...civilian.equipment, melee: { id: 'paladin_sword_t4', label: 'T4 Sword', tier: 4 },
          shield: { id: 'paladin_shield_t4', label: 'T4 Shield', tier: 4 } } }] })
  const view = { allowed: true, reason: '', squads }
  const change = vi.fn(() => '裝備已保存。'), bulk = vi.fn(() => '已達最佳分配，保持原裝備。')
  const bindings: TownEquipmentUIBindings = {
    read: () => view, personal,
    options: () => [{ id: null, label: 'None' }, { id: 'paladin_sword_t4', label: 'T4 Sword · 可用 1' }], change, bulk,
  }
  const adapter = townEquipmentUI(bindings)
  let root = new Element('div')
  function render() { root = new Element('div'); adapter.render(root as unknown as HTMLElement, render); return root }
  function select(id: string) { render().descendants().find(node => node.dataset.squadId === id)!.onclick!(); return root }
  return { adapter, bindings, view, change, bulk, render, select, root: () => root }
}

describe('Town-wide equipment panels', () => {

  it('blocks locked access and stale controls, and explains absent or unsafe members without changing domain data', () => {
    const h = townUIHarness(), root = h.render(), stale = root.descendants().find(node => node.dataset.bulkCategory === 'sword')!
    h.view.allowed = false; h.view.reason = '需正式升任 Commander。'
    stale.onclick!()
    expect(h.bulk).not.toHaveBeenCalled()
    expect(h.adapter.access()).toEqual({ allowed: false, reason: '需正式升任 Commander。' })
    expect(h.render().children[0].textContent).toBe('需正式升任 Commander。')
    h.view.allowed = true; h.view.squads[0].refittable = 0; h.view.squads[0].reason = '正式戰鬥中，無法整補。'
    const locked = h.render().descendants().filter(node => node.tag === 'select' || node.dataset.bulkCategory)
    expect(locked.every(node => node.disabled && node.title === '正式戰鬥中，無法整補。')).toBe(true)
  })

  it('shows no-inventory reasons from the domain and blocks stale individual controls after an actor becomes unavailable', () => {
    const h = townUIHarness()
    h.bindings.bulkAvailability = () => ({ enabled: false, reason: '無適用庫存。' })
    const root = h.render(), buttons = root.descendants().filter(node => node.dataset.bulkCategory)
    expect(buttons.every(node => node.disabled && node.title === '無適用庫存。')).toBe(true)
    const select = root.descendants().find(node => node.tag === 'select')!
    h.view.squads[0].members[0].reason = '死亡動畫中，無法整補。'
    select.value = 'paladin_sword_t4'; select.onchange!()
    expect(h.change).not.toHaveBeenCalled()
    expect(h.root().descendants().some(node => node.textContent === '死亡動畫中，無法整補。')).toBe(true)
  })
})
