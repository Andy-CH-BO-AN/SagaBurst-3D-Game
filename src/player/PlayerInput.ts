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

  // Accumulated mouse deltas since last consume()
  private _dx = 0
  private _dy = 0

  // Pointer lock state
  isLocked = this.allowUnlockedInput

  private _keyETriggered = false

  constructor() {
    window.addEventListener('keydown', (e) => {
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
          if (this.isLocked) this._leftClickTriggered = true
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
          if (this.isLocked) this._leftClickReleased = true
        }
      }
      if (e.button === 2) {
        if (!this.allowUnlockedInput) this.isRightMouseDown = false
      }
    })

    // Prevent context menu from popping up on right-click
    window.addEventListener('contextmenu', (e) => {
      e.preventDefault()
    })

    document.addEventListener('mousemove', (e) => {
      if (!this.isLocked) return
      this._dx += e.movementX
      this._dy += e.movementY
    })

    document.addEventListener('pointerlockchange', () => {
      this.isLocked = document.pointerLockElement !== null || this.allowUnlockedInput
    })
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

  /** Returns true if E key was pressed since last check, then resets flag. */
  consumeKeyE(): boolean {
    const val = this._keyETriggered
    this._keyETriggered = false
    return val
  }

  /** Returns and resets accumulated mouse delta. */
  consumeMouseDelta(): { dx: number; dy: number } {
    const result = { dx: this._dx, dy: this._dy }
    this._dx = 0
    this._dy = 0
    return result
  }

  requestPointerLock() {
    document.body.requestPointerLock()
  }
}
