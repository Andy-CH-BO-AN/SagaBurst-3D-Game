import { cloneCareerProfile, getCareerPurchaseTier, type CareerProfile } from '../career/CareerProfile'
import { WEAPONS } from '../rpg/WeaponDatabase'
import { ARMORS } from '../rpg/ArmorDatabase'
import type { CharacterFaction } from '../world/CharacterVisuals'
import type { NPC } from '../world/NPC'
import type { Mount } from '../world/Mount'
import { T4_UNIT_PROFILES } from '../battle/T4HeroCatalog'
export const TOWN_RULES = { garrisonTier: 2, deathPenalty: 100, civilians: 20, principalActors: 85, stableHorses: 5 } as const
export const CIVILIAN_PROFILE = { category: 'civilian', name: '平民 Civilian', hp: 50, retaliationWeapon: 'gladius_rusty' } as const
export type TownRole = 'melee_cavalry' | 'ranged_cavalry' | 'ranged_infantry' | 'melee_infantry' | 'captain' | 'deployment' | 'merchant' | 'ranger' | 'cat' | 'civilian'
export interface TownActorSpec { id: string; role: TownRole; x: number; z: number; index: number; yaw?: number }
export const TOWN_SITES = {
  weapons: { x: -29, z: -10, yaw: Math.PI / 2 },
  stable: { x: -34, z: 20, yaw: Math.PI / 2 },
  barracks: { x: 33, z: 16, yaw: -Math.PI / 2 },
} as const
export function townSitePoint(site: keyof typeof TOWN_SITES, side: number, forward: number) {
  const { x, z, yaw } = TOWN_SITES[site]
  return { x: x + Math.cos(yaw) * side + Math.sin(yaw) * forward, z: z - Math.sin(yaw) * side + Math.cos(yaw) * forward, yaw }
}
export function townRoster(): TownActorSpec[] {
  const result: TownActorSpec[] = []
  const groups = [ ['melee_cavalry', 10, 35, -38], ['ranged_cavalry', 10, 62, -38], ['ranged_infantry', 20, 35, 0], ['melee_infantry', 20, 62, 0] ] as const
  for (const [role, count, x, z] of groups) for (let i = 0; i < count; i++) result.push({ id: role + '-' + i, role, index: i, x: x + (i % 5) * 4, z: z + Math.floor(i / 5) * 7 })
  for (let i = 0; i < 20; i++) { const angle = i * Math.PI * 2 / 20; result.push({ id: 'civilian-' + i, role: 'civilian', index: i, x: Math.sin(angle) * (15 + i % 3 * 3) - 5, z: Math.cos(angle) * 16 + 7 }) }
  for (const [role, site, side, forward] of [['captain', 'barracks', -5, 8], ['deployment', 'barracks', 4, 8], ['merchant', 'weapons', 0, 7.5], ['ranger', 'stable', 3, 8], ['cat', 'stable', -3, 8]] as const) result.push({ id: role, role, index: 0, ...townSitePoint(site, side, forward) })
  return result
}
export function isCivilian(role: TownRole): boolean { return role === 'civilian' || role === 'merchant' }
export type TownResult = 'player_defeated' | 'town_defeated'
export class TownEvent {
  readonly actors = new Map<string, { dead: boolean }>()
  hostile = false
  registrationComplete = false
  register(id: string, actor: { dead: boolean }): void { if (this.actors.has(id)) throw new Error('Duplicate town actor: ' + id); this.actors.set(id, actor) }
  complete(): void { if (this.actors.size !== TOWN_RULES.principalActors) throw new Error('Town population incomplete'); this.registrationComplete = true }
  evaluate(playerDead: boolean): TownResult | null {
    if (!this.hostile) return null
    if (playerDead) return 'player_defeated'
    return this.registrationComplete && [...this.actors.values()].every(a => a.dead) ? 'town_defeated' : null
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
  if (!profile.ownedWeapons.includes(weapon)) profile.ownedWeapons.push(weapon)
  return profile
}
export function careerTownWeapon(profile: CareerProfile): string {
  const tier = getCareerPurchaseTier(profile.rank)
  return profile.ownedWeapons.find(id => WEAPONS[id]?.type === 'melee' && WEAPONS[id].tier <= tier && id !== 'maki-ranger-bow') ?? 'gladius_rusty'
}
export interface TownProduct { id: string; category: 'weapon' | 'armor' | 'mount'; name: string; tier: 1 | 2 | 3 | 4; price: number }
// Weapon / hero prices remain previews. Horse tiers are purchased through the canonical catalog.
export const TOWN_PRODUCTS: TownProduct[] = [
  ...Object.values(WEAPONS).filter(w => w.id !== 'maki-ranger-bow').map(w => ({ id: w.id, category: 'weapon' as const, name: w.name, tier: w.tier, price: w.tier * w.tier * 100 })),
  ...Object.values(ARMORS).map(a => ({ id: a.id, category: 'armor' as const, name: a.name, tier: a.tier, price: a.tier * a.tier * 90 })),
  { id: 'horse-t1', category: 'mount', name: '普通戰馬 · T1', tier: 1, price: 200 },
  { id: 'horse-t2', category: 'mount', name: '受訓戰馬 · T2', tier: 2, price: 500 },
  { id: 'horse-t3', category: 'mount', name: '精銳戰馬 · T3', tier: 3, price: 1000 },
  { id: 'black-cat', category: 'mount', name: '黑貓英雄坐騎', tier: 4, price: 4000 },
  { id: 'corgi', category: 'mount', name: '柯基英雄坐騎', tier: 4, price: 4000 },
]
export function productStatus(profile: CareerProfile, item: TownProduct): string {
  if (isTownProductOwned(profile, item)) return '已擁有'
  if (getCareerPurchaseTier(profile.rank) < item.tier) return '軍階未解鎖'
  if (item.id.startsWith('horse-t') && item.tier > 1 && !horseTiers(profile).includes((item.tier - 1) as 1 | 2 | 3)) return '先購買前一階戰馬'
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

export function horseTiers(profile: CareerProfile): readonly (1 | 2 | 3)[] { return profile.ownedHorseTiers ?? (profile.ownedMounts.includes('horse') ? [1] : []) }
export function isTownProductOwned(profile: CareerProfile, item: TownProduct): boolean {
  return item.id.startsWith('horse-t') ? horseTiers(profile).includes(item.tier as 1 | 2 | 3)
    : (item.category === 'weapon' ? profile.ownedWeapons : item.category === 'armor' ? profile.ownedArmors : profile.ownedMounts as string[]).includes(item.id)
}
/** Never trust a UI-supplied price/tier; recheck against current rank and ownership. */
export function purchaseTownHorse(profile: CareerProfile, id: string): CareerProfile | null {
  const item = TOWN_PRODUCTS.find(p => p.id === id && /^horse-t[123]$/.test(p.id))
  if (!item || productStatus(profile, item) !== '已解鎖・餘額足夠') return null
  const next = cloneCareerProfile(profile)
  next.availableMerit -= item.price
  next.ownedHorseTiers = [...horseTiers(profile), item.tier as 1 | 2 | 3]
  if (!next.ownedMounts.includes('horse')) next.ownedMounts.push('horse')
  next.selectedMountId = item.id as 'horse-t1' | 'horse-t2' | 'horse-t3'
  return next
}
