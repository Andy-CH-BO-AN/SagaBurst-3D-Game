import { afterEach, describe, expect, it, vi } from 'vitest'
import { HeroMountTrialUI } from '../../src/ui/HeroMountTrialUI'

function harness() {
  const buttons = new Map(['#hero-mount-trial-resume', '#hero-mount-trial-exit'].map(id => [id, {
    focus: vi.fn(), addEventListener: (_type: string, callback: () => void) => { clicks.set(id, callback) },
  }]))
  const clicks = new Map<string, () => void>()
  const panel = { style: { display: '' }, innerHTML: '', setAttribute: vi.fn(), querySelector: (id: string) => buttons.get(id) }
  let keydown: (event: KeyboardEvent) => void = () => {}
  let pointerlockchange: () => void = () => {}
  const document = {
    body: { appendChild: vi.fn() }, createElement: () => panel, pointerLockElement: null as object | null,
    activeElement: null as object | null,
    exitPointerLock: vi.fn(() => { document.pointerLockElement = null; pointerlockchange() }),
    addEventListener: (_type: string, callback: () => void) => { pointerlockchange = callback },
  }
  vi.stubGlobal('document', document)
  vi.stubGlobal('window', { addEventListener: (_type: string, callback: typeof keydown) => { keydown = callback } })
  for (const button of buttons.values()) button.focus.mockImplementation(() => { document.activeElement = button })
  const actions = { onPause: vi.fn(), onResume: vi.fn(), onExit: vi.fn(), equipmentVisible: vi.fn(() => false) }
  const ui = new HeroMountTrialUI(actions)
  const key = (code = 'Escape', repeat = false) => {
    const event = { code, repeat, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() }
    keydown(event as unknown as KeyboardEvent)
    return event
  }
  const lock = (locked: boolean) => { document.pointerLockElement = locked ? {} : null; pointerlockchange() }
  return { ui, actions, key, lock, document, panel, click: (id: string) => clicks.get(id)!() }
}

afterEach(() => { vi.unstubAllGlobals() })

describe('hero mount trial Escape navigation', () => {
  it('opens without pointer lock, blocks shortcuts while paused, and resumes once', () => {
    const h = harness()
    h.key()
    expect(h.ui.visible).toBe(true)
    expect(h.panel.style.display).toBe('flex')
    expect(h.actions.onPause).toHaveBeenCalledOnce()
    expect(h.key('Tab').stopImmediatePropagation).toHaveBeenCalledOnce()
    h.key('Escape', true)
    expect(h.ui.visible).toBe(true)
    h.key()
    expect(h.ui.visible).toBe(false)
    expect(h.actions.onResume).toHaveBeenCalledOnce()
    expect(h.actions.onExit).not.toHaveBeenCalled()
  })

  it('keeps keyboard focus on the trial actions and allows native button activation', () => {
    const h = harness()
    h.key()
    const resume = h.document.activeElement
    h.key('Tab')
    expect(h.document.activeElement).not.toBe(resume)
    h.key('Tab')
    expect(h.document.activeElement).toBe(resume)
    expect(h.key('Enter').preventDefault).not.toHaveBeenCalled()
  })

  it('offers explicit continue and exit actions', () => {
    const h = harness()
    h.key(); h.click('#hero-mount-trial-resume')
    expect(h.ui.visible).toBe(false)
    h.key(); h.click('#hero-mount-trial-exit')
    expect(h.actions.onExit).toHaveBeenCalledOnce()
  })

  it('opens when the browser consumes Escape to release pointer lock', () => {
    const h = harness()
    h.lock(true); h.lock(false)
    expect(h.ui.visible).toBe(true)
    expect(h.actions.onPause).toHaveBeenCalledOnce()
    h.lock(false)
    expect(h.actions.onPause).toHaveBeenCalledOnce()
  })

  it('does not double-open when Escape also releases pointer lock', () => {
    const h = harness()
    h.lock(true); h.key()
    expect(h.document.exitPointerLock).toHaveBeenCalledOnce()
    expect(h.actions.onPause).toHaveBeenCalledOnce()
    expect(h.ui.visible).toBe(true)
  })

  it('leaves equipment Escape and pointer-lock release to the equipment screen', () => {
    const h = harness()
    h.actions.equipmentVisible.mockReturnValue(true)
    expect(h.key().preventDefault).not.toHaveBeenCalled()
    h.lock(true); h.lock(false)
    expect(h.ui.visible).toBe(false)
    h.actions.equipmentVisible.mockReturnValue(false)
    h.key()
    expect(h.ui.visible).toBe(true)
  })
})
