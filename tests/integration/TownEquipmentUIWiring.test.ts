import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import { addCareerItem, normalizeCareerInventory } from '../../src/career/CareerInventory'
import { recruitPersonalSquadMember } from '../../src/career/CareerPersonalSquad'
import { resolveTownActorEquipment, type TownEquipmentContext } from '../../src/career/CareerTownEquipment'
import { createTownCareerEquipmentUI, type TownEquipmentUIResident } from '../../src/town/TownCareerEquipmentUI'
import type { EquipmentSquadAdapter } from '../../src/ui/EquipmentUI'
import { MemoryStorage } from '../helpers/memoryStorage'

class UIElement {
  className = ''; textContent = ''; value = ''; title = ''; disabled = false; id = ''; type = ''; tabIndex = 0
  dataset: Record<string, string> = {}
  style: Record<string, string> = {}
  attributes: Record<string, string> = {}
  children: UIElement[] = []
  options: { text: string; value: string }[] = []
  onchange: (() => void) | null = null
  onclick: (() => void) | null = null
  constructor(readonly tag: string) {}
  append(...children: UIElement[]) { this.children.push(...children) }
  setAttribute(name: string, value: string) { this.attributes[name] = value }
  add(option: { text: string; value: string }) { this.options.push(option) }
  descendants(): UIElement[] { return this.children.flatMap(child => [child, ...child.descendants()]) }
}

/** Real UI wiring + domain + serialized store; 4 resident metadata doubles, 0 NPC/Mount constructors. */
function fixture() {
  vi.stubGlobal('document', { createElement: (tag: string) => new UIElement(tag), getElementById: () => null })
  vi.stubGlobal('Option', class { constructor(readonly text: string, readonly value: string) {} })
  const storage = new MemoryStorage(), store = new CareerProfileStore(storage), events: string[] = []
  let profile: CareerProfile = { ...createCareerProfile('roman'), rank: 'commander', totalMerit: 100000, availableMerit: 100000 }
  normalizeCareerInventory(profile); addCareerItem(profile, 'paladin_sword_t4', 2)
  const save = (next: CareerProfile) => {
    events.push('save')
    if (!store.save(next)) return false
    profile = next; return true
  }
  expect(recruitPersonalSquadMember(profile, 'soldier', save, () => 'personal:ui-soldier').recruited).toBe(true)
  const residents: TownEquipmentUIResident[] = [
    { spec: { id: 'gate:north:0' }, npc: { name: 'North guard', dead: false } },
    { spec: { id: 'cavalry-training:melee_cavalry:0' }, npc: { name: 'Town cavalry', dead: false } },
    { spec: { id: 'civilian-0' }, npc: { name: 'Civilian', dead: false } },
    { spec: { id: 'merchant' }, npc: { name: 'Merchant', dead: false } },
  ]
  const context: TownEquipmentContext = { townFaction: 'roman', peaceful: true, personalState: 'RESERVE',
    safeActorIds: new Set(['gate:north:0', 'cavalry-training:melee_cavalry:0', 'civilian-0', 'personal:ui-soldier']) }
  const apply = vi.fn((_before: CareerProfile, current: CareerProfile, ids: readonly string[]) => {
    events.push('apply')
    expect(store.load()!.townEquipment).toEqual(current.townEquipment)
    expect(ids).toContain('gate:north:0')
    return 0
  })
  const adapters = createTownCareerEquipmentUI(() => profile, () => context, () => residents, save, apply)
  let townRoot = new UIElement('div'), personalRoot = new UIElement('div')
  function render(adapter: EquipmentSquadAdapter): UIElement {
    const root = new UIElement('div')
    adapter.render(root as unknown as HTMLElement, () => { if (adapter === adapters.town) townRoot = render(adapter); else personalRoot = render(adapter) })
    return root
  }
  function town() { townRoot = render(adapters.town); return townRoot }
  function personal() { personalRoot = render(adapters.personal); return personalRoot }
  function select(id: string) { town().descendants().find(node => node.dataset.squadId === id)!.onclick!(); return townRoot }
  events.length = 0
  return { read: () => profile, set: (next: CareerProfile) => { profile = next }, store, storage, context, events, apply,
    adapters, town, personal, select, townRoot: () => townRoot, personalRoot: () => personalRoot }
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('Town equipment domain and UI wiring', () => {
  it('uses the official eight squads and civilian membership, preserves native mount Tier and exposes Merchant equipment read-only', () => {
    const h = fixture(), tabs = h.town().descendants().filter(node => node.attributes.role === 'tab')
    expect(tabs.map(tab => tab.dataset.squadId)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', 'personal', 'civilian'])
    expect(tabs[7].textContent).toBe('城鎮巨鷹巡邏隊')
    expect(h.town().descendants().some(node => node.textContent.includes('北門步兵隊 · 總人數 30'))).toBe(true)
    const cavalryPanel = h.select('2')
    const cavalry = cavalryPanel.descendants().find(node => node.dataset.memberId === 'cavalry-training:melee_cavalry:0')!
    expect(cavalry.descendants().some(node => node.textContent === '坐騎 Mount · T1: ')).toBe(true)
    const civilians = h.select('civilian')
    expect(civilians.descendants().some(node => node.textContent.includes('平民／商人 · 總人數 21'))).toBe(true)
    const merchant = civilians.descendants().find(node => node.dataset.memberId === 'merchant')!
    expect(merchant.children[0].textContent).toBe('武器商人 · T4 預設裝備')
    expect(merchant.descendants().some(node => node.textContent === 'T4 Sword\nT4 Mace\nT4 Shield')).toBe(true)
    expect(merchant.descendants().some(node => node.tag === 'select' || node.tag === 'button')).toBe(false)
    expect(h.events).toEqual([])
  })

  it('shares the saved HR member between the original and town panels through the common individual domain transaction', () => {
    const h = fixture(), original = h.personal().descendants().find(node => node.tag === 'select' && node.attributes['aria-label']?.endsWith(' melee'))!
    original.value = 'paladin_sword_t4'; original.onchange!()
    const shared = h.select('personal').descendants().find(node => node.tag === 'select' && node.attributes['aria-label']?.endsWith(' melee'))!
    expect(shared.value).toBe('paladin_sword_t4')
    expect(h.store.load()!.personalSquad!.members).toHaveLength(1)
    expect(h.store.load()!.personalSquad!.members[0].equipment?.melee).toBe('paladin_sword_t4')
    expect(h.events).toEqual(['save']); expect(h.apply).not.toHaveBeenCalled()
  })

  it('commits a bulk town loadout through serialization before calling runtime apply once', () => {
    const h = fixture(), previous = h.read(), button = h.town().descendants().find(node => node.dataset.bulkCategory === 'sword')!
    button.onclick!()
    expect(h.events).toEqual(['save', 'apply'])
    expect(h.apply).toHaveBeenCalledExactlyOnceWith(previous, h.read(), ['gate:north:0'])
    expect(resolveTownActorEquipment(h.store.load()!, 'roman', 'gate:north:0').loadout.meleeWeaponId).toBe('paladin_sword_t4')
    expect(h.store.load()!.inventory!.quantities.paladin_sword_t4).toBe(2)
    expect(h.townRoot().descendants().some(node => node.textContent.includes('成功換裝：1 人 · 升級：1 人'))).toBe(true)
  })

  it('keeps both the profile and runtime unchanged when the bulk save fails', () => {
    const h = fixture(), previous = h.read(), stored = h.store.load(), button = h.town().descendants().find(node => node.dataset.bulkCategory === 'sword')!
    h.storage.failWrites = true; button.onclick!()
    expect(h.events).toEqual(['save']); expect(h.apply).not.toHaveBeenCalled()
    expect(h.read()).toBe(previous); expect(h.store.load()).toEqual(stored)
    expect(h.townRoot().descendants().some(node => node.textContent.includes('保存失敗，所有裝備保持不變。'))).toBe(true)
  })

  it.each(['hostile', 'enemy-town'] as const)('locks original HR controls during %s and does not save or apply stale changes', state => {
    const h = fixture(), stale = h.personal().descendants().find(node => node.tag === 'select')!
    if (state === 'hostile') h.context.peaceful = false
    else h.context.townFaction = 'viking'
    stale.value = 'paladin_sword_t4'; stale.onchange!()
    expect(h.events).toEqual([]); expect(h.apply).not.toHaveBeenCalled()
    const controls = h.personal().descendants().filter(node => node.tag === 'select' || node.dataset.bulkCategory)
    expect(controls.every(node => node.disabled)).toBe(true)
    expect(h.personalRoot().descendants().some(node => node.textContent.includes(state === 'hostile' ? '交戰' : '家鄉'))).toBe(true)
  })
})
