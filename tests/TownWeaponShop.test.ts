import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCareerProfile, getCareerPurchaseTier, type CareerProfile, type CareerRank } from '../src/career/CareerProfile'
import { CareerProfileStore } from '../src/career/CareerProfileStore'
import { T4_RANGER_BOW_RANGED_ID } from '../src/rpg/WeaponDatabase'
import { TownScene } from '../src/town/TownScene'
import { TownEquipment } from '../src/town/TownEquipment'
import { grantStarter, purchaseTownEquipment, purchaseTownHorse, TOWN_PRODUCTS } from '../src/town/TownRules'
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
    expect(current.equipment).toEqual({ ranged: 'recurve_longbow' })
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
  append(...children: PanelElement[]): void { this.children.push(...children) }
  querySelector(): null { return null }
}
function merchantHarness(failSave = false) {
  vi.stubGlobal('document', { createElement: (tag: string) => new PanelElement(tag) })
  const current = profile(); current.townDialogueSeen = ['roman:merchant']
  const store = new CareerProfileStore(storage()); store.save(current)
  if (failSave) vi.spyOn(store, 'save').mockReturnValue(false)
  const town = Object.assign(Object.create(TownScene.prototype), {
    skills: { skillState: current.skills }, careerSkillSaveTimer: null,
    profile: current, store, player: { dead: false }, event: { hostile: false }, serviceAvailable: () => true,
    openPanel: function (_title: string, message: string) { this.message = message; this.panel = new PanelElement('panel'); return this.panel },
  }) as any
  town.talk('merchant')
  const rows = () => town.panel.children.find((child: PanelElement) => child.className === 'town-products').children as PanelElement[]
  const row = (name: string) => rows().find(child => child.children[0]?.textContent.includes(name))!
  return { town, store, row, rows }
}
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
