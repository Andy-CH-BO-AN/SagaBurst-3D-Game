import * as THREE from 'three'
import type { NPC } from '../world/NPC'
import type { MobileSiegeRamp } from './MobileSiegeRamp'
import { SIEGE_RAMP, type MobileSiegeRampId } from './MobileSiegeRampPolicy'
import { getTerrainHeight, getWalkRampHeight } from '../world/Terrain'
import type { MobileSiegeRampState } from './MobileSiegeRampController'

const needsGroundBypass = (state: MobileSiegeRampState): boolean =>
  state === 'DEPLOYING' || state === 'PUSHING' || state === 'DOCKING' || state === 'ABANDONED'

/** The same convoy detour in the vehicle's frame for Outpost and Town. NPC owns locomotion/collision. */
export class SiegeConvoy<Id extends MobileSiegeRampId> {
  private readonly bypassing = new Map<NPC, { ramp: MobileSiegeRamp<Id>; lateral: number }>()
  update(npc: NPC, ramps: readonly MobileSiegeRamp<Id>[]): void {
    // Evacuees own the continuous rear walk lane until their feet reach ground.
    if (npc.siegeEvacuation) { this.release(npc); return }
    const p = npc.combatPosition
    // Match the chassis front and the ground body used by canMove. Once clear,
    // normal gate targeting owns the rider even in the narrow gap before a wall.
    const frontClearance = SIEGE_RAMP.chassisOverhang + (npc.isMounted ? 1 : .5)
    let bypass = this.bypassing.get(npc)
    if (bypass) {
      const br = bypass.ramp
      const bdx = br.placement.dirX ?? 0
      const bdz = br.placement.dirZ
      const balong = (p.x - br.position.x) * bdx + (p.z - br.position.z) * bdz
      if (!needsGroundBypass(br.controller.state) || balong >= frontClearance) {
        this.bypassing.delete(npc); npc.siegeBypassTarget = null; bypass = undefined
      }
    }
    if (!bypass) {
      let ramp: MobileSiegeRamp<Id> | undefined
      for (let i = 0; i < ramps.length; i++) {
        const r = ramps[i]
        if (!needsGroundBypass(r.controller.state)) continue
        const dx = r.placement.dirX ?? 0
        const dz = r.placement.dirZ
        const lateralVal = (p.x - r.position.x) * dz - (p.z - r.position.z) * dx
        if (Math.abs(lateralVal) >= r.surface.halfWidth + 3) continue
        if ((p.x - r.position.x) * dx + (p.z - r.position.z) * dz >= frontClearance) continue
        if ((p.x - r.surface.startX) * dx + (p.z - r.surface.startZ) * dz <= -8) continue
        ramp = r
        break
      }
      if (ramp) {
        const dx = ramp.placement.dirX ?? 0
        const dz = ramp.placement.dirZ
        const lateralVal = (p.x - ramp.position.x) * dz - (p.z - ramp.position.z) * dx
        const side = Math.sign(lateralVal) || -Math.sign(ramp.position.x * dz - ramp.position.z * dx) || 1
        bypass = { ramp, lateral: side * (ramp.surface.halfWidth + 4) }; this.bypassing.set(npc, bypass)
      }
    }
    if (bypass) {
      const r = bypass.ramp, dx = r.placement.dirX ?? 0, dz = r.placement.dirZ
      const currentAlong = (p.x - r.position.x) * dx + (p.z - r.position.z) * dz
      const currentLateral = (p.x - r.position.x) * dz - (p.z - r.position.z) * dx
      const noseHalfWidth = r.surface.halfWidth + (npc.isMounted ? 1.5 : 1)
      const inFrontPocket = currentAlong >= -.25 && Math.abs(currentLateral) < noseHalfWidth
      const targetLateral = inFrontPocket ? currentLateral : bypass.lateral
      const forward = inFrontPocket ? frontClearance + .5
        : Math.abs(currentLateral - bypass.lateral) > .8 ? currentAlong : 6
      npc.siegeBypassTarget ??= new THREE.Vector3()
      npc.siegeBypassTarget.set(r.position.x + dz * targetLateral + dx * forward, p.y,
        r.position.z - dx * targetLateral + dz * forward)
    }
  }
  release(npc: NPC): void { if (this.bypassing.delete(npc)) npc.siegeBypassTarget = null }
  dispose(): void { for (const npc of this.bypassing.keys()) npc.siegeBypassTarget = null; this.bypassing.clear() }
}

export function evacuateAbandonedRamp<Id extends MobileSiegeRampId>(
  npc: Pick<NPC, 'combatantId' | 'dead' | 'position' | 'siegeEvacuation' | 'siegeBypassTarget'>,
  ramp: Pick<MobileSiegeRamp<Id>, 'assignment' | 'surface'>,
): void {
  if (npc.dead || npc.siegeEvacuation) return
  const assaultSlot = ramp.assignment.assaultIds.indexOf(npc.combatantId)
  const slot = assaultSlot >= 0 ? assaultSlot : ramp.assignment.pusherIds.indexOf(npc.combatantId)
  if (slot < 0) return
  const s = ramp.surface, y = getWalkRampHeight(s, npc.position.x, npc.position.z)
  if (y === null || Math.abs(npc.position.y - y) >= .8
    || npc.position.y <= getTerrainHeight(npc.position.x, npc.position.z) + .1) return
  // Follow the existing walk surface out through its open rear, with separate
  // ground slots inside the reserved pusher corridor. Never teleport off a deck.
  const lateral = slot % 2 === 0 ? -1 : 1, rear = 2 + Math.floor(slot / 2) * 1.5
  const x = s.startX - s.dirX * rear + s.dirZ * lateral
  const z = s.startZ - s.dirZ * rear - s.dirX * lateral
  npc.siegeBypassTarget = null
  npc.siegeEvacuation = new THREE.Vector3(x, getTerrainHeight(x, z), z)
}

export function fallFromDestroyedRamp<Id extends MobileSiegeRampId>(npc: NPC, ramp: MobileSiegeRamp<Id>): void {
  if (npc.dead || npc.isMounted) return
  const y = getWalkRampHeight(ramp.surface, npc.position.x, npc.position.z) ?? getWalkRampHeight(ramp.bridgeSurface, npc.position.x, npc.position.z)
  if (y !== null && Math.abs(npc.position.y - y) < .8) { npc.siegeEvacuation = null; npc.pendingFall.begin(npc.position, new THREE.Vector3()) }
}
