import { afterEach,describe,expect,it,onTestFinished,vi } from 'vitest';
import { TrainingGroundUI } from '../../src/ui/TrainingGroundUI';
import { Vector3 } from 'three'
import { CareerTutorialScene, type TutorialSceneFrame } from '../../src/training/CareerTutorialScene'
import type { CombatEvent } from '../../src/combat/CombatAttribution'
import { Faction } from '../../src/world/NPC'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import { startCareerTutorial } from '../../src/career/CareerTutorial'
import { CAREER_TUTORIAL_OPERATIONS, recordCareerTutorialOperation } from '../../src/career/CareerTutorialState'
import { MemoryStorage } from '../helpers/memoryStorage'

/** Minimal DOM boundary; EventTarget retains real listener cancellation semantics. */
function harness() {
  const nodes = new Map<string, Node>()
  class Node extends EventTarget {
    id = ''; hidden = false; innerHTML = ''; textContent = ''; value = ''; className = ''
    style = {}; removed = false
    onclick: (() => void) | null = null
    append() {}
    remove() { this.removed = true }
    focus() { doc.activeElement = this }
    querySelector(selector: string): Node {
      if (!nodes.has(selector)) nodes.set(selector, new Node())
      return nodes.get(selector)!
    }
    querySelectorAll() {
      return ['select', 'resume', 'pause-refill', 'pause-reset', 'pause-exit'].map(id => this.querySelector(id === 'select' ? id : `[data-training="${id}"]`))
    }
  }
  const rootNodes: Node[] = []
  const doc = Object.assign(new EventTarget(), {
    body: { append() {} }, pointerLockElement: null as object | null, activeElement: null as object | null,
    createElement() { const node = new Node(); rootNodes.push(node); return node },
    getElementById(id: string) { return rootNodes.find(node => node.id === id) ?? null },
    exitPointerLock() { doc.pointerLockElement = null; doc.dispatchEvent(new Event('pointerlockchange')) },
  })
  const win = new EventTarget()
  vi.stubGlobal('document', doc); vi.stubGlobal('window', win)
  const actions = { onPause: vi.fn(), onResume: vi.fn(), onExit: vi.fn(), onEquipment: vi.fn(), onRefill: vi.fn(), onReset: vi.fn(), onCharacter: vi.fn(), equipmentVisible: vi.fn(() => false) }
  const ui = new TrainingGroundUI(actions, [])
  onTestFinished(() => ui.dispose())
  const key = (code = 'Escape', repeat = false, shiftKey = false) => {
    const event = Object.assign(new Event('keydown', { cancelable: true }), { code, repeat, shiftKey })
    win.dispatchEvent(event); return event
  }
  const lock = (locked: boolean) => { doc.pointerLockElement = locked ? {} : null; doc.dispatchEvent(new Event('pointerlockchange')) }
  const click = (name: string) => nodes.get(`[data-training="${name}"]`)!.dispatchEvent(new Event('click'))
  return { ui, actions, key, lock, click, doc, nodes, rootNodes }
}

afterEach(() => vi.unstubAllGlobals())

describe('Training pause, controls and listener ownership', () => {


  it('traps pause focus and routes supply/reset/exit actions while releasing listeners on dispose', () => {
    const h = harness(); h.key()
    const focus = h.doc.activeElement
    h.key('Tab'); expect(h.doc.activeElement).not.toBe(focus)
    h.key('Tab', false, true); expect(h.doc.activeElement).toBe(focus)
    h.click('pause-refill'); h.click('pause-reset'); h.click('pause-exit')
    expect(h.actions.onRefill).toHaveBeenCalledOnce(); expect(h.actions.onReset).toHaveBeenCalledOnce(); expect(h.actions.onExit).toHaveBeenCalledOnce()
    h.ui.dispose(); h.key(); h.click('pause-exit')
    expect(h.actions.onExit).toHaveBeenCalledOnce(); expect(h.actions.onResume).not.toHaveBeenCalled()
    expect(h.rootNodes.every(node => node.removed)).toBe(true)
  })

  it('automatically returns a completed recruit and keeps its retry clickable while paused if the route save fails', async () => {
    const h = harness(), storage = new MemoryStorage()
    vi.stubGlobal('localStorage', storage)
    const profile = createCareerProfile('roman'), session = startCareerTutorial(profile, 'recruit')!
    for (const operation of CAREER_TUTORIAL_OPERATIONS.recruit.flat()) recordCareerTutorialOperation(profile, 'recruit', operation)
    const store = new CareerProfileStore(storage)
    expect(store.save(profile)).toBe(true)
    const returned = vi.fn(), clearInput = vi.fn()
    const tutorial = new CareerTutorialScene({ careerId: session.careerId, sessionId: session.id, stage: 'recruit' }, {
      returnToTown: returned, reset: vi.fn(), clearInput,
    })
    onTestFinished(() => tutorial.dispose())
    const frame: TutorialSceneFrame = { position: new Vector3(), cameraYaw: 0, cameraPitch: 0,
      inputLocked: false, hidden: false, paused: true, dead: false, onFoot: true,
      mountedOnPracticeHorse: false, mountedOnPracticeCat: false, shieldRaised: false, friendlyCount: 0 }
    storage.failWrites = true
    tutorial.update(frame, .016)
    await Promise.resolve()
    const panel = h.rootNodes.find(node => node.id === 'career-tutorial-scene')!
    const retry = h.rootNodes.find(node => node.textContent === '重試保存')!
    expect(panel.hidden).toBe(false)
    expect(retry.hidden).toBe(false)
    expect(returned).not.toHaveBeenCalled()
    expect(store.load()!.tutorial?.session?.id).toBe(session.id)
    storage.failWrites = false
    retry.onclick!()
    expect(clearInput).toHaveBeenCalled()
    expect(returned).toHaveBeenCalledOnce()
    expect(store.load()).toMatchObject({ totalMerit: 100, availableMerit: 100, tutorial: { rewards: { recruit: 100 } } })
    expect(store.load()!.tutorial?.session).toBeUndefined()
    tutorial.update(frame, .016)
    await Promise.resolve()
    expect(returned).toHaveBeenCalledOnce()
  })
  it('automatically returns a completed Captain tutorial once and unlocks HR', async () => {
    harness()
    const storage = new MemoryStorage()
    vi.stubGlobal('localStorage', storage)
    const profile = createCareerProfile('roman')
    profile.tutorial!.captain.status = 'available'
    const session = startCareerTutorial(profile, 'captain')!
    for (const operation of CAREER_TUTORIAL_OPERATIONS.captain.flat()) recordCareerTutorialOperation(profile, 'captain', operation)
    const store = new CareerProfileStore(storage)
    expect(store.save(profile)).toBe(true)
    const returned = vi.fn()
    const tutorial = new CareerTutorialScene({ careerId: session.careerId, sessionId: session.id, stage: 'captain' }, {
      returnToTown: returned, reset: vi.fn(), clearInput: vi.fn(),
    })
    onTestFinished(() => tutorial.dispose())
    const frame: TutorialSceneFrame = { position: new Vector3(), cameraYaw: 0, cameraPitch: 0,
      inputLocked: true, hidden: false, paused: false, dead: false, onFoot: true,
      mountedOnPracticeHorse: false, mountedOnPracticeCat: false, shieldRaised: false, friendlyCount: 30 }
    tutorial.update(frame, .016); tutorial.update(frame, .016)
    await Promise.resolve()
    expect(returned).toHaveBeenCalledOnce()
    expect(store.load()!.tutorial).toMatchObject({ hr: { status: 'available' }, captain: { status: 'completed' } })
    expect(store.load()!.tutorial!.session).toBeUndefined()
  })

  it('recruit mount lesson needs the black cat, then the practice horse, then a damaging horse impact on the runway dummy', () => {
    const h = harness()
    const storage = new MemoryStorage()
    vi.stubGlobal('localStorage', storage)
    const profile = createCareerProfile('roman'), session = startCareerTutorial(profile, 'recruit')!
    for (const operation of ['look', 'movement', 'equipment', 'melee-hit-1', 'melee-hit-2', 'shield', 'bow-hit']) recordCareerTutorialOperation(profile, 'recruit', operation)
    const store = new CareerProfileStore(storage)
    expect(store.save(profile)).toBe(true)
    const tutorial = new CareerTutorialScene({ careerId: session.careerId, sessionId: session.id, stage: 'recruit' }, {
      returnToTown: vi.fn(), reset: vi.fn(), clearInput: vi.fn(),
    })
    onTestFinished(() => tutorial.dispose())
    const frame = (patch: Partial<TutorialSceneFrame>): TutorialSceneFrame => ({ position: new Vector3(), cameraYaw: 0, cameraPitch: 0,
      inputLocked: true, hidden: false, paused: false, dead: false, onFoot: true,
      mountedOnPracticeHorse: false, mountedOnPracticeCat: false, shieldRaised: false, friendlyCount: 0, horsePosition: new Vector3(70, 0, 216), ...patch })
    const step = () => store.load()!.tutorial!.recruit.step
    tutorial.update(frame({ onFoot: false, mountedOnPracticeHorse: true }), .016)
    expect(step()).toBe('cat-mounted')
    tutorial.update(frame({ onFoot: false, mountedOnPracticeCat: true }), .016)
    expect(step()).toBe('horse-mounted')
    tutorial.update(frame({ onFoot: false, mountedOnPracticeCat: true }), .016)
    expect(step()).toBe('horse-mounted')
    tutorial.update(frame({ onFoot: false, mountedOnPracticeHorse: true }), .016)
    expect(step()).toBe('mount-impact')

    const hit = (patch: Partial<Extract<CombatEvent, { type: 'damage_applied' }>> = {}): CombatEvent => ({
      type: 'damage_applied', method: 'mount-impact', requestedDamage: 20, appliedDamage: 20,
      source: { actorId: 'player', actorType: 'player', allegiance: Faction.PLAYER, characterFaction: 'roman' },
      target: { targetId: 'training:0', targetType: 'training', name: '0m Dummy' }, ...patch })
    tutorial.combat(hit(), false)
    tutorial.combat(hit({ appliedDamage: 0 }), true)
    tutorial.combat(hit({ method: 'melee' }), true)
    tutorial.combat(hit({ method: 'projectile', weaponId: 'wooden_shortbow' }), true)
    tutorial.combat(hit({ target: { targetId: 'training:10', targetType: 'training', name: '10m Dummy' } }), true)
    expect(step()).toBe('mount-impact')
    tutorial.combat(hit(), true)
    expect(step()).toBe('dismounted')

    // Resuming mid-lesson respawns on foot far from the horse: the cat is the transit again, progress is kept.
    const saved = store.load()!; saved.tutorial!.recruit.operations.pop(); saved.tutorial!.recruit.step = 'mount-impact'
    const hint = () => h.rootNodes.some(node => node.textContent.includes('先騎最近的黑貓'))
    tutorial.dispose()
    expect(store.save(saved)).toBe(true)
    const resumed = new CareerTutorialScene({ careerId: session.careerId, sessionId: session.id, stage: 'recruit' }, { returnToTown: vi.fn(), reset: vi.fn(), clearInput: vi.fn() })
    onTestFinished(() => resumed.dispose())
    const catPosition = new Vector3(70, 0, 60)
    resumed.update(frame({ position: new Vector3(105, 0, 47), catPosition }), .016)
    expect([resumed.step, hint()]).toEqual(['mount-impact', true])
    resumed.update(frame({ position: new Vector3(70, 0, 205), catPosition }), .016)
    expect(hint()).toBe(false)
  })
})
