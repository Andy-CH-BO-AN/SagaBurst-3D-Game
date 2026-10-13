import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import { createCareerDuelMission } from '../../src/career/CareerDuelState'
import { acceptCareerOutpost } from '../../src/career/CareerOutpostMission'
import { changePersonalEquipment, recruitPersonalSquadMember } from '../../src/career/CareerPersonalSquad'
import { purchaseTownEquipment } from '../../src/town/TownRules'
import { squadEquipmentUI } from '../../src/town/TownSquadEquipmentUI'
import { TownScene } from '../../src/town/TownScene'
import type { PersonalSquadState } from '../../src/town/TownPersonalSquadController'
import { MemoryStorage } from '../helpers/memoryStorage'

// DOM boundary only; profile, inventory and equipment changes use production code, with no actors.
class Element {
  className = ''; textContent = ''; value = ''; title = ''; disabled = false
  dataset: Record<string, string> = {}
  style: Record<string, string> = {}
  attributes: Record<string, string> = {}
  children: Element[] = []
  options: { text: string; value: string }[] = []
  onchange: (() => void) | null = null
  onclick: (() => void) | null = null
  constructor(readonly tag: string) {}
  append(...children: Element[]) { this.children.push(...children) }
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
  it.each([
    { rank: 'captain', locked: true },
    { rank: 'commander', locked: false },
  ] as const)('shows the 2000-merit T5 Commander offer for $rank with rank lock $locked despite abundant merit', ({ rank, locked }) => {
    const h = recruitmentHarness(rank), row = h.row()
    expect(row.children[1].textContent).toBe('2000 Merit')
    const button = row.children[2]
    expect(button.textContent).toBe('Recruit · 招募')
    expect(button.disabled).toBe(locked)
    expect(button.title).toBe(locked ? '需正式任命為 Commander 才能招募。' : '')
    expect(h.save).not.toHaveBeenCalled()
  })

  it('recruits the selected Commander and persists its 2000-merit cost through the real Town commit', () => {
    const h = recruitmentHarness('commander')
    h.row().children[2].onclick!()
    expect(h.save).toHaveBeenCalledTimes(1)
    const saved = h.store.load()!
    expect(saved).toMatchObject({ rank: 'commander', totalMerit: 100000, availableMerit: 98000 })
    expect(saved.personalSquad?.members).toHaveLength(1)
    expect(saved.personalSquad?.members[0]).toMatchObject({ type: 'commander', originalHirePrice: 2000 })
    expect(saved.personalSquad?.members[0].id).toMatch(/^personal:[A-Za-z0-9-]+$/)
    expect(h.town.profile.personalSquad).toEqual(saved.personalSquad)
    expect(saved.townDialogueSeen).toContain('roman:hr-recruit-commander')
    expect(h.message()).toContain('Commander 已經登記')
  })

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
  it('shows the historical T3 weapon for a legacy Captain without saved equipment', () => {
    const h = harness()
    h.set({ ...createCareerProfile('roman'), rank: 'captain', ownedWeapons: ['centurion_blade'],
      ownedArmors: ['scutum_t3'], ownedMounts: ['horse'],
      personalSquad: { members: [{ id: 'personal:legacy-captain', type: 'captain' }] },
    })
    const melee = h.render().selects.find(select => select.attributes['aria-label'] === 'T4 Captain #1 melee')!
    expect(melee.options.some(option => option.value === 'centurion_blade')).toBe(true)
    expect(melee.value).toBe('centurion_blade')
    expect(h.read().personalSquad!.members[0].equipment).toBeUndefined()
  })

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
