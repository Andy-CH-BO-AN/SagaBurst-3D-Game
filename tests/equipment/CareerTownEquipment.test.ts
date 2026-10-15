import { describe, expect, it } from 'vitest'
import { addCareerItem, availableCareerItem, careerItemAllocated, careerItemTotal, normalizeCareerInventory } from '../../src/career/CareerInventory'
import { cloneCareerProfile, createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore, parseCareerProfile } from '../../src/career/CareerProfileStore'
import {
  bulkCareerEquipment, changeTownEquipment,
  resolveTownActorEquipment,
  type TownEquipmentContext
} from '../../src/career/CareerTownEquipment'
import { sellTownNativeEquipment, sellTownNativeProducts, type TownNativeSaleContext } from '../../src/career/CareerTownNativeResale'
import { MemoryStorage } from '../helpers/memoryStorage'

/** Real domain and JSON storage; zero NPC/Mount/TownWorld/asset construction. */
function harness(faction: CareerProfile['faction'] = 'roman') {
  let profile: CareerProfile = { ...createCareerProfile(faction), rank: 'commander', totalMerit: 60000, availableMerit: 60000 }
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
    expect(h.store.save(h.read())).toBe(true)
    const before = cloneCareerProfile(h.read()), durableBefore = h.saved()
    let staged: CareerProfile | undefined
    let saves = 0
    h.storage.failWrites = true
    const result = bulkCareerEquipment(h.read, h.context, 1, 'bow', next => {
      saves++; staged = next
      return h.save(next)
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
    const h = resaleHarness(), ids = [h.retire('gate:north:0'), h.retire('gate:north:1')]
    const before = cloneCareerProfile(h.read()), disk = h.store.load()
    h.storage.failWrites = true
    const save = failure === 'throw' ? () => { throw new Error('quota') } : h.save
    expect(h.sell(ids, save)).toMatchObject({ sold: false, reason: 'save-failed', earnedMerit: 0, soldCount: 0 })
    expect(h.read()).toEqual(before); expect(h.store.load()).toEqual(disk)
    h.storage.failWrites = false
    expect(h.sell(ids)).toMatchObject({ sold: true, soldCount: 2, earnedMerit: 720 })
    expect(h.reload().townEquipment!.roman!.soldNativeIds).toEqual([...ids].sort())
  })
  it('rejects an invalid product in a bulk request without selling its valid token', () => {
    const h = resaleHarness(); h.retire()
    const request = [{ itemId: 'gladius_standard', quantity: 1 }]
    const before = cloneCareerProfile(h.read())
    expect(sellTownNativeProducts(h.read, () => h.saleContext, [...request, { itemId: 'missing', quantity: 1 }], h.save).sold).toBe(false)
    expect(h.read()).toEqual(before)
  })
})
