import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
import { ArenaEquipmentMenu } from '../../src/arena/ArenaEquipmentMenu'
import { CareerDuelArenaScene } from '../../src/arena/CareerDuelArenaScene'
import { CareerArenaCombatScene } from '../../src/arena/CareerArenaCombatScene'
import { InventoryManager } from '../../src/rpg/InventoryManager'
import { SkillManager } from '../../src/rpg/SkillManager'
import type { PlayerInput } from '../../src/player/PlayerInput'

// Only the rendered DOM boundary is replaced; events and menu decisions are real.
vi.mock('../../src/ui/EquipmentUI', () => ({ EquipmentUI: class {
  visible = false
  open() { this.visible = true }
  close() { this.visible = false }
} }))
afterEach(() => vi.unstubAllGlobals())

it('owns Tab, I and Escape, clears held input and removes its listeners on exit', () => {
  const win = new EventTarget(), exitPointerLock = vi.fn()
  vi.stubGlobal('window', win)
  vi.stubGlobal('location', { search: '' })
  vi.stubGlobal('document', { exitPointerLock, getElementById: () => null })
  const input = { clear: vi.fn(), requestPointerLock: vi.fn() }
  const inventory = new InventoryManager({ meleeWeaponId: '', rangedWeaponId: '', shieldId: null })
  let allowed = false
  const menu = new ArenaEquipmentMenu(input as unknown as PlayerInput, new SkillManager(), inventory,
    {} as HTMLCanvasElement, () => allowed)
  onTestFinished(() => { menu.dispose(); inventory.dispose() })
  const key = (code: string, repeat = false) => {
    const event = Object.assign(new Event('keydown', { cancelable: true }), { code, repeat })
    win.dispatchEvent(event); expect(event.defaultPrevented).toBe(true)
  }
  key('Tab'); expect(menu.visible).toBe(false)
  allowed = true
  key('Tab'); expect(menu.visible).toBe(true)
  expect(exitPointerLock).toHaveBeenCalledOnce()
  key('Tab', true); expect(menu.visible).toBe(true)
  const clears = input.clear.mock.calls.length
  win.dispatchEvent(new Event('mousedown'))
  expect(input.clear).toHaveBeenCalledTimes(clears + 1)
  key('Escape'); expect(menu.visible).toBe(false)
  expect(input.requestPointerLock).toHaveBeenCalledOnce()
  key('KeyI'); expect(menu.visible).toBe(true)
  menu.dispose()
  win.dispatchEvent(Object.assign(new Event('keydown'), { code: 'Tab' }))
  expect(menu.visible).toBe(false)
})

it('freezes the real duel and squad simulation callers before clocks, actors and shots advance', () => {
  for (const Scene of [CareerDuelArenaScene, CareerArenaCombatScene]) {
    const input = { clear: vi.fn() }
    // No scene, model or renderer is constructed. Any simulation access beyond the modal guard fails.
    const host = Object.assign(Object.create(Scene.prototype) as { update(dt: number): void }, {
      disposed: false, equipment: { visible: true }, input,
    })
    expect(() => host.update(60)).not.toThrow()
    expect(input.clear).toHaveBeenCalledOnce()
  }
})
