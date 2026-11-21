import { describe, expect, it } from 'vitest'
import { InventoryManager } from '../../src/rpg/InventoryManager'
import {
  PlayerInteractionController, type InteractionMount, type InteractionPickup,
} from '../../src/world/PlayerInteractionController'

type Point = { x: number; y: number; z: number }

class PickupDouble implements InteractionPickup {
  isAlive = true
  selected = false
  readonly position: Point
  constructor(readonly weaponId: string, x: number, z: number, readonly arrowQuantity = 0) {
    this.position = { x, y: 0, z }
  }
  get isArrowPack(): boolean { return this.arrowQuantity > 0 }
  get name(): string { return this.weaponId }
  setSelected(selected: boolean): void { this.selected = selected }
  destroy(): void { this.isAlive = false }
}

function mountDouble(x: number): InteractionMount {
  return { group: { position: { x, y: 0, z: 0 } }, availableForPlayer: true, coopPuppet: false, displayName: '馬' }
}

/** Yaw π looks along -(-sin) = +z where the pickups sit. */
const VIEW_YAW = Math.PI

function setup(options: { custom?: boolean; pickups?: PickupDouble[]; mounts?: InteractionMount[] } = {}) {
  const inventory = new InventoryManager({ meleeWeaponId: '', rangedWeaponId: '', shieldId: null })
  const state = { prompt: null as string | null, notices: [] as string[], quiverCounts: [] as number[], mountedOn: [] as InteractionMount[] }
  const player = {
    position: { x: 0, y: 0, z: 0 }, isMounted: false, currentMount: null as InteractionMount | null, arrowCount: 3,
    setArrowCount(count: number) { this.arrowCount = count }, dismountFromMount() {},
  }
  const pickups = options.pickups ?? []
  const controller = new PlayerInteractionController<PickupDouble, InteractionMount>({
    player: () => player,
    pickups: () => pickups,
    mounts: () => options.mounts ?? [],
    inventory: () => inventory,
    customPickupPolicy: () => options.custom ?? true,
    hud: { show: text => { state.prompt = text }, notify: text => { state.notices.push(text) } },
    quiver: { setArrowCount: count => { state.quiverCounts.push(count) } },
    onDismounted: () => {},
    mountPlayer: mount => { state.mountedOn.push(mount) },
  })
  const step = (pressed = false) => controller.update(pressed, VIEW_YAW)
  return { inventory, state, player, pickups, step }
}

describe('Player interaction controller', () => {
  it('uses the displayed target even beside a mount, and ignores a target destroyed before the press', () => {
    const sword = new PickupDouble('gladius_rusty', 0, 1.2), lance = new PickupDouble('steel_lance', .4, 1.3)
    const mount = mountDouble(1.4)
    const h = setup({ pickups: [sword, lance], mounts: [mount] })
    h.step()
    expect(h.state.prompt).toContain('gladius_rusty')
    expect(sword.selected).toBe(true)
    sword.destroy()
    h.step(true)
    expect(h.inventory.saveState.items).toEqual([])
    expect(h.state.mountedOn).toEqual([])
    expect(h.state.prompt).toContain('steel_lance')
    h.step(true)
    expect(h.inventory.activeMelee?.id).toBe('steel_lance')
    expect(h.pickups).toEqual([sword])
    h.step(true)
    expect(h.state.mountedOn).toEqual([mount])
    h.inventory.dispose()
  })

  it('stores a bow when a shield is allocated without changing the shield', () => {
    const bow = new PickupDouble('wooden_shortbow', 0, 1.2)
    const h = setup({ pickups: [bow] })
    h.inventory.addWeapon('scutum_t1'); h.inventory.equipWeapon('scutum_t1')
    h.step()
    expect(h.state.prompt).toContain('收進背包')
    h.step(true)
    expect(h.inventory.saveState.equippedShieldId).toBe('scutum_t1')
    expect(h.inventory.saveState.equippedRangedId).toBe('')
    expect(h.inventory.saveState.items).toContainEqual({ id: 'wooden_shortbow', quantity: 1 })
    h.inventory.dispose()
  })

  it('keeps non-custom equipment in the backpack and applies arrow supplies to the player quiver', () => {
    const sword = new PickupDouble('gladius_rusty', 0, 1.2)
    const h = setup({ custom: false, pickups: [sword] })
    h.step()
    expect(h.state.prompt).toContain('收進背包')
    h.step(true)
    expect(h.inventory.saveState.items).toEqual([{ id: 'gladius_rusty', quantity: 1 }])
    expect(h.inventory.saveState.equippedMeleeId).toBe('')
    h.pickups.push(new PickupDouble('arrows', 0, 1.2, 20))
    h.step()
    expect(h.state.prompt).toContain('+20')
    h.step(true)
    expect(h.player.arrowCount).toBe(23)
    expect(h.state.quiverCounts).toEqual([23])
    expect(h.state.notices.at(-1)).toContain('+20')
    h.inventory.dispose()
  })
})
