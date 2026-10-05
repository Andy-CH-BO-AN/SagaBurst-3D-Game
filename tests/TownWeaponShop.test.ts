import { createTownCombatFixture } from './townCombatFixture'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCareerProfile, getCareerPurchaseTier, type CareerProfile, type CareerRank } from '../src/career/CareerProfile'
import * as THREE from 'three'
import { CareerMountController } from '../src/career/CareerMountController'
import { CareerProfileStore } from '../src/career/CareerProfileStore'
import { T4_RANGER_BOW_RANGED_ID } from '../src/rpg/WeaponDatabase'
import { TownScene } from '../src/town/TownScene'
import { TownEquipment } from '../src/town/TownEquipment'
import { grantStarter, purchaseTownEquipment, purchaseTownHorse, purchaseTownMount, sellTownProduct, townSaleStatus, TOWN_PRODUCTS } from '../src/town/TownRules'
import { acceptCareerOutpost, acceptCareerOutpostRelief } from '../src/career/CareerOutpostMission'
import { createCareerOutpostLaunch } from '../src/career/CareerOutpostLaunch'

function profile(rank: CareerRank = 'soldier'): CareerProfile {
  return { ...grantStarter(createCareerProfile('roman'), 'gladius_rusty'), rank, totalMerit: 800, availableMerit: 500 }
}
function storage(): Storage {
  const values = new Map<string, string>()
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value) } } as Storage
}

describe('Career weapon shop canonical purchases', () => {
  it.each([
    ['recruit', 'rusty_dagger', true], ['recruit', 'steel_sword', false],
    ['soldier', 'steel_sword', true], ['soldier', 'runic_greatsword', false],
    ['veteran', 'runic_greatsword', true],
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
    expect(duplicate.reason).toBe('already-owned'); expect(duplicate.profile).toEqual(result.profile)
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
    const locked = call(profile('recruit'), 'steel_sword', { price: 0, tier: 1, category: 'armor' })
    expect(locked.reason).toBe('tier-locked')
    const canonical = call(profile(), 'steel_sword', { price: 0, tier: 1, category: 'armor' })
    expect(canonical.spentMerit).toBe(400); expect(canonical.profile.ownedArmors).toEqual([])
    expect(canonical.profile.ownedWeapons).toContain('steel_sword')
  })
  it.each(['maki-ranger-bow', T4_RANGER_BOW_RANGED_ID])('excludes Hero-only %s from catalog and purchase', id => {
    expect(TOWN_PRODUCTS.some(p => p.id === id)).toBe(false)
    const current = profile('commander')
    expect(purchaseTownEquipment(current, id)).toMatchObject({ purchased: false, profile: current, reason: 'invalid-id' })
  })
  it('keeps weapon and shield catalog prices and faction independent collection', () => {
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
    expect(current.equipment).toEqual({ ranged: 'recurve_longbow', shield: null })
  })
  it('saves ownership and merit, rejects duplicates after reload and passes equipment into Outpost', () => {
    const store = new CareerProfileStore(storage())
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
    expect(purchaseTownEquipment(reloaded, 'steel_sword')).toMatchObject({ purchased: false, reason: 'already-owned', profile: reloaded })
    const launch = createCareerOutpostLaunch(acceptCareerOutpost(reloaded, 1, 'shop-outpost')!)
    const expected = { meleeWeaponId: 'steel_sword', rangedWeaponId: 'recurve_longbow', shieldId: 'scutum_t2' }
    expect(launch.playerLoadout).toMatchObject(expected)
    const relief = acceptCareerOutpostRelief({ ...reloaded, completedOutpostStages: [1, 2, 3], ownedMounts: ['horse'], ownedHorseTiers: [1], selectedMountId: 'horse-t1' }, 'shop-relief')!
    expect(createCareerOutpostLaunch(relief).playerLoadout).toMatchObject(expected)
  })
  it('buys one military horse alongside equipment and rejects a second horse charge', () => {
    const current = { ...profile('veteran'), availableMerit: 2500 }
    expect(purchaseTownHorse(current, 'horse-t2')).toBeNull()
    const horse = purchaseTownHorse(current, 'horse')!
    const weapon = purchaseTownEquipment(horse, 'steel_sword').profile
    expect(purchaseTownHorse(weapon, 'horse')).toBeNull()
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
  children: PanelElement[] = []
  constructor(readonly tag: string) {}
  parent?: PanelElement
  append(...children: PanelElement[]): void { for (const child of children) child.parent = this; this.children.push(...children) }
  querySelector(selector: string): PanelElement | null { return this.children.find(child => '.' + child.className === selector) ?? null }
  remove(): void { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this) }
}
function merchantHarness(failSave = false, initial = profile(), shop = 'merchant') {
  vi.stubGlobal('document', { createElement: (tag: string) => new PanelElement(tag) })
  const current = initial; current.townDialogueSeen = ['roman:merchant', 'roman:ranger', 'roman:cat']
  const store = new CareerProfileStore(storage()); store.save(current)
  if (failSave) vi.spyOn(store, 'save').mockReturnValue(false)
  const town = Object.assign(createTownCombatFixture(), {
    skills: { skillState: current.skills }, careerSkillSaveTimer: null,
    profile: current, store, player: { dead: false, clearTownAction: vi.fn() }, event: { hostile: false }, serviceAvailable: () => true,
    careerMounts: { syncOwnership: vi.fn() },
    openPanel: function (_title: string, message: string) { this.message = message; this.panel = new PanelElement('panel'); return this.panel },
  }) as any
  town.inventory = new TownEquipment(() => town.profile, next => town.commit(next))
  town.talk(shop)
  const rows = () => town.panel.children.find((child: PanelElement) => child.className === 'town-products').children as PanelElement[]
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
    const current = { ...profile('recruit'), ownedWeapons: ['gladius_rusty', 'runic_greatsword'], ownedArmors: ['scutum_t1'], equipment: { melee: 'gladius_rusty', shield: 'scutum_t1' } }
    const sold = sellTownProduct(current, 'gladius_rusty').profile
    expect(sold.equipment?.melee).toBeUndefined()
    expect(grantStarter(sold, 'gladius_rusty').ownedWeapons).toEqual(['runic_greatsword'])
    expect(townSaleStatus(sold, 'runic_greatsword')).toBe('last-weapon')
    expect(sellTownProduct(sold, 'scutum_t1')).toMatchObject({ sold: true, earnedMerit: 45, profile: { ownedArmors: [] } })
    expect(sellTownProduct(current, 'missing')).toMatchObject({ sold: false, reason: 'invalid-id' })
  })
  it('sells legacy horse ownership and all pets, then allows a new horse purchase', () => {
    let current = { ...profile(), ownedMounts: ['black-cat', 'corgi'], ownedHorseTiers: [2], selectedMountId: 'horse-t2' } as CareerProfile
    current = sellTownProduct(current, 'horse').profile
    expect(current.selectedMountId).toBeUndefined(); expect(current.ownedHorseTiers).toBeUndefined()
    for (const id of ['black-cat', 'corgi']) current = sellTownProduct(current, id).profile
    expect(current.ownedMounts).toEqual([])
    expect(purchaseTownHorse(current, 'horse')).not.toBeNull()
  })
  it('keeps resale proceeds above lifetime merit after reload', () => {
    const store = new CareerProfileStore(storage())
    const current = { ...profile('recruit'), totalMerit: 0, availableMerit: 0, ownedWeapons: ['gladius_rusty', 'wooden_shortbow'] }
    expect(store.save(sellTownProduct(current, 'gladius_rusty').profile)).toBe(true)
    expect(store.load()).toMatchObject({ availableMerit: 50, totalMerit: 0, rank: 'recruit', ownedWeapons: ['wooden_shortbow'] })
  })
  it('switches tabs, sells equipped items, disables the last weapon and permits rebuying', () => {
    const { town, store, row } = merchantHarness(false, { ...profile(), ownedWeapons: ['gladius_rusty', 'steel_sword'] })
    town.inventory.equipWeapon('steel_sword')
    town.panel.querySelector('.town-shop-tabs').children[1].onclick()
    expect(row('Steel Sword').children[2]).toMatchObject({ textContent: '賣出 · 收回 240 軍功', disabled: false })
    row('Steel Sword').children[2].onclick()
    expect(store.load()).toMatchObject({ availableMerit: 740, ownedWeapons: ['gladius_rusty'], equipment: {} })
    expect(town.inventory.meleeEnabled).toBe(false)
    expect(town.inventory.isEquipped('steel_sword')).toBe(false)
    expect(row('Gladius Rusty').children[2]).toMatchObject({ textContent: '至少保留一件武器', disabled: true })
    town.panel.querySelector('.town-shop-tabs').children[0].onclick()
    row('Steel Sword').children[2].onclick()
    expect(town.inventory.inventoryStacks.find((s: any) => s.item.id === 'steel_sword')?.quantity).toBe(1)
  })
  it('leaves ownership, equipment and funds intact on save failure', () => {
    const { town, row } = merchantHarness(true, { ...profile(), ownedWeapons: ['gladius_rusty', 'steel_sword'] })
    const before = structuredClone(town.profile)
    town.panel.querySelector('.town-shop-tabs').children[1].onclick()
    row('Steel Sword').children[2].onclick()
    expect(town.profile).toEqual(before)
    expect(town.message).toContain('保存失敗')
    expect(town.careerMounts.syncOwnership).not.toHaveBeenCalled()
    expect(row('Steel Sword').children[2].disabled).toBe(false)
  })
  it('offers mount resale and shows an empty list after selling the last mount', () => {
    const { town, row, rows, store } = merchantHarness(false, { ...profile(), ownedMounts: ['horse'], selectedMountId: 'horse' }, 'ranger')
    town.panel.querySelector('.town-shop-tabs').children[1].onclick()
    row('軍用戰馬').children[2].onclick()
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
    expect(row('Steel Sword').children[2]).toMatchObject({ textContent: '購買', disabled: false })
    expect(row('Runic Sword').children[2]).toMatchObject({ textContent: '軍階未解鎖', disabled: true })
    expect(row('Gladius Rusty').children[2]).toMatchObject({ textContent: '已擁有', disabled: true })
    row('Steel Sword').children[2].onclick!()
    expect(store.load()).toMatchObject({ availableMerit: 100, totalMerit: 800, ownedWeapons: ['gladius_rusty', 'steel_sword'] })
    expect(town.panel.children[0].textContent).toContain('可用軍功 100')
    expect(row('Steel Sword').children[2]).toMatchObject({ textContent: '已擁有', disabled: true })
    expect(row('Recurve').children[2]).toMatchObject({ textContent: '餘額不足', disabled: true })
  })
  it('retains profile and offers purchase again when saving fails', () => {
    const { town, store, row } = merchantHarness(true)
    const before = structuredClone(town.profile)
    row('Steel Sword').children[2].onclick!()
    expect(town.profile).toEqual(before); expect(store.load()).toEqual(before)
    expect(town.message).toContain('保存失敗')
    expect(row('Steel Sword').children[2]).toMatchObject({ textContent: '購買', disabled: false })
  })
})

describe('Career hero mount purchases', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it.each(['black-cat', 'corgi'] as const)('purchases %s at the catalog price and persists ownership and selection', id => {
    for (const faction of ['roman', 'viking'] as const) {
      const current = { ...profile('captain'), faction, totalMerit: 5000, availableMerit: 4229 }
      const before = structuredClone(current)
      const result = purchaseTownMount(current, id)
      expect(result).toMatchObject({ purchased: true, spentMerit: 4000, profile: {
        totalMerit: 5000, availableMerit: 229, rank: 'captain', ownedMounts: [id], selectedMountId: id,
      } })
      expect(current).toEqual(before)
      const store = new CareerProfileStore(storage())
      expect(store.save(result.profile)).toBe(true)
      const reloaded = store.load()!
      expect(reloaded.ownedMounts).toEqual([id])
      expect(reloaded.selectedMountId).toBe(id)
      expect(reloaded.availableMerit).toBe(229)
      const mounts = new CareerMountController(new THREE.Scene(), () => null as any, () => reloaded, () => true, () => [], () => [])
      expect(mounts.list()).toEqual([expect.objectContaining({ id, available: true, active: false })])
      expect(purchaseTownMount(reloaded, id)).toMatchObject({ purchased: false, spentMerit: 0, reason: 'already-owned', profile: reloaded })
    }
  })

  it.each(['black-cat', 'corgi'] as const)('enforces %s rank and balance without altering the profile', id => {
    for (const rank of ['recruit', 'soldier', 'veteran'] as const) {
      const current = { ...profile(rank), availableMerit: 8000 }
      expect(purchaseTownMount(current, id)).toMatchObject({ purchased: false, reason: 'tier-locked', spentMerit: 0, profile: current })
    }
    const insufficient = { ...profile('captain'), totalMerit: 5000, availableMerit: 3999, selectedMountId: 'horse' as const }
    expect(purchaseTownMount(insufficient, id)).toMatchObject({ purchased: false, reason: 'insufficient-merit', spentMerit: 0, profile: insufficient })
    const exact = purchaseTownMount({ ...insufficient, rank: 'commander', availableMerit: 4000 }, id)
    expect(exact.purchased).toBe(true)
    expect(exact.profile.availableMerit).toBe(0)
  })

  it('rejects non-mount products and preserves legacy horse ownership', () => {
    const current = { ...profile('captain'), totalMerit: 5000, availableMerit: 8000 }
    for (const id of ['missing', '', 'horse-t1', 'steel_sword', 'scutum_t2', { id: 'black-cat', price: 0, tier: 1 }]) {
      expect(purchaseTownMount(current, id as string)).toMatchObject({ purchased: false, reason: 'invalid-id', spentMerit: 0, profile: current })
    }
    const legacy = { ...current, ownedHorseTiers: [2] as (1 | 2 | 3)[], selectedMountId: 'horse-t2' as const }
    expect(purchaseTownMount(legacy, 'horse')).toMatchObject({ purchased: false, reason: 'already-owned', profile: legacy })
    expect(purchaseTownHorse(legacy, 'horse')).toBeNull()
    expect(purchaseTownHorse(current, 'black-cat')).toBeNull()
    const fresh = purchaseTownMount(profile('recruit'), 'horse')
    expect(fresh).toMatchObject({ purchased: true, spentMerit: 200, profile: { selectedMountId: 'horse', ownedMounts: ['horse'], availableMerit: 300 } })
  })

  it.each(['cat', 'ranger'])('purchases both hero mounts through the actual %s panel handlers', shop => {
    for (const name of ['黑貓英雄坐騎', '柯基英雄坐騎']) {
      const id = name.startsWith('黑貓') ? 'black-cat' : 'corgi'
      const { town, store, row } = merchantHarness(false, { ...profile('captain'), totalMerit: 5000, availableMerit: 4229 }, shop)
      if (shop === 'cat') town.panel.children.find((child: PanelElement) => child.textContent === '查看坐騎').onclick()
      expect(row(name).children[2]).toMatchObject({ textContent: '購買', disabled: false })
      row(name).children[2].onclick!()
      expect(store.load()).toMatchObject({ ownedMounts: [id], selectedMountId: id, availableMerit: 229, totalMerit: 5000 })
      expect(row(name).children[2]).toMatchObject({ textContent: '已擁有', disabled: true })
      expect(town.message).toContain(name)
      expect(town.message).toContain('按 Tab → 坐騎 → 騎乘')
      const before = structuredClone(town.profile)
      row(name).children[2].onclick!()
      expect(town.profile).toEqual(before)
    }
  })

  it('shows locked and unaffordable mount buttons, and rejects stale purchase clicks', () => {
    const locked = merchantHarness(false, { ...profile('veteran'), totalMerit: 5000, availableMerit: 8000 }, 'ranger')
    expect(locked.row('黑貓英雄坐騎').children[2]).toMatchObject({ textContent: '軍階未解鎖', disabled: true })
    locked.row('黑貓英雄坐騎').children[2].onclick!()
    expect(locked.town.profile.ownedMounts).toEqual([])
    const poor = merchantHarness(false, { ...profile('captain'), totalMerit: 5000, availableMerit: 3999 }, 'ranger')
    expect(poor.row('柯基英雄坐騎').children[2]).toMatchObject({ textContent: '餘額不足', disabled: true })
    const ready = merchantHarness(false, { ...profile('captain'), totalMerit: 5000, availableMerit: 4229 }, 'ranger')
    ready.town.profile.availableMerit = 3999
    ready.row('柯基英雄坐騎').children[2].onclick!()
    expect(ready.town.profile.ownedMounts).toEqual([])
    expect(ready.town.profile.availableMerit).toBe(3999)
    expect(ready.town.message).toBe('可用軍功不足')
  })

  it.each(['黑貓英雄坐騎', '柯基英雄坐騎'])('keeps balance and ownership unchanged when saving %s fails', name => {
    const { town, store, row } = merchantHarness(true, { ...profile('captain'), totalMerit: 5000, availableMerit: 4229, ownedMounts: ['horse'], selectedMountId: 'horse' }, 'ranger')
    const before = structuredClone(town.profile)
    row(name).children[2].onclick!()
    expect(town.profile).toEqual(before)
    expect(store.load()).toEqual(before)
    expect(town.message).toContain('保存失敗')
    expect(row(name).children[2]).toMatchObject({ textContent: '購買', disabled: false })
  })
})
