import { horseVariantForStableKey } from '../world/HorseAssetRegistry'
import type * as THREE from 'three'
import type { CareerProfile, CareerMountId } from '../career/CareerProfile'
import { careerMountType } from '../career/CareerMountController'
import { resolveTownActorEquipment, type TownEquipmentRef } from '../career/CareerTownEquipment'
import { Mount, mountCombatRadius, felineVariantFromMountId } from '../world/Mount'
import { BlackCatVisual, type FelineMountVariant } from '../world/BlackCatVisual'
import { townMountPlacementBatchClear } from './TownCivilianLife'
import { getTerrainHeight } from '../world/Terrain'
import type { TownCombatResident } from './TownMissionCombat'

const nativeMountIds = new WeakMap<Mount, string>()
export function registerTownNativeMount(mount: Mount, nativeId: string): void { nativeMountIds.set(mount, nativeId) }
export function findTownNativeMount(mounts: readonly Mount[], ref: TownEquipmentRef | null): Mount | undefined {
  return ref?.source === 'native' ? mounts.find(mount => nativeMountIds.get(mount) === ref.nativeId && !mount.disposed) : undefined
}

export interface TownEquipmentRuntimeOptions {
  canPlaceMountedCivilian?: (point: { x: number; z: number }, actorId: string, reusedMount?: Mount | null, vacatingMounts?: readonly Mount[]) => boolean
  onStatusChange?: (status: string) => void
  onPreloadComplete?: (result: { success: boolean; status: string; actorIds: readonly string[]; error?: unknown }) => void
  getCurrentProfile?: () => CareerProfile
  isDisposed?: () => boolean
}

export let townEquipmentRuntimeStatus = ''
export function getTownEquipmentRuntimeStatus(): string { return townEquipmentRuntimeStatus }

// A resident object belongs to one Town scene. Never key async refits by actor ID:
// a new scene may reuse the ID while owning a different physical mount.
let pendingActorPreloadTokens = new WeakMap<TownCombatResident, number>()
let actorPreloadTokenSeq = 0
let residentPhysicalMountRefs = new WeakMap<TownCombatResident, TownEquipmentRef | null>()

export function resetTownEquipmentRuntimeState(): void {
  townEquipmentRuntimeStatus = ''
  pendingActorPreloadTokens = new WeakMap()
  residentPhysicalMountRefs = new WeakMap()
}

type CivilianPlacementChecker = (point: { x: number; z: number }, actorId: string, reusedMount?: Mount | null, vacatingMounts?: readonly Mount[]) => boolean

/** Applies a committed configuration. Existing physical mounts follow their ownership reference. */
export function applyTownEquipmentRuntime(scene: THREE.Scene, residents: readonly TownCombatResident[], mounts: Mount[],
  previous: CareerProfile, current: CareerProfile, actorIds: readonly string[],
  canPlaceMountedCivilianOrOptions?: CivilianPlacementChecker | TownEquipmentRuntimeOptions,
  options?: TownEquipmentRuntimeOptions): number {
  const resolvedOptions: TownEquipmentRuntimeOptions = typeof canPlaceMountedCivilianOrOptions === 'function'
    ? { canPlaceMountedCivilian: canPlaceMountedCivilianOrOptions, ...options }
    : (canPlaceMountedCivilianOrOptions ?? options ?? {})
  const canPlaceMountedCivilian = resolvedOptions.canPlaceMountedCivilian

  const selected = new Set(actorIds)
  const plans = residents.filter(resident => selected.has(resident.spec.id)).map(resident => {
    if (!residentPhysicalMountRefs.has(resident)) {
      const initialBefore = resolveTownActorEquipment(previous, previous.faction, resident.spec.id)
      residentPhysicalMountRefs.set(resident, initialBefore.refs.mount)
    }
    const physicalMountRef = residentPhysicalMountRefs.get(resident)!
    const before = resolveTownActorEquipment(previous, previous.faction, resident.spec.id)
    const after = resolveTownActorEquipment(current, current.faction, resident.spec.id)
    return {
      resident,
      before: {
        ...before,
        refs: { ...before.refs, mount: physicalMountRef },
        loadout: { ...before.loadout, mountId: physicalMountRef?.itemId ?? null },
      },
      after,
    }
  })
  // A late lifecycle change defers the whole committed batch without touching old physical equipment.
  if (plans.some(({ resident, after }) => !resident.npc.canApplyCareerEquipment(after.loadout)
    || resident.npc.inCombat || resident.npc.mount?.isAirborne || resident.homeMount?.isAirborne
    || resident.homeMount?.riderPlayer || resident.homeMount?.riderNpc && resident.homeMount.riderNpc !== resident.npc)) return plans.length
  // A not-yet-loaded feline cannot be constructed synchronously: load it now and trigger continuation when ready.
  const unloaded = new Set<FelineMountVariant>()
  for (const { after } of plans) {
    const variant = felineVariantFromMountId(after.loadout.mountId)
    if (variant && !BlackCatVisual.isPreloaded(variant) && !findTownNativeMount(mounts, after.refs.mount)) unloaded.add(variant)
  }
  if (unloaded.size) {
    const token = ++actorPreloadTokenSeq
    for (const plan of plans) pendingActorPreloadTokens.set(plan.resident, token)
    void BlackCatVisual.preloadVariants(unloaded)
      .then(() => {
        if (resolvedOptions.isDisposed?.() || (scene as { disposed?: boolean })?.disposed) return
        const latestProfile = resolvedOptions.getCurrentProfile ? resolvedOptions.getCurrentProfile() : current

        const validPlans = plans.filter(plan => pendingActorPreloadTokens.get(plan.resident) === token)
        if (validPlans.length === 0) return

        const eligibleActorIds: string[] = []
        let hasCancelled = false
        for (const plan of validPlans) {
          const actorId = plan.resident.spec.id
          const currentPlanTarget = plan.after
          const liveTarget = resolveTownActorEquipment(latestProfile, latestProfile.faction, actorId)
          if (liveTarget.loadout.mountId !== currentPlanTarget.loadout.mountId
            || JSON.stringify(liveTarget.refs.mount) !== JSON.stringify(currentPlanTarget.refs.mount)) {
            hasCancelled = true
            continue
          }
          if (plan.resident.npc.dead || plan.resident.npc.inCombat) continue
          eligibleActorIds.push(actorId)
        }

        if (eligibleActorIds.length === 0) {
          const status = hasCancelled ? '配置已取消。' : '配置已保存，待下次回城套用。'
          townEquipmentRuntimeStatus = status
          resolvedOptions.onStatusChange?.(status)
          resolvedOptions.onPreloadComplete?.({ success: false, status, actorIds: [] })
          return
        }

        const pendingCount = applyTownEquipmentRuntime(scene, residents, mounts, previous, latestProfile, eligibleActorIds, resolvedOptions)
        if (pendingCount > 0) {
          townEquipmentRuntimeStatus = '配置已保存，待下次回城套用。'
          resolvedOptions.onStatusChange?.(townEquipmentRuntimeStatus)
          resolvedOptions.onPreloadComplete?.({ success: false, status: townEquipmentRuntimeStatus, actorIds: eligibleActorIds })
        } else {
          townEquipmentRuntimeStatus = '配置已套用。'
          resolvedOptions.onStatusChange?.(townEquipmentRuntimeStatus)
          resolvedOptions.onPreloadComplete?.({ success: true, status: townEquipmentRuntimeStatus, actorIds: eligibleActorIds })
        }
      })
      .catch((error: unknown) => {
        if (resolvedOptions.isDisposed?.() || (scene as { disposed?: boolean })?.disposed) return
        const isStillActive = plans.some(plan => pendingActorPreloadTokens.get(plan.resident) === token)
        if (!isStillActive) return
        townEquipmentRuntimeStatus = '配置保存成功，坐騎資源載入失敗，可重試套用'
        resolvedOptions.onStatusChange?.(townEquipmentRuntimeStatus)
        resolvedOptions.onPreloadComplete?.({ success: false, status: townEquipmentRuntimeStatus, actorIds, error })
      })
    return plans.length
  }
  for (const plan of plans) pendingActorPreloadTokens.delete(plan.resident)
  const selectedActors = new Set(plans.map(plan => plan.resident.npc))
  if (plans.some(({ after }) => {
    const physical = findTownNativeMount(mounts, after.refs.mount)
    return physical && (physical.dead || physical.isAirborne || physical.riderPlayer
      || physical.riderNpc && !selectedActors.has(physical.riderNpc))
  })) return plans.length
  const mountChanges = plans.filter(plan => JSON.stringify(plan.before.refs.mount) !== JSON.stringify(plan.after.refs.mount))
  // Predict the same ordered pool consumption used below, including non-civilian plans.
  const reusable = new Map<string, Mount[]>()
  for (const { resident, before } of mountChanges) {
    if (!resident.homeMount) continue
    const key = JSON.stringify(before.refs.mount), pool = reusable.get(key) ?? []
    pool.push(resident.homeMount); reusable.set(key, pool)
  }
  const reusedMounts = new Map<TownCombatResident, Mount | undefined>()
  for (const { resident, after } of mountChanges) if (after.loadout.mountId) {
    reusedMounts.set(resident, reusable.get(JSON.stringify(after.refs.mount))?.shift() ?? findTownNativeMount(mounts, after.refs.mount))
  }
  const assignedMounts = new Set(reusedMounts.values())
  // Inventory releases are disposed or reassigned; native reserves remain in place unless reused.
  const vacatingMounts = mountChanges.flatMap(({ resident, before }) => resident.homeMount
    && (before.refs.mount?.source !== 'native' || assignedMounts.has(resident.homeMount)) ? [resident.homeMount] : [])
  const mountPoints = new Map<TownCombatResident, { x: number; z: number }>()
  for (const { resident, after } of mountChanges) {
    if (!after.loadout.mountId) continue
    const reusedMount = reusedMounts.get(resident)
    let point: { x: number; z: number } = resident.npc.combatPosition
    if (resident.spec.role === 'civilian' && canPlaceMountedCivilian
      && !canPlaceMountedCivilian(point, resident.spec.id, reusedMount ?? null, vacatingMounts)) {
      const owner = current.civilianCommandSquad?.owners[resident.spec.id]
      if ((owner && owner !== 'daily') || current.activeMission || current.activeOutpostMission
        || current.townEvent?.state === 'hostile' || !canPlaceMountedCivilian(resident.spec, resident.spec.id, reusedMount ?? null, vacatingMounts)) return plans.length
      point = resident.spec
    }
    mountPoints.set(resident, { x: point.x, z: point.z })
  }
  // All checks above see live pre-change actors. Reserve final mounted footprints together
  // before any dismount, equipment mutation, physical relocation or new Mount construction.
  if (!townMountPlacementBatchClear(mountChanges.flatMap(({ resident, after }) => after.loadout.mountId ? [{
    point: mountPoints.get(resident) ?? resident.npc.combatPosition,
    radius: mountCombatRadius(careerMountType(after.loadout.mountId as CareerMountId)),
  }] : []))) return plans.length
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
    if (mountChanges.some(plan => plan.resident === resident)) {
      if (after.loadout.mountId) {
        const key = JSON.stringify(after.refs.mount)
        const reused = released.get(key)?.shift() ?? findTownNativeMount(mounts, after.refs.mount)
        const point = mountPoints.get(resident) ?? resident.npc.combatPosition
        const mount = reused ?? new Mount(scene, careerMountType(after.loadout.mountId as CareerMountId), point.x, point.z, undefined, horseVariantForStableKey(`town:${current.faction}:${resident.spec.id}`))
        if (after.refs.mount?.source === 'native') registerTownNativeMount(mount, after.refs.mount.nativeId!)
        mount.reservedForTown = true
        mount.group.position.set(point.x, getTerrainHeight(point.x, point.z), point.z)
        mount.group.rotation.y = resident.npc.group.rotation.y
        if (!reused) mounts.push(mount)
        resident.homeMount = mount
        resident.npc.mountVehicle(mount)
        if (resident.npc.mount === mount) residentPhysicalMountRefs.set(resident, after.refs.mount)
        else pending++
      } else {
        residentPhysicalMountRefs.set(resident, null)
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
