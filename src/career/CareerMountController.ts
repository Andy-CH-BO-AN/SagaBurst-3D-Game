import * as THREE from 'three'
import { getCareerPurchaseTier, cloneCareerProfile, type CareerMountId, type CareerProfile } from './CareerProfile'
import type { EquipmentMountAdapter, EquipmentMountItem } from '../ui/EquipmentUI'
import type { Player } from '../player/Player'
import { Mount, MountType } from '../world/Mount'
import { getTerrainHeight, type ObstacleData } from '../world/Terrain'

const MOUNTS: Readonly<Record<CareerMountId, Omit<EquipmentMountItem, 'active' | 'available'>>> = {
  'horse-t1': { id: 'horse-t1', name: '普通戰馬', tier: 1 },
  'horse-t2': { id: 'horse-t2', name: '受訓戰馬', tier: 2 },
  'horse-t3': { id: 'horse-t3', name: '精銳戰馬', tier: 3 },
  'black-cat': { id: 'black-cat', name: '黑貓英雄坐騎', tier: 4 },
  corgi: { id: 'corgi', name: '柯基英雄坐騎', tier: 4 },
}

export function ownedCareerMountIds(profile: Pick<CareerProfile, 'ownedMounts' | 'ownedHorseTiers'>): CareerMountId[] {
  const horseTiers = profile.ownedHorseTiers ?? (profile.ownedMounts.includes('horse') ? [1] : [])
  const result = horseTiers.map(tier => `horse-t${tier}` as CareerMountId)
  if (profile.ownedMounts.includes('black-cat')) result.push('black-cat')
  if (profile.ownedMounts.includes('corgi')) result.push('corgi')
  return result
}

export function careerMountType(id: CareerMountId): MountType {
  if (id === 'black-cat') return MountType.BLACK_CAT
  if (id === 'corgi') return MountType.CORGI
  return MountType.HORSE
}

export function canUseCareerMount(profile: CareerProfile, id: CareerMountId): boolean {
  return ownedCareerMountIds(profile).includes(id) && MOUNTS[id].tier <= getCareerPurchaseTier(profile.rank)
}

export function findSafeCareerMountPosition(
  origin: THREE.Vector3,
  obstacles: readonly ObstacleData[],
  occupied: readonly THREE.Vector3[],
): THREE.Vector3 | null {
  for (let ring = 0; ring < 3; ring++) {
    const radius = 2.4 + ring * 1.6
    for (let index = 0; index < 8; index++) {
      const angle = index / 8 * Math.PI * 2
      const point = new THREE.Vector3(
        origin.x + Math.sin(angle) * radius,
        0,
        origin.z + Math.cos(angle) * radius,
      )
      point.y = getTerrainHeight(point.x, point.z)
      const blocked = obstacles.some(obstacle => {
        const expanded = obstacle.box.clone().expandByScalar(1.05)
        return expanded.containsPoint(new THREE.Vector3(point.x, Math.max(point.y + .8, expanded.min.y), point.z))
      })
      if (blocked || occupied.some(other => Math.hypot(other.x - point.x, other.z - point.z) < 2.1)) continue
      return point
    }
  }
  return null
}

export class CareerMountController implements EquipmentMountAdapter {
  private active: { id: CareerMountId; mount: Mount } | null = null
  private readonly hp = new Map<CareerMountId, number>()
  private readonly unavailable = new Set<CareerMountId>()
  statusText = ''

  constructor(
    private readonly scene: THREE.Scene,
    private readonly player: () => Player,
    private readonly readProfile: () => CareerProfile,
    private readonly commit: (profile: CareerProfile) => boolean,
    private readonly obstacles: () => readonly ObstacleData[],
    private readonly occupied: () => readonly THREE.Vector3[],
  ) {}

  list(): EquipmentMountItem[] {
    const profile = this.readProfile()
    const unlockedTier = getCareerPurchaseTier(profile.rank)
    return ownedCareerMountIds(profile).map(id => ({
      ...MOUNTS[id],
      active: this.active?.id === id && this.player().currentMount === this.active.mount,
      available: MOUNTS[id].tier <= unlockedTier && !this.unavailable.has(id),
    }))
  }

  activate(rawId: string): boolean {
    const id = rawId as CareerMountId
    const config = MOUNTS[id]
    const profile = this.readProfile()
    if (!config || !ownedCareerMountIds(profile).includes(id)) return this.fail('尚未擁有這匹坐騎。')
    if (!canUseCareerMount(profile, id)) return this.fail('目前軍階不能使用這匹坐騎。')
    if (this.unavailable.has(id)) return this.fail('這匹坐騎本次出城已倒下，回到和平小鎮休整後才能再用。')
    if (this.active?.id === id && !this.active.mount.dead) {
      if (!this.player().isMounted) this.player().mountVehicle(this.active.mount)
      this.statusText = `${config.name}已騎乘。`
      return true
    }

    const position = findSafeCareerMountPosition(
      this.player().combatPosition,
      this.obstacles(),
      this.occupied().filter(point => point !== this.active?.mount.group.position),
    )
    if (!position) return this.fail('附近空間不足，請移到較空曠的位置。')

    const next = cloneCareerProfile(profile)
    next.selectedMountId = id
    if (!this.commit(next)) return this.fail('保存失敗，坐騎沒有變更。')

    const previous = this.active
    const mount = new Mount(this.scene, careerMountType(id), position.x, position.z, position.y, id.startsWith('horse-t') ? (Number(id.charAt(id.length - 1)) - 1) as 0 | 1 | 2 : 0)
    mount.currentHp = Math.max(1, Math.min(mount.maxHp, this.hp.get(id) ?? mount.maxHp))
    mount.onDeathCallbacks.push(() => {
      this.hp.set(id, 0)
      this.unavailable.add(id)
      this.statusText = `${config.name}已倒下；本次出城不能再次召喚。`
    })
    if (previous) this.removeActive(previous)
    this.active = { id, mount }
    this.player().mountVehicle(mount)
    this.statusText = `${config.name}已騎乘。`
    return true
  }

  dismiss(): boolean {
    if (!this.active) return false
    this.removeActive(this.active)
    this.active = null
    this.statusText = '坐騎已收起。'
    return true
  }

  update(dt: number): void {
    const active = this.active
    if (!active) return
    active.mount.setCameraDistance(active.mount.group.position.distanceTo(this.player().position))
    if (active.mount.dead) active.mount.update(dt, this.obstacles() as ObstacleData[])
    this.hp.set(active.id, active.mount.currentHp)
  }

  restInTown(): void {
    this.dismiss()
    this.unavailable.clear()
    this.hp.clear()
    this.statusText = '坐騎已在馬廄完成休整。'
  }

  get activeMount(): Mount | null { return this.active?.mount ?? null }
  get activeMountId(): CareerMountId | null { return this.active?.id ?? null }

  dispose(): void {
    if (this.active) this.removeActive(this.active)
    this.active = null
  }

  private removeActive(entry: { id: CareerMountId; mount: Mount }): void {
    this.hp.set(entry.id, entry.mount.currentHp)
    if (this.player().currentMount === entry.mount) this.player().dismountFromMount()
    entry.mount.dispose()
  }

  private fail(message: string): false { this.statusText = message; return false }
}
