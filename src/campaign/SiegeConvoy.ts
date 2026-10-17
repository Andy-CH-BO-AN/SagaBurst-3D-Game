import * as THREE from 'three'
import type { NPC } from '../world/NPC'
import type { MobileSiegeRamp } from './MobileSiegeRamp'
import type { MobileSiegeRampId } from './MobileSiegeRampPolicy'
import { getWalkRampHeight } from '../world/Terrain'

/** The same convoy detour in the vehicle's frame for Outpost and Town. NPC owns locomotion/collision. */
export class SiegeConvoy<Id extends MobileSiegeRampId> {
  private readonly bypassing = new Map<NPC, { ramp: MobileSiegeRamp<Id>; lateral: number }>()
  update(npc: NPC, ramps: readonly MobileSiegeRamp<Id>[]): void {
    const p = npc.combatPosition
    const along = (r: MobileSiegeRamp<Id>, x: number, z: number) => (p.x - x) * (r.placement.dirX ?? 0) + (p.z - z) * r.placement.dirZ
    const lateral = (r: MobileSiegeRamp<Id>) => (p.x - r.position.x) * r.placement.dirZ - (p.z - r.position.z) * (r.placement.dirX ?? 0)
    let bypass = this.bypassing.get(npc)
    if (bypass && (bypass.ramp.controller.state !== 'PUSHING' || along(bypass.ramp, bypass.ramp.position.x, bypass.ramp.position.z) > 5)) {
      this.bypassing.delete(npc); npc.siegeBypassTarget = null; bypass = undefined
    }
    if (!bypass) {
      const ramp = ramps.find(r => r.controller.state === 'PUSHING' && Math.abs(lateral(r)) < r.surface.halfWidth + 3
        && along(r, r.position.x, r.position.z) < 5 && along(r, r.surface.startX, r.surface.startZ) > -8)
      if (ramp) {
        const side = Math.sign(lateral(ramp)) || -Math.sign(ramp.position.x * ramp.placement.dirZ - ramp.position.z * (ramp.placement.dirX ?? 0)) || 1
        bypass = { ramp, lateral: side * (ramp.surface.halfWidth + 4) }; this.bypassing.set(npc, bypass)
      }
    }
    if (bypass) {
      const r = bypass.ramp, dx = r.placement.dirX ?? 0, dz = r.placement.dirZ
      const forward = Math.abs(lateral(r) - bypass.lateral) > .8 ? along(r, r.position.x, r.position.z) : 6
      npc.siegeBypassTarget ??= new THREE.Vector3()
      npc.siegeBypassTarget.set(r.position.x + dz * bypass.lateral + dx * forward, p.y,
        r.position.z - dx * bypass.lateral + dz * forward)
    }
  }
  release(npc: NPC): void { if (this.bypassing.delete(npc)) npc.siegeBypassTarget = null }
  dispose(): void { for (const npc of this.bypassing.keys()) npc.siegeBypassTarget = null; this.bypassing.clear() }
}

export function evacuateAbandonedRamp<Id extends MobileSiegeRampId>(npc: NPC, ramp: MobileSiegeRamp<Id>): void {
  if (npc.dead || !ramp.assignment.assaultIds.includes(npc.combatantId)) return
  const s = ramp.surface, y = getWalkRampHeight(s, npc.position.x, npc.position.z)
  if (y !== null && Math.abs(npc.position.y - y) < .8) npc.siegeEvacuation = new THREE.Vector3(s.startX - s.dirX * 2, s.startY, s.startZ - s.dirZ * 2)
}

export function fallFromDestroyedRamp<Id extends MobileSiegeRampId>(npc: NPC, ramp: MobileSiegeRamp<Id>): void {
  if (npc.dead || npc.isMounted) return
  const y = getWalkRampHeight(ramp.surface, npc.position.x, npc.position.z) ?? getWalkRampHeight(ramp.bridgeSurface, npc.position.x, npc.position.z)
  if (y !== null && Math.abs(npc.position.y - y) < .8) { npc.siegeEvacuation = null; npc.pendingFall.begin(npc.position, new THREE.Vector3()) }
}
