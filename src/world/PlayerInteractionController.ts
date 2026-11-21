import { InteractionFocus, type InteractionCandidate } from './InteractionFocus'

type Point = { x: number; y: number; z: number }

export interface InteractionPickup {
  readonly weaponId: string
  readonly name: string
  readonly isArrowPack: boolean
  readonly arrowQuantity: number
  readonly position: Point
  readonly isAlive: boolean
  setSelected(selected: boolean): void
  destroy(): void
}

export interface InteractionMount {
  readonly group: { readonly position: Point }
  readonly availableForPlayer: boolean
  readonly coopPuppet: boolean
  readonly displayName: string
}

export interface PlayerInteractionPorts<P extends InteractionPickup, M extends InteractionMount> {
  player(): {
    readonly position: Point
    readonly isMounted: boolean
    readonly currentMount: M | null
    readonly arrowCount: number
    setArrowCount(count: number): void
    dismountFromMount(): void
  }
  pickups(): P[]
  mounts(): readonly M[]
  inventory(): {
    pickupDisposition(weaponId: string): 'equip' | 'backpack'
    addWeapon(weaponId: string): unknown
    equipWeapon(weaponId: string): unknown
  }
  customPickupPolicy(): boolean
  hud: { show(text: string | null): void; notify(text: string): void }
  quiver: { setArrowCount(count: number): void }
  /** Runs after the player has left the mount (tutorial, aim registry, mount HUD). */
  onDismounted(mount: M): void
  mountPlayer(mount: M): void
}

/** Chooses, displays and applies the single pickup / mount / dismount action the player may press E for. */
export class PlayerInteractionController<P extends InteractionPickup, M extends InteractionMount> {
  private readonly focus = new InteractionFocus<P | M>()

  constructor(private readonly ports: PlayerInteractionPorts<P, M>) {}

  /** Drop the displayed target, e.g. when interaction input is unavailable. */
  clear(): void {
    this.focus.clear()
    this.ports.hud.show(null)
    for (const pickup of this.ports.pickups()) pickup.setSelected(false)
  }

  /** The press belongs to the target and action displayed in the preceding frame. */
  update(pressed: boolean, viewYaw: number): void {
    const { ports } = this
    const player = ports.player()
    const action = this.focus.pressed(pressed, this.candidates(), player.position)
    if (action?.action === 'dismount') {
      const prevMount = player.currentMount!
      player.dismountFromMount()
      ports.onDismounted(prevMount)
    } else if (action && (action.action === 'arrows' || action.action === 'equip' || action.action === 'backpack')) {
      const pickup = action.target as P
      if (pickup.isArrowPack) {
        player.setArrowCount(player.arrowCount + pickup.arrowQuantity)
        ports.quiver.setArrowCount(player.arrowCount)
        ports.hud.notify(`已補充箭矢 · +${pickup.arrowQuantity}`)
      } else {
        const inventory = ports.inventory()
        inventory.addWeapon(pickup.weaponId)
        if (action.action === 'equip') inventory.equipWeapon(pickup.weaponId)
        ports.hud.notify(`${action.action === 'equip' ? '已裝備' : '已收進背包'} · ${pickup.name}`)
      }
      pickup.destroy()
      const pickups = ports.pickups()
      const idx = pickups.indexOf(pickup)
      if (idx !== -1) pickups.splice(idx, 1)
    } else if (action?.action === 'mount') {
      ports.mountPlayer(action.target as M)
    }

    const selected = this.focus.select(this.candidates(), player.position,
      { x: -Math.sin(viewYaw), z: -Math.cos(viewYaw) })
    for (const pickup of ports.pickups()) pickup.setSelected(selected?.target === pickup)
    ports.hud.show(selected?.prompt ?? null)
  }

  private candidates(): InteractionCandidate<P | M>[] {
    const { ports } = this
    const player = ports.player()
    const position = player.position
    if (player.isMounted && player.currentMount) return [{
      target: player.currentMount, position, range: 2.5, action: 'dismount', prompt: '[E] 下騎',
    }]
    const items: InteractionCandidate<P | M>[] = []
    for (const pickup of ports.pickups()) {
      if (!pickup.isAlive) continue
      const action = pickup.isArrowPack ? 'arrows' : ports.customPickupPolicy() ? ports.inventory().pickupDisposition(pickup.weaponId) : 'backpack'
      const text = action === 'arrows' ? `補充箭矢 · +${pickup.arrowQuantity}`
        : `${action === 'equip' ? '拾起並裝備' : '收進背包'} · ${pickup.name}`
      items.push({ target: pickup, position: pickup.position, range: 2.5, action, prompt: `[E] ${text}` })
    }
    for (const mount of ports.mounts()) if (mount.availableForPlayer && !mount.coopPuppet) items.push({
      target: mount, position: mount.group.position, range: 2.5, action: 'mount', prompt: `[E] 騎乘：${mount.displayName}`,
    })
    return items
  }
}
