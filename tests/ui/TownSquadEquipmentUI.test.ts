import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import { createCareerDuelMission } from '../../src/career/CareerDuelState'
import { acceptCareerOutpost } from '../../src/career/CareerOutpostMission'
import { changePersonalEquipment, recruitPersonalSquadMember } from '../../src/career/CareerPersonalSquad'
import { purchaseTownEquipment } from '../../src/town/TownRules'
import { squadEquipmentUI } from '../../src/town/TownSquadEquipmentUI'
import type { PersonalSquadState } from '../../src/town/TownPersonalSquadController'
import { MemoryStorage } from '../helpers/memoryStorage'

// DOM boundary only; profile, inventory and equipment changes use production code, with no actors.
class Element {
  className = ''; textContent = ''; value = ''; disabled = false
  dataset: Record<string, string> = {}
  style: Record<string, string> = {}
  attributes: Record<string, string> = {}
  children: Element[] = []
  options: { text: string; value: string }[] = []
  onchange: (() => void) | null = null
  constructor(readonly tag: string) {}
  append(child: Element) { this.children.push(child) }
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
  return { render, state, store, read: () => profile, set: (next: CareerProfile) => { profile = next } }
}

afterEach(() => vi.unstubAllGlobals())

describe('Town squad equipment availability and mission guidance', () => {
  it.each(['duel-returning', 'duel-assembling', 'outpost'] as const)('locks RESERVE controls during %s and explains the outstanding mission', mission => {
    const h = harness()
    if (mission === 'outpost') h.set(acceptCareerOutpost(h.read(), 1, 'outpost')!)
    else {
      const activeMission = createCareerDuelMission(h.read(), 'roman_heavy_infantry', 4, 'opponent', 'referee', 'duel')!
      activeMission.phase = mission === 'duel-returning' ? 'RETURNING' : 'ASSEMBLING'
      h.set({ ...h.read(), activeMission })
    }
    const view = h.render()
    expect(view.selects).toHaveLength(4)
    expect(view.selects.every(select => select.disabled)).toBe(true)
    expect(view.notice).toContain('尚未結算')
    if (mission === 'duel-returning') {
      expect(view.notice).toContain('關閉面板')
      expect(view.notice).toContain('跟隨裁判回營')
    }
  })

  it.each(['DEPLOYING', 'ACTIVE', 'RETURNING'] as const)('locks %s controls until the whole squad returns to RESERVE', state => {
    const h = harness(); h.state.state = state
    const view = h.render()
    expect(view.selects.every(select => select.disabled)).toBe(true)
    expect(view.notice).toContain('RESERVE')
  })

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
