import { describe, it, expect } from "vitest"
import { PlayerInput } from "../src/player/PlayerInput"

describe("PlayerInput Pointer Lock Synchronization", () => {
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
})
