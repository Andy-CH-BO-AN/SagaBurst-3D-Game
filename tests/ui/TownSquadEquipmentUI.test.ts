import { afterEach,describe,expect,it,vi } from 'vitest'
import { createCareerDuelMission } from '../../src/career/CareerDuelState'
import { acceptCareerOutpost } from '../../src/career/CareerOutpostMission'
import { changePersonalEquipment,recruitPersonalSquadMember } from '../../src/career/CareerPersonalSquad'
import { createCareerProfile,type CareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import type { PersonalSquadState } from '../../src/town/TownPersonalSquadController'
import { purchaseTownEquipment } from '../../src/town/TownRules'
import { appendCommanderRetirementOption } from '../../src/town/TownRetirementUI'
import { areOrdinaryTownServicesPeaceful } from '../../src/career/CareerRetirement'
import { squadEquipmentUI,townEquipmentUI,type TownEquipmentMemberView,type TownEquipmentSquadView,type TownEquipmentUIBindings } from '../../src/town/TownSquadEquipmentUI'
import { type EquipmentSquadAdapter } from '../../src/ui/EquipmentUI'
import { appendPersonalRecruitmentConfigurator, personalRecruitmentPresentation } from '../../src/town/TownRecruitmentPanel'
import type { PersonalRecruitmentChoice } from '../../src/career/CareerRecruitmentCatalog'
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

function harness(type: 'captain' | 'ranger' = 'captain') {
  vi.stubGlobal('document', { createElement: (tag: string) => new Element(tag) })
  vi.stubGlobal('Option', class { constructor(readonly text: string, readonly value: string) {} })
  let profile: CareerProfile = { ...createCareerProfile('roman'), rank: 'captain', totalMerit: 60000, availableMerit: 60000,
    duelHighestDefeatedTierByPreset: { roman_heavy_infantry: 3 } }
  const store = new CareerProfileStore(new MemoryStorage())
  const save = (next: CareerProfile) => { if (!store.save(next)) return false; profile = next; return true }
  expect(recruitPersonalSquadMember(profile, type, save).recruited).toBe(true)
  const purchase = purchaseTownEquipment(profile, type === 'ranger' ? 'paladin_mace_t4' : 'maki-ranger-bow-ranged')
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

describe('Town retirement service controls', () => {
  it('blocks every stale retirement dialog action when the saved phase enters final stand', () => {
    vi.stubGlobal('document', { createElement: (tag: string) => new Element(tag) })
    let profile: CareerProfile = { ...createCareerProfile('roman'), rank: 'commander',
      careerMissionCompletionsByTier: { 5: 10 },
      completedCareerMissionTemplateIds: ['commander-four-gate-defense'] }
    const panels: Element[] = []
    const openPanel = vi.fn(() => {
      const panel = new Element('div'); panels.push(panel)
      return panel as unknown as HTMLDivElement
    })
    const start = vi.fn(() => true), leave = vi.fn(), root = new Element('div')
    appendCommanderRetirementOption(root as unknown as HTMLElement, profile, {
      available: () => areOrdinaryTownServicesPeaceful(profile), openPanel, start, leave,
    })
    const apply = root.children.find(node => node.tag === 'button')!
    expect(apply.disabled).toBe(false)
    apply.onclick!()
    const dialogueButtons = panels[0].children.filter(node => node.tag === 'button')
    dialogueButtons[0].onclick!()
    const confirmationButtons = panels[1].children.filter(node => node.tag === 'button')
    expect(openPanel).toHaveBeenCalledTimes(2)
    expect(confirmationButtons[0].disabled).toBe(false)

    // Keep each removed dialog's captured profile unchanged: only the live gate can
    // prevent its initial, nested, acceptance and leave callbacks after betrayal.
    profile = { ...profile, careerRetirement: {
      version: 1, phase: 'final-stand', acceptedAt: 1, combatElapsedSeconds: 0,
    } }
    expect(profile.townEvent).toBeUndefined()
    openPanel.mockClear()
    for (const button of [apply, ...dialogueButtons, ...confirmationButtons]) button.onclick!()
    expect(openPanel).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
    expect(leave).not.toHaveBeenCalled()
  })
})

describe('Town squad equipment availability and mission guidance', () => {

  it('unlocks all Ranger slots after a mission and persists a purchased melee weapon through the real transaction', () => {
    const h = harness('ranger')
    h.set({ ...h.read(), activeMission: createCareerDuelMission(h.read(), 'roman_heavy_infantry', 4, 'opponent', 'referee', 'duel')! })
    h.render()
    const settled = { ...h.read() }; delete settled.activeMission; h.set(settled)
    const view = h.render()
    expect(view.selects.map(select => select.attributes['aria-label'].split(' ').at(-1))).toEqual(['melee', 'ranged', 'shield', 'mount'])
    expect(view.selects.every(select => !select.disabled)).toBe(true)
    const ranged = view.selects.find(select => select.attributes['aria-label'].endsWith(' ranged'))!
    const melee = view.selects.find(select => select.attributes['aria-label'].endsWith(' melee'))!
    expect(ranged.options.some(option => option.value === 'recurve_longbow')).toBe(true)
    melee.value = 'paladin_mace_t4'; melee.onchange!()
    expect(h.render().notice).toBe('裝備已更新。')
    expect(h.store.load()!.personalSquad!.members[0].equipment).toMatchObject({ melee: 'paladin_mace_t4', ranged: 'recurve_longbow', shield: null })
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
    { id: 'civilian', name: '平民／商人', total: 21, alive: 21, refittable: 21, members: [civilian,
      { ...civilian, id: 'merchant', name: 'Merchant', tier: 4, lockedSlots: ['melee', 'ranged', 'shield'],
        fixedEquipment: ['T5 Sword', 'T5 Axe', 'T4 Shield'],
        equipment: { ...civilian.equipment, melee: { id: 'sword_t5', label: 'T5 Sword', tier: 5 },
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
  it('blocks locked access, no-inventory actions, and stale controls when unavailable', () => {
    const h = townUIHarness(), root = h.render(), stale = root.descendants().find(node => node.dataset.bulkCategory === 'sword')!
    h.view.allowed = false; h.view.reason = '需正式升任 Commander。'
    stale.onclick!()
    expect(h.bulk).not.toHaveBeenCalled()
    expect(h.adapter.access()).toEqual({ allowed: false, reason: '需正式升任 Commander。' })
    expect(h.render().children[0].textContent).toBe('需正式升任 Commander。')
    h.view.allowed = true; h.view.squads[0].refittable = 0; h.view.squads[0].reason = '正式戰鬥中，無法整補。'
    const locked = h.render().descendants().filter(node => node.tag === 'select' || node.dataset.bulkCategory)
    expect(locked.every(node => node.disabled && node.title === '正式戰鬥中，無法整補。')).toBe(true)

    // No-inventory reasons and unavailable actors
    h.view.squads[0].refittable = 1; h.view.squads[0].reason = undefined
    h.bindings.bulkAvailability = () => ({ enabled: false, reason: '無適用庫存。' })
    const buttons = h.render().descendants().filter(node => node.dataset.bulkCategory)
    expect(buttons.every(node => node.disabled && node.title === '無適用庫存。')).toBe(true)
    const select = h.render().descendants().find(node => node.tag === 'select')!
    h.view.squads[0].members[0].reason = '死亡動畫中，無法整補。'
    select.value = 'paladin_sword_t4'; select.onchange!()
    expect(h.change).not.toHaveBeenCalled()
    expect(h.root().descendants().some(node => node.textContent === '死亡動畫中，無法整補。')).toBe(true)
  })
})

it('updates recruitment choices and summary immediately and blocks a stale purchase when service closes', () => {
  vi.stubGlobal('document', { createElement: (tag: string) => new Element(tag) })
  const profile: CareerProfile = { ...createCareerProfile('roman'), rank: 'captain', availableMerit: 5000 }
  let choice: PersonalRecruitmentChoice = { characterTier: 3, recruitmentRole: 'spearman' }, available = true
  const recruit = vi.fn(), root = new Element('div')
  appendPersonalRecruitmentConfigurator(root as unknown as HTMLElement, { readProfile: () => profile, serviceAvailable: () => available,
    choice, onChoice: next => { choice = next }, recruit })
  const nodes = root.descendants(), controls = nodes.filter(node => node.tag === 'select')
  const summary = nodes.find(node => node.attributes['aria-live'] === 'polite')!, button = nodes.find(node => node.tag === 'button')!
  expect(controls.map(node => node.children.length)).toEqual([5, 3, 2, 5])
  expect(controls[1].disabled).toBe(true)
  expect(summary.textContent).toContain('人物 T3'); expect(summary.textContent).toContain('基礎生命值：200')
  expect(summary.textContent).toContain('T1'); expect(summary.textContent).toContain('無坐騎')
  controls[0].value = '4'; controls[0].onchange!(); controls[1].value = 'ranger'; controls[1].onchange!()
  expect(choice).toEqual({ characterTier: 4, heroArchetype: 'ranger', recruitmentRole: 'spearman' })
  expect(controls[1].disabled).toBe(false); expect(summary.textContent).toContain('基礎生命值：300')
  button.onclick!(); expect(recruit).toHaveBeenCalledWith(choice); recruit.mockClear()
  available = false; button.onclick!(); expect(recruit).not.toHaveBeenCalled(); expect(button.title).toContain('無法服務')
  expect(personalRecruitmentPresentation(profile, { characterTier: 5, heroArchetype: 'commander', recruitmentRole: 'archer' }, true).reason).toContain('Commander')
})

it.each([
  ['roman', ['禁衛軍隊長 Praetorian Captain', '百夫長 Centurion', '遊俠 Ranger'], ['羅馬軍團統帥 Roman Legate', '拜占庭鐵甲重騎兵 Byzantine Cataphract'], 'roman-centurion-t4', 'byzantine-cataphract-t5'],
  ['viking', ['瓦良格隊長 Varangian Captain', '龍誓重衛 Dragon Oathguard', '遊俠 Ranger'], ['北境戰酋 Norse Warchief', '鐵血戰帥 Ironblood Warlord'], 'viking-heavy-hero-t4', 'viking-heavy-hero-t5'],
] as const)('offers the %s HR officer only its own T4/T5 classes with their price, and submits the chosen elite body', (faction, t4Labels, t5Labels, t4Asset, t5Asset) => {
  vi.stubGlobal('document', { createElement: (tag: string) => new Element(tag) })
  const profile: CareerProfile = { ...createCareerProfile(faction), rank: 'commander', availableMerit: 5000 }
  let choice: PersonalRecruitmentChoice = { characterTier: 3, recruitmentRole: 'swordsman' }
  const root = new Element('div')
  appendPersonalRecruitmentConfigurator(root as unknown as HTMLElement, { readProfile: () => profile, serviceAvailable: () => true, choice, onChoice: next => { choice = next }, recruit: vi.fn() })
  const controls = root.descendants().filter(node => node.tag === 'select'), summary = root.descendants().find(node => node.attributes['aria-live'] === 'polite')!
  const labels = (select: Element) => select.children.map(option => option.textContent)
  expect([labels(controls[1]), labels(controls[2])]).toEqual([t4Labels, t5Labels])
  controls[0].value = '4'; controls[0].onchange!(); controls[1].value = t4Asset; controls[1].onchange!()
  expect(choice).toEqual({ characterTier: 4, heroArchetype: 'captain', visualAssetId: t4Asset, recruitmentRole: 'swordsman' })
  expect(summary.textContent).toContain('招募費用：500 軍功'); expect(summary.textContent).not.toContain(t4Asset)
  controls[0].value = '5'; controls[0].onchange!(); controls[2].value = t5Asset; controls[2].onchange!()
  expect(choice).toMatchObject({ characterTier: 5, heroArchetype: 'commander', visualAssetId: t5Asset })
  expect(summary.textContent).toContain('招募費用：3,000 軍功'); expect(summary.textContent).toContain('基礎生命值：1000')
})
