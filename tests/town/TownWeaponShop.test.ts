import { careerItemTotal, addCareerItem } from '../../src/career/CareerInventory'
import { createTownCombatFixture } from '../helpers/townCombatFixture'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCareerProfile, getCareerPurchaseTier, purchaseCareerContent, type CareerProfile, type CareerRank } from '../../src/career/CareerProfile'
import * as THREE from 'three'
import { EaglePadReservations } from '../../src/career/EaglePadReservations'
import { CareerMountController } from '../../src/career/CareerMountController'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import { T4_RANGER_BOW_RANGED_ID } from '../../src/rpg/WeaponDatabase'
import { TownScene } from '../../src/town/TownScene'
import { TownEquipment } from '../../src/town/TownEquipment'
import { grantStarter, purchaseTownEquipment, purchaseTownHorse, purchaseTownMount, sellTownProduct, townSaleStatus, TOWN_PRODUCTS, townShopProducts } from '../../src/town/TownRules'
import { acceptCareerOutpost, acceptCareerOutpostRelief } from '../../src/career/CareerOutpostMission'
import { createCareerOutpostLaunch } from '../../src/career/CareerOutpostLaunch'
import { MemoryStorage } from '../helpers/memoryStorage'

function profile(rank: CareerRank = 'soldier'): CareerProfile {
  const legacy = grantStarter(createCareerProfile('roman'), 'gladius_rusty')
  delete legacy.inventory // Fixture exercises migration from the original ownership arrays.
  return { ...legacy, rank, totalMerit: 800, availableMerit: 500 }
}

describe('Career weapon shop canonical purchases', () => {
  it.each([
    ['recruit', 'rusty_dagger', true], ['recruit', 'steel_sword', false],
    ['soldier', 'steel_sword', true], ['soldier', 'runic_greatsword', false],
    ['veteran', 'runic_greatsword', true],
    ['veteran', 'paladin_sword_t4', false], ['veteran', 'paladin_mace_t4', false], ['veteran', 'paladin_shield_t4', false],
    ['recruit', 'paladin_sword_t4', false], ['recruit', 'paladin_mace_t4', false], ['recruit', 'paladin_shield_t4', false],
    ['soldier', 'paladin_sword_t4', false], ['soldier', 'paladin_mace_t4', false], ['soldier', 'paladin_shield_t4', false],
    ['captain', 'paladin_sword_t4', true], ['captain', 'paladin_mace_t4', true], ['captain', 'paladin_shield_t4', true],
    ['commander', 'paladin_sword_t4', true], ['commander', 'paladin_mace_t4', true], ['commander', 'paladin_shield_t4', true],
    ['recruit', T4_RANGER_BOW_RANGED_ID, false], ['soldier', T4_RANGER_BOW_RANGED_ID, false], ['veteran', T4_RANGER_BOW_RANGED_ID, false],
    ['captain', T4_RANGER_BOW_RANGED_ID, true], ['commander', T4_RANGER_BOW_RANGED_ID, true],
  ] as const)('%s purchases %s: %s', (rank, id, allowed) => {
    const current = { ...profile(rank), availableMerit: 2000 }
    const result = purchaseTownEquipment(current, id)
    expect(result.purchased).toBe(allowed)
    expect(result.purchased).toBe(TOWN_PRODUCTS.find(p => p.id === id)!.tier <= getCareerPurchaseTier(rank))
    if (!allowed) { expect(result.reason).toBe('tier-locked'); expect(result.profile).toEqual(current) }
  })
  it('spends available merit only and preserves starter and equipment without auto equipping', () => {
    const current = profile(); current.equipment = { melee: 'gladius_rusty' }
    const before = structuredClone(current)
    const result = purchaseTownEquipment(current, 'steel_sword')
    expect(result).toMatchObject({ purchased: true, spentMerit: 400, profile: { totalMerit: 800, availableMerit: 100, ownedWeapons: ['gladius_rusty', 'steel_sword'], equipment: current.equipment, starterWeaponId: 'gladius_rusty' } })
    expect(current).toEqual(before)
    const duplicate = purchaseTownEquipment(result.profile, 'steel_sword')
    expect(duplicate.reason).toBe('insufficient-merit'); expect(duplicate.profile).toEqual(result.profile)
    const repeated = purchaseTownEquipment({ ...result.profile, availableMerit: 500 }, 'steel_sword')
    expect(repeated.purchased).toBe(true); expect(careerItemTotal(repeated.profile, 'steel_sword')).toBe(2)
  })
  it('rejects insufficient merit, missing IDs, mounts and caller supplied product objects without mutation', () => {
    const current = profile(); current.availableMerit = 399
    const insufficient = purchaseTownEquipment(current, 'steel_sword')
    expect(insufficient.reason).toBe('insufficient-merit'); expect(insufficient.profile).toEqual(current)
    for (const id of ['missing', '', 'horse-t1', { id: 'steel_sword', price: 0, tier: 1, category: 'armor' }]) {
      const rejected = purchaseTownEquipment(current, id as string)
      expect(rejected.reason).toBe('invalid-id'); expect(rejected.profile).toEqual(current)
    }
    // Extra JS arguments cannot override the canonical fields.
    const call = purchaseTownEquipment as (...args: unknown[]) => ReturnType<typeof purchaseTownEquipment>
    const locked = call(profile('recruit'), 'steel_sword', 1, { price: 0, tier: 1, category: 'armor' })
    expect(locked.reason).toBe('tier-locked')
    const canonical = call(profile(), 'steel_sword', 1, { price: 0, tier: 1, category: 'armor' })
    expect(canonical.spentMerit).toBe(400); expect(canonical.profile.ownedArmors).toEqual([])
    expect(canonical.profile.ownedWeapons).toContain('steel_sword')
  })
  it('excludes Maki fixed melee weapon from catalog and purchase', () => {
    const id = 'maki-ranger-bow'
    expect(TOWN_PRODUCTS.some(p => p.id === id)).toBe(false)
    const current = profile('commander')
    expect(purchaseTownEquipment(current, id)).toMatchObject({ purchased: false, profile: current, reason: 'invalid-id' })
  })
  it('keeps weapon and shield catalog prices and faction independent collection', () => {
    expect(TOWN_PRODUCTS.filter(item => item.id === T4_RANGER_BOW_RANGED_ID)).toEqual([
      { id: T4_RANGER_BOW_RANGED_ID, name: 'T4 遊俠弓 Ranger Bow', category: 'weapon', tier: 4, price: 1600 },
    ])
    for (const item of TOWN_PRODUCTS.filter(p => p.category !== 'mount')) expect(item.price).toBe(item.tier ** 2 * (item.category === 'weapon' ? 100 : 90))
    expect(purchaseTownEquipment(profile(), 'viking_axe_t2').purchased).toBe(true)
    expect(purchaseTownEquipment({ ...profile(), faction: 'viking' }, 'pilum_standard').purchased).toBe(true)
  })
})

describe('Career purchased inventory and persistence', () => {
  it.each(['steel_sword', 'recurve_longbow', 'scutum_t2'])('immediately lists and equips %s without recreating inventory', id => {
    let current = profile()
    const inventory = new TownEquipment(() => current, next => { current = next; return true })
    expect(inventory.inventoryStacks.some(s => s.item.id === id)).toBe(false)
    current = purchaseTownEquipment(current, id).profile
    expect(inventory.isEquipped(id)).toBe(false)
    expect(inventory.inventoryStacks.find(s => s.item.id === id)?.quantity).toBe(1)
    expect(inventory.equipWeapon(id)).toBe(true)
    expect(Object.values(current.equipment!)).toContain(id)
    expect(inventory.inventoryStacks.find(s => s.item.id === id)?.quantity).toBe(1)
  })
  it('also equips purchases before any inventory getter refresh and rejects failed equipment saves', () => {
    let current = profile()
    const ready = new TownEquipment(() => current, next => { current = next; return true })
    current = purchaseTownEquipment(current, 'recurve_longbow').profile
    expect(ready.equipWeapon('recurve_longbow')).toBe(true)
    current.availableMerit = 500
    const inventory = new TownEquipment(() => current, () => false)
    current = purchaseTownEquipment(current, 'steel_sword').profile
    expect(inventory.equipWeapon('steel_sword')).toBe(false)
    expect(inventory.isEquipped('steel_sword')).toBe(false)
    expect(current.equipment).toEqual({ melee: 'gladius_rusty', ranged: 'recurve_longbow', shield: null })
  })
  it('saves ownership and merit, supports duplicates after reload and passes equipment into Outpost', () => {
    const store = new CareerProfileStore(new MemoryStorage())
    let current = profile(); current.totalMerit = 2000; current.availableMerit = 2000
    const inventory = new TownEquipment(() => current, next => { if (!store.save(next)) return false; current = next; return true })
    for (const id of ['steel_sword', 'recurve_longbow', 'scutum_t2']) {
      const result = purchaseTownEquipment(current, id)
      expect(result.purchased).toBe(true); expect(store.save(result.profile)).toBe(true); current = result.profile
      expect(inventory.equipWeapon(id)).toBe(true)
    }
    const reloaded = store.load()!
    expect(reloaded.totalMerit).toBe(2000); expect(reloaded.availableMerit).toBe(840)
    expect(reloaded.ownedWeapons).toEqual(['gladius_rusty', 'steel_sword', 'recurve_longbow'])
    expect(reloaded.ownedArmors).toEqual(['scutum_t2'])
    expect(careerItemTotal(purchaseTownEquipment(reloaded, 'steel_sword').profile, 'steel_sword')).toBe(2)
    const launch = createCareerOutpostLaunch(acceptCareerOutpost(reloaded, 1, 'shop-outpost')!)
    const expected = { meleeWeaponId: 'steel_sword', rangedWeaponId: 'recurve_longbow', shieldId: 'scutum_t2' }
    expect(launch.playerLoadout).toMatchObject(expected)
    addCareerItem(reloaded, 'horse', 1)
    const relief = acceptCareerOutpostRelief({ ...reloaded, completedOutpostStages: [1, 2, 3], ownedMounts: ['horse'], ownedHorseTiers: [1], selectedMountId: 'horse-t1' }, 'shop-relief')!
    expect(createCareerOutpostLaunch(relief).playerLoadout).toMatchObject(expected)
  })
  it.each(['roman', 'viking'] as const)('%s captain purchases, equips and reloads shared T4 equipment', faction => {
    const store = new CareerProfileStore(new MemoryStorage())
    let current = { ...profile('captain'), faction, totalMerit: 10000, availableMerit: 10000 }
    const inventory = new TownEquipment(() => current, next => { current = next; return store.save(next) })
    for (const id of ['paladin_sword_t4', 'paladin_mace_t4', 'paladin_shield_t4', T4_RANGER_BOW_RANGED_ID]) {
      const purchase = purchaseTownEquipment(current, id)
      expect(purchase.purchased).toBe(true)
      current = purchase.profile
      expect(inventory.equipWeapon(id)).toBe(true)
    }
    const loaded = store.load()!
    expect(loaded.equipment).toMatchObject({ melee: 'paladin_mace_t4', ranged: T4_RANGER_BOW_RANGED_ID, shield: null })
    expect(loaded.ownedWeapons).toEqual(expect.arrayContaining(['paladin_sword_t4', 'paladin_mace_t4', T4_RANGER_BOW_RANGED_ID]))
    expect(loaded.ownedArmors).toContain('paladin_shield_t4')
    expect(loaded.availableMerit).toBe(3760)
    const outpost = acceptCareerOutpost(loaded, 1, 't4-shop-outpost')!
    expect(createCareerOutpostLaunch(outpost).playerLoadout.rangedWeaponId).toBe(T4_RANGER_BOW_RANGED_ID)
    const returned = new TownEquipment(() => loaded, () => true)
    returned.prepareForCombat()
    expect(returned.equippedRanged.id).toBe(T4_RANGER_BOW_RANGED_ID)
    expect(returned.rangedEnabled).toBe(true)
    expect(returned.shieldEnabled).toBe(false)
    expect(inventory.equipWeapon('paladin_shield_t4')).toBe(true)
    expect(inventory.rangedEnabled).toBe(false)
    expect(current.ownedWeapons).toContain(T4_RANGER_BOW_RANGED_ID)
    expect(current.equipment?.ranged).toBeUndefined()
    expect(inventory.equipWeapon(T4_RANGER_BOW_RANGED_ID)).toBe(true)
    expect(inventory.shieldEnabled).toBe(false)
    const foreign = { ...store.load()!, faction: faction === 'roman' ? 'viking' as const : 'roman' as const }
    expect(store.save(foreign)).toBe(true)
    expect(store.load()?.equipment?.ranged).toBe(T4_RANGER_BOW_RANGED_ID)
  })
  it('buys repeated military horses alongside equipment', () => {
    const current = { ...profile('veteran'), availableMerit: 2500 }
    expect(purchaseTownHorse(current, 'horse-t2')).toBeNull()
    const horse = purchaseTownHorse(current, 'horse')!
    const weapon = purchaseTownEquipment(horse, 'steel_sword').profile
    expect(careerItemTotal(purchaseTownHorse(weapon, 'horse')!, 'horse')).toBe(2)
    expect(weapon.ownedMounts).toEqual(['horse']); expect(weapon.ownedWeapons).toContain('steel_sword')
    expect(weapon.selectedMountId).toBe('horse')
    expect(weapon.availableMerit).toBe(1900); expect(weapon.totalMerit).toBe(800)
  })
})

// Exercise the real Merchant handlers and commit boundary without constructing WebGL.
class PanelElement {
  textContent = ''
  className = ''
  disabled = false
  onclick?: () => void
  onchange?: () => void
  value = ''
  attributes: Record<string, string> = {}
  setAttribute(name: string, value: string): void { this.attributes[name] = value }
  children: PanelElement[] = []
  constructor(readonly tag: string) {}
  parent?: PanelElement
  append(...children: PanelElement[]): void { for (const child of children) child.parent = this; this.children.push(...children) }
  querySelector(selector: string): PanelElement | null { return this.children.find(child => child.className.split(' ').some(name => '.' + name === selector)) ?? null }
  remove(): void { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this) }
}
function merchantHarness(failSave = false, initial = profile(), shop = 'merchant') {
  vi.stubGlobal('document', { createElement: (tag: string) => new PanelElement(tag) })
  const current = initial; current.townDialogueSeen = ['roman:merchant', 'roman:ranger', 'roman:cat', 'roman:eagle-trainer']
  const store = new CareerProfileStore(new MemoryStorage()); store.save(current)
  if (failSave) vi.spyOn(store, 'save').mockReturnValue(false)
  const town = Object.assign(createTownCombatFixture(), {
    skills: { skillState: current.skills }, careerSkillSaveTimer: null,
    profile: store.load()!, store, player: { dead: false, clearTownAction: vi.fn() }, event: { hostile: false }, serviceAvailable: () => true,
    careerMounts: { syncOwnership: vi.fn() },
    openPanel: function (_title: string, message: string) { this.message = message; this.panel = new PanelElement('panel'); return this.panel },
  }) as any
  town.inventory = new TownEquipment(() => town.profile, next => town.commit(next))
  town.talk(shop)
  const rows = () => town.panel.children.find((child: PanelElement) => child.className.split(' ').includes('town-products')).children as PanelElement[]
  const row = (name: string) => rows().find(child => child.children[0]?.textContent.includes(name))!
  return { town, store, row, rows }
}

describe('Career shop resale', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
  it.each([['recruit', 200], ['soldier', 240], ['veteran', 280], ['captain', 320], ['commander', 360]] as const)('uses current %s rank and credits only available merit', (rank, earnedMerit) => {
    const current = { ...profile(rank), ownedWeapons: ['gladius_rusty', 'steel_sword'] }
    const before = structuredClone(current)
    const result = sellTownProduct(current, 'steel_sword')
    expect(result).toMatchObject({ sold: true, earnedMerit, profile: { availableMerit: 500 + earnedMerit, totalMerit: 800, rank, ownedWeapons: ['gladius_rusty'] } })
    expect(current).toEqual(before)
    expect(sellTownProduct(result.profile, 'steel_sword')).toMatchObject({ sold: false, reason: 'not-owned', earnedMerit: 0 })
  })
  it('counts locked weapons but not shields, and preserves starter grant history', () => {
    const current = { ...profile('recruit'), ownedWeapons: ['gladius_rusty', 'runic_greatsword'], ownedArmors: ['scutum_t1'], equipment: {} }
    const sold = sellTownProduct(current, 'gladius_rusty').profile
    expect(sold.equipment?.melee).toBeUndefined()
    expect(grantStarter(sold, 'gladius_rusty').ownedWeapons).toEqual(['runic_greatsword'])
    expect(townSaleStatus(sold, 'runic_greatsword')).toBe('sellable')
    expect(sellTownProduct(sold, 'scutum_t1')).toMatchObject({ sold: true, earnedMerit: 45, profile: { ownedArmors: [] } })
    expect(sellTownProduct(current, 'missing')).toMatchObject({ sold: false, reason: 'invalid-id' })
  })
  it('sells legacy horse ownership and all pets, then allows a new horse purchase', () => {
    let current = { ...profile(), ownedMounts: ['black-cat', 'corgi'], ownedHorseTiers: [2] } as CareerProfile
    current = sellTownProduct(current, 'horse').profile
    expect(current.selectedMountId).toBeUndefined(); expect(current.ownedHorseTiers).toBeUndefined()
    for (const id of ['black-cat', 'corgi']) current = sellTownProduct(current, id).profile
    expect(current.ownedMounts).toEqual([])
    expect(purchaseTownHorse(current, 'horse')).not.toBeNull()
  })
  it('keeps resale proceeds above lifetime merit after reload', () => {
    const store = new CareerProfileStore(new MemoryStorage())
    const current = { ...profile('recruit'), totalMerit: 0, availableMerit: 0, ownedWeapons: ['gladius_rusty', 'wooden_shortbow'], equipment: { ranged: 'wooden_shortbow' } }
    expect(store.save(sellTownProduct(current, 'gladius_rusty').profile)).toBe(true)
    expect(store.load()).toMatchObject({ availableMerit: 50, totalMerit: 0, rank: 'recruit', ownedWeapons: ['wooden_shortbow'] })
  })
  it('switches tabs, requires releasing equipped items before sale, and permits rebuying', () => {
    const { town, store, row } = merchantHarness(false, { ...profile(), ownedWeapons: ['gladius_rusty', 'steel_sword'] })
    town.inventory.equipWeapon('steel_sword')
    expect(sellTownProduct(town.profile, 'steel_sword').reason).toBe('allocated')
    town.inventory.unequipWeapon('steel_sword')
    town.panel.querySelector('.town-shop-tabs').children[1].onclick()
    expect(row('Steel Sword').querySelector('.town-button')!).toMatchObject({ textContent: '賣出 · 收回 240 軍功', disabled: false })
    row('Steel Sword').querySelector('.town-button')!.onclick!()
    expect(store.load()).toMatchObject({ availableMerit: 740, ownedWeapons: ['gladius_rusty'], equipment: {} })
    expect(town.inventory.meleeEnabled).toBe(false)
    expect(town.inventory.isEquipped('steel_sword')).toBe(false)
    expect(row('Gladius Rusty').querySelector('.town-button')!).toMatchObject({ textContent: '賣出 · 收回 60 軍功', disabled: false })
    town.panel.querySelector('.town-shop-tabs').children[0].onclick()
    row('Steel Sword').querySelector('.town-button')!.onclick!()
    expect(town.inventory.inventoryStacks.find((s: any) => s.item.id === 'steel_sword')?.quantity).toBe(1)
  })
  it('leaves ownership, equipment and funds intact on save failure', () => {
    const { town, row } = merchantHarness(true, { ...profile(), ownedWeapons: ['gladius_rusty', 'steel_sword'] })
    const before = structuredClone(town.profile)
    town.panel.querySelector('.town-shop-tabs').children[1].onclick()
    row('Steel Sword').querySelector('.town-button')!.onclick!()
    expect(town.profile).toEqual(before)
    expect(town.message).toContain('保存失敗')
    expect(town.careerMounts.syncOwnership).not.toHaveBeenCalled()
    expect(row('Steel Sword').querySelector('.town-button')!.disabled).toBe(false)
  })
  it('offers mount resale and shows an empty list after selling the last mount', () => {
    const { town, row, rows, store } = merchantHarness(false, { ...profile(), ownedMounts: ['horse'] }, 'ranger')
    town.panel.querySelector('.town-shop-tabs').children[1].onclick()
    row('軍用戰馬').querySelector('.town-button')!.onclick!()
    expect(store.load()).toMatchObject({ ownedMounts: [], availableMerit: 620 })
    expect(store.load()?.selectedMountId).toBeUndefined()
    expect(town.careerMounts.syncOwnership).toHaveBeenCalledOnce()
    expect(rows()[0].textContent).toBe('沒有可賣出的物品。')
  })
})
describe('Merchant panel purchase integration', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
  it('shows sections and disabled states, saves and refreshes balance/ownership immediately', () => {
    const { town, store, row, rows } = merchantHarness()
    expect(rows().filter(child => child.tag === 'h3').map(child => child.textContent)).toEqual(['近戰武器', '遠程武器', '盾牌'])
    expect(row('Steel Sword').querySelector('.town-button')!).toMatchObject({ textContent: '購買 1 件', disabled: false })
    expect(row('Runic Sword').querySelector('.town-button')!).toMatchObject({ textContent: '軍階未解鎖', disabled: true })
    expect(row('Gladius Rusty').querySelector('.town-button')!).toMatchObject({ textContent: '購買 1 件', disabled: false })
    row('Steel Sword').querySelector('.town-button')!.onclick!()
    expect(store.load()).toMatchObject({ availableMerit: 100, totalMerit: 800, ownedWeapons: ['gladius_rusty', 'steel_sword'] })
    expect(town.panel.children[0].textContent).toContain('可用軍功 100')
    expect(row('Steel Sword').querySelector('.town-button')!).toMatchObject({ textContent: '餘額不足', disabled: true })
    expect(row('Recurve').querySelector('.town-button')!).toMatchObject({ textContent: '餘額不足', disabled: true })
  })
  it('retains profile and offers purchase again when saving fails', () => {
    const { town, store, row } = merchantHarness(true)
    const before = structuredClone(town.profile)
    row('Steel Sword').querySelector('.town-button')!.onclick!()
    expect(town.profile).toEqual(before); expect(store.load()).toEqual(before)
    expect(town.message).toContain('保存失敗')
    expect(row('Steel Sword').querySelector('.town-button')!).toMatchObject({ textContent: '購買 1 件', disabled: false })
  })
})

describe('Career hero mount purchases', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it.each([['black-cat', 4000], ['corgi', 4000], ['xongkoro', 10000]] as const)('purchases %s at the catalog price and persists ownership and selection', (id, price) => {
    for (const faction of ['roman', 'viking'] as const) {
      const current = { ...profile('captain'), faction, totalMerit: 15000, availableMerit: price + 229 }
      const before = structuredClone(current)
      const result = purchaseTownMount(current, id)
      expect(result).toMatchObject({ purchased: true, spentMerit: price, profile: {
        totalMerit: 15000, availableMerit: 229, rank: 'captain', ownedMounts: [id], selectedMountId: id,
      } })
      expect(current).toEqual(before)
      const store = new CareerProfileStore(new MemoryStorage())
      expect(store.save(result.profile)).toBe(true)
      const reloaded = store.load()!
      expect(reloaded.ownedMounts).toEqual([id])
      expect(reloaded.selectedMountId).toBe(id)
      expect(reloaded.availableMerit).toBe(229)
      const mounts = new CareerMountController(new THREE.Scene(), () => null as any, () => reloaded, () => true, () => [], () => [])
      expect(mounts.list()).toEqual([expect.objectContaining({ id, available: true, active: false })])
      expect(purchaseTownMount(reloaded, id)).toMatchObject({ purchased: false, spentMerit: 0, reason: 'insufficient-merit', profile: reloaded })
    }
  })

  it.each([['black-cat', 4000], ['corgi', 4000], ['xongkoro', 10000]] as const)('enforces %s rank and balance without altering the profile', (id, price) => {
    for (const rank of ['recruit', 'soldier', 'veteran'] as const) {
      const current = { ...profile(rank), availableMerit: 8000 }
      expect(purchaseTownMount(current, id)).toMatchObject({ purchased: false, reason: 'tier-locked', spentMerit: 0, profile: current })
    }
    const insufficient = { ...profile('captain'), totalMerit: 15000, availableMerit: price - 1, selectedMountId: 'horse' as const }
    expect(purchaseTownMount(insufficient, id)).toMatchObject({ purchased: false, reason: 'insufficient-merit', spentMerit: 0, profile: insufficient })
    const exact = purchaseTownMount({ ...insufficient, rank: 'commander', availableMerit: price }, id)
    expect(exact.purchased).toBe(true)
    expect(exact.profile.availableMerit).toBe(0)
  })

  it.each([0, 1, 2, 3, 4])('enforces the canonical concurrent eagle cap with %i owned, retaining legacy excess through storage', count => {
    const current = { ...profile('captain'), availableMerit: 50000,
      inventory: { version: 1 as const, quantities: { gladius_rusty: 1, ...(count ? { xongkoro: count } : {}) } },
      ownedMounts: count ? ['xongkoro' as const] : [] }
    const before = structuredClone(current), result = purchaseTownMount(current, 'xongkoro')
    expect(result.purchased).toBe(count < 3)
    expect(result.spentMerit).toBe(count < 3 ? 10000 : 0)
    expect(result.profile.availableMerit).toBe(count < 3 ? 40000 : 50000)
    expect(careerItemTotal(result.profile, 'xongkoro')).toBe(count < 3 ? count + 1 : count)
    expect(current).toEqual(before)
    if (count >= 3) {
      expect(result.reason).toBe('ownership-limit'); expect(result.profile.selectedMountId).toBeUndefined()
      expect(purchaseCareerContent(current, { id: 'xongkoro', kind: 'mount', requiredTier: 4, cost: 10000 })).toMatchObject({ purchased: false, spentMerit: 0, reason: 'ownership-limit' })
    }
    const store = new CareerProfileStore(new MemoryStorage())
    expect(store.save(result.profile)).toBe(true)
    expect(careerItemTotal(store.load()!, 'xongkoro')).toBe(count < 3 ? count + 1 : count)
  })

  it('allows buying again only after legal sales lower legacy eagle ownership below three', () => {
    const current = { ...profile('captain'), availableMerit: 50000,
      inventory: { version: 1 as const, quantities: { gladius_rusty: 1, xongkoro: 4 } }, ownedMounts: ['xongkoro' as const] }
    const three = sellTownProduct(current, 'xongkoro')
    expect(three.sold).toBe(true); expect(purchaseTownMount(three.profile, 'xongkoro').reason).toBe('ownership-limit')
    const two = sellTownProduct(three.profile, 'xongkoro')
    expect(two.sold).toBe(true)
    const bought = purchaseTownMount(two.profile, 'xongkoro')
    expect(bought.purchased).toBe(true); expect(careerItemTotal(bought.profile, 'xongkoro')).toBe(3)
  })

  it('rejects non-mount products and preserves legacy horse ownership', () => {
    const current = { ...profile('captain'), totalMerit: 5000, availableMerit: 8000 }
    for (const id of ['missing', '', 'horse-t1', 'steel_sword', 'scutum_t2', { id: 'black-cat', price: 0, tier: 1 }]) {
      expect(purchaseTownMount(current, id as string)).toMatchObject({ purchased: false, reason: 'invalid-id', spentMerit: 0, profile: current })
    }
    const legacy = { ...current, ownedHorseTiers: [2] as (1 | 2 | 3)[], selectedMountId: 'horse-t2' as const }
    expect(careerItemTotal(purchaseTownMount(legacy, 'horse').profile, 'horse')).toBe(2)
    expect(purchaseTownHorse(legacy, 'horse')).not.toBeNull()
    expect(purchaseTownHorse(current, 'black-cat')).toBeNull()
    const fresh = purchaseTownMount(profile('recruit'), 'horse')
    expect(fresh).toMatchObject({ purchased: true, spentMerit: 200, profile: { selectedMountId: 'horse', ownedMounts: ['horse'], availableMerit: 300 } })
  })

  it.each(['cat', 'ranger'])('purchases both hero mounts through the actual %s panel handlers', shop => {
    for (const name of ['黑貓英雄坐騎', '柯基英雄坐騎']) {
      const id = name.startsWith('黑貓') ? 'black-cat' : 'corgi'
      const { town, store, row } = merchantHarness(false, { ...profile('captain'), totalMerit: 5000, availableMerit: 4229 }, shop)
      if (shop === 'cat') town.panel.children.find((child: PanelElement) => child.textContent === '查看坐騎').onclick()
      expect(row(name).querySelector('.town-button')!).toMatchObject({ textContent: '購買 1 件', disabled: false })
      row(name).querySelector('.town-button')!.onclick!()
      expect(store.load()).toMatchObject({ ownedMounts: [id], selectedMountId: id, availableMerit: 229, totalMerit: 5000 })
      expect(row(name).querySelector('.town-button')!).toMatchObject({ textContent: '餘額不足', disabled: true })
      expect(town.message).toContain(name)
      expect(town.message).toContain('按 Tab → 坐騎 → 騎乘')
      const before = structuredClone(town.profile)
      row(name).querySelector('.town-button')!.onclick!()
      expect(town.profile).toEqual(before)
    }
  })

  it('sells xongkoro only through the ranger at the eagle training ground', () => {
    for (const shop of ['ranger', 'cat', 'merchant']) expect(townShopProducts(shop).map(item => item.id)).not.toContain('xongkoro')
    expect(townShopProducts('eagle-trainer').map(item => item.id)).toEqual(['xongkoro'])
    const { town, store, row } = merchantHarness(false, { ...profile('captain'), totalMerit: 25000, availableMerit: 20229 }, 'eagle-trainer')
    row('xongkoro').querySelector('.town-button')!.onclick!()
    row('xongkoro').querySelector('.town-button')!.onclick!()
    expect(store.load()).toMatchObject({ availableMerit: 229, totalMerit: 25000, rank: 'captain', ownedMounts: ['xongkoro'], inventory: { quantities: { xongkoro: 2 } } })
    expect(town.message).toContain('xongkoro')
  })

  it('shows locked and unaffordable mount buttons, and rejects stale purchase clicks', () => {
    const locked = merchantHarness(false, { ...profile('veteran'), totalMerit: 5000, availableMerit: 8000 }, 'ranger')
    expect(locked.row('黑貓英雄坐騎').querySelector('.town-button')!).toMatchObject({ textContent: '軍階未解鎖', disabled: true })
    locked.row('黑貓英雄坐騎').querySelector('.town-button')!.onclick!()
    expect(locked.town.profile.ownedMounts).toEqual([])
    const poor = merchantHarness(false, { ...profile('captain'), totalMerit: 5000, availableMerit: 3999 }, 'ranger')
    expect(poor.row('柯基英雄坐騎').querySelector('.town-button')!).toMatchObject({ textContent: '餘額不足', disabled: true })
    const ready = merchantHarness(false, { ...profile('captain'), totalMerit: 5000, availableMerit: 4229 }, 'ranger')
    ready.town.profile.availableMerit = 3999
    ready.row('柯基英雄坐騎').querySelector('.town-button')!.onclick!()
    expect(ready.town.profile.ownedMounts).toEqual([])
    expect(ready.town.profile.availableMerit).toBe(3999)
    expect(ready.town.message).toBe('可用軍功不足')
  })

  it.each([['黑貓英雄坐騎', 'ranger', 4000], ['柯基英雄坐騎', 'ranger', 4000], ['xongkoro · 巨鷹英雄坐騎', 'eagle-trainer', 10000]] as const)('keeps balance and ownership unchanged when saving %s fails', (name, shop, price) => {
    const { town, store, row } = merchantHarness(true, { ...profile('captain'), totalMerit: 15000, availableMerit: price + 229, ownedMounts: ['horse'], selectedMountId: 'horse' }, shop)
    const pads = new EaglePadReservations([1, 2, 3].map(index => ({ id: `private-eagle-pad:${index}`, x: index * 30, z: 0, yaw: 0 })))
    const scene = new THREE.Scene()
    town.careerMounts = new CareerMountController(scene, () => town.player, () => town.profile, next => town.commit(next), () => [], () => [], () => 'town-home', { eaglePads: pads })
    const before = structuredClone(town.profile)
    row(name).querySelector('.town-button')!.onclick!()
    expect(town.profile).toEqual(before)
    expect(store.load()).toEqual(before)
    expect(pads.get('player')).toBeUndefined(); expect(scene.children).toHaveLength(0)
    expect(town.careerMounts.activeMount).toBeNull()
    expect(town.message).toContain('保存失敗')
    expect(row(name).querySelector('.town-button')!).toMatchObject({ textContent: '購買 1 件', disabled: false })
  })
})


describe('Career bulk purchase transactions', () => {
  it.each([
    ['paladin_sword_t4', 10, 16000], ['recurve_longbow', 10, 4000],
    ['paladin_shield_t4', 20, 28800], ['horse', 20, 4000],
    ['black-cat', 20, 80000], ['corgi', 20, 80000],
  ] as const)('buys %s × %s atomically for %s merit without changing the input', (id, quantity, cost) => {
    const current = { ...profile('captain'), availableMerit: cost }
    const before = structuredClone(current)
    const result = ['horse', 'black-cat', 'corgi'].includes(id)
      ? purchaseTownMount(current, id, quantity) : purchaseTownEquipment(current, id, quantity)
    expect(result).toMatchObject({ purchased: true, spentMerit: cost, profile: { availableMerit: 0, totalMerit: 800 } })
    expect(careerItemTotal(result.profile, id)).toBe(quantity)
    expect(current).toEqual(before)
    const store = new CareerProfileStore(new MemoryStorage())
    expect(store.save(result.profile)).toBe(true)
    expect(careerItemTotal(store.load()!, id)).toBe(quantity)
  })

  it('allows forty owned swords through two twenty-item transactions', () => {
    const current = { ...profile('captain'), availableMerit: 64000 }
    const first = purchaseTownEquipment(current, 'paladin_sword_t4', 20)
    const second = purchaseTownEquipment(first.profile, 'paladin_sword_t4', 20)
    expect(second.purchased).toBe(true)
    expect(careerItemTotal(second.profile, 'paladin_sword_t4')).toBe(40)
    expect(second.profile.availableMerit).toBe(0)
  })

  it.each([
    ['zero', 0], ['negative', -1], ['fraction', 1.5], ['NaN', NaN], ['Infinity', Infinity],
    ['over transaction limit', 21], ['unsafe integer', Number.MAX_SAFE_INTEGER + 1], ['string', '10'],
  ] as const)('rejects %s quantity at the shared domain boundary without mutation', (_name, quantity) => {
    const current = { ...profile('captain'), availableMerit: 100000 }
    const before = structuredClone(current)
    const result = purchaseCareerContent(current, { id: 'steel_sword', kind: 'weapon', cost: 400, requiredTier: 2, quantity: quantity as number })
    expect(result).toMatchObject({ purchased: false, spentMerit: 0, reason: 'invalid-quantity', profile: before })
    expect(current).toEqual(before)
  })

  it.each([
    ['one merit short', 'captain', 15999, 'insufficient-merit'],
    ['tier locked despite sufficient merit', 'veteran', 16000, 'tier-locked'],
  ] as const)('rejects the whole ten-sword transaction when %s', (_name, rank, merit, reason) => {
    const current = { ...profile(rank), availableMerit: merit }
    const before = structuredClone(current)
    expect(purchaseTownEquipment(current, 'paladin_sword_t4', 10)).toMatchObject({ purchased: false, spentMerit: 0, reason, profile: before })
    expect(current).toEqual(before)
  })

  it('rejects unsafe total cost before spending or updating inventory', () => {
    const current = { ...profile('captain'), availableMerit: Number.MAX_SAFE_INTEGER }
    const before = structuredClone(current)
    expect(purchaseCareerContent(current, { id: 'steel_sword', kind: 'weapon', cost: Number.MAX_SAFE_INTEGER, requiredTier: 2, quantity: 2 }))
      .toMatchObject({ purchased: false, spentMerit: 0, reason: 'invalid-cost', profile: before })
    expect(current).toEqual(before)
  })

  it.each([[1, 2, true, 3], [2, 2, false, 2], [3, 1, false, 3], [4, 1, false, 4]] as const)
    ('with %s eagles, buying %s succeeds %s and retains %s total', (owned, quantity, purchased, total) => {
      const current = { ...profile('captain'), availableMerit: 50000 }
      addCareerItem(current, 'xongkoro', owned)
      const before = structuredClone(current), result = purchaseTownMount(current, 'xongkoro', quantity)
      expect(result.purchased).toBe(purchased)
      expect(careerItemTotal(result.profile, 'xongkoro')).toBe(total)
      expect(result.spentMerit).toBe(purchased ? 20000 : 0)
      if (!purchased) expect(result).toMatchObject({ reason: 'ownership-limit', profile: before })
      expect(current).toEqual(before)
    })

  it('keeps heroes unique and rejects bulk hero recruitment', () => {
    const current = { ...profile('captain'), availableMerit: 10000 }
    const request = { id: 'hero-test', kind: 'hero' as const, cost: 100, requiredTier: 1 as const }
    const first = purchaseCareerContent(current, request)
    expect(first.purchased).toBe(true)
    expect(first.profile.ownedHeroes).toEqual(['hero-test'])
    expect(purchaseCareerContent(first.profile, request)).toMatchObject({ purchased: false, reason: 'already-owned', profile: first.profile })
    expect(purchaseCareerContent(current, { ...request, quantity: 2 })).toMatchObject({ purchased: false, reason: 'invalid-quantity', profile: current })
  })
})

describe('Career bulk purchase panel integration', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
  const select = (row: PanelElement) => row.querySelector('.town-purchase-quantity')!.children[0]
  const buy = (row: PanelElement) => row.querySelector('.town-buy-button')!

  it('defaults every item to one and updates only the selected row total and button', () => {
    const h = merchantHarness(false, { ...profile('captain'), totalMerit: 100000, availableMerit: 100000 })
    const sword = h.row('Paladin Sword'), bow = h.row('Recurve'), quantity = select(sword)
    expect(quantity).toMatchObject({ tag: 'select', value: '1', attributes: { 'aria-label': '購買數量' } })
    expect(quantity.children.map(option => option.value)).toEqual(Array.from({ length: 20 }, (_, i) => String(i + 1)))
    quantity.value = '15'; quantity.onchange!()
    expect(sword.querySelector('.town-purchase-total')!.textContent).toBe('總價：24,000 軍功')
    expect(buy(sword).textContent).toBe('購買 15 件')
    expect(select(bow).value).toBe('1'); expect(buy(bow).textContent).toBe('購買 1 件')
  })

  it('limits affordable quantities and refreshes balance, ownership, available stock and choices after one commit', () => {
    const h = merchantHarness(false, { ...profile('captain'), totalMerit: 100000, availableMerit: 10000 })
    const quantity = select(h.row('Paladin Sword'))
    expect(quantity.children.map(option => option.value)).toEqual(['1', '2', '3', '4', '5', '6'])
    quantity.value = '5'; quantity.onchange!()
    const save = vi.spyOn(h.store, 'save'), sync = vi.spyOn(h.town.inventory, 'syncOwnership')
    buy(h.row('Paladin Sword')).onclick!()
    expect(save).toHaveBeenCalledOnce(); expect(sync).toHaveBeenCalledOnce()
    expect(h.town.careerMounts.syncOwnership).toHaveBeenCalledOnce()
    expect(h.store.load()!.availableMerit).toBe(2000)
    expect(careerItemTotal(h.store.load()!, 'paladin_sword_t4')).toBe(5)
    expect(h.row('Paladin Sword').children[1].textContent).toContain('總持有 5 · 可用 5')
    expect(select(h.row('Paladin Sword')).children.map(option => option.value)).toEqual(['1'])
    expect(select(h.row('Paladin Sword')).value).toBe('1')
    expect(h.town.message).toContain('× 5'); expect(h.town.message).toContain('花費：8,000 軍功')
    expect(h.town.message).toContain('剩餘軍功：2,000')
  })

  it.each([[0, 3], [1, 2], [2, 1], [3, 0], [4, 0]] as const)('with %s eagles renders %s purchasable choices', (owned, choices) => {
    const current = { ...profile('captain'), totalMerit: 100000, availableMerit: 100000 }
    if (owned) addCareerItem(current, 'xongkoro', owned)
    const h = merchantHarness(false, current, 'eagle-trainer'), row = h.row('xongkoro')
    expect(select(row).children).toHaveLength(choices)
    expect(select(row).disabled).toBe(choices === 0); expect(buy(row).disabled).toBe(choices === 0)
  })

  it.each([['ranger', '黑貓英雄坐騎'], ['cat', '柯基英雄坐騎']] as const)('provides bulk quantities for %s mount shop', (shop, name) => {
    const h = merchantHarness(false, { ...profile('captain'), totalMerit: 100000, availableMerit: 80000 }, shop)
    if (shop === 'cat') h.town.panel.children.find((child: PanelElement) => child.textContent === '查看坐騎').onclick!()
    expect(select(h.row(name)).children).toHaveLength(20)
  })

  it.each([['captain', 1599, '餘額不足'], ['veteran', 10000, '軍階未解鎖']] as const)
    ('disables both controls for %s rank with %s merit', (rank, merit, message) => {
      const h = merchantHarness(false, { ...profile(rank), totalMerit: 100000, availableMerit: merit }), row = h.row('Paladin Sword')
      expect(select(row).disabled).toBe(true); expect(buy(row)).toMatchObject({ disabled: true, textContent: message })
    })

  it('rejects a stale affordable quantity and a forged quantity without committing', () => {
    const h = merchantHarness(false, { ...profile('captain'), totalMerit: 100000, availableMerit: 10000 })
    const row = h.row('Paladin Sword'), quantity = select(row), save = vi.spyOn(h.store, 'save')
    quantity.value = '6'; quantity.onchange!()
    h.town.profile.availableMerit = 9599
    const before = structuredClone(h.town.profile)
    buy(row).onclick!()
    expect(h.town.profile).toEqual(before); expect(save).not.toHaveBeenCalled()
    expect(h.town.message).toBe('可用軍功不足')
    quantity.value = '21'; buy(row).onclick!()
    expect(h.town.profile).toEqual(before); expect(save).not.toHaveBeenCalled()
  })

  it('retains bulk inventory and balance after save failure, skips runtime sync, and allows retry', () => {
    const h = merchantHarness(true, { ...profile('captain'), totalMerit: 100000, availableMerit: 20000 })
    const sync = vi.spyOn(h.town.inventory, 'syncOwnership'), before = structuredClone(h.town.profile)
    select(h.row('Paladin Sword')).value = '10'
    buy(h.row('Paladin Sword')).onclick!()
    expect(h.town.profile).toEqual(before); expect(h.store.load()).toEqual(before)
    expect(sync).not.toHaveBeenCalled(); expect(h.town.careerMounts.syncOwnership).not.toHaveBeenCalled()
    expect(h.town.message).toContain('保存失敗'); expect(buy(h.row('Paladin Sword')).disabled).toBe(false)
    vi.mocked(h.store.save).mockRestore()
    select(h.row('Paladin Sword')).value = '10'; buy(h.row('Paladin Sword')).onclick!()
    expect(careerItemTotal(h.store.load()!, 'paladin_sword_t4')).toBe(10)
    expect(h.store.load()!.availableMerit).toBe(4000)
  })

  it('buys twenty horses through the real ownership sync without creating mount actors', () => {
    const h = merchantHarness(false, { ...profile('captain'), totalMerit: 100000, availableMerit: 4000 }, 'ranger')
    const scene = new THREE.Scene()
    h.town.careerMounts = new CareerMountController(scene, () => h.town.player, () => h.town.profile, next => h.town.commit(next), () => [], () => [], () => 'town-home')
    const save = vi.spyOn(h.store, 'save')
    select(h.row('軍用戰馬')).value = '20'; buy(h.row('軍用戰馬')).onclick!()
    expect(save).toHaveBeenCalledOnce()
    expect(h.store.load()!.selectedMountId).toBe('horse'); expect(careerItemTotal(h.store.load()!, 'horse')).toBe(20)
    expect(h.row('軍用戰馬').children[1].textContent).toContain('總持有 20 · 可用 19')
    expect(scene.children).toHaveLength(0); expect(h.town.careerMounts.activeMount).toBeNull()
  })

  it.each(['falling', 'airborne'] as const)('blocks bulk mount purchases while %s', state => {
    const h = merchantHarness(false, { ...profile('captain'), totalMerit: 100000, availableMerit: 4000 }, 'ranger')
    if (state === 'falling') h.town.player.isFalling = true
    else h.town.player.currentMount = { isAirborne: true }
    const before = structuredClone(h.town.profile), save = vi.spyOn(h.store, 'save')
    select(h.row('軍用戰馬')).value = '20'; buy(h.row('軍用戰馬')).onclick!()
    expect(h.town.profile).toEqual(before); expect(save).not.toHaveBeenCalled()
    expect(h.town.message).toContain('請先安全降落')
  })
})
