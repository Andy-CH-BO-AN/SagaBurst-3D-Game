import { isCareerShopItemUseUnlocked } from './CareerShopCatalog'
import type { RaceRider } from './CareerRaceState'
import { availableCareerItem, canAllocateCareerItemToPlayer, careerItemTotal, normalizeCareerInventory } from './CareerInventory'
import * as THREE from 'three'
import { getCareerPurchaseTier, cloneCareerProfile, canonicalCareerMountId, ownsCareerHorse, type CareerMountId, type CareerProfile } from './CareerProfile'
import type { EquipmentMountAdapter, EquipmentMountItem } from '../ui/EquipmentUI'
import type { Player } from '../player/Player'
import { horseVariantFromSave, type HorseAppearanceVariant } from '../world/HorseAssetRegistry'
import { Mount, MountType } from '../world/Mount'
import { findEagleLandingPosition, type EagleLandingPoint } from '../world/EagleLanding'
import { syncCareerEaglePads, EaglePadReservations, PLAYER_EAGLE_PAD_OWNER } from './EaglePadReservations'
import { getTerrainHeight, getScenePlayableWorldBound, type ObstacleData } from '../world/Terrain'

const MOUNTS: Readonly<Record<ReturnType<typeof canonicalCareerMountId>, Omit<EquipmentMountItem, 'active' | 'available'>>> = {
  horse: { id: 'horse', name: '軍用戰馬', tier: 1 },
  'black-cat': { id: 'black-cat', name: '黑貓英雄坐騎', tier: 4 },
  corgi: { id: 'corgi', name: '柯基英雄坐騎', tier: 4 },
  'snow-leopard': { id: 'snow-leopard', name: '重甲雪豹', tier: 5 },
  xongkoro: { id: 'xongkoro', name: 'xongkoro · 巨鷹英雄坐騎', tier: 4 },
}

export function ownedCareerMountIds(profile: Pick<CareerProfile, 'ownedMounts' | 'ownedHorseTiers'>): CareerMountId[] {
  const result: CareerMountId[] = ownsCareerHorse(profile) ? ['horse'] : []
  if (profile.ownedMounts.includes('black-cat')) result.push('black-cat')
  if (profile.ownedMounts.includes('corgi')) result.push('corgi')
  if (profile.ownedMounts.includes('snow-leopard')) result.push('snow-leopard')
  if (profile.ownedMounts.includes('xongkoro')) result.push('xongkoro')
  return result
}

export function careerMountType(id: CareerMountId): MountType {
  if (id === 'black-cat') return MountType.BLACK_CAT
  if (id === 'corgi') return MountType.CORGI
  if (id === 'snow-leopard') return MountType.SNOW_LEOPARD
  if (id === 'xongkoro') return MountType.XONGKORO
  return MountType.HORSE
}

export function careerMountTier(id: CareerMountId, profile: Pick<CareerProfile, 'rank'>): number {
  const canonical = canonicalCareerMountId(id)
  return canonical === 'horse' ? Math.min(4, getCareerPurchaseTier(profile.rank)) : MOUNTS[canonical].tier
}

export function careerMountAppearanceVariant(profile: Pick<CareerProfile, 'horseAppearanceVariant'>): HorseAppearanceVariant {
  return horseVariantFromSave(profile.horseAppearanceVariant)
}

export function canUseCareerMount(profile: CareerProfile, id: CareerMountId): boolean {
  const canonical = canonicalCareerMountId(id)
  return isCareerShopItemUseUnlocked(profile, canonical) && canAllocateCareerItemToPlayer(profile, canonical)
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
    private readonly sceneKey: () => string = () => 'town-home',
    private readonly options: { eaglePads?: EaglePadReservations; eagleDeployment?: () => EagleLandingPoint | undefined } = {},
  ) {
    syncCareerEaglePads(this.options.eaglePads, this.readProfile(), this.sceneKey())
    const state = this.readProfile().activeMission?.mountState ?? this.readProfile().retirementRuntime?.mountState
    if (!state) return
    for (const id of Object.keys(state.hp) as CareerMountId[]) {
      const value = state.hp[id]
      const canonical = canonicalCareerMountId(id)
      if (MOUNTS[canonical] && typeof value === 'number') this.hp.set(canonical, Math.min(this.hp.get(canonical) ?? value, value))
    }
    for (const id of state.unavailable) {
      const canonical = canonicalCareerMountId(id)
      if (MOUNTS[canonical]) this.unavailable.add(canonical)
    }
  }

  list(): EquipmentMountItem[] {
    const profile = this.readProfile()
    return ownedCareerMountIds(profile).map(id => ({
      ...MOUNTS[canonicalCareerMountId(id)],
      tier: careerMountTier(id, profile),
      active: this.active?.id === id && this.player().currentMount === this.active.mount,
      available: canUseCareerMount(profile, id) && !this.unavailable.has(id),
      quantityText: `總持有 ${careerItemTotal(profile, id)} · 可用 ${availableCareerItem(profile, id)}`,
      ...(!isCareerShopItemUseUnlocked(profile, canonicalCareerMountId(id)) ? { unavailableReason: '巨鷹訓練需 Captain / Commander 軍階' } : {}),
      allocated: profile.selectedMountId === id,
      ...(id === 'horse' ? { appearanceVariant: careerMountAppearanceVariant(profile), appearanceEditable: !profile.activeRace } : {}),
    }))
  }

  setAppearanceVariant(variant: HorseAppearanceVariant): boolean {
    const profile = this.readProfile()
    if (profile.activeRace) return this.fail('賽馬期間不能變更戰馬毛色。')
    if (![0, 1, 2].includes(variant) || !ownsCareerHorse(profile)) return this.fail('無法變更戰馬毛色。')
    const next = cloneCareerProfile(profile)
    next.horseAppearanceVariant = variant
    if (!this.commit(next)) return this.fail('保存失敗，戰馬毛色沒有變更。')
    this.active?.mount.setAppearanceVariant(variant)
    this.statusText = '戰馬毛色已保存。'
    return true
  }

  activate(rawId: string): boolean {
    if (this.readProfile().activeRace) return this.fail('賽馬期間不能召喚或切換坐騎。')
    if (this.player().isFalling || this.player().currentMount?.isAirborne) return this.fail('請先安全降落，再召喚或切換坐騎。')
    const id = canonicalCareerMountId(rawId as CareerMountId)
    const config = MOUNTS[id]
    const profile = this.readProfile()
    if (!config || !ownedCareerMountIds(profile).includes(id)) return this.fail('尚未擁有這匹坐騎。')
    if (!canUseCareerMount(profile, id)) return this.fail(!isCareerShopItemUseUnlocked(profile, id) ? '巨鷹訓練需 Captain / Commander 軍階。' : '這匹坐騎已分配給其他單位。')
    if (this.unavailable.has(id)) return this.fail('這匹坐騎本次出城已倒下，回到和平小鎮休整後才能再用。')
    if (this.active?.id === id && !this.active.mount.dead) {
      if (!this.player().isMounted) this.player().mountVehicle(this.active.mount, id === 'xongkoro' ? this.active.mount.group.rotation.y : undefined)
      this.persistOutingState(id)
      this.statusText = `${config.name}已騎乘。`
      return true
    }

    syncCareerEaglePads(this.options.eaglePads, profile, this.sceneKey())
    const previousPad = this.options.eaglePads?.get(PLAYER_EAGLE_PAD_OWNER)
    const pad = id === 'xongkoro' ? this.options.eaglePads?.reserve(PLAYER_EAGLE_PAD_OWNER) : undefined
    if (id === 'xongkoro' && this.options.eaglePads && !pad) return this.fail('私人巨鷹停放位已滿。')
    const occupied = this.occupied().filter(point => point !== this.active?.mount.group.position)
    const eagleOccupied = [...occupied, ...(this.options.eaglePads?.pads.filter(other => other.id !== pad?.id) ?? [])]
    const deployment = this.options.eagleDeployment?.()
    const heading = deployment?.yaw ?? this.player().facingYaw
    const position = id === 'xongkoro'
      ? findEagleLandingPosition(deployment ?? { ...this.player().combatPosition, yaw: heading }, this.obstacles(), eagleOccupied, getScenePlayableWorldBound(this.scene))
      : findSafeCareerMountPosition(this.player().combatPosition, this.obstacles(), occupied)
    if (!position) {
      if (pad && !previousPad) this.options.eaglePads?.release(PLAYER_EAGLE_PAD_OWNER)
      return this.fail('附近空間不足，請移到較空曠的位置。')
    }

    const previous = this.active
    const mount = new Mount(this.scene, careerMountType(id), position.x, position.z, position.y, careerMountAppearanceVariant(profile))
    mount.currentHp = Math.max(1, Math.min(mount.maxHp, this.hp.get(id) ?? mount.maxHp))
    this.installDeathPersistence(id, mount)
    if (previous) this.hp.set(previous.id, previous.mount.currentHp)
    const previousHp = this.hp.get(id)
    this.hp.set(id, mount.currentHp)
    const next = cloneCareerProfile(profile)
    normalizeCareerInventory(next)
    next.selectedMountId = id
    delete next.racePlayerState
    if (next.activeMission) next.activeMission.mountState = this.outingState(id)
    if (!this.commit(next)) {
      if (previousHp === undefined) this.hp.delete(id)
      else this.hp.set(id, previousHp)
      mount.dispose()
      if (pad && !previousPad) this.options.eaglePads?.release(PLAYER_EAGLE_PAD_OWNER)
      return this.fail('保存失敗，坐騎沒有變更。')
    }

    if (previous) this.removeMountVisual(previous)
    this.active = { id, mount }
    syncCareerEaglePads(this.options.eaglePads, next, this.sceneKey())
    this.player().mountVehicle(mount, id === 'xongkoro' ? heading : undefined)
    this.statusText = `${config.name}已騎乘。`
    return true
  }

  restoreRaceMount(saved: RaceRider): boolean {
    if (this.active) return false
    const profile = this.readProfile(), id = saved.mountId
    if (!canUseCareerMount(profile, id)) return false
    const p = saved.mountPosition
    const mount = new Mount(this.scene, careerMountType(id), p.x, p.z, p.y, careerMountAppearanceVariant(profile))
    this.active = { id, mount }; this.hp.set(id, saved.mountHp)
    this.installDeathPersistence(id, mount)
    mount.group.rotation.y = p.yaw
    if (saved.mountHp === 0) { mount.takeDamage(mount.maxHp * 100); this.unavailable.add(id) }
    else mount.currentHp = Math.min(mount.maxHp, saved.mountHp)
    return true
  }

  restoreActiveMount(restoreAerial = true): boolean {
    if (this.active) return true
    const profile = this.readProfile()
    const retirement = profile.careerRetirement?.phase === 'final-stand' ? profile.retirementRuntime : undefined
    const aerial = restoreAerial && profile.playerAerialState?.sceneKey === this.sceneKey() ? profile.playerAerialState : undefined
    if (aerial?.fall && !retirement?.mount) return false
    const savedId = profile.activeMission?.mountState?.activeMountId ?? profile.retirementRuntime?.mountState?.activeMountId ?? (aerial?.mount ? 'xongkoro' : undefined)
    const id = savedId ? canonicalCareerMountId(savedId) : undefined
    if (!id || !MOUNTS[id] || !canUseCareerMount(profile, id) || this.unavailable.has(id) || (this.hp.get(id) ?? 1) <= 0) return false
    syncCareerEaglePads(this.options.eaglePads, profile, this.sceneKey())
    const pad = id === 'xongkoro' ? this.options.eaglePads?.reserve(PLAYER_EAGLE_PAD_OWNER) : undefined
    // A legacy fourth Player eagle already in flight keeps its saved runtime, even while all home pads are reserved.
    if (id === 'xongkoro' && this.options.eaglePads && !pad && !aerial?.mount && !retirement?.mount) return false
    const deployment = this.options.eagleDeployment?.()
    const heading = retirement?.mount?.position.yaw ?? aerial?.mount?.position.yaw ?? deployment?.yaw ?? this.player().facingYaw
    const position = retirement?.mount
      ? new THREE.Vector3(retirement.mount.position.x, retirement.mount.position.y, retirement.mount.position.z)
      : id === 'xongkoro' && aerial?.mount
      ? new THREE.Vector3(aerial.mount.position.x, aerial.mount.position.y, aerial.mount.position.z)
      : id === 'xongkoro'
      ? findEagleLandingPosition(deployment ?? { ...this.player().combatPosition, yaw: heading }, this.obstacles(),
        [...this.occupied(), ...(this.options.eaglePads?.pads.filter(other => other.id !== pad?.id) ?? [])], getScenePlayableWorldBound(this.scene))
      : findSafeCareerMountPosition(this.player().combatPosition, this.obstacles(), this.occupied())
    if (!position) return false
    const mount = new Mount(this.scene, careerMountType(id), position.x, position.z, position.y, careerMountAppearanceVariant(profile))
    mount.currentHp = Math.max(1, Math.min(mount.maxHp, this.hp.get(id) ?? mount.maxHp))
    this.installDeathPersistence(id, mount)
    this.active = { id, mount }
    if (!retirement || retirement.player.mounted) this.player().mountVehicle(mount, id === 'xongkoro' ? heading : undefined)
    this.statusText = `${MOUNTS[canonicalCareerMountId(id)].name}已恢復，剩餘耐久 ${Math.ceil(mount.currentHp)}/${mount.maxHp}。`
    return true
  }

  dismiss(): boolean {
    if (this.readProfile().activeRace) return this.fail('賽馬期間不能收起坐騎。')
    if (this.player().isFalling || this.active?.mount.isAirborne) return this.fail('請先安全降落，再收起坐騎。')
    if (!this.active) return false
    const entry = this.active
    if (this.readProfile().racePlayerState) {
      const next = cloneCareerProfile(this.readProfile()); delete next.racePlayerState
      if (!this.commit(next)) return this.fail('保存失敗，坐騎仍保持召喚。')
    }
    this.hp.set(entry.id, entry.mount.currentHp)
    if (!this.persistOutingState(undefined)) return this.fail('保存失敗，坐騎仍保持召喚。')
    this.removeMountVisual(entry)
    this.active = null
    this.statusText = '坐騎已收起。'
    return true
  }

  release(rawId: string): boolean {
    if (this.readProfile().activeRace) return this.fail('賽馬期間不能解除坐騎分配。')
    if (this.player().isFalling || this.active?.mount.isAirborne) return this.fail('請先安全降落，再解除坐騎分配。')
    const id = canonicalCareerMountId(rawId as CareerMountId)
    const next = cloneCareerProfile(this.readProfile())
    delete next.racePlayerState
    if (next.selectedMountId !== id) return false
    delete next.selectedMountId
    if (next.activeMission?.mountState) delete next.activeMission.mountState.activeMountId
    if (!this.commit(next)) return this.fail('保存失敗，分配沒有變更。')
    if (this.active?.id === id) { this.removeMountVisual(this.active); this.active = null }
    if (id === 'xongkoro') this.options.eaglePads?.release(PLAYER_EAGLE_PAD_OWNER)
    this.statusText = '坐騎已解除分配，可交給隊員或出售。'
    return true
  }

  update(dt: number): void {
    const active = this.active
    if (!active) return
    active.mount.setCameraDistance(active.mount.group.position.distanceTo(this.player().position))
    if (active.mount.dead || active.mount.isFlyingMount && !active.mount.riderNpc && !active.mount.riderPlayer) active.mount.update(dt, this.obstacles() as ObstacleData[])
    if (this.hp.get(active.id) !== active.mount.currentHp) {
      this.hp.set(active.id, active.mount.currentHp)
      this.persistOutingState(active.id)
    }
  }

  restInTown(): void {
    if (['final-stand', 'completed'].includes(this.readProfile().careerRetirement?.phase ?? '')) return
    if (this.active) this.removeMountVisual(this.active)
    this.active = null
    this.unavailable.clear()
    this.hp.clear()
    this.persistOutingState(undefined)
    this.statusText = '坐騎已在馬廄完成休整。'
  }

  get activeMount(): Mount | null { return this.active?.mount ?? null }
  get activeMountId(): CareerMountId | null { return this.active?.id ?? null }

  /** Called after an ownership change has been saved; never writes another transaction. */
  syncOwnership(): void {
    syncCareerEaglePads(this.options.eaglePads, this.readProfile(), this.sceneKey())
    const owned = new Set(ownedCareerMountIds(this.readProfile()))
    if (this.active && (!owned.has(this.active.id) || this.readProfile().selectedMountId !== this.active.id)) {
      this.removeMountVisual(this.active)
      this.active = null
      this.statusText = '坐騎已賣出。'
    }
    for (const id of this.hp.keys()) if (!owned.has(id)) this.hp.delete(id)
    for (const id of this.unavailable) if (!owned.has(id)) this.unavailable.delete(id)
  }

  dispose(): void {
    this.options.eaglePads?.release(PLAYER_EAGLE_PAD_OWNER)
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
      this.statusText = `${MOUNTS[canonicalCareerMountId(id)].name}已倒下；本次出城不能再次召喚。`
    })
  }

  /** Player-only checkpoint; does not inspect or persist any mission NPCs. */
  checkpoint(): NonNullable<CareerProfile['activeMission']>['mountState'] {
    if (this.active) this.hp.set(this.active.id, this.active.mount.currentHp)
    return this.outingState(this.active?.id)
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
    if (!profile.activeMission && profile.careerRetirement?.phase !== 'final-stand') return true
    const next = cloneCareerProfile(profile)
    if (next.activeMission) next.activeMission.mountState = this.outingState(activeMountId)
    else if (next.retirementRuntime) next.retirementRuntime.mountState = this.outingState(activeMountId)
    return this.commit(next)
  }

  private removeMountVisual(entry: { id: CareerMountId; mount: Mount }): void {
    if (this.player().currentMount === entry.mount) this.player().dismountFromMount()
    entry.mount.dispose()
  }

  private fail(message: string): false { this.statusText = message; return false }
}
