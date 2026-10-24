import type { CareerProfile } from './CareerProfile'
import { WEAPONS } from '../rpg/WeaponDatabase'
import { ARMORS } from '../rpg/ArmorDatabase'

export interface CareerShopProduct { id: string; category: 'weapon' | 'armor' | 'mount'; name: string; tier: 1 | 2 | 3 | 4 | 5; price: number }
export const XONGKORO_PRODUCT: Readonly<CareerShopProduct> = { id: 'xongkoro', category: 'mount', name: 'xongkoro · 巨鷹英雄坐騎', tier: 4, price: 10000 }
/** Canonical prices and quality tiers; the eagle trainer remains a separate rank-gated service. */
export const CAREER_SHOP_PRODUCTS: readonly Readonly<CareerShopProduct>[] = Object.freeze([
  ...Object.values(WEAPONS).map(w => ({ id: w.id, category: 'weapon' as const, name: w.name, tier: w.tier, price: w.tier * w.tier * 100 })),
  ...Object.values(ARMORS).map(a => ({ id: a.id, category: 'armor' as const, name: a.name, tier: a.tier, price: a.tier * a.tier * 90 })),
  { id: 'horse', category: 'mount' as const, name: '軍用戰馬', tier: 1 as const, price: 200 },
  { id: 'black-cat', category: 'mount' as const, name: '黑貓英雄坐騎', tier: 4 as const, price: 4000 },
  { id: 'corgi', category: 'mount' as const, name: '柯基英雄坐騎', tier: 4 as const, price: 4000 },
  { id: 'snow-leopard', category: 'mount' as const, name: '重甲雪豹', tier: 5 as const, price: 9000 },
  XONGKORO_PRODUCT,
].map(item => Object.freeze(item)))
const PRODUCTS_BY_ID = new Map(CAREER_SHOP_PRODUCTS.map(item => [item.id, item]))
export function careerShopProduct(id: string): Readonly<CareerShopProduct> | undefined { return PRODUCTS_BY_ID.get(id) }
/** Normal shop equipment and ground mounts can be used at any rank; eagle training keeps its qualification. */
export function isCareerShopItemUseUnlocked(profile: Pick<CareerProfile, 'rank'>, id: string): boolean {
  return Boolean(careerShopProduct(id) && (id !== 'xongkoro' || profile.rank === 'captain' || profile.rank === 'commander'))
}
