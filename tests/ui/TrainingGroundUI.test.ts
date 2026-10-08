import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { TrainingGroundUI } from '../../src/ui/TrainingGroundUI'

/** Minimal DOM boundary; EventTarget retains real listener cancellation semantics. */
function harness() {
  const nodes = new Map<string, Node>()
  class Node extends EventTarget {
    id = ''; hidden = false; innerHTML = ''; textContent = ''; value = ''; className = ''
    style = {}; removed = false
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
  it('pauses with Escape without pointer lock, ignores repeats and resumes once', () => {
    const h = harness()
    h.key(); h.key('Escape', true)
    expect(h.ui.paused).toBe(true); expect(h.actions.onPause).toHaveBeenCalledOnce()
    h.key(); expect(h.ui.paused).toBe(false); expect(h.actions.onResume).toHaveBeenCalledOnce()
  })

  it('handles browser-only pointer unlock and avoids duplicate pause callbacks', () => {
    const h = harness()
    h.lock(true); h.key()
    expect(h.ui.paused).toBe(true); expect(h.actions.onPause).toHaveBeenCalledOnce()
    h.click('resume'); h.lock(true); h.lock(false)
    expect(h.ui.paused).toBe(true); expect(h.actions.onPause).toHaveBeenCalledTimes(2)
  })

  it('keeps equipment Escape and unlock handling with the equipment owner', () => {
    const h = harness(); h.actions.equipmentVisible.mockReturnValue(true)
    expect(h.key().defaultPrevented).toBe(false)
    h.lock(true); h.lock(false); expect(h.ui.paused).toBe(false)
  })

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
})
