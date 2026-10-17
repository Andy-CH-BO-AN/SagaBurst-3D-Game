import { afterEach,describe,expect,it,vi } from 'vitest'
import { createCareerDuelMission } from '../../src/career/CareerDuelState'
import { acceptCareerOutpost } from '../../src/career/CareerOutpostMission'
import { changePersonalEquipment,recruitPersonalSquadMember,type CareerPersonalSquadMember } from '../../src/career/CareerPersonalSquad'
import { createCareerProfile,type CareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import type { PersonalSquadState } from '../../src/town/TownPersonalSquadController'
import { purchaseTownEquipment,townRoster } from '../../src/town/TownRules'
import { TownScene } from '../../src/town/TownScene'
import { createTownCareerEquipmentUI } from '../../src/town/TownCareerEquipmentUI'
import { squadEquipmentUI,townEquipmentUI,type TownEquipmentMemberView,type TownEquipmentSquadView,type TownEquipmentUIBindings } from '../../src/town/TownSquadEquipmentUI'
import { type EquipmentSquadAdapter } from '../../src/ui/EquipmentUI'
import { combatUnitDisplayName,personalUnitDisplayName,townUnitDisplayName } from '../../src/ui/UnitDisplayName'
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
    expect(ranged.options.some(option => option.value === 'maki-ranger-bow-ranged')).toBe(true)
    melee.value = 'paladin_mace_t4'; melee.onchange!()
    expect(h.render().notice).toBe('裝備已更新。')
    expect(h.store.load()!.personalSquad!.members[0].equipment).toMatchObject({ melee: 'paladin_mace_t4', ranged: 'maki-ranger-bow-ranged', shield: null })
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

  it('renders absent residents from their authored specs and keeps Commander display rank separate from equipment tier', () => {
    vi.stubGlobal('document', { createElement: (tag: string) => new Element(tag) })
    vi.stubGlobal('Option', class { constructor(readonly text: string, readonly value: string) {} })
    const profile: CareerProfile = { ...createCareerProfile('roman'), rank: 'commander' }
    const commanderResident = { spec: { id: 'commander' }, npc: { dead: true, name: 'internal-commander-id' } }
    const savedProfile = structuredClone(profile)
    const adapter = createTownCareerEquipmentUI(() => profile,
      () => ({ townFaction: 'roman', peaceful: true, safeActorIds: new Set<string>(), personalState: 'RESERVE' }),
      () => [commanderResident], () => true, () => 0).town
    let root: Element
    const render = () => { root = new Element('div'); adapter.render(root as unknown as HTMLElement, render); return root }
    const first = render().descendants().find(node => node.dataset.memberId === 'gate:north:0')!
    expect(first.children[0].textContent).toBe('北門劍兵 01 · T2')
    expect(first.descendants().some(node => node.textContent.includes('不在目前場景'))).toBe(true)
    expect(first.descendants().every(node => !node.textContent.includes('gate:north:0')
      && !node.attributes['aria-label']?.includes('gate:north:0'))).toBe(true)
    root!.descendants().find(node => node.dataset.squadId === '2')!.onclick!()
    const commander = root!.descendants().find(node => node.dataset.memberId === 'commander')!
    expect(commander.children[0].textContent).toBe('羅馬指揮官 · T5')
    expect(commander.descendants().some(node => node.textContent.includes('已陣亡'))).toBe(true)
    expect(commanderResident.npc.name).toBe('internal-commander-id')
    expect(profile).toEqual(savedProfile)
  })


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
    select.value = 'paladin_sword_t4'; select.onchange!()
    expect(h.change).toHaveBeenCalledWith(1, 'soldier-1', 'melee', 'paladin_sword_t4')
    h.change.mockClear()
    h.view.squads[0].members[0].reason = '死亡動畫中，無法整補。'
    select.value = 'paladin_sword_t4'; select.onchange!()
    expect(h.change).not.toHaveBeenCalled()
    expect(h.root().descendants().some(node => node.textContent === '死亡動畫中，無法整補。')).toBe(true)
  })
})


describe('Unit display identity', () => {
  it('uses authored on-foot ranged identity rather than historical cavalry IDs for each faction', () => {
    const spec = townRoster().find(spec => spec.id === 'ranged_cavalry-0')!
    const before = structuredClone(spec)
    expect(townUnitDisplayName(spec, 'roman')).toBe('訓練隊標槍兵 01 · T2')
    expect(townUnitDisplayName(spec, 'viking')).toBe('訓練隊弓兵 01 · T2')
    expect(townUnitDisplayName({ ...spec, unitKind: undefined }, 'roman')).toBe('訓練隊標槍兵 01 · T2')
    expect(townUnitDisplayName(spec, 'roman', { mounted: true })).toBe('訓練隊標槍騎兵 01 · T2')
    expect(townUnitDisplayName({ ...spec, mounted: true }, 'viking', { mounted: false })).toBe('訓練隊弓兵 01 · T2')
    expect(combatUnitDisplayName({ faction: 'roman', combatProfileId: 'roman-commander', tier: 4, enemy: true })).toBe('敵方羅馬指揮官 · T5')
    expect(combatUnitDisplayName({ faction: 'viking', combatProfileId: 'ranger', tier: 4 })).toBe('維京遊俠 · T4')
    expect(combatUnitDisplayName({ enemy: true })).toBe('敵方士兵')
    expect(spec).toEqual(before)
  })

  it('keeps a personal Soldier label and ordinal while reflecting its equipped primary weapon tier', () => {
    const member: CareerPersonalSquadMember = { id: 'personal:stable-member', type: 'soldier',
      equipment: { melee: 'gladius_rusty', ranged: null, shield: null, mount: null } }
    expect(personalUnitDisplayName(member, 'roman', 1)).toBe('私兵・Sword / Axe Soldier 02 · T1')
    member.equipment!.ranged = 'pilum_standard'
    const before = structuredClone(member)
    expect(personalUnitDisplayName(member, 'roman', 1)).toBe('私兵・Sword / Axe Soldier 02 · T2')
    expect(personalUnitDisplayName(member, 'roman', 1, 3)).toBe('私兵・Sword / Axe Soldier 02 · T3')
    expect(member).toEqual(before)
  })
})
