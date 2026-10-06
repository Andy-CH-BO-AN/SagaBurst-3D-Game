import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTownCombatFixture } from './townCombatFixture'
import { createCareerProfile } from '../src/career/CareerProfile'
import { CareerProfileStore } from '../src/career/CareerProfileStore'

class Element {
  textContent = ''
  style = {} as Record<string, string>
  children: Element[] = []
  onclick?: () => void
  remove = vi.fn()
  constructor(readonly tag: string) {}
  append(...children: Element[]) { this.children.push(...children) }
  querySelector(tag: string) { return this.children.find(child => child.tag === tag) ?? null }
}
function harness() {
  const values = new Map<string, string>()
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) } as Storage
  const document = { body: new Element('body'), createElement: (tag: string) => new Element(tag), exitPointerLock: vi.fn(), pointerLockElement: null as Element | null }
  vi.stubGlobal('document', document)
  vi.stubGlobal('location', { search: '?nolock' })
  const profile = createCareerProfile('roman'), store = new CareerProfileStore(storage)
  store.save(profile)
  const town = Object.assign(createTownCombatFixture(), {
    profile, store, skills: { skillState: profile.skills }, careerSkillsDirty: false, careerSkillSaveTimer: null, careerSaveFailures: 0,
    panel: null, equipment: { visible: false, close: vi.fn() }, input: { clear: vi.fn(), requestPointerLock: vi.fn() },
    player: { dead: false, clearTownAction: vi.fn() }, pointerPrompt: new Element('prompt'), pointerWasLocked: false,
    dispose: vi.fn(() => { town.disposed = true }), onHome: vi.fn(), personalSaveElapsed: 0,
  })
  const escape = () => town.key({ code: 'Escape', preventDefault: vi.fn(), stopImmediatePropagation: vi.fn(), repeat: false })
  const back = () => town.panel.children.find((child: Element) => child.textContent === '上一頁')!.onclick!()
  return { town, store, document, escape, back }
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('Career Escape navigation', () => {
  it('opens the pause menu, saves progress and disposes before returning home once', () => {
    const h = harness()
    h.town.profile.availableMerit = 123
    h.escape()
    expect(h.town.panel.children.map((child: Element) => child.textContent)).toContain('繼續遊戲')
    h.back()
    expect(h.store.load()?.availableMerit).toBe(123)
    expect(h.town.dispose).toHaveBeenCalledOnce()
    expect(h.town.dispose.mock.invocationCallOrder[0]).toBeLessThan(h.town.onHome.mock.invocationCallOrder[0])
    h.back()
    expect(h.town.onHome).toHaveBeenCalledOnce()
  })
  it('also opens when the browser consumes Escape to release pointer lock', () => {
    const h = harness()
    h.document.pointerLockElement = new Element('canvas'); h.town.updatePointerPrompt()
    expect(h.town.panel).toBeNull()
    h.document.pointerLockElement = null; h.town.updatePointerPrompt()
    expect(h.town.panel.children.map((child: Element) => child.textContent)).toContain('上一頁')
    const panel = h.town.panel
    h.town.updatePointerPrompt()
    expect(h.town.panel).toBe(panel)
  })
  it('closes equipment first and opens the pause menu on the next Escape', () => {
    const h = harness(); h.town.equipment.visible = true
    h.town.equipment.close.mockImplementation(() => { h.town.equipment.visible = false })
    h.escape(); expect(h.town.panel).toBeNull()
    h.escape(); expect(h.town.panel).not.toBeNull()
  })
  it.each(['result', 'missionResultOpen'])('does not bypass a required %s settlement panel', flag => {
    const h = harness(); h.town[flag] = true
    h.escape(); expect(h.town.panel).toBeNull()
    h.town.returnHome(); expect(h.town.onHome).not.toHaveBeenCalled()
  })
  it('keeps the scene and supports retry when saving fails', () => {
    const h = harness(), save = vi.spyOn(h.store, 'save').mockReturnValue(false)
    h.escape(); h.back()
    expect(h.town.onHome).not.toHaveBeenCalled(); expect(h.town.dispose).not.toHaveBeenCalled()
    expect(h.town.panel.children.map((child: Element) => child.textContent).join('')).toContain('進度保存失敗')
    save.mockRestore(); h.back()
    expect(h.town.onHome).toHaveBeenCalledOnce()
  })
  it('does not exit after a failed mission checkpoint even if the final profile write succeeds', () => {
    const h = harness()
    h.town.defense = { active: true, persistRuntimeProgress: vi.fn(() => {
      vi.spyOn(h.store, 'save').mockReturnValueOnce(false)
      h.town.commit({ ...h.town.profile, availableMerit: 77 })
    }) }
    h.escape(); h.back()
    expect(h.town.defense.persistRuntimeProgress).toHaveBeenCalledWith(true)
    expect(h.town.onHome).not.toHaveBeenCalled(); expect(h.town.dispose).not.toHaveBeenCalled()
  })
})
