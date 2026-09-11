import * as THREE from 'three'
import type { NPC } from './NPC'
import type { Mount } from './Mount'

/**
 * Dedicated layer for aim raycasting.
 * The gameplay camera has layer 0 enabled and layer 1 disabled, so proxy meshes
 * are NEVER rendered by WebGLRenderer (zero render / shader cost).
 * The aim raycaster has layers 0 and 1 enabled, allowing it to intersect both
 * standard world meshes (terrain/obstacles) and dedicated aim proxy colliders.
 */
export const AIM_RAYCAST_LAYER = 1

export class AimTargetRegistry {
  private readonly _targets: THREE.Object3D[] = []
  private readonly _targetSet = new Set<THREE.Object3D>()

  private readonly _npcProxies = new Map<NPC, THREE.Object3D>()
  private readonly _npcDeathUnsubs = new Map<NPC, () => void>()

  private readonly _mountProxies = new Map<Mount, THREE.Object3D>()
  private readonly _mountDeathUnsubs = new Map<Mount, () => void>()

  /** Returns flat target array for Raycaster.intersectObjects(targets, false) */
  get targets(): THREE.Object3D[] {
    return this._targets
  }

  /** Add static terrain or obstacle collision mesh */
  addStaticTarget(object: THREE.Object3D): void {
    if (this._targetSet.has(object)) return
    this._targetSet.add(object)
    this._targets.push(object)
  }

  /** Remove static target */
  removeStaticTarget(object: THREE.Object3D): void {
    if (!this._targetSet.delete(object)) return
    const idx = this._targets.indexOf(object)
    if (idx !== -1) {
      this._targets.splice(idx, 1)
    }
  }

  /** Register an NPC and its aim hit proxy */
  registerNpc(npc: NPC): void {
    const proxy = npc.aimCollider
    if (!proxy) return
    if (this._npcProxies.has(npc)) return

    this._npcProxies.set(npc, proxy)

    // Only add to active targets if NPC is not dead
    if (!npc.dead) {
      this._addTarget(proxy)
    }

    // Subscribe to death and respawn events
    const onDeath = (): void => {
      this._removeTarget(proxy)
    }
    const onRespawn = (): void => {
      this._addTarget(proxy)
    }

    npc.onDeathCallbacks.push(onDeath)
    npc.onRespawnCallbacks.push(onRespawn)

    this._npcDeathUnsubs.set(npc, () => {
      const deathIdx = npc.onDeathCallbacks.indexOf(onDeath)
      if (deathIdx !== -1) npc.onDeathCallbacks.splice(deathIdx, 1)
      const respawnIdx = npc.onRespawnCallbacks.indexOf(onRespawn)
      if (respawnIdx !== -1) npc.onRespawnCallbacks.splice(respawnIdx, 1)
    })
  }

  /** Unregister an NPC (on despawn or entity cleanup) */
  unregisterNpc(npc: NPC): void {
    const proxy = this._npcProxies.get(npc)
    if (!proxy) return

    this._npcProxies.delete(npc)
    const unsub = this._npcDeathUnsubs.get(npc)
    if (unsub) {
      unsub()
      this._npcDeathUnsubs.delete(npc)
    }
    this._removeTarget(proxy)
  }

  /** Register a Mount (e.g. horse) and its aim hit proxy */
  registerMount(mount: Mount): void {
    const proxy = mount.aimCollider
    if (!proxy) return
    if (this._mountProxies.has(mount)) return

    this._mountProxies.set(mount, proxy)

    if (!mount.dead) {
      this._addTarget(proxy)
    }

    const onDeath = (): void => {
      this._removeTarget(proxy)
    }
    mount.onDeathCallbacks.push(onDeath)
    this._mountDeathUnsubs.set(mount, () => {
      const idx = mount.onDeathCallbacks.indexOf(onDeath)
      if (idx !== -1) mount.onDeathCallbacks.splice(idx, 1)
    })
  }

  /** Unregister a Mount (e.g. player's mount or despawned mount) */
  unregisterMount(mount: Mount): void {
    const proxy = this._mountProxies.get(mount)
    if (!proxy) return

    this._mountProxies.delete(mount)
    const unsub = this._mountDeathUnsubs.get(mount)
    if (unsub) {
      unsub()
      this._mountDeathUnsubs.delete(mount)
    }
    this._removeTarget(proxy)
  }

  private _addTarget(target: THREE.Object3D): void {
    if (this._targetSet.has(target)) return
    this._targetSet.add(target)
    this._targets.push(target)
  }

  private _removeTarget(target: THREE.Object3D): void {
    if (!this._targetSet.delete(target)) return
    const idx = this._targets.indexOf(target)
    if (idx !== -1) {
      this._targets.splice(idx, 1)
    }
  }

  clear(): void {
    this._targets.length = 0
    this._targetSet.clear()
    for (const unsub of this._npcDeathUnsubs.values()) unsub()
    this._npcDeathUnsubs.clear()
    this._npcProxies.clear()
    for (const unsub of this._mountDeathUnsubs.values()) unsub()
    this._mountDeathUnsubs.clear()
    this._mountProxies.clear()
  }
}
