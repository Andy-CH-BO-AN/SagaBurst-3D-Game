import { afterEach,describe,expect,it,onTestFinished,vi } from 'vitest';
import { PlayerInput } from '../../src/player/PlayerInput';

/** Event listeners are real; no Player, camera or rendered scene is constructed. */
function harness(search = '') {
  const win = Object.assign(new EventTarget(), { location: { search } })
  const doc = Object.assign(new EventTarget(), { pointerLockElement: null as object | null })
  vi.stubGlobal('window', win); vi.stubGlobal('document', doc)
  const input = new PlayerInput()
  onTestFinished(() => input.dispose())
  const mouse = (type: string, button: number) => win.dispatchEvent(Object.assign(new Event(type), { button }))
  const key = (code: string, repeat = false) => win.dispatchEvent(Object.assign(new Event('keydown'), { code, repeat }))
  const keyUp = (code: string) => win.dispatchEvent(Object.assign(new Event('keyup'), { code }))
  const lock = (locked: boolean) => { doc.pointerLockElement = locked ? {} : null; doc.dispatchEvent(new Event('pointerlockchange')) }
  return { win, doc, input, mouse, key, keyUp, lock }
}

afterEach(() => vi.unstubAllGlobals())
describe('PlayerInput ownership', () => {
  it('delivers one E edge per physical press and never revives it from keyboard repeat', () => {
    const h = harness('?nolock')
    h.key('KeyE'); expect(h.input.consumeKeyE()).toBe(true)
    h.key('KeyE', true); h.key('KeyE', true)
    expect(h.input.consumeKeyE()).toBe(false)
    h.input.clear(); h.key('KeyE', true)
    expect(h.input.consumeKeyE()).toBe(false)
    h.keyUp('KeyE'); h.key('KeyE')
    expect(h.input.consumeKeyE()).toBe(true)
    expect(h.input.consumeKeyE()).toBe(false)
  })
  it('ignores unlocked controls and clears held movement and combat input when lock is lost', () => {
    const h = harness()
    h.key('KeyW'); h.mouse('mousedown', 0); h.mouse('mousedown', 2)
    expect(h.input.keys.KeyW).toBeUndefined()
    expect(h.input.consumeLeftClick()).toBe(false)
    expect(h.input.isRightMouseDown).toBe(false)
    h.lock(true); h.key('KeyW'); h.mouse('mousedown', 2)
    expect(h.input.keys.KeyW).toBe(true)
    expect(h.input.isRightMouseDown).toBe(true)
    h.lock(false)
    expect(h.input.keys.KeyW).toBeUndefined()
    expect(h.input.isRightMouseDown).toBe(false)
  })

  it('preserves right-button hold/release and clears it on focus loss', () => {
    const h = harness(); h.lock(true)
    h.mouse('mousedown', 2); h.mouse('mousedown', 2)
    expect(h.input.isRightMouseDown).toBe(true)
    h.mouse('mouseup', 2)
    expect(h.input.isRightMouseDown).toBe(false)
    h.mouse('mousedown', 2); h.win.dispatchEvent(new Event('blur'))
    expect(h.input.isRightMouseDown).toBe(false)
  })

  it('holds aim with F while a left click draws, without cancelling a physically held right button', () => {
    const h = harness(); h.lock(true)
    h.key('KeyF'); h.mouse('mousedown', 0)
    expect(h.input.isRightMouseDown).toBe(true)
    expect(h.input.consumeLeftClick()).toBe(true)
    h.keyUp('KeyF')
    expect(h.input.isRightMouseDown).toBe(false)
    h.mouse('mousedown', 2); h.key('KeyF'); h.keyUp('KeyF')
    expect(h.input.isRightMouseDown).toBe(true)
    h.key('KeyF'); h.win.dispatchEvent(new Event('blur'))
    expect(h.input.isRightMouseDown).toBe(false)
  })

  it('releases listeners on dispose so a former scene cannot receive input', () => {
    const h = harness('?nolock'); h.input.dispose()
    h.key('KeyW'); h.mouse('mousedown', 0)
    expect(h.input.keys.KeyW).toBeUndefined()
    expect(h.input.consumeLeftClick()).toBe(false)
  })
})
