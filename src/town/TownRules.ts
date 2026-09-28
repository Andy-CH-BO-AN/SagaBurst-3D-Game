import { cloneCareerProfile, getCareerPurchaseTier, type CareerProfile } from '../career/CareerProfile'
import { WEAPONS } from '../rpg/WeaponDatabase'
import { ARMORS } from '../rpg/ArmorDatabase'
import type { CharacterFaction } from '../world/CharacterVisuals'
import type { NPC } from '../world/NPC'
import type { Mount } from '../world/Mount'
export const TOWN_RULES = { garrisonTier: 2, deathPenalty: 100, civilians: 20, principalActors: 85 } as const
export const CIVILIAN_PROFILE = { category: 'civilian', name: '平民 Civilian', hp: 50, retaliationWeapon: 'gladius_rusty' } as const
export type TownRole = 'melee_cavalry' | 'ranged_cavalry' | 'ranged_infantry' | 'melee_infantry' | 'captain' | 'deployment' | 'merchant' | 'ranger' | 'cat' | 'civilian'
export interface TownActorSpec { id: string; role: TownRole; x: number; z: number; index: number }
export function townRoster(): TownActorSpec[] {
  const result: TownActorSpec[] = []
  const groups = [ ['melee_cavalry', 10, 35, -38], ['ranged_cavalry', 10, 62, -38], ['ranged_infantry', 20, 35, 0], ['melee_infantry', 20, 62, 0] ] as const
  for (const [role, count, x, z] of groups) for (let i = 0; i < count; i++) result.push({ id: role + '-' + i, role, index: i, x: x + (i % 5) * 4, z: z + Math.floor(i / 5) * 7 })
  for (let i = 0; i < 20; i++) { const angle = i * Math.PI * 2 / 20; result.push({ id: 'civilian-' + i, role: 'civilian', index: i, x: Math.sin(angle) * (15 + i % 3 * 3) - 5, z: Math.cos(angle) * 16 + 7 }) }
  for (const [role, x, z] of [['captain', 26, -9], ['deployment', 25, 0], ['merchant', -19, -7], ['ranger', -21, 17], ['cat', -25, 18]] as const) result.push({ id: role, role, index: 0, x, z })
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
  if (result === 'town_defeated') { profile.faction = profile.faction === 'roman' ? 'viking' : 'roman'; profile.rank = 'recruit'; profile.enlistmentMeritBase = profile.totalMerit }
  profile.townEvent = { id, state: 'settled', result, penalty }
  return profile
}
export const STARTER_WEAPONS = ['gladius_rusty', 'viking_axe_t1'] as const
export function grantStarter(current: CareerProfile, weapon: string): CareerProfile {
  if (current.starterWeaponId || !STARTER_WEAPONS.includes(weapon as typeof STARTER_WEAPONS[number])) return current
  const profile = cloneCareerProfile(current); profile.starterWeaponId = weapon
  if (!profile.ownedWeapons.includes(weapon)) profile.ownedWeapons.push(weapon)
  return profile
}
export function careerTownWeapon(profile: CareerProfile): string {
  const tier = getCareerPurchaseTier(profile.rank)
  return profile.ownedWeapons.find(id => WEAPONS[id]?.type === 'melee' && WEAPONS[id].tier <= tier && id !== 'maki-ranger-bow') ?? profile.starterWeaponId ?? 'gladius_rusty'
}
export interface TownProduct { id: string; category: 'weapon' | 'armor' | 'mount'; name: string; tier: 1 | 2 | 3 | 4; price: number }
// Provisional display prices and mount tiers. No purchase mutation is exposed.
export const TOWN_PRODUCTS: TownProduct[] = [
  ...Object.values(WEAPONS).filter(w => w.id !== 'maki-ranger-bow').map(w => ({ id: w.id, category: 'weapon' as const, name: w.name, tier: w.tier, price: w.tier * w.tier * 100 })),
  ...Object.values(ARMORS).map(a => ({ id: a.id, category: 'armor' as const, name: a.name, tier: a.tier, price: a.tier * a.tier * 90 })),
  { id: 'horse', category: 'mount', name: '普通戰馬', tier: 2, price: 500 },
  { id: 'black-cat', category: 'mount', name: '黑貓英雄坐騎', tier: 4, price: 4000 },
  { id: 'corgi', category: 'mount', name: '柯基英雄坐騎', tier: 4, price: 4000 },
]
export function productStatus(profile: CareerProfile, item: TownProduct): string {
  const owned: readonly string[] = item.category === 'weapon' ? profile.ownedWeapons : item.category === 'armor' ? profile.ownedArmors : profile.ownedMounts
  if (owned.includes(item.id)) return '已擁有'
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
