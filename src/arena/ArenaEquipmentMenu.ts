import type { PlayerInput } from '../player/PlayerInput'
import type { InventoryManager } from '../rpg/InventoryManager'
import type { SkillManager } from '../rpg/SkillManager'
import { EquipmentUI, type EquipmentMountAdapter } from '../ui/EquipmentUI'

/** Owns modal input; the combat host freezes its whole simulation while visible. */
export class ArenaEquipmentMenu {
  private readonly ui = new EquipmentUI()
  private readonly listeners = new AbortController()

  constructor(private readonly input: PlayerInput, skills: SkillManager, inventory: InventoryManager,
    canvas: HTMLCanvasElement, canOpen: () => boolean, mounts?: EquipmentMountAdapter) {
    const signal = this.listeners.signal
    window.addEventListener('keydown', event => {
      if (event.code === 'Tab' || event.code === 'KeyI' || this.visible && event.code === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        if (event.repeat) return
        if (this.visible) {
          this.close()
          if (!location.search.includes('nolock')) input.requestPointerLock(canvas)
        } else if (canOpen()) {
          input.clear()
          document.exitPointerLock?.()
          this.ui.open(skills, inventory, () => input.clear(), mounts)
        }
      } else if (this.visible && !(event.target as Element | null)?.closest?.('#character-modal')) {
        event.stopImmediatePropagation()
      }
    }, { capture: true, signal })
    for (const type of ['mousedown', 'mouseup', 'wheel', 'mousemove'] as const) {
      window.addEventListener(type, event => {
        if (!this.visible) return
        event.stopImmediatePropagation()
        input.clear()
      }, { capture: true, passive: false, signal })
    }
  }

  get visible(): boolean { return this.ui.visible }
  close(): void { this.ui.close(); this.input.clear() }
  dispose(): void { this.close(); this.listeners.abort() }
}
