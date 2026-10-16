import { describe, expect, it } from 'vitest'
import { addCareerItem, availableCareerItem, careerItemAllocated, careerItemTotal, normalizeCareerInventory } from '../../src/career/CareerInventory'
import { cloneCareerProfile, createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { CAREER_STORAGE_KEY, CareerProfileStore, parseCareerProfile } from '../../src/career/CareerProfileStore'
import {
  bulkCareerEquipment, changeTownEquipment,
  resolveTownActorEquipment,
  type TownEquipmentContext
} from '../../src/career/CareerTownEquipment'
import { sellTownNativeEquipment, sellTownNativeProducts, townNativeSaleStock, type TownNativeSaleContext } from '../../src/career/CareerTownNativeResale'
import { MemoryStorage } from '../helpers/memoryStorage'

/** Real domain and JSON storage; zero NPC/Mount/TownWorld/asset construction. */
function harness(faction: CareerProfile['faction'] = 'roman') {
  // Already received (and may have sold) the rank reward; this suite isolates native ownership.
  let profile: CareerProfile = { ...createCareerProfile(faction), rank: 'commander', commanderMeleeGranted: true, totalMerit: 60000, availableMerit: 60000 }
  normalizeCareerInventory(profile)
  const storage = new MemoryStorage(), store = new CareerProfileStore(storage)
  const read = () => profile
  const save = (next: CareerProfile) => { if (!store.save(next)) return false; profile = next; return true }
  const context: TownEquipmentContext = { townFaction: faction, peaceful: true, personalState: 'RESERVE',
    safeActorIds: new Set(['gate:north:0', 'gate:north:1', 'gate:north:7', 'civilian-0', 'civilian-1']) }
  return { read, save, store, storage, context, set: (next: CareerProfile) => { profile = next },
    buy: (id: string, count = 1) => addCareerItem(profile, id, count),
    change: (actor: string, slot: 'melee' | 'ranged' | 'shield' | 'mount', id: string | null) => changeTownEquipment(read, context, actor, slot, id, save),
    bulk: (target: Parameters<typeof bulkCareerEquipment>[2], category: Parameters<typeof bulkCareerEquipment>[3]) => bulkCareerEquipment(read, context, target, category, save),
    reload() { profile = store.load()!; return profile },
    saved() { const key = storage.key(0); return key === null ? null : storage.getItem(key) },
  }
}
describe('Town equipment domain, canonical ownership and persisted native sources', () => {
  it('rolls back a bulk bow allocation and displaced native shield when storage fails', () => {
    const h = harness(); h.context.safeActorIds = new Set(['gate:north:0']); h.buy('elven_runebow')
    // The bulk owner already validates its staged domain data. Seed durable bytes
    // directly here; CareerProfileStore validation has a separate persistence owner.
    h.storage.setItem(CAREER_STORAGE_KEY, JSON.stringify(h.read()))
    const before = cloneCareerProfile(h.read()), durableBefore = h.saved()
    let staged: CareerProfile | undefined
    let saves = 0
    h.storage.failWrites = true
    const result = bulkCareerEquipment(h.read, h.context, 1, 'bow', next => {
      saves++; staged = next
      // Exercise a real failed storage write at the injected persistence boundary.
      h.storage.setItem(CAREER_STORAGE_KEY, JSON.stringify(next))
      return true
    })
    expect(result).toMatchObject({ changed: false, reason: 'save-failed', changedActorIds: [] })
    expect(saves).toBe(1)
    expect(staged!.townEquipment!.roman!.actors['gate:north:0']).toMatchObject({
      ranged: { itemId: 'elven_runebow', source: 'inventory' }, shield: null,
    })
    expect(staged!.townEquipment!.roman!.nativeReserve).toContain('roman/gate:north:0/shield')
    expect(availableCareerItem(staged!, 'elven_runebow')).toBe(0)
    expect(h.read()).toEqual(before)
    expect(h.saved()).toBe(durableBefore)
    expect(availableCareerItem(h.read(), 'elven_runebow')).toBe(1)
  })
  it('counts Player, HR, Town and Civilian in one quantity pool and refuses another claimant', () => {
    const h = harness(); h.buy('paladin_sword_t4', 4)
    const next = cloneCareerProfile(h.read())
    const guard = resolveTownActorEquipment(next, 'roman', 'gate:north:0').refs
    next.equipment = { melee: 'paladin_sword_t4' }
    next.personalSquad = { members: [{ id: 'personal:test', type: 'soldier', originalHirePrice: 50,
      equipment: { melee: 'paladin_sword_t4', ranged: null, shield: null, mount: null } }] }
    next.townEquipment = { roman: { version: 1, actors: {
      'gate:north:0': { ...guard, melee: { itemId: 'paladin_sword_t4', source: 'inventory' } },
      'civilian-0': { melee: { itemId: 'paladin_sword_t4', source: 'inventory' }, ranged: null, shield: null, mount: null },
    }, nativeReserve: ['roman/gate:north:0/melee'] } }
    h.set(next)
    const before = cloneCareerProfile(next)
    let saves = 0
    expect(careerItemAllocated(next, 'paladin_sword_t4')).toBe(4)
    expect(availableCareerItem(next, 'paladin_sword_t4')).toBe(0)
    expect(changeTownEquipment(h.read, h.context, 'civilian-1', 'melee', 'paladin_sword_t4', () => {
      saves++; return true
    }).reason).toBe('no-available-item')
    expect(saves).toBe(0)
    expect(h.read()).toEqual(before)
  })
  it('redistributes one native sword in its authored squad and never recreates it at the origin on reload', () => {
    const h = harness(); h.context.safeActorIds = new Set(['gate:north:0', 'gate:north:7']); h.buy('centurion_blade')
    expect(h.bulk(1, 'sword').summary).toMatchObject({ equipped: 2, upgraded: 1 })
    const state = h.read().townEquipment!.roman!
    expect(state.actors['gate:north:0'].melee).toEqual({ itemId: 'centurion_blade', source: 'inventory' })
    expect(state.actors['gate:north:7'].melee).toEqual({
      itemId: 'gladius_standard', source: 'native', nativeId: 'roman/gate:north:0/melee',
    })
    // The archer keeps its active T2 bow while accepting the released T2 melee sword.
    expect(resolveTownActorEquipment(h.read(), 'roman', 'gate:north:7')).toMatchObject({ tier: 2,
      refs: { ranged: { itemId: 'recurve_longbow', source: 'native' } },
    })
    expect(careerItemTotal(h.read(), 'gladius_standard')).toBe(0)
    expect(h.reload().townEquipment!.roman).toEqual(state)
    expect(state.nativeReserve).not.toContain('roman/gate:north:0/melee')
  })
  it('does not borrow other squad stock, Player equipment, or an unsafe target member', () => {
    const h = harness(); h.buy('paladin_mace_t4', 2)
    const player = cloneCareerProfile(h.read()); player.equipment = { melee: 'paladin_mace_t4' }; h.set(player)
    expect(h.change('gate:north:0', 'melee', 'paladin_mace_t4').changed).toBe(true)
    h.context.safeActorIds = new Set(['civilian-0'])
    expect(h.bulk('civilian', 'axe').reason).toBe('no-available-item')
    expect(h.change('civilian-1', 'melee', 'paladin_mace_t4').reason).toBe('not-safe')
    expect(careerItemAllocated(h.read(), 'paladin_mace_t4')).toBe(2)
  })
  it.each(['captain', 'veteran'] as const)('rejects direct all-city API at %s even with Commander merit', rank => {
    const h = harness(); h.set({ ...h.read(), rank }); h.buy('paladin_sword_t4')
    expect(h.change('civilian-0', 'melee', 'paladin_sword_t4').reason).toBe('rank-locked')
    expect(h.bulk('civilian', 'sword').reason).toBe('rank-locked')
  })
  it('rolls back the complete bulk plan and persistent ownership on a failed final save', () => {
    const h = harness(); h.buy('paladin_sword_t4', 3); expect(h.store.save(h.read())).toBe(true)
    const before = cloneCareerProfile(h.read()), disk = h.store.load(); h.storage.failWrites = true
    expect(h.bulk('civilian', 'sword')).toMatchObject({ changed: false, reason: 'save-failed', changedActorIds: [], summary: { equipped: 0 } })
    expect(h.read()).toEqual(before); expect(h.store.load()).toEqual(disk)
    h.storage.failWrites = false
    expect(h.bulk('civilian', 'sword')).toMatchObject({ changed: true, changedActorIds: ['civilian-0', 'civilian-1'] })
    expect(careerItemAllocated(h.read(), 'paladin_sword_t4')).toBe(2)
    const committed = cloneCareerProfile(h.read())
    expect(h.reload()).toEqual(committed)
  })
  it('suppresses an implicit native owner after its shield is transferred in a sparse save', () => {
    const h = harness(), profile = h.read()
    const origin = resolveTownActorEquipment(profile, 'roman', 'gate:north:0').refs
    const recipient = resolveTownActorEquipment(profile, 'roman', 'gate:north:1').refs
    // The same profile was resolved above; the next scan must see its new ownership.
    profile.townEquipment = { roman: { version: 1, actors: {}, nativeReserve: ['roman/gate:north:0/shield'] } }
    expect(resolveTownActorEquipment(profile, 'roman', 'gate:north:0').refs.shield).toBeNull()
    profile.townEquipment = { roman: { version: 1, actors: {
      'gate:north:1': { ...recipient, shield: origin.shield },
    }, nativeReserve: ['roman/gate:north:1/shield'] } }
    expect(h.store.save(profile)).toBe(true)
    expect(resolveTownActorEquipment(profile, 'roman', 'gate:north:0').refs.shield).toBeNull()
    const restored = h.reload()
    expect(resolveTownActorEquipment(restored, 'roman', 'gate:north:0').refs.shield).toBeNull()
    expect(resolveTownActorEquipment(restored, 'roman', 'gate:north:1').refs.shield).toEqual({
      itemId: 'scutum_t2', source: 'native', nativeId: 'roman/gate:north:0/shield',
    })
  })
  it('durably migrates old Ranger native gear after resident migration and permits refits without minting inventory', () => {
    const h = harness('viking'), native = resolveTownActorEquipment(h.read(), 'viking', 'ranger').refs
    const legacy = cloneCareerProfile(h.read())
    legacy.townEquipment = { viking: { version: 1, residentEquipmentVersion: 1, actors: { ranger: {
      ...native, melee: { ...native.melee!, itemId: 'maki-ranger-bow' },
    } }, nativeReserve: [] } }
    const bytes = JSON.stringify(legacy)
    h.storage.setItem(CAREER_STORAGE_KEY, bytes); h.storage.failWrites = true
    expect(h.store.loadChecked()).toMatchObject({ profile: null, error: expect.any(String) })
    expect(h.storage.getItem(CAREER_STORAGE_KEY)).toBe(bytes)
    h.storage.failWrites = false
    const loaded = h.reload()
    expect(loaded.townEquipment!.viking!.actors.ranger.melee).toEqual({ itemId: 'viking_axe_t3', source: 'native', nativeId: 'viking/ranger/melee' })
    expect(careerItemTotal(loaded, 'viking_axe_t3')).toBe(0)
    expect(JSON.parse(h.storage.getItem(CAREER_STORAGE_KEY)!)).toEqual(loaded)
    h.storage.failWrites = true
    expect(h.store.load()).toEqual(loaded)
    h.storage.failWrites = false
    h.context.safeActorIds = new Set(['ranger', 'eagle-trainer']); h.buy('heavy_lance', 2)
    expect(h.change('ranger', 'melee', 'heavy_lance').changed).toBe(true)
    expect(h.change('eagle-trainer', 'melee', 'heavy_lance').changed).toBe(true)
    expect(availableCareerItem(h.read(), 'heavy_lance')).toBe(0)
    expect(h.read().townEquipment!.viking!.nativeReserve).toContain('viking/ranger/melee')
    expect(resolveTownActorEquipment(h.reload(), 'viking', 'ranger').loadout).toMatchObject({
      meleeWeaponId: 'heavy_lance', rangedWeaponId: 'maki-ranger-bow-ranged', mountId: 'black-cat', reversibleRangedSwitch: true,
    })
    expect(resolveTownActorEquipment(h.read(), 'viking', 'eagle-trainer').loadout).toMatchObject({
      meleeWeaponId: 'heavy_lance', rangedWeaponId: 'maki-ranger-bow-ranged', shieldId: null, mountId: null,
    })
  })
  it('rejects a save assigning the same native equipment token to two owners', () => {
    const h = harness(); h.buy('paladin_sword_t4'); h.change('gate:north:0', 'melee', 'paladin_sword_t4')
    const valid = cloneCareerProfile(h.read()), native = resolveTownActorEquipment(valid, 'roman', 'gate:north:1').refs.melee!
    const duplicate = cloneCareerProfile(valid); duplicate.townEquipment!.roman!.actors['gate:north:0'].melee = native
    duplicate.townEquipment!.roman!.actors['gate:north:1'] = { ...resolveTownActorEquipment(valid, 'roman', 'gate:north:1').refs }
    expect(parseCareerProfile(duplicate)).toBeNull()
    expect(h.store.load()).toEqual(valid)
  })
})

/** Native sale policies use pure domain fixtures and real JSON persistence, with zero actors/assets. */
function resaleHarness(faction: CareerProfile['faction'] = 'roman') {
  const h = harness(faction)
  const context: TownNativeSaleContext = { townFaction: faction, peaceful: true, playerAlive: true, merchantAvailable: true }
  return { ...h, saleContext: context,
    sell: (ids: string[], save = h.save) => sellTownNativeEquipment(h.read, () => context, ids, save),
    retire(actor = 'gate:north:0') {
      const token = resolveTownActorEquipment(h.read(), faction, actor).refs.melee!
      h.buy('paladin_sword_t4'); expect(h.change(actor, 'melee', 'paladin_sword_t4').changed).toBe(true)
      return token.nativeId!
    },
  }
}
/** Already-unloaded native stock is input to the merchant transaction, not a refit simulation. */
function unloadedNorthSwords() {
  const h = resaleHarness(); h.buy('paladin_sword_t4', 2)
  const first = resolveTownActorEquipment(h.read(), 'roman', 'gate:north:0').refs
  const second = resolveTownActorEquipment(h.read(), 'roman', 'gate:north:1').refs
  const profile = cloneCareerProfile(h.read())
  const ids = ['roman/gate:north:0/melee', 'roman/gate:north:1/melee']
  profile.townEquipment = { roman: { version: 1, actors: {
    'gate:north:0': { ...first, melee: { itemId: 'paladin_sword_t4', source: 'inventory' } },
    'gate:north:1': { ...second, melee: { itemId: 'paladin_sword_t4', source: 'inventory' } },
  }, nativeReserve: [...ids] } }
  h.set(profile)
  expect(h.store.save(profile)).toBe(true)
  return { h, ids }
}

describe('Commander native equipment resale and permanent token ownership', () => {
  it('sells an unloaded T2 sword once for 360 available merit and never adds it to Inventory', () => {
    const h = resaleHarness(), id = h.retire(), before = cloneCareerProfile(h.read())
    const result = h.sell([id])
    expect(result).toMatchObject({ sold: true, soldCount: 1, earnedMerit: 360 })
    expect(h.read().availableMerit).toBe(before.availableMerit + 360)
    expect(h.read().totalMerit).toBe(before.totalMerit)
    expect(h.read().townEquipment!.roman!.nativeReserve).not.toContain(id)
    expect(h.read().townEquipment!.roman!.soldNativeIds).toEqual([id])
    expect(careerItemTotal(h.read(), 'gladius_standard')).toBe(0)
    expect(h.sell([id])).toMatchObject({ sold: false, earnedMerit: 0 })
    expect(h.reload().availableMerit).toBe(before.availableMerit + 360)
  })
  it('rejects a native sale that would overflow available merit', () => {
    const h = resaleHarness(), id = h.retire()
    h.read().availableMerit = Number.MAX_SAFE_INTEGER
    const before = cloneCareerProfile(h.read())
    expect(h.sell([id])).toMatchObject({ sold: false, reason: 'invalid-quantity' })
    expect(h.read()).toEqual(before)

  })
  it('rejects resale of a native sword held by a different actor', () => {
    const h = resaleHarness(); h.buy('paladin_sword_t4')
    // A valid sparse saved transfer is the input; bulk allocation has its own owner above.
    const origin = resolveTownActorEquipment(h.read(), 'roman', 'gate:north:0').refs
    const recipient = resolveTownActorEquipment(h.read(), 'roman', 'gate:north:7').refs
    const transferred = cloneCareerProfile(h.read())
    transferred.townEquipment = { roman: { version: 1,
      actors: {
        'gate:north:0': { ...origin, melee: { itemId: 'paladin_sword_t4', source: 'inventory' } },
        'gate:north:7': { ...recipient, melee: origin.melee },
      },
      nativeReserve: ['roman/gate:north:7/melee'],
    } }
    h.set(transferred)
    expect(h.store.save(transferred)).toBe(true)
    const before = cloneCareerProfile(h.read()), durableBefore = h.saved()
    expect(h.sell(['roman/gate:north:0/melee'])).toMatchObject({ sold: false, reason: 'invalid-token', earnedMerit: 0 })
    expect(h.read()).toEqual(before)
    expect(h.saved()).toBe(durableBefore)
  })
  it.each(['false', 'throw'] as const)('rolls back all tokens and merit on a %s save failure, then permits retry', failure => {
    const { h, ids } = unloadedNorthSwords()
    const before = cloneCareerProfile(h.read()), disk = h.saved()
    h.storage.failWrites = true
    const save = failure === 'throw' ? () => { throw new Error('quota') } : h.save
    expect(h.sell(ids, save)).toMatchObject({ sold: false, reason: 'save-failed', earnedMerit: 0, soldCount: 0 })
    expect(h.read()).toEqual(before); expect(h.saved()).toBe(disk)
    h.storage.failWrites = false
    expect(h.sell(ids)).toMatchObject({ sold: true, soldCount: 2, earnedMerit: 720 })
    expect(JSON.parse(h.saved()!).townEquipment.roman.soldNativeIds).toEqual(ids)
    expect(h.read().availableMerit).toBe(before.availableMerit + 720)
  })
  it('excludes Ranger native weapons and rejects invalid bulk requests without selling valid tokens', () => {
    const h = resaleHarness(); h.retire(); h.buy('steel_sword')
    const ranger = resolveTownActorEquipment(h.read(), 'roman', 'ranger').refs
    const unloaded = cloneCareerProfile(h.read())
    unloaded.townEquipment!.roman!.actors.ranger = {
      ...ranger, melee: { itemId: 'steel_sword', source: 'inventory' }, ranged: null,
    }
    unloaded.townEquipment!.roman!.nativeReserve.push('roman/ranger/melee', 'roman/ranger/ranged')
    expect(h.save(unloaded)).toBe(true)
    const request = [{ itemId: 'gladius_standard', quantity: 1 }]
    const before = cloneCareerProfile(h.read()), durableBefore = h.saved()
    const stock = townNativeSaleStock(h.read(), 'roman').flatMap(item => item.nativeIds)
    expect(stock).not.toContain('roman/ranger/melee')
    expect(stock).not.toContain('roman/ranger/ranged')
    expect(sellTownNativeProducts(h.read, () => h.saleContext, [...request, { itemId: 'maki-ranger-bow-ranged', quantity: 1 }], h.save).sold).toBe(false)
    expect(sellTownNativeProducts(h.read, () => h.saleContext, [...request, { itemId: 'missing', quantity: 1 }], h.save).sold).toBe(false)
    expect(h.read()).toEqual(before)
    expect(h.saved()).toBe(durableBefore)
  })
})

describe('Resident native equipment and military horse ownership', () => {
  it('keeps merchant weapons fixed while allocating, releasing and rolling back a purchased horse', () => {
    const h = harness(); h.context.safeActorIds = new Set(['merchant', 'civilian-0'])
    const merchant = resolveTownActorEquipment(h.read(), 'roman', 'merchant')
    expect(merchant).toMatchObject({ readOnly: false, fixedWeapons: true, loadout: {
      meleeWeaponId: 'sword_t5', secondaryMeleeWeaponId: 'axe_t5', shieldId: 'paladin_shield_t4', rangedWeaponId: null, mountId: null,
    } })
    expect(careerItemTotal(h.read(), 'sword_t5')).toBe(0)
    expect(h.change('merchant', 'melee', 'paladin_sword_t4').reason).toBe('fixed-equipment')
    expect(h.change('merchant', 'shield', null).reason).toBe('fixed-equipment')
    expect(h.change('merchant', 'ranged', 'bow_t5').reason).toBe('fixed-equipment')
    expect(h.change('merchant', 'mount', 'black-cat').reason).toBe('invalid-item')
    expect(h.change('merchant', 'mount', 'horse').reason).toBe('no-available-item')
    h.buy('horse')
    const before = cloneCareerProfile(h.read()); h.storage.failWrites = true
    expect(h.change('merchant', 'mount', 'horse').reason).toBe('save-failed')
    expect(h.read()).toEqual(before)
    h.storage.failWrites = false
    expect(h.change('merchant', 'mount', 'horse').changed).toBe(true)
    expect(careerItemAllocated(h.read(), 'horse')).toBe(1)
    expect(h.change('civilian-0', 'mount', 'horse').reason).toBe('no-available-item')
    expect(resolveTownActorEquipment(h.reload(), 'roman', 'merchant').loadout.mountId).toBe('horse')
    expect(h.change('merchant', 'mount', null).changed).toBe(true)
    expect(availableCareerItem(h.read(), 'horse')).toBe(1)
  })

  it('durably upgrades resident tokens after Ranger migration without disturbing purchases, mounts or sales', () => {
    const h = harness(); h.buy('horse'); h.buy('sword_t5'); h.buy('heavy_lance')
    h.read().personalSquad = { members: [{ id: 'personal:ranger', type: 'ranger', originalHirePrice: 500, rangerEquipmentVersion: 1,
      equipment: { melee: 'heavy_lance', ranged: null, shield: null, mount: null } }] }
    const guard = resolveTownActorEquipment(h.read(), 'roman', 'gate:north:0').refs
    h.read().townEquipment = { roman: { version: 1, actors: {
      merchant: { melee: { itemId: 'paladin_sword_t4', source: 'native', nativeId: 'roman/merchant/melee' },
        shield: { itemId: 'paladin_shield_t4', source: 'native', nativeId: 'roman/merchant/shield' }, ranged: null, mount: null },
      'civilian-0': { melee: null, ranged: null, shield: null, mount: { itemId: 'horse', source: 'inventory' } },
      'civilian-1': { melee: { itemId: 'sword_t5', source: 'inventory' }, ranged: null, shield: null, mount: null },
      'civilian-2': { melee: null, ranged: null, shield: null, mount: null },
      'gate:north:0': guard,
    }, nativeReserve: [], soldNativeIds: ['roman/civilian-2/melee'] } }
    const original = cloneCareerProfile(h.read()), bytes = JSON.stringify(original)
    h.storage.setItem(CAREER_STORAGE_KEY, bytes); h.storage.failWrites = true
    expect(h.store.loadChecked()).toMatchObject({ profile: null, error: expect.any(String) })
    expect(h.storage.getItem(CAREER_STORAGE_KEY)).toBe(bytes)
    h.storage.failWrites = false
    const loaded = h.reload()
    expect(loaded).not.toBeNull()
    const state = loaded.townEquipment!.roman!
    expect(state.residentEquipmentVersion).toBe(1)
    expect(state.actors.merchant.melee?.itemId).toBe('sword_t5')
    expect(state.actors['civilian-0']).toMatchObject({ melee: { itemId: 'gladius_rusty', source: 'native', nativeId: 'roman/civilian-0/melee' },
      mount: { itemId: 'horse', source: 'inventory' } })
    expect(state.actors['civilian-1'].melee).toEqual({ itemId: 'sword_t5', source: 'inventory' })
    expect(state.nativeReserve).toEqual(['roman/civilian-1/melee'])
    expect(state.actors['civilian-2'].melee).toBeNull()
    expect(state.actors['gate:north:0']).toEqual(guard)
    expect(loaded.inventory).toEqual(original.inventory)
    expect(loaded.personalSquad).toEqual(original.personalSquad)
    expect(original.townEquipment!.roman!.actors.merchant.melee?.itemId).toBe('paladin_sword_t4')
    expect(JSON.parse(h.storage.getItem(CAREER_STORAGE_KEY)!)).toEqual(loaded)
    h.storage.failWrites = true
    expect(h.store.loadChecked().profile).toEqual(loaded)
  })

  it('retains each civilian native token in reserve or sold ownership after deliberate unequip and reload', () => {
    const h = resaleHarness()
    const defaults = Array.from({ length: 20 }, (_, i) => resolveTownActorEquipment(h.read(), 'roman', `civilian-${i}`))
    expect(new Set(defaults.map(actor => actor.refs.melee?.nativeId)).size).toBe(20)
    expect(defaults.every(actor => actor.refs.melee?.itemId === 'gladius_rusty' && actor.tier === 1)).toBe(true)
    expect(careerItemTotal(h.read(), 'gladius_rusty')).toBe(0)
    expect(h.change('civilian-0', 'melee', null).changed).toBe(true)
    const id = 'roman/civilian-0/melee'
    expect(h.reload().townEquipment!.roman!.nativeReserve).toContain(id)
    expect(resolveTownActorEquipment(h.read(), 'roman', 'civilian-0').refs.melee).toBeNull()
    expect(h.sell([id]).sold).toBe(true)
    expect(resolveTownActorEquipment(h.reload(), 'roman', 'civilian-0').refs.melee).toBeNull()
    expect(h.read().townEquipment!.roman!.nativeReserve).not.toContain(id)
    expect(h.read().townEquipment!.roman!.soldNativeIds).toEqual([id])
    expect(h.sell(['roman/merchant/melee']).sold).toBe(false)
  })
})
