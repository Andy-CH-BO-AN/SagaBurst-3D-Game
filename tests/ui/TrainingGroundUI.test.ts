import { afterEach,describe,expect,it,onTestFinished,vi } from 'vitest';
import { TrainingGroundUI } from '../../src/ui/TrainingGroundUI';
import { Vector3 } from 'three'
import { CareerTutorialScene, type TutorialSceneFrame } from '../../src/training/CareerTutorialScene'
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
      mountedOnPracticeHorse: false, shieldRaised: false, friendlyCount: 0 }
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
})
