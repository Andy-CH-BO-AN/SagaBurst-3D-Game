import { findTownMerchantParking, type MerchantParking } from './TownMerchantMount'
import type * as THREE from 'three'
import type { CareerProfile, CareerMountId } from '../career/CareerProfile'
import { careerMountType } from '../career/CareerMountController'
import { resolveTownActorEquipment, type TownEquipmentRef } from '../career/CareerTownEquipment'
import { Mount } from '../world/Mount'
import { getTerrainHeight } from '../world/Terrain'
import type { TownCombatResident } from './TownMissionCombat'

const nativeMountIds = new WeakMap<Mount, string>()
export function registerTownNativeMount(mount: Mount, nativeId: string): void { nativeMountIds.set(mount, nativeId) }
export function findTownNativeMount(mounts: readonly Mount[], ref: TownEquipmentRef | null): Mount | undefined {
  return ref?.source === 'native' ? mounts.find(mount => nativeMountIds.get(mount) === ref.nativeId && !mount.disposed) : undefined
}

/** Applies a committed configuration. Existing physical mounts follow their ownership reference. */
export function applyTownEquipmentRuntime(scene: THREE.Scene, residents: readonly TownCombatResident[], mounts: Mount[],
  previous: CareerProfile, current: CareerProfile, actorIds: readonly string[], merchantParking: MerchantParking | undefined = findTownMerchantParking()): number {
  const selected = new Set(actorIds)
  const plans = residents.filter(resident => selected.has(resident.spec.id)).map(resident => ({ resident,
    before: resolveTownActorEquipment(previous, previous.faction, resident.spec.id),
    after: resolveTownActorEquipment(current, current.faction, resident.spec.id),
  }))
  // A late lifecycle change defers the whole committed batch without touching old physical equipment.
  if (plans.some(({ resident, after }) => !resident.npc.canApplyCareerEquipment(after.loadout)
    || resident.npc.inCombat || resident.npc.mount?.isAirborne || resident.homeMount?.isAirborne
    || resident.homeMount?.riderPlayer || resident.homeMount?.riderNpc && resident.homeMount.riderNpc !== resident.npc)) return plans.length
  const selectedActors = new Set(plans.map(plan => plan.resident.npc))
  if (plans.some(({ after }) => {
    const physical = findTownNativeMount(mounts, after.refs.mount)
    return physical && (physical.dead || physical.isAirborne || physical.riderPlayer
      || physical.riderNpc && !selectedActors.has(physical.riderNpc))
  })) return plans.length
  const mountChanges = plans.filter(plan => JSON.stringify(plan.before.refs.mount) !== JSON.stringify(plan.after.refs.mount))
  const released = new Map<string, Mount[]>()
  for (const { resident, before } of mountChanges) {
    const mount = resident.homeMount
    if (!mount) continue
    resident.npc.dismountFromMount()
    if (before.refs.mount?.source === 'native') registerTownNativeMount(mount, before.refs.mount.nativeId!)
    const key = JSON.stringify(before.refs.mount)
    const pool = released.get(key) ?? []
    pool.push(mount); released.set(key, pool)
    resident.homeMount = undefined
  }
  let pending = 0
  for (const { resident, after } of plans) {
    if (!resident.npc.applyCareerEquipment(after.loadout, after.tier)) { pending++; continue }
    if (mountChanges.some(plan => plan.resident === resident) && after.loadout.mountId) {
      const key = JSON.stringify(after.refs.mount)
      const reused = released.get(key)?.shift() ?? findTownNativeMount(mounts, after.refs.mount)
      const mount = reused ?? new Mount(scene, careerMountType(after.loadout.mountId as CareerMountId), resident.npc.group.position.x, resident.npc.group.position.z)
      if (after.refs.mount?.source === 'native') registerTownNativeMount(mount, after.refs.mount.nativeId!)
      mount.reservedForTown = true
      const home = resident.spec.role === 'merchant' ? merchantParking ?? resident.spec : resident.npc.group.position
      mount.group.position.set(home.x, getTerrainHeight(home.x, home.z), home.z)
      mount.group.rotation.y = resident.npc.group.rotation.y
      if (!reused) mounts.push(mount)
      resident.homeMount = mount
      if (resident.spec.role === 'merchant') mount.visualHold = true
      else {
        mount.visualHold = false; resident.npc.mountVehicle(mount)
        if (resident.npc.mount !== mount) pending++
      }
    }
    resident.npc.setTownPeaceful()
  }
  for (const pool of released.values()) for (const mount of pool) {
    // Native reserves remain Town-owned physical resources, including the shared shop Cat.
    if (nativeMountIds.has(mount)) continue
    mount.dispose()
    const index = mounts.indexOf(mount)
    if (index >= 0) mounts.splice(index, 1)
  }
  return pending
}
