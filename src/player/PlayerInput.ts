/**
 * PlayerInput.ts
 * Centralised keyboard & mouse event manager.
 * Phase 3 addition: right mouse button (aim mode) detection.
 */
export class PlayerInput {
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
    this.isLocked = (typeof document !== "undefined" && document.pointerLockElement !== null) || this.allowUnlockedInput
  }

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (!this.keys[e.code]) this._keyPresses.add(e.code)
      this.keys[e.code] = true
      if (e.code === 'KeyE') {
        this._keyETriggered = true
      }
    })
    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false
    })

    window.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        if (this.allowUnlockedInput && this.isRightMouseDown) {
          this.isLeftMouseDown = !this.isLeftMouseDown
          if (this.isLeftMouseDown) this._leftClickTriggered = true
          else this._leftClickReleased = true
        } else {
          this.isLeftMouseDown = true
          // Strict lock gating: only trigger melee action when already locked.
          // The initial click to acquire pointer lock does not trigger attack.
          if (this.isLocked) {
            this._leftClickTriggered = true
          }
        }
      }
      if (e.button === 1) {
        // Middle click is reserved for Army Command confirmation while locked.
        if (this.isLocked) {
          e.preventDefault()
          this._middleClickTriggered = true
        }
      }
      if (e.button === 2) {
        // Browser automation cannot hold pointer-lock mouse buttons.  In the
        // explicit ?nolock QA mode, each right click toggles aim so the real
        // input path can still be exercised end-to-end.
        this.isRightMouseDown = this.allowUnlockedInput ? !this.isRightMouseDown : true
      }
    })

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        if (!(this.allowUnlockedInput && this.isRightMouseDown)) {
          this.isLeftMouseDown = false
          if (this.isLocked) {
            this._leftClickReleased = true
          }
        }
      }
      if (e.button === 2) {
        if (!this.allowUnlockedInput) this.isRightMouseDown = false
      }
    })

    window.addEventListener('wheel', (e) => {
      if (!this.isLocked || e.deltaY === 0) return
      // One physical wheel direction becomes one deterministic selection step.
      // Clamp queued steps so trackpads cannot accumulate an unbounded backlog.
      e.preventDefault()
      this._wheelSteps = Math.max(-8, Math.min(8, this._wheelSteps + Math.sign(e.deltaY)))
    }, { passive: false })

    // Prevent context menu from popping up on right-click
    window.addEventListener('contextmenu', (e) => {
      e.preventDefault()
    })

    document.addEventListener('mousemove', (e) => {
      // Strict lock gating: mouse movement delta is only accumulated when locked.
      // Pressing ESC to release pointer lock safely prevents camera rotation while navigating UI.
      if (!this.isLocked) return
      this._dx += e.movementX
      this._dy += e.movementY
    })

    document.addEventListener('pointerlockchange', () => {
      this._syncPointerLockState()
    })

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
