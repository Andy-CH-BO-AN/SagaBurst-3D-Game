import { describe, expect, it, vi } from 'vitest'
import { Vector3 } from 'three'
import { Game } from '../../src/Game'
import { InventoryManager } from '../../src/rpg/InventoryManager'
import { InteractionFocus } from '../../src/world/InteractionFocus'
import { WeaponPickup } from '../../src/world/WeaponPickup'

function pickup(id: string, x: number, z: number, arrows = 0): WeaponPickup {
  return Object.assign(Object.create(WeaponPickup.prototype) as WeaponPickup, {
    group: { position: new Vector3(x, 0, z) }, alive: true, weaponId: id, name: id,
    isArrowPack: arrows > 0, arrowQuantity: arrows,
    update() {}, setSelected() {}, destroy() { this.alive = false },
  })
}

function harness(custom = true) {
  let pressed = false, prompt: string | null = null
  const inventory = new InventoryManager({ meleeWeaponId: '', rangedWeaponId: '', shieldId: null })
  const player = { position: new Vector3(), dead: false, spectatorOnly: false, isMounted: false, currentMount: null,
    arrowCount: 3, setArrowCount(count: number) { this.arrowCount = count } }
  const mount = { group: { position: new Vector3(1.4, 0, 0) }, availableForPlayer: true, type: 'HORSE',
    dead: false, state: 'IDLE', movementSpeed: 0, currentLod: 0, displayName: '馬', eagleVisual: null,
    setCameraDistance() {}, update() {} }
  const game = Object.assign(Object.create(Game.prototype) as { _updateInteractions(dt: number): void }, {
    pickups: [] as WeaponPickup[], mounts: [mount], player, camera: { position: new Vector3() }, obstacles: [],
    thirdPersonCamera: { cameraYaw: Math.PI }, inventoryManager: inventory, customPickupPolicy: custom,
    pickupFocus: new InteractionFocus(), pickupHud: { show: (text: string | null) => { prompt = text }, notify: vi.fn() },
    input: { isLocked: true, consumeKeyE: () => { const value = pressed; pressed = false; return value } },
    soundManager: { updateHorseGallopLoops() {}, updateEagleWingbeats() {} }, equipmentUI: { visible: false },
    controlMode: 'player', interactionInputCaptured: false, isTrainingGround: false, modelStudio: null,
    quiverUI: { setArrowCount: vi.fn() }, _mountPlayer: vi.fn(),
  })
  return { game, inventory, player, mount, mountPlayer: (game as unknown as { _mountPlayer: ReturnType<typeof vi.fn> })._mountPlayer,
    press: () => { pressed = true }, prompt: () => prompt }
}

describe('Game pickup caller', () => {
  it('uses the displayed target even beside a mount, and cancels when that target is gone', () => {
    const h = harness(), sword = pickup('gladius_rusty', 0, 1.2), lance = pickup('steel_lance', .4, 1.3)
    Object.assign(h.game, { pickups: [sword, lance] })
    h.game._updateInteractions(0)
    expect(h.prompt()).toContain('gladius_rusty')
    sword.destroy()
    h.press(); h.game._updateInteractions(0)
    expect(h.inventory.saveState.items).toEqual([])
    expect(h.mountPlayer).not.toHaveBeenCalled()
    expect(h.prompt()).toContain('steel_lance')
    h.press(); h.game._updateInteractions(0)
    expect(h.inventory.activeMelee?.id).toBe('steel_lance')
    h.press(); h.game._updateInteractions(0)
    expect(h.mountPlayer).toHaveBeenCalledWith(h.mount)
    h.inventory.dispose()
  })

  it('stores a bow when a shield is allocated without changing the shield', () => {
    const h = harness(), bow = pickup('wooden_shortbow', 0, 1.2)
    h.inventory.addWeapon('scutum_t1'); h.inventory.equipWeapon('scutum_t1')
    Object.assign(h.game, { pickups: [bow], mounts: [] })
    h.game._updateInteractions(0)
    expect(h.prompt()).toContain('收進背包')
    h.press(); h.game._updateInteractions(0)
    expect(h.inventory.saveState.equippedShieldId).toBe('scutum_t1')
    expect(h.inventory.saveState.equippedRangedId).toBe('')
    expect(h.inventory.saveState.items).toContainEqual({ id: 'wooden_shortbow', quantity: 1 })
    h.inventory.dispose()
  })

  it('keeps non-custom equipment in the backpack and applies arrow supplies to the player', () => {
    const h = harness(false), sword = pickup('gladius_rusty', 0, 1.2)
    Object.assign(h.game, { pickups: [sword], mounts: [] })
    h.game._updateInteractions(0)
    expect(h.prompt()).toContain('收進背包')
    h.press(); h.game._updateInteractions(0)
    expect(h.inventory.saveState.items).toEqual([{ id: 'gladius_rusty', quantity: 1 }])
    expect(h.inventory.saveState.equippedMeleeId).toBe('')
    Object.assign(h.game, { pickups: [pickup('arrows', 0, 1.2, 20)] })
    h.game._updateInteractions(0); expect(h.prompt()).toContain('+20')
    h.press(); h.game._updateInteractions(0)
    expect(h.player.arrowCount).toBe(23)
    h.inventory.dispose()
  })
})
