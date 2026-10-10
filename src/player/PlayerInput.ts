/**
 * PlayerInput.ts
 * Centralised keyboard & mouse event manager.
 * Phase 3 addition: right mouse button (aim mode) detection.
 */
export class PlayerInput {
  private readonly listeners = new AbortController()
  dispose(): void { this.listeners.abort(); this.clear() }
  clear(): void {
    for (const key of Object.keys(this.keys)) delete this.keys[key]
    this.isLeftMouseDown = this.isRightMouseDown = false
    this._leftClickTriggered = this._leftClickReleased = this._middleClickTriggered = this._keyETriggered = false
    this._wheelSteps = this._dx = this._dy = 0
    this._keyPresses.clear()
  }

  private readonly allowUnlockedInput = window.location.search.includes('nolock')
  // Movement & Action keys
  readonly keys: Record<string, boolean> = {}

  // Mouse buttons
  isLeftMouseDown = false
  isRightMouseDown = false
  private _leftClickTriggered = false
  private _leftClickReleased = false
  private _middleClickTriggered = false
  private _wheelSteps = 0

  // Accumulated mouse deltas since last consume()
  private _dx = 0
  private _dy = 0

  // Pointer lock state
  isLocked = false

  private _keyETriggered = false
  private readonly _keyPresses = new Set<string>()

  private _syncPointerLockState(): void {
    const locked = typeof document !== "undefined" && document.pointerLockElement !== null
    const nextLocked = locked || this.allowUnlockedInput
    if (!nextLocked) this.clear()
    this.isLocked = nextLocked
  }

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (!this.isLocked) return
      // A modal, death or focus change cancels held keys until a new physical press.
      if (e.repeat && !this.keys[e.code]) return
      if (!this.keys[e.code]) this._keyPresses.add(e.code)
      if (e.code === 'Space') e.preventDefault()
      this.keys[e.code] = true
      if (e.code === 'KeyE') {
        this._keyETriggered = true
      }
    }, { signal: this.listeners.signal })
    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false
    }, { signal: this.listeners.signal })

    window.addEventListener('mousedown', (e) => {
      if (!this.isLocked) return
      if (e.button === 0) {
        this.isLeftMouseDown = true
        this._leftClickTriggered = true
      }
      if (e.button === 1) {
        // Middle click is reserved for Army Command confirmation while locked.
        if (this.isLocked) {
          e.preventDefault()
          this._middleClickTriggered = true
        }
      }
      if (e.button === 2) {
        this.isRightMouseDown = true
      }
    }, { signal: this.listeners.signal })

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        const wasDown = this.isLeftMouseDown
        this.isLeftMouseDown = false
        if (this.isLocked && wasDown) this._leftClickReleased = true
      }
      if (e.button === 2) {
        this.isRightMouseDown = false
      }
    }, { signal: this.listeners.signal })

    window.addEventListener('wheel', (e) => {
      if (!this.isLocked || e.deltaY === 0) return
      // One physical wheel direction becomes one deterministic selection step.
      // Clamp queued steps so trackpads cannot accumulate an unbounded backlog.
      e.preventDefault()
      this._wheelSteps = Math.max(-8, Math.min(8, this._wheelSteps + Math.sign(e.deltaY)))
    }, { passive: false, signal: this.listeners.signal })

    // Prevent context menu from popping up on right-click
    window.addEventListener('contextmenu', (e) => {
      e.preventDefault()
    }, { signal: this.listeners.signal })

    document.addEventListener('mousemove', (e) => {
      if (!this.isLocked) return
      this._dx += e.movementX
      this._dy += e.movementY
    }, { signal: this.listeners.signal })

    window.addEventListener('blur', () => this.clear(), { signal: this.listeners.signal })
    document.addEventListener('pointerlockchange', () => {
      this._syncPointerLockState()
    }, { signal: this.listeners.signal })

    // Critical: handle pointer lock acquired before PlayerInput existed.
    this._syncPointerLockState()
  }

  /** Returns true if left click was triggered since last check, then resets flag. */
  consumeLeftClick(): boolean {
    const val = this._leftClickTriggered
    this._leftClickTriggered = false
    return val
  }

  /** Returns true if left click was released since last check, then resets flag. */
  consumeLeftClickRelease(): boolean {
    const val = this._leftClickReleased
    this._leftClickReleased = false
    return val
  }

  /** A UI owns the whole click, including its held state and later physical release. */
  consumeLeftGesture(): void {
    this.isLeftMouseDown = false
    this._leftClickTriggered = this._leftClickReleased = false
  }

  /** Returns true once for a locked middle-click, then resets the flag. */
  consumeMiddleClick(): boolean {
    const val = this._middleClickTriggered
    this._middleClickTriggered = false
    return val
  }

  /**
   * Returns one queued wheel selection step.
   * -1 = wheel up / previous, +1 = wheel down / next.
   */
  consumeWheelStep(): -1 | 0 | 1 {
    if (this._wheelSteps > 0) {
      this._wheelSteps--
      return 1
    }
    if (this._wheelSteps < 0) {
      this._wheelSteps++
      return -1
    }
    return 0
  }

  /** Returns true if E key was pressed since last check, then resets flag. */
  consumeKeyE(): boolean {
    const val = this._keyETriggered
    this._keyETriggered = false
    this._keyPresses.delete('KeyE')
    return val
  }

  /** Returns true once for each physical key-down edge. Key repeat is ignored. */
  consumeKeyPress(code: string): boolean {
    if (!this._keyPresses.has(code)) return false
    this._keyPresses.delete(code)
    return true
  }

  /** Returns and resets accumulated mouse delta. */
  consumeMouseDelta(): { dx: number; dy: number } {
    const result = { dx: this._dx, dy: this._dy }
    this._dx = 0
    this._dy = 0
    return result
  }

  requestPointerLock(element?: Element) {
    const target = element || (typeof document !== "undefined" ? (document.querySelector("canvas") || document.body) : null)
    try {
      const p = target?.requestPointerLock?.()
      if (p && typeof (p as any).catch === "function") {
        ;(p as Promise<void>).catch(() => {})
      }
    } catch {
      // ignore
    }
  }
}
