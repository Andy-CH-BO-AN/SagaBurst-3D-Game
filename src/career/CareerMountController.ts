import * as THREE from 'three'
import { getCareerPurchaseTier, cloneCareerProfile, type CareerMountId, type CareerProfile } from './CareerProfile'
import type { EquipmentMountAdapter, EquipmentMountItem } from '../ui/EquipmentUI'
import type { Player } from '../player/Player'
import type { HorseAppearanceVariant } from '../world/HorseAssetRegistry'
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

export function careerMountTier(id: CareerMountId): number { return MOUNTS[id].tier }

export function careerMountAppearanceVariant(id?: CareerMountId): HorseAppearanceVariant {
  if (id === 'horse-t2') return 1
  if (id === 'horse-t3') return 2
  return 0
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
  ) {
    const state = this.readProfile().activeMission?.mountState
    if (!state) return
    for (const id of Object.keys(state.hp) as CareerMountId[]) {
      const value = state.hp[id]
      if (MOUNTS[id] && typeof value === 'number') this.hp.set(id, value)
    }
    for (const id of state.unavailable) if (MOUNTS[id]) this.unavailable.add(id)
  }

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
      this.persistOutingState(id)
      this.statusText = `${config.name}已騎乘。`
      return true
    }

    const position = findSafeCareerMountPosition(
      this.player().combatPosition,
      this.obstacles(),
      this.occupied().filter(point => point !== this.active?.mount.group.position),
    )
    if (!position) return this.fail('附近空間不足，請移到較空曠的位置。')

    const previous = this.active
    const mount = new Mount(this.scene, careerMountType(id), position.x, position.z, position.y, careerMountAppearanceVariant(id))
    mount.currentHp = Math.max(1, Math.min(mount.maxHp, this.hp.get(id) ?? mount.maxHp))
    this.installDeathPersistence(id, mount)
    if (previous) this.hp.set(previous.id, previous.mount.currentHp)
    const previousHp = this.hp.get(id)
    this.hp.set(id, mount.currentHp)
    const next = cloneCareerProfile(profile)
    next.selectedMountId = id
    if (next.activeMission) next.activeMission.mountState = this.outingState(id)
    if (!this.commit(next)) {
      if (previousHp === undefined) this.hp.delete(id)
      else this.hp.set(id, previousHp)
      mount.dispose()
      return this.fail('保存失敗，坐騎沒有變更。')
    }

    if (previous) this.removeMountVisual(previous)
    this.active = { id, mount }
    this.player().mountVehicle(mount)
    this.statusText = `${config.name}已騎乘。`
    return true
  }

  restoreActiveMount(): boolean {
    const profile = this.readProfile()
    const id = profile.activeMission?.mountState?.activeMountId
    if (!id || !MOUNTS[id] || !canUseCareerMount(profile, id) || this.unavailable.has(id) || (this.hp.get(id) ?? 1) <= 0) return false
    const position = findSafeCareerMountPosition(this.player().combatPosition, this.obstacles(), this.occupied())
    if (!position) return false
    const mount = new Mount(this.scene, careerMountType(id), position.x, position.z, position.y, careerMountAppearanceVariant(id))
    mount.currentHp = Math.max(1, Math.min(mount.maxHp, this.hp.get(id) ?? mount.maxHp))
    this.installDeathPersistence(id, mount)
    this.active = { id, mount }
    this.player().mountVehicle(mount)
    this.statusText = `${MOUNTS[id].name}已恢復，剩餘耐久 ${Math.ceil(mount.currentHp)}/${mount.maxHp}。`
    return true
  }

  dismiss(): boolean {
    if (!this.active) return false
    const entry = this.active
    this.hp.set(entry.id, entry.mount.currentHp)
    if (!this.persistOutingState(undefined)) return this.fail('保存失敗，坐騎仍保持召喚。')
    this.removeMountVisual(entry)
    this.active = null
    this.statusText = '坐騎已收起。'
    return true
  }

  update(dt: number): void {
    const active = this.active
    if (!active) return
    active.mount.setCameraDistance(active.mount.group.position.distanceTo(this.player().position))
    if (active.mount.dead) active.mount.update(dt, this.obstacles() as ObstacleData[])
    if (this.hp.get(active.id) !== active.mount.currentHp) {
      this.hp.set(active.id, active.mount.currentHp)
      this.persistOutingState(active.id)
    }
  }

  restInTown(): void {
    if (this.active) this.removeMountVisual(this.active)
    this.active = null
    this.unavailable.clear()
    this.hp.clear()
    this.persistOutingState(undefined)
    this.statusText = '坐騎已在馬廄完成休整。'
  }

  get activeMount(): Mount | null { return this.active?.mount ?? null }
  get activeMountId(): CareerMountId | null { return this.active?.id ?? null }

  dispose(): void {
    if (this.active) {
      if (this.hp.get(this.active.id) !== this.active.mount.currentHp) {
        this.hp.set(this.active.id, this.active.mount.currentHp)
        this.persistOutingState(this.active.id)
      }
      this.removeMountVisual(this.active)
    }
    this.active = null
  }

  private installDeathPersistence(id: CareerMountId, mount: Mount): void {
    mount.onDeathCallbacks.push(() => {
      this.hp.set(id, 0)
      this.unavailable.add(id)
      this.persistOutingState(id)
      this.statusText = `${MOUNTS[id].name}已倒下；本次出城不能再次召喚。`
    })
  }

  private outingState(activeMountId: CareerMountId | undefined): NonNullable<CareerProfile['activeMission']>['mountState'] {
    const hp: Partial<Record<CareerMountId, number>> = {}
    for (const [id, value] of this.hp) hp[id] = Math.max(0, value)
    return {
      ...(activeMountId ? { activeMountId } : {}),
      hp,
      unavailable: [...this.unavailable],
    }
  }

  private persistOutingState(activeMountId: CareerMountId | undefined): boolean {
    const profile = this.readProfile()
    if (!profile.activeMission) return true
    const next = cloneCareerProfile(profile)
    next.activeMission!.mountState = this.outingState(activeMountId)
    return this.commit(next)
  }

  private removeMountVisual(entry: { id: CareerMountId; mount: Mount }): void {
    if (this.player().currentMount === entry.mount) this.player().dismountFromMount()
    entry.mount.dispose()
  }

  private fail(message: string): false { this.statusText = message; return false }
}
