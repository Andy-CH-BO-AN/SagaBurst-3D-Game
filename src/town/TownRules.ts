import { addCareerItem, availableCareerItem, canAllocateCareerItemToPlayer, careerItemTotal, normalizeCareerInventory } from '../career/CareerInventory'
import { canonicalCareerMountId, cloneCareerProfile, getCareerPurchaseTier, ownsCareerHorse, purchaseCareerContent, type CareerPurchaseResult, type CareerProfile, type CareerRank } from '../career/CareerProfile'
import { PLAYER_MOUNT_IDS, type PlayerMountId } from '../battle/BattleConfig'
import { T4_RANGER_BOW_RANGED_ID, WEAPONS } from '../rpg/WeaponDatabase'
import { ARMORS } from '../rpg/ArmorDatabase'
import type { CharacterFaction } from '../world/CharacterVisuals'
import type { NPC } from '../world/NPC'
import type { Mount } from '../world/Mount'
import { T4_UNIT_PROFILES } from '../battle/T4HeroCatalog'
import { followLocalOffset } from '../battle/FollowOrder'
import { TOWN_GATES, townGatePoint, type TownGateId } from './TownLayout'
import { UNIT_PRESETS, type UnitPresetId } from '../battle/UnitPresetCatalog'
export const townName = (faction: CharacterFaction): string => faction === 'roman' ? 'vinum 村' : 'økse 村'
export const TOWN_RULES = { garrisonTier: 2, deathPenalty: 100, civilians: 20, stableHorses: 5 } as const
export const CIVILIAN_PROFILE = { category: 'civilian', name: '平民 Civilian', hp: 50, retaliationWeapon: 'gladius_rusty' } as const
export type TownRole = 'melee_cavalry' | 'lancer_cavalry' | 'ranged_cavalry' | 'ranged_infantry' | 'archer_infantry' | 'melee_infantry' | 'spearman_infantry' | 'captain' | 'deployment' | 'merchant' | 'ranger' | 'cat' | 'civilian' | 'hr-officer' | 'eagle-trainer'
export type TownDuty = 'training' | 'gate_guard' | 'patrol' | 'service' | 'civilian'
export type TownPatrolId = 'A' | 'B'
export type TownDefenseGroupId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F'
export type TownUnitKind = 'sword_cavalry' | 'lancer' | 'horse_archer' | 'melee' | 'spearman' | 'ranged' | 'archer'
export interface TownActorSpec {
  id: string
  /** Unit/service identity; never used to infer training or objective membership. */
  role: TownRole
  unitKind?: TownUnitKind
  duty: TownDuty
  mounted: boolean
  training: boolean
  defenseGroup?: TownDefenseGroupId
  assaultObjective: boolean
  patrolId?: TownPatrolId
  /** Permanent Captain identity, independent of the runtime acting leader. */
  patrolLeader?: boolean
  gateId?: TownGateId
  tier: 2 | 3 | 4
  x: number
  z: number
  index: number
  yaw?: number
}
export function townMilitaryEquipment(faction: CharacterFaction, actor: TownRole | TownActorSpec) {
  const role = typeof actor === 'string' ? actor : actor.role
  const kinds: Partial<Record<TownRole, TownUnitKind>> = {
    melee_cavalry: 'sword_cavalry', lancer_cavalry: 'lancer', ranged_cavalry: 'horse_archer',
    melee_infantry: 'melee', spearman_infantry: 'spearman', ranged_infantry: 'ranged', archer_infantry: 'archer',
    captain: 'sword_cavalry', deployment: 'melee',
  }
  const unitKind = role === 'hr-officer' ? 'sword_cavalry' : typeof actor === 'string' ? kinds[role] : actor.unitKind
  const kind = unitKind === 'melee' || !unitKind ? faction === 'roman' ? 'heavy_infantry' : 'berserker'
    : unitKind === 'ranged' ? faction === 'roman' ? 'javelin_infantry' : 'archer' : unitKind
  const presetId = `${faction}_${kind}` as UnitPresetId
  const patrolCaptain = typeof actor !== 'string' && actor.duty === 'patrol' && actor.patrolLeader
  const tier = role === 'captain' || role === 'hr-officer' || role === 'deployment' || patrolCaptain ? 3 : TOWN_RULES.garrisonTier
  const level: 1 | 2 | 3 | 4 = role === 'captain' || role === 'hr-officer' || patrolCaptain ? 4 : tier
  return { presetId, tier, level, loadout: { ...UNIT_PRESETS[presetId].tierLoadouts[tier] } }
}
export const TOWN_SITES = {
  weapons: { x: -29, z: -10, yaw: Math.PI / 2 },
  stable: { x: -34, z: 20, yaw: Math.PI / 2 },
  barracks: { x: 33, z: 16, yaw: -Math.PI / 2 },
} as const
export function townSitePoint(site: keyof typeof TOWN_SITES, side: number, forward: number) {
  const { x, z, yaw } = TOWN_SITES[site]
  return { x: x + Math.cos(yaw) * side + Math.sin(yaw) * forward, z: z - Math.sin(yaw) * side + Math.cos(yaw) * forward, yaw }
}
/** Fixed mounted slots in the courtyard south of the Barracks hut, separate from Patrol startup formations. */
export function townPatrolRefitPoint(actor: Pick<TownActorSpec, 'patrolId' | 'index'>) {
  const slot = (actor.patrolId === 'B' ? 20 : 0) + actor.index
  return townSitePoint('barracks', 22 + Math.floor(slot / 8) * 4.5, -(slot % 8) * 4.5)
}
export function townRoster(): TownActorSpec[] {
  const result: TownActorSpec[] = []
  // Preserve the original IDs even where mounted training slots become infantry.
  const infantry = [
    ['melee_cavalry', 'melee_infantry', 'melee', 5, 35, -38, 'E'],
    ['lancer_cavalry', 'spearman_infantry', 'spearman', 5, 35, -31, 'E'],
    ['ranged_cavalry', 'ranged_infantry', 'ranged', 10, 62, -38, 'F'],
    ['ranged_infantry', 'ranged_infantry', 'ranged', 20, 40, 8, 'C'],
    ['melee_infantry', 'melee_infantry', 'melee', 10, 62, 8, 'A'],
    ['spearman_infantry', 'spearman_infantry', 'spearman', 10, 62, 26, 'B'],
  ] as const
  for (const [idPrefix, role, unitKind, count, x, z, group] of infantry) for (let i = 0; i < count; i++) result.push({
    id: `${idPrefix}-${i}`, role, unitKind, index: i, x: x + i % 5 * 4, z: z + Math.floor(i / 5) * 7,
    duty: 'training', mounted: false, training: true, tier: 2,
    defenseGroup: group === 'C' && i >= 10 ? 'D' : group, assaultObjective: true,
  })
  for (const [role, unitKind, x] of [['melee_cavalry', 'sword_cavalry', 35], ['lancer_cavalry', 'lancer', 70], ['ranged_cavalry', 'horse_archer', 105]] as const) {
    for (let i = 0; i < 20; i++) result.push({
      id: `cavalry-training:${role}:${i}`, role, unitKind, index: i, x: x + i % 5 * 6, z: -90 + Math.floor(i / 5) * 8,
      duty: 'training', mounted: true, training: true, tier: 2, assaultObjective: false,
    })
  }
  for (const gate of TOWN_GATES) for (let i = 0; i < 10; i++) {
    const role = i < 4 ? 'melee_infantry' : i < 7 ? 'spearman_infantry' : 'archer_infantry'
    result.push({
      id: `gate:${gate.id}:${i}`, role, unitKind: i < 4 ? 'melee' : i < 7 ? 'spearman' : 'archer', index: i,
      ...townGatePoint(gate, (i % 2 ? 1 : -1) * (11 + Math.floor(i / 2) % 3 * 3), 5 + Math.floor(i / 6) * 4),
      duty: 'gate_guard', gateId: gate.id, mounted: false, training: false, tier: 2, assaultObjective: false,
    })
  }
  for (let i = 0; i < 20; i++) {
    const angle = i * Math.PI * 2 / 20
    result.push({ id: 'civilian-' + i, role: 'civilian', index: i, x: Math.sin(angle) * (15 + i % 3 * 3) - 5, z: Math.cos(angle) * 16 + 7,
      duty: 'civilian', mounted: false, training: false, tier: 2, assaultObjective: false })
  }
  for (const [role, site, side, forward] of [['captain', 'barracks', -5, 8], ['deployment', 'barracks', 4, 8], ['merchant', 'weapons', 0, 7.5], ['ranger', 'stable', 3, 8], ['cat', 'stable', -3, 8]] as const) result.push({
    id: role, role, index: 0, ...townSitePoint(site, side, forward), duty: 'service', mounted: role === 'captain', training: false,
    ...(role === 'captain' ? { unitKind: 'sword_cavalry' as const } : role === 'deployment' ? { unitKind: 'melee' as const } : {}),
    tier: role === 'captain' || role === 'ranger' ? 4 : role === 'deployment' ? 3 : 2,
    assaultObjective: role === 'captain' || role === 'deployment' || role === 'ranger',
  })
  for (const patrolId of ['A', 'B'] as const) {
    const muster = townSitePoint('barracks', patrolId === 'A' ? 46 : 66, patrolId === 'A' ? -43 : 35)
    const yaw = patrolId === 'A' ? Math.PI / 2 : -Math.PI / 2
    for (let i = -1; i < 19; i++) {
      const offset = i < 0 ? { x: 0, z: 0 } : followLocalOffset(i, true)
      result.push({
        id: `town-patrol:${patrolId.toLowerCase()}:${i < 0 ? 'captain' : i}`,
        role: 'melee_cavalry', unitKind: 'sword_cavalry', duty: 'patrol', patrolId, patrolLeader: i < 0,
        mounted: true, training: false, tier: i < 0 ? 4 : 2, index: i + 1,
        assaultObjective: false,
        x: muster.x + Math.cos(yaw) * offset.x + Math.sin(yaw) * offset.z,
        z: muster.z - Math.sin(yaw) * offset.x + Math.cos(yaw) * offset.z, yaw,
      })
    }
  }
  return result
}
export function townAssaultObjectiveRoster(roster = townRoster()): TownActorSpec[] { return roster.filter(actor => isTownMilitary(actor) || actor.role === 'ranger' || actor.role === 'eagle-trainer') }
export function isCivilian(role: TownRole): boolean { return role === 'civilian' || role === 'merchant' }
export function isTownMilitary(actor: TownActorSpec): boolean { return Boolean(actor.unitKind) }
export type TownResult = 'player_defeated' | 'town_defeated'
export class TownEvent {
  /** Stable resident identities only; mounts and temporary combatants are not objectives. */
  readonly allActors = new Map<string, { dead: boolean }>()
  readonly actors = new Map<string, { dead: boolean }>()
  private readonly expectedIds: Set<string>
  hostile = false
  registrationComplete = false
  constructor(objectiveRoster: readonly Pick<TownActorSpec, 'id'>[]) {
    this.expectedIds = new Set(objectiveRoster.map(actor => actor.id))
    if (!this.expectedIds.size || this.expectedIds.size !== objectiveRoster.length) throw new Error('Invalid town objective roster')
  }
  register(id: string, actor: { dead: boolean }): void {
    if (this.allActors.has(id)) throw new Error('Duplicate town actor: ' + id)
    this.allActors.set(id, actor)
    if (this.expectedIds.has(id)) this.actors.set(id, actor)
  }
  complete(): void {
    const missing = [...this.expectedIds].filter(id => !this.actors.has(id))
    if (missing.length) throw new Error('Town objective roster incomplete: ' + missing.join(', '))
    this.registrationComplete = true
  }
  evaluate(playerDead: boolean): TownResult | null {
    if (!this.hostile) return null
    if (playerDead) return 'player_defeated'
    return this.registrationComplete && [...this.expectedIds].every(id => this.actors.get(id)?.dead === true) ? 'town_defeated' : null
  }
}
export function settleTown(current: CareerProfile, id: string, result: TownResult): CareerProfile {
  const profile = cloneCareerProfile(current)
  if (profile.townEvent?.id !== id || profile.townEvent.state !== 'hostile') return profile
  const penalty = result === 'player_defeated' ? Math.min(profile.availableMerit, TOWN_RULES.deathPenalty) : 0
  profile.availableMerit -= penalty
  if (result === 'town_defeated') { profile.faction = profile.faction === 'roman' ? 'viking' : 'roman'; profile.rank = 'recruit'; profile.enlistmentMeritBase = profile.totalMerit; delete profile.activeMission }
  profile.townEvent = { id, state: 'settled', result, penalty }
  return profile
}
export const STARTER_WEAPONS = ['gladius_rusty', 'viking_axe_t1', 'hunting_spear', 'wooden_shortbow', 'pilum_basic'] as const
export function grantStarter(current: CareerProfile, weapon: string): CareerProfile {
  if (current.starterWeaponId || !STARTER_WEAPONS.includes(weapon as typeof STARTER_WEAPONS[number])) return current
  const profile = cloneCareerProfile(current); profile.starterWeaponId = weapon
  addCareerItem(profile, weapon, 1)
  profile.equipment = { ...profile.equipment, [WEAPONS[weapon].type === 'ranged' ? 'ranged' : 'melee']: weapon }
  if (WEAPONS[weapon].type === 'ranged') profile.equipment.shield = null
  return profile
}
export function careerTownWeapon(profile: CareerProfile): string {
  const tier = getCareerPurchaseTier(profile.rank)
  return [profile.equipment?.melee, ...profile.ownedWeapons].find(id => id && WEAPONS[id]?.type === 'melee' && WEAPONS[id].tier <= tier && isTownShopWeapon(id) && canAllocateCareerItemToPlayer(profile, id)) ?? ''
}
export interface TownProduct { id: string; category: 'weapon' | 'armor' | 'mount'; name: string; tier: 1 | 2 | 3 | 4; price: number }
// Hero fixed equipment is not part of the ordinary Career collection.
export function isTownShopWeapon(id: string): boolean {
  return Boolean(WEAPONS[id]) && id !== 'maki-ranger-bow' && id !== T4_RANGER_BOW_RANGED_ID
}
export const XONGKORO_PRODUCT: Readonly<TownProduct> = { id: 'xongkoro', category: 'mount', name: 'xongkoro · 巨鷹英雄坐騎', tier: 4, price: 10000 }
export const TOWN_PRODUCTS: TownProduct[] = [
  ...Object.values(WEAPONS).filter(w => isTownShopWeapon(w.id)).map(w => ({ id: w.id, category: 'weapon' as const, name: w.name, tier: w.tier, price: w.tier * w.tier * 100 })),
  ...Object.values(ARMORS).map(a => ({ id: a.id, category: 'armor' as const, name: a.name, tier: a.tier, price: a.tier * a.tier * 90 })),
  { id: 'horse', category: 'mount', name: '軍用戰馬', tier: 1, price: 200 },
  { id: 'black-cat', category: 'mount', name: '黑貓英雄坐騎', tier: 4, price: 4000 },
  { id: 'corgi', category: 'mount', name: '柯基英雄坐騎', tier: 4, price: 4000 },
  XONGKORO_PRODUCT,
]
export function townShopProducts(serviceId: string): TownProduct[] {
  if (serviceId === 'eagle-trainer') return TOWN_PRODUCTS.filter(item => item.id === 'xongkoro')
  return TOWN_PRODUCTS.filter(item => item.id !== 'xongkoro' && (item.category === 'mount') === (serviceId !== 'merchant'))
}
export function productStatus(profile: CareerProfile, item: TownProduct): string {
  if (getCareerPurchaseTier(profile.rank) < item.tier) return '軍階未解鎖'
  return profile.availableMerit < item.price ? '已解鎖・餘額不足' : '已解鎖・餘額足夠'
}
export function townCampaignTarget(faction: CharacterFaction) { return { defenderFaction: faction, stageId: 1 as const } }
export function updateRangerMount(ranger: Pick<NPC, 'dead' | 'mount' | 'mountVehicle' | 'dismountFromMount'>, cat: Mount, distance: number): 'foot' | 'approach' | 'mounted' {
  if (ranger.dead || cat.dead) { if (ranger.mount) ranger.dismountFromMount(); return 'foot' }
  if (ranger.mount === cat) return 'mounted'
  if (distance > 2) return 'approach'
  ranger.mountVehicle(cat); return 'mounted'
}

export function townCaptainProfile(faction: CharacterFaction) { return T4_UNIT_PROFILES[faction === 'roman' ? 'roman_sword_cavalry' : 'viking_sword_cavalry'] }
export function stableHorsePositions() { return Array.from({ length: TOWN_RULES.stableHorses }, (_, i) => ({ ...townSitePoint('stable', -5.2 + i * 2.6, 1), variant: (i % 3) as 0 | 1 | 2 })) }

export function isTownProductOwned(profile: CareerProfile, item: TownProduct): boolean {
  return item.id === 'horse' ? ownsCareerHorse(profile)
    : (item.category === 'weapon' ? profile.ownedWeapons : item.category === 'armor' ? profile.ownedArmors : profile.ownedMounts as string[]).includes(item.id)
}
/** Resolve mount purchases from the catalog and preserve legacy horse ownership. */
export function purchaseTownMount(profile: CareerProfile, productId: string): CareerPurchaseResult {
  const item = TOWN_PRODUCTS.find(product => product.id === productId && product.category === 'mount')
  if (!item || !(PLAYER_MOUNT_IDS as readonly string[]).includes(item.id)) {
    return { profile: cloneCareerProfile(profile), purchased: false, spentMerit: 0, reason: 'invalid-id' }
  }
  const result = purchaseCareerContent(profile, {
    id: item.id, kind: 'mount', requiredTier: item.tier, cost: item.price,
  })
  if (result.purchased) result.profile.selectedMountId = item.id as PlayerMountId
  return result
}

/** Compatibility entry point for the canonical military-horse product. */
export function purchaseTownHorse(profile: CareerProfile, id: string): CareerProfile | null {
  if (id !== 'horse') return null
  const result = purchaseTownMount(profile, id)
  return result.purchased ? result.profile : null
}

/** Resolve every purchase field from the catalog; callers supply only a product ID. */
export function purchaseTownEquipment(profile: CareerProfile, productId: string): CareerPurchaseResult {
  const item = TOWN_PRODUCTS.find(product => product.id === productId && product.category !== 'mount')
  if (!item || item.category === 'mount') return { profile: cloneCareerProfile(profile), purchased: false, spentMerit: 0, reason: 'invalid-id' }
  return purchaseCareerContent(profile, {
    id: item.id, kind: item.category, requiredTier: item.tier, cost: item.price,
  })
}

export const TOWN_RESALE_PERCENT: Readonly<Record<CareerRank, number>> = {
  recruit: 50, soldier: 60, veteran: 70, captain: 80, commander: 90,
}

export function townResalePrice(profile: CareerProfile, productId: string): number {
  const item = TOWN_PRODUCTS.find(product => product.id === productId)
  return item ? Math.floor(item.price * TOWN_RESALE_PERCENT[profile.rank] / 100) : 0
}

export function townSaleStatus(profile: CareerProfile, productId: string): 'sellable' | 'invalid-id' | 'not-owned' | 'allocated' {
  const item = TOWN_PRODUCTS.find(product => product.id === productId)
  if (!item) return 'invalid-id'
  if (!isTownProductOwned(profile, item)) return 'not-owned'
  if (availableCareerItem(profile, productId) < 1) return 'allocated'
  return 'sellable'
}

/** Selling changes spendable merit and ownership only; rank never gates resale. */
export function sellTownProduct(current: CareerProfile, productId: string, quantity = 1) {
  const status = townSaleStatus(current, productId)
  const profile = cloneCareerProfile(current)
  if (status !== 'sellable') return { profile, sold: false, earnedMerit: 0, reason: status }
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > availableCareerItem(current, productId)) {
    return { profile, sold: false, earnedMerit: 0, reason: 'invalid-quantity' as const }
  }
  const item = TOWN_PRODUCTS.find(product => product.id === productId)!
  const earnedMerit = townResalePrice(current, productId) * quantity
  if (!Number.isSafeInteger(earnedMerit) || !Number.isSafeInteger(profile.availableMerit + earnedMerit)) {
    return { profile, sold: false, earnedMerit: 0, reason: 'invalid-quantity' as const }
  }
  profile.availableMerit += earnedMerit
  normalizeCareerInventory(profile)
  addCareerItem(profile, productId, -quantity)
  if (item.category === 'mount' && careerItemTotal(profile, productId) === 0) {
    const state = profile.activeMission?.mountState
    if (state) {
      for (const id of Object.keys(state.hp) as (keyof typeof state.hp)[]) {
        if (canonicalCareerMountId(id) === productId) delete state.hp[id]
      }
      state.unavailable = state.unavailable.filter(id => canonicalCareerMountId(id) !== productId)
    }
  }
  return { profile, sold: true, earnedMerit }
}

/** Stage every available copy of the selected products for a single shop save. */
export function sellTownProducts(current: CareerProfile, productIds: readonly string[]) {
  const ids = [...new Set(productIds)]
  const fail = (reason: string) => ({ profile: current, sold: false, soldCount: 0, earnedMerit: 0, reason })
  if (ids.some(id => !TOWN_PRODUCTS.some(item => item.id === id))) return fail('invalid-id')
  let profile = current, soldCount = 0, earnedMerit = 0
  for (const id of ids) {
    const quantity = availableCareerItem(profile, id)
    if (!quantity) continue
    const result = sellTownProduct(profile, id, quantity)
    if (!result.sold) return fail(result.reason!)
    profile = result.profile
    soldCount += quantity
    earnedMerit += result.earnedMerit
  }
  if (!soldCount) return fail('not-owned')
  return { profile, sold: true, soldCount, earnedMerit, reason: undefined }
}

/** Service and Patrol Captains share the faction's canonical T4 mounted profile. */
export function townActorCaptainProfile(faction: CharacterFaction, spec: TownActorSpec) {
  if (spec.role === 'captain' || spec.role === 'hr-officer') return townCaptainProfile(faction)
  if (spec.duty === 'patrol' && spec.patrolLeader) return townCaptainProfile(faction)
  return undefined
}
