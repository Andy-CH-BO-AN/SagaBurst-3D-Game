import { describe, it, expect } from "vitest"
import { PlayerInput } from "../src/player/PlayerInput"

function inputHarness(search = '') {
  const windowListeners: Record<string, Function[]> = {}
  const documentListeners: Record<string, Function[]> = {}
  ;(globalThis as any).window = {
    location: { search },
    addEventListener: (name: string, fn: Function) => { (windowListeners[name] ??= []).push(fn) },
    removeEventListener: () => {},
  }
  ;(globalThis as any).document = {
    pointerLockElement: null,
    addEventListener: (name: string, fn: Function) => { (documentListeners[name] ??= []).push(fn) },
    removeEventListener: () => {},
  }
  return { input: new PlayerInput(), windowListeners, documentListeners }
}

describe("PlayerInput Pointer Lock Synchronization", () => {
  it.each(['', '?nolock'])('RMB remains hold/release in %s, including repeated down and blur', search => {
    const { input, windowListeners, documentListeners } = inputHarness(search)
    ;(globalThis as any).document.pointerLockElement = {}
    documentListeners.pointerlockchange.forEach(fn => fn())
    const fire = (name: string, button = 2) => windowListeners[name]?.forEach(fn => fn({ button }))
    fire('mousedown'); fire('mousedown')
    expect(input.isRightMouseDown).toBe(true)
    fire('mousedown', 0); fire('mouseup', 0)
    expect(input.consumeLeftClick()).toBe(true)
    expect(input.consumeLeftClickRelease()).toBe(true)
    fire('mouseup')
    expect(input.isRightMouseDown).toBe(false)
    fire('mousedown'); fire('blur')
    expect(input.isRightMouseDown).toBe(false)
    input.dispose()
  })
  it("PlayerInput created while document.pointerLockElement already exists -> isLocked === true", () => {
    ;(globalThis as any).window = {
      location: { search: "" },
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    ;(globalThis as any).document = {
      pointerLockElement: {} as Element,
      addEventListener: () => {},
      removeEventListener: () => {},
    };

    const input = new PlayerInput()
    expect(input.isLocked).toBe(true)
  })

  it("PlayerInput created while document.pointerLockElement is null -> isLocked === false", () => {
    ;(globalThis as any).window = {
      location: { search: "" },
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    ;(globalThis as any).document = {
      pointerLockElement: null,
      addEventListener: () => {},
      removeEventListener: () => {},
    };

    const input = new PlayerInput()
    expect(input.isLocked).toBe(false)
  })

  it("Town ignores mouse look until a real pointer lock exists", () => {
    const listeners: Record<string, Function[]> = {}
    ;(globalThis as any).window = { location: { search: '' }, addEventListener: () => {} }
    ;(globalThis as any).document = { pointerLockElement: null, addEventListener: (name: string, fn: Function) => { (listeners[name] ??= []).push(fn) } }
    const input = new PlayerInput()
    listeners.mousemove.forEach(fn => fn({ movementX: 30, movementY: 4 }))
    expect(input.consumeMouseDelta()).toEqual({ dx: 0, dy: 0 })
    ;(globalThis as any).document.pointerLockElement = {}
    listeners.pointerlockchange.forEach(fn => fn())
    ;(globalThis as any).document.pointerLockElement = null
    listeners.pointerlockchange.forEach(fn => fn())
    expect(input.isLocked).toBe(false)
    listeners.mousemove.forEach(fn => fn({ movementX: 30, movementY: 4 }))
    expect(input.consumeMouseDelta()).toEqual({ dx: 0, dy: 0 })
  })

  it("syncs isLocked when pointerlockchange event is dispatched", () => {
    const listeners: Record<string, Function[]> = {};
    ;(globalThis as any).window = {
      location: { search: "" },
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    ;(globalThis as any).document = {
      pointerLockElement: null,
      addEventListener: (event: string, cb: any) => {
        listeners[event] = listeners[event] || []
        listeners[event].push(cb)
      },
      removeEventListener: () => {},
    };

    const input = new PlayerInput()
    expect(input.isLocked).toBe(false)

    // Acquire lock
    ;(globalThis as any).document.pointerLockElement = {} as Element
    listeners["pointerlockchange"]?.forEach(cb => cb(new Event("pointerlockchange")))
    expect(input.isLocked).toBe(true)

    // Release lock (ESC)
    ;(globalThis as any).document.pointerLockElement = null
    listeners["pointerlockchange"]?.forEach(cb => cb(new Event("pointerlockchange")))
    expect(input.isLocked).toBe(false)
  })

  it('ignores movement and combat input while unlocked and clears held input on unlock', () => {
    const { input, windowListeners, documentListeners } = inputHarness()
    windowListeners.keydown.forEach(fn => fn({ code: 'KeyW' }))
    windowListeners.mousedown.forEach(fn => fn({ button: 0 }))
    windowListeners.mousedown.forEach(fn => fn({ button: 2 }))
    expect(input.keys.KeyW).toBeUndefined()
    expect(input.consumeLeftClick()).toBe(false)
    expect(input.isRightMouseDown).toBe(false)

    ;(globalThis as any).document.pointerLockElement = {}
    documentListeners.pointerlockchange.forEach(fn => fn())
    windowListeners.keydown.forEach(fn => fn({ code: 'KeyW' }))
    windowListeners.mousedown.forEach(fn => fn({ button: 2 }))
    expect(input.keys.KeyW).toBe(true)
    expect(input.isRightMouseDown).toBe(true)

    ;(globalThis as any).document.pointerLockElement = null
    documentListeners.pointerlockchange.forEach(fn => fn())
    expect(input.keys.KeyW).toBeUndefined()
    expect(input.isRightMouseDown).toBe(false)
  })

  it('keeps explicit nolock QA input enabled', () => {
    const { input, windowListeners } = inputHarness('?nolock')
    windowListeners.keydown.forEach(fn => fn({ code: 'KeyW' }))
    windowListeners.mousedown.forEach(fn => fn({ button: 0 }))
    expect(input.isLocked).toBe(true)
    expect(input.keys.KeyW).toBe(true)
    expect(input.consumeLeftClick()).toBe(true)
  })
})
