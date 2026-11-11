import { mountArmorImpactMax } from '../combat/MountArmor'
import { mountStats } from '../combat/MountStats'
import { compareMounts, mountDetails, mountTraits, type MountComparisonBasis } from '../rpg/MountComparison'
import { isCareerShopItemUseUnlocked } from './CareerShopCatalog'
import type { RaceRider } from './CareerRaceState'
import { availableCareerItem, canAllocateCareerItemToPlayer, careerItemTotal, normalizeCareerInventory } from './CareerInventory'
import * as THREE from 'three'
import { getCareerPurchaseTier, cloneCareerProfile, canonicalCareerMountId, ownsCareerHorse, type CareerMountId, type CareerProfile } from './CareerProfile'
import type { EquipmentMountAdapter, EquipmentMountItem } from '../ui/EquipmentUI'
import type { Player } from '../player/Player'
import { HorseAssetRegistry, horseVariantFromSave, type HorseAppearanceVariant } from '../world/HorseAssetRegistry'
import { Mount, MountType, felineVariantFromMountId } from '../world/Mount'
import { BlackCatVisual, type FelineMountVariant } from '../world/BlackCatVisual'
import { findEagleLandingPosition, type EagleLandingPoint } from '../world/EagleLanding'
import { syncCareerEaglePads, EaglePadReservations, PLAYER_EAGLE_PAD_OWNER } from './EaglePadReservations'
import { getTerrainHeight, getScenePlayableWorldBound, type ObstacleData } from '../world/Terrain'

export const CAREER_MOUNT_INTERACTION_DISTANCE = 3

const MOUNTS: Readonly<Record<ReturnType<typeof canonicalCareerMountId>, Omit<EquipmentMountItem, 'active' | 'available'>>> = {
  horse: { id: 'horse', name: '軍用戰馬', tier: 1 },
  'armored-horse': { id: 'armored-horse', name: '重甲戰馬', tier: 5 },
  'black-cat': { id: 'black-cat', name: '黑貓英雄坐騎', tier: 4 },
  'white-cat': { id: 'white-cat', name: '白貓英雄坐騎', tier: 4 },
  'orange-cat': { id: 'orange-cat', name: '橘貓英雄坐騎', tier: 4 },
  corgi: { id: 'corgi', name: '柯基英雄坐騎', tier: 4 },
  serval: { id: 'serval', name: '藪貓英雄坐騎', tier: 5 },
  caracal: { id: 'caracal', name: '獰貓英雄坐騎', tier: 5 },
  'snow-leopard': { id: 'snow-leopard', name: '重甲雪豹', tier: 5 },
  xongkoro: { id: 'xongkoro', name: 'xongkoro · 巨鷹英雄坐騎', tier: 4 },
}

export function ownedCareerMountIds(profile: Pick<CareerProfile, 'ownedMounts' | 'ownedHorseTiers'>): CareerMountId[] {
  const result: CareerMountId[] = ownsCareerHorse(profile) ? ['horse'] : []
  if (profile.ownedMounts.includes('armored-horse')) result.push('armored-horse')
  if (profile.ownedMounts.includes('black-cat')) result.push('black-cat')
  if (profile.ownedMounts.includes('white-cat')) result.push('white-cat')
  if (profile.ownedMounts.includes('orange-cat')) result.push('orange-cat')
  if (profile.ownedMounts.includes('corgi')) result.push('corgi')
  if (profile.ownedMounts.includes('serval')) result.push('serval')
  if (profile.ownedMounts.includes('caracal')) result.push('caracal')
  if (profile.ownedMounts.includes('snow-leopard')) result.push('snow-leopard')
  if (profile.ownedMounts.includes('xongkoro')) result.push('xongkoro')
  return result
}

export function careerMountType(id: CareerMountId): MountType {
  if (id === 'armored-horse') return MountType.ARMORED_HORSE
  if (id === 'black-cat') return MountType.BLACK_CAT
  if (id === 'white-cat') return MountType.WHITE_CAT
  if (id === 'orange-cat') return MountType.ORANGE_CAT
  if (id === 'serval') return MountType.SERVAL
  if (id === 'caracal') return MountType.CARACAL
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

/**
 * Feline variants a Town scene must be able to construct synchronously at startup:
 * the Town Cat, the player's selected/active/saved-race mount, saved race opponent,
 * and mounts already assigned to squad members or Town actors. Merely owned mounts are
 * deferred until summon, purchase or preview.
 */
export function careerFelineVariants(profile: CareerProfile): Set<FelineMountVariant> {
  const ids: Array<string | null | undefined> = [
    'black-cat',
    profile.selectedMountId,
    profile.activeMission?.mountState?.activeMountId,
    profile.retirementRuntime?.mountState?.activeMountId,
    profile.racePlayerState?.mountId,
    profile.activeRace?.player.mountId,
    profile.activeRace?.opponent.mountId,
    ...(profile.personalSquad?.members ?? []).map(member => member.equipment?.mount),
    ...Object.values(profile.townEquipment ?? {}).flatMap(state => Object.values(state?.actors ?? {}).map(refs => refs.mount?.itemId)),
  ]
  const variants = new Set<FelineMountVariant>()
  for (const id of ids) {
    const variant = felineVariantFromMountId(id)
    if (variant) variants.add(variant)
  }
  return variants
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
  private readonly armorImpact = new Map<CareerMountId, number>()
  private readonly hp = new Map<CareerMountId, number>()
  private readonly unavailable = new Set<CareerMountId>()
  statusText = ''
  /** Called when an asynchronous result (mount asset loaded or failed) changes statusText, so an open UI can refresh. */
  onChange?: () => void
  /** The mount whose assets are loading; its activation will finish on its own. */
  get loadingId(): string | null { return this.pending?.id ?? null }
  private requestSeq = 0
  private resourcesDirty = false
  private pending: { id: CareerMountId; token: number } | null = null

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
    for (const [id, value] of Object.entries(this.readProfile().mountArmor ?? {})) this.armorImpact.set(id as CareerMountId, value!)
    for (const [id, value] of Object.entries(state?.armorImpact ?? {})) this.armorImpact.set(id as CareerMountId, value!)
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

  /** The mount to compare against: the one being ridden, else the one allocated to the Player. */
  comparisonBasis(profile: CareerProfile = this.readProfile()): MountComparisonBasis | null {
    const owned = ownedCareerMountIds(profile)
    const riding = this.active && this.player().currentMount === this.active.mount ? canonicalCareerMountId(this.active.id) : null
    const allocated = profile.selectedMountId ? canonicalCareerMountId(profile.selectedMountId) : null
    const [id, source] = riding ? [riding, 'riding' as const] : allocated && owned.includes(allocated) ? [allocated, 'allocated' as const] : [null, null]
    return id && source ? { id, name: MOUNTS[id].name, source, kind: careerMountType(id) } : null
  }

  list(): EquipmentMountItem[] {
    const profile = this.readProfile()
    const basis = this.comparisonBasis(profile), rider = this.player().heroAssetId
    return ownedCareerMountIds(profile).map(id => ({
      ...MOUNTS[canonicalCareerMountId(id)],
      traits: mountTraits(mountStats(careerMountType(id), rider)),
      // Speed follows the real rider (see MountStats), so the Byzantine cataphract exception shows what riding would actually give.
      detail: mountDetails(careerMountType(id), rider).join(' ｜ '),
      comparison: compareMounts(canonicalCareerMountId(id), careerMountType(id), basis, rider),
      tier: careerMountTier(id, profile),
      active: this.active?.id === id && this.player().currentMount === this.active.mount,
      available: canUseCareerMount(profile, id) && !this.unavailable.has(id),
      quantityText: `總持有 ${careerItemTotal(profile, id)} · 可用 ${availableCareerItem(profile, id)}${mountArmorImpactMax(careerMountType(id)) ? ` · 護甲 ${Math.ceil(this.active?.id === id ? this.active.mount.armorImpactRemaining : this.armorImpact.get(id) ?? mountArmorImpactMax(careerMountType(id)))}/${mountArmorImpactMax(careerMountType(id))}` : ''}`,
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
    if (this.readProfile().activeMission?.duelMode === 'unarmed') return this.fail('空手對戰期間不能召喚或切換坐騎。')
    if (this.readProfile().activeRace) return this.fail('賽馬期間不能召喚或切換坐騎。')
    if (this.player().isFalling || this.player().currentMount?.isAirborne) return this.fail('請先安全降落，再召喚或切換坐騎。')
    const id = canonicalCareerMountId(rawId as CareerMountId)
    const config = MOUNTS[id]
    const profile = this.readProfile()
    if (!config || !ownedCareerMountIds(profile).includes(id)) return this.fail('尚未擁有這匹坐騎。')
    if (!canUseCareerMount(profile, id)) return this.fail(!isCareerShopItemUseUnlocked(profile, id) ? '巨鷹訓練需 Captain / Commander 軍階。' : '這匹坐騎已分配給其他單位。')
    if (this.unavailable.has(id)) return this.fail('這匹坐騎本次出城已倒下，回到和平小鎮休整後才能再用。')
    if (id === 'armored-horse' && !HorseAssetRegistry.armoredReady) return this.fail('重甲戰馬資源尚未就緒，請重新載入場景。')
    const feline = felineVariantFromMountId(id)
    if (feline && !BlackCatVisual.isPreloaded(feline)) {
      // Repeated clicks on the same loading mount coalesce; any other request supersedes it.
      if (this.pending?.id === id) return this.fail('正在載入坐騎資源…')
      const token = ++this.requestSeq
      this.pending = { id, token }
      void BlackCatVisual.preload(feline).then(() => {
        if (this.pending?.token !== token) return
        this.pending = null
        this.activate(rawId)
        this.onChange?.()
      }).catch(() => {
        if (this.pending?.token !== token) return
        this.pending = null
        this.statusText = '坐騎資源載入失敗，請稍後重試。'
        this.onChange?.()
      })
      return this.fail('正在載入坐騎資源…')
    }
    this.cancelPending()
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
    mount.restoreArmor(this.armorImpact.get(id))
    this.installDeathPersistence(id, mount)
    if (previous) { this.hp.set(previous.id, previous.mount.currentHp); this.rememberArmor(previous.id, previous.mount) }
    const previousHp = this.hp.get(id)
    this.hp.set(id, mount.currentHp)
    const next = cloneCareerProfile(profile)
    normalizeCareerInventory(next)
    if (this.armorImpact.size) next.mountArmor = Object.fromEntries(this.armorImpact)
    else delete next.mountArmor
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
    if (!canUseCareerMount(profile, id) || (id === 'armored-horse' && !HorseAssetRegistry.armoredReady)) return false
    const p = saved.mountPosition
    const mount = new Mount(this.scene, careerMountType(id), p.x, p.z, p.y, careerMountAppearanceVariant(profile))
    mount.restoreArmor(saved.mountArmorImpact ?? this.armorImpact.get(id))
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
    if (id === 'armored-horse' && !HorseAssetRegistry.armoredReady) {
      this.statusText = '重甲戰馬資源載入失敗，請稍後重試。'
      return false
    }
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
    mount.currentHp = Math.max(1, Math.min(mount.maxHp, retirement?.mount?.hp ?? this.hp.get(id) ?? mount.maxHp))
    mount.restoreArmor(retirement?.mount?.armorImpactRemaining ?? this.armorImpact.get(id))
    if (retirement?.mount) mount.group.rotation.y = heading
    this.installDeathPersistence(id, mount)
    this.active = { id, mount }
    if (profile.activeMission?.duelMode !== 'unarmed' && (!retirement || retirement.player.mounted)) this.player().mountVehicle(mount, heading)
    this.statusText = `${MOUNTS[canonicalCareerMountId(id)].name}已恢復，剩餘耐久 ${Math.ceil(mount.currentHp)}/${mount.maxHp}。`
    return true
  }

  dismiss(): boolean {
    this.cancelPending()
    if (this.readProfile().activeRace) return this.fail('賽馬期間不能收起坐騎。')
    if (this.player().isFalling || this.active?.mount.isAirborne) return this.fail('請先安全降落，再收起坐騎。')
    if (!this.active) return false
    const entry = this.active
    if (this.readProfile().racePlayerState) {
      const next = cloneCareerProfile(this.readProfile()); delete next.racePlayerState
      if (!this.commit(next)) return this.fail('保存失敗，坐騎仍保持召喚。')
    }
    this.hp.set(entry.id, entry.mount.currentHp)
    this.rememberArmor(entry.id, entry.mount)
    if (!this.persistOutingState(undefined)) return this.fail('保存失敗，坐騎仍保持召喚。')
    this.removeMountVisual(entry)
    this.active = null
    this.statusText = '坐騎已收起。'
    return true
  }

  release(rawId: string): boolean {
    this.cancelPending()
    if (this.readProfile().activeRace) return this.fail('賽馬期間不能解除坐騎分配。')
    if (this.player().isFalling || this.active?.mount.isAirborne) return this.fail('請先安全降落，再解除坐騎分配。')
    const id = canonicalCareerMountId(rawId as CareerMountId)
    const next = cloneCareerProfile(this.readProfile())
    delete next.racePlayerState
    if (next.selectedMountId !== id) return false
    if (this.active?.id === id) next.mountArmor = { ...next.mountArmor, [id]: this.active.mount.armorImpactRemaining }
    delete next.selectedMountId
    if (next.activeMission?.mountState) delete next.activeMission.mountState.activeMountId
    if (!this.commit(next)) return this.fail('保存失敗，分配沒有變更。')
    if (this.active?.id === id) { this.rememberArmor(id, this.active.mount); this.removeMountVisual(this.active); this.active = null }
    if (id === 'xongkoro') this.options.eaglePads?.release(PLAYER_EAGLE_PAD_OWNER)
    this.statusText = '坐騎已解除分配，可交給隊員或出售。'
    return true
  }

  update(dt: number): void {
    const active = this.active
    if (!active) return
    active.mount.setCameraDistance(active.mount.group.position.distanceTo(this.player().position))
    if (active.mount.dead || active.mount.isFlyingMount && !active.mount.riderNpc && !active.mount.riderPlayer) active.mount.update(dt, this.obstacles() as ObstacleData[])
    if (this.resourcesDirty || this.hp.get(active.id) !== active.mount.currentHp || (this.armorImpact.get(active.id) ?? 0) !== active.mount.armorImpactRemaining) {
      this.hp.set(active.id, active.mount.currentHp)
      this.rememberArmor(active.id, active.mount)
      this.resourcesDirty = !this.persistOutingState(active.id)
    }
  }

  restInTown(options?: { persist?: boolean }): boolean {
    this.cancelPending()
    if (['final-stand', 'completed'].includes(this.readProfile().careerRetirement?.phase ?? '')) return true
    if (this.active) this.removeMountVisual(this.active)
    this.active = null
    this.unavailable.clear()
    this.hp.clear()
    this.armorImpact.clear()
    if (options?.persist === false) {
      this.statusText = '坐騎已在馬廄完成休整。'
      return true
    }
    const saved = this.persistOutingState(undefined)
    if (saved) this.statusText = '坐騎已在馬廄完成休整。'
    return saved
  }

  get activeMount(): Mount | null { return this.active?.mount ?? null }
  get activeMountId(): CareerMountId | null { return this.active?.id ?? null }

  /** Called after an ownership change has been saved; never writes another transaction. */
  syncOwnership(): void {
    this.cancelPending()
    syncCareerEaglePads(this.options.eaglePads, this.readProfile(), this.sceneKey())
    const owned = new Set(ownedCareerMountIds(this.readProfile()))
    if (this.active && (!owned.has(this.active.id) || this.readProfile().selectedMountId !== this.active.id)) {
      this.removeMountVisual(this.active)
      this.active = null
      this.statusText = '坐騎已賣出。'
    }
    for (const id of this.hp.keys()) if (!owned.has(id)) this.hp.delete(id)
    for (const id of this.armorImpact.keys()) if (!owned.has(id)) this.armorImpact.delete(id)
    for (const id of this.unavailable) if (!owned.has(id)) this.unavailable.delete(id)
  }

  dispose(): void {
    this.cancelPending()
    this.options.eaglePads?.release(PLAYER_EAGLE_PAD_OWNER)
    if (this.active) {
      if (this.hp.get(this.active.id) !== this.active.mount.currentHp || (this.armorImpact.get(this.active.id) ?? 0) !== this.active.mount.armorImpactRemaining) {
        this.hp.set(this.active.id, this.active.mount.currentHp)
        this.rememberArmor(this.active.id, this.active.mount)
        this.persistOutingState(this.active.id)
      }
      this.removeMountVisual(this.active)
    }
    this.active = null
  }

  private installDeathPersistence(id: CareerMountId, mount: Mount): void {
    mount.onDeathCallbacks.push(() => {
      this.hp.set(id, 0)
      this.rememberArmor(id, mount)
      this.unavailable.add(id)
      this.persistOutingState(id)
      this.statusText = `${MOUNTS[canonicalCareerMountId(id)].name}已倒下；本次出城不能再次召喚。`
    })
  }

  /** Player-only checkpoint; does not inspect or persist any mission NPCs. */
  checkpoint(): NonNullable<CareerProfile['activeMission']>['mountState'] {
    if (this.active) { this.hp.set(this.active.id, this.active.mount.currentHp); this.rememberArmor(this.active.id, this.active.mount) }
    return this.outingState(this.active?.id)
  }

  private rememberArmor(id: CareerMountId, mount: Mount): void {
    if (mount.armorImpactMax > 0) this.armorImpact.set(id, mount.armorImpactRemaining)
  }

  private outingState(activeMountId: CareerMountId | undefined): NonNullable<CareerProfile['activeMission']>['mountState'] {
    const hp: Partial<Record<CareerMountId, number>> = {}
    for (const [id, value] of this.hp) hp[id] = Math.max(0, value)
    return {
      ...(activeMountId ? { activeMountId } : {}),
      hp,
      ...(this.armorImpact.size ? { armorImpact: Object.fromEntries(this.armorImpact) } : {}),
      unavailable: [...this.unavailable],
    }
  }

  private persistOutingState(activeMountId: CareerMountId | undefined): boolean {
    const profile = this.readProfile()
    const next = cloneCareerProfile(profile)
    if (this.armorImpact.size) next.mountArmor = Object.fromEntries(this.armorImpact)
    else delete next.mountArmor
    if (next.activeMission) next.activeMission.mountState = this.outingState(activeMountId)
    else if (next.retirementRuntime) next.retirementRuntime.mountState = this.outingState(activeMountId)
    return this.commit(next)
  }

  private removeMountVisual(entry: { id: CareerMountId; mount: Mount }): void {
    if (this.player().currentMount === entry.mount) this.player().dismountFromMount()
    entry.mount.dispose()
  }

  /** Invalidates any in-flight asset-load activation so a stale completion can never materialize a mount. */
  private cancelPending(): void { this.pending = null; this.requestSeq++ }

  private fail(message: string): false { this.statusText = message; return false }
}
