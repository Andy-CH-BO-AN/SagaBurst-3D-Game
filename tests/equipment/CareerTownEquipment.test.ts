import { personalSquadFixture } from '../helpers/personalSquadFixture'
import { careerRankFixture } from '../helpers/careerRankFixture'
import { TownEquipment } from '../../src/town/TownEquipment'
import { createCareerDuelMission } from '../../src/career/CareerDuelState'
import { describe, expect, it } from 'vitest'
import { addCareerItem, availableCareerItem, careerItemAllocated, careerItemTotal, normalizeCareerInventory } from '../../src/career/CareerInventory'
import { cloneCareerProfile, createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore, parseCareerProfile } from '../../src/career/CareerProfileStore'
import { bulkCareerEquipment, changeTownEquipment, resolveTownActorEquipment, type TownEquipmentContext } from '../../src/career/CareerTownEquipment'
import { sellTownNativeProducts, townNativeSaleStock, type TownNativeSaleContext } from '../../src/career/CareerTownNativeResale'
import { MemoryStorage } from '../helpers/memoryStorage'

/** Real domain and JSON storage; zero NPC/Mount/TownWorld/asset construction. */
function harness(faction: CareerProfile['faction'] = 'roman') {
  // Already received (and may have sold) the rank reward; this suite isolates native ownership.
  let profile: CareerProfile = { ...createCareerProfile(faction), ...careerRankFixture(faction, 'commander'), rank: 'commander', commanderMeleeGranted: true, totalMerit: 60000, availableMerit: 60000 }
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
  it('bulk refit never downgrades or restocks the deployment officer\'s untouched T5 lance across factions', () => {
    for (const [faction, melee, t4Stock] of [['roman', 'sword', 'paladin_sword_t4'], ['viking', 'axe', 'paladin_mace_t4']] as const) {
      const h = harness(faction); h.context.safeActorIds = new Set(['deployment']); h.buy('spear_t4'); h.buy(t4Stock)
      const lance = resolveTownActorEquipment(h.read(), faction, 'deployment').loadout.meleeWeaponId
      for (const category of ['spear', melee] as const) expect(h.bulk(1, category)).toMatchObject({ changed: false, changedActorIds: [] })
      expect(h.read().townEquipment).toBeUndefined()
      expect([availableCareerItem(h.read(), 'spear_t4'), availableCareerItem(h.read(), t4Stock)]).toEqual([1, 1])
      expect(resolveTownActorEquipment(h.read(), faction, 'deployment').loadout.meleeWeaponId).toBe(lance)
    }
  })
  it('lets the deployment officer switch from its T5 lance to the T4 weapon its native token records across factions, only from available stock', () => {
    for (const [faction, t4] of [['roman', 'paladin_sword_t4'], ['viking', 'paladin_mace_t4']] as const) {
      const h = harness(faction); h.context.safeActorIds = new Set(['deployment'])
      const native = resolveTownActorEquipment(h.read(), faction, 'deployment')
      expect(native.refs.melee).toMatchObject({ itemId: t4, source: 'native', nativeId: `${faction}/deployment/melee` })
      expect(native.loadout.meleeWeaponId).not.toBe(t4)
      expect(h.change('deployment', 'melee', t4)).toMatchObject({ changed: false, reason: 'no-available-item' })
      expect(h.read().townEquipment).toBeUndefined()
      h.buy(t4)
      expect(h.change('deployment', 'melee', t4)).toMatchObject({ changed: true, changedActorIds: ['deployment'] })
      const loaded = h.reload()
      expect(resolveTownActorEquipment(loaded, faction, 'deployment')).toMatchObject({ refs: { melee: { itemId: t4, source: 'inventory' } }, loadout: { meleeWeaponId: t4 } })
      expect(loaded.townEquipment![faction]!.nativeReserve).toContain(`${faction}/deployment/melee`)
      expect([careerItemTotal(loaded, t4), availableCareerItem(loaded, t4)]).toEqual([1, 0])
      expect(h.change('deployment', 'melee', t4)).toMatchObject({ changed: false, reason: 'no-op' })
    }
  })
  it('still refits a manually equipped deployment officer by the weapon actually held', () => {
    const h = harness(); h.context.safeActorIds = new Set(['deployment']); h.buy('spear_t4'); h.buy('spear_t5')
    expect(h.change('deployment', 'melee', 'spear_t4').changed).toBe(true)
    expect(h.bulk(1, 'spear')).toMatchObject({ changed: true, changedActorIds: ['deployment'], summary: { upgraded: 1 } })
    expect(resolveTownActorEquipment(h.read(), 'roman', 'deployment').loadout.meleeWeaponId).toBe('spear_t5')
  })
  it('keeps a deliberately emptied deployment mount empty once the marker exists', () => {
    const h = harness('viking'), profile = h.read(), deployment = resolveTownActorEquipment(profile, 'viking', 'deployment')
    profile.townEquipment = { viking: { version: 2,
      nativeReserve: ['viking/deployment/mount'], actors: { deployment: { ...deployment.refs, mount: null } } } }
    expect(h.save(profile)).toBe(true)
    const loaded = h.reload()
    expect(loaded.townEquipment!.viking!.actors.deployment.mount).toBeNull()
    expect(resolveTownActorEquipment(loaded, 'viking', 'deployment').loadout).toMatchObject({ meleeWeaponId: 'spear_t5', mountId: null })
    expect(h.reload()).toEqual(loaded)
  })

  it('counts Player, HR, Town and Civilian in one quantity pool and refuses another claimant', () => {
    const h = harness(); h.buy('paladin_sword_t4', 4)
    const next = cloneCareerProfile(h.read())
    const guard = resolveTownActorEquipment(next, 'roman', 'gate:north:0').refs
    next.equipment = { melee: 'paladin_sword_t4' }
    next.personalSquad = personalSquadFixture(next, [{ id: 'personal:test', type: 'soldier', originalHirePrice: 50,
      equipment: { melee: 'paladin_sword_t4', ranged: null, shield: null, mount: null } }])
    next.townEquipment = { roman: { version: 2, actors: {
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
    // Absorbed from #671: returning an allocated copy restores the pool for another claimant
    next.equipment = {}
    h.set(next)
    expect(availableCareerItem(h.read(), 'paladin_sword_t4')).toBe(1)
    expect(h.change('civilian-1', 'melee', 'paladin_sword_t4').changed).toBe(true)
    expect(availableCareerItem(h.read(), 'paladin_sword_t4')).toBe(0)
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
  it.each(['captain'] as const)('rejects direct all-city API at %s even with Commander merit', rank => {
    const h = harness(); h.set({ ...h.read(), ...careerRankFixture((h.read()).faction, rank), rank }); h.buy('paladin_sword_t4')
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
    profile.townEquipment = { roman: { version: 2, actors: {}, nativeReserve: ['roman/gate:north:0/shield'] } }
    expect(resolveTownActorEquipment(profile, 'roman', 'gate:north:0').refs.shield).toBeNull()
    profile.townEquipment = { roman: { version: 2, actors: {
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
  it('refits Ranger native gear with ordinary melee weapons without minting inventory', () => {
    const h = harness('viking')
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
    sell: (itemId: string, quantity = 1, save = h.save) => sellTownNativeProducts(h.read, () => context, [{ itemId, quantity }], save),
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
  profile.townEquipment = { roman: { version: 2, actors: {
    'gate:north:0': { ...first, melee: { itemId: 'paladin_sword_t4', source: 'inventory' } },
    'gate:north:1': { ...second, melee: { itemId: 'paladin_sword_t4', source: 'inventory' } },
  }, nativeReserve: [...ids] } }
  h.set(profile)
  expect(h.store.save(profile)).toBe(true)
  return { h, ids }
}

describe('Commander native equipment resale and permanent token ownership', () => {
  it('sells unloaded native sword for merit, rejecting overflow, invalid holders and save failure', () => {
    const h = resaleHarness(), id = h.retire(), before = cloneCareerProfile(h.read())
    const result = h.sell('gladius_standard')
    expect(result).toMatchObject({ sold: true, soldCount: 1, earnedMerit: 360 })
    expect(h.read().availableMerit).toBe(before.availableMerit + 360)
    expect(h.read().totalMerit).toBe(before.totalMerit)
    expect(h.read().townEquipment!.roman!.nativeReserve).not.toContain(id)
    expect(h.read().townEquipment!.roman!.soldNativeIds).toEqual([id])
    expect(careerItemTotal(h.read(), 'gladius_standard')).toBe(0)
    expect(h.sell('gladius_standard')).toMatchObject({ sold: false, earnedMerit: 0 })
    expect(h.reload().availableMerit).toBe(before.availableMerit + 360)

    // Overflow rejection
    const overflowH = resaleHarness(); overflowH.retire()
    overflowH.read().availableMerit = Number.MAX_SAFE_INTEGER
    const overflowBefore = cloneCareerProfile(overflowH.read())
    expect(overflowH.sell('gladius_standard')).toMatchObject({ sold: false, reason: 'invalid-quantity' })
    expect(overflowH.read()).toEqual(overflowBefore)

    // Rejection of held native sword
    h.buy('paladin_sword_t4')
    const origin = resolveTownActorEquipment(h.read(), 'roman', 'gate:north:0').refs
    const recipient = resolveTownActorEquipment(h.read(), 'roman', 'gate:north:7').refs
    const transferred = cloneCareerProfile(h.read())
    transferred.townEquipment = { roman: { version: 2,
      actors: {
        'gate:north:0': { ...origin, melee: { itemId: 'paladin_sword_t4', source: 'inventory' } },
        'gate:north:7': { ...recipient, melee: origin.melee },
      },
      nativeReserve: ['roman/gate:north:7/melee'],
    } }
    h.set(transferred)
    const selected = h.sell('gladius_standard')
    expect(selected).toMatchObject({ sold: false, reason: 'invalid-token', earnedMerit: 0 })

    // Rollback on save failure
    const { h: failH, ids } = unloadedNorthSwords()
    const failBefore = cloneCareerProfile(failH.read()), disk = failH.saved()
    failH.storage.failWrites = true
    expect(failH.sell('gladius_standard', ids.length)).toMatchObject({ sold: false, reason: 'save-failed', earnedMerit: 0, soldCount: 0 })
    expect(failH.read()).toEqual(failBefore); expect(failH.saved()).toBe(disk)
    failH.storage.failWrites = false
    expect(failH.sell('gladius_standard', ids.length)).toMatchObject({ sold: true, soldCount: 2, earnedMerit: 720 })
    expect(failH.read().availableMerit).toBe(failBefore.availableMerit + 720)
  })
  it('selects one canonical token for a product and rejects a stale whole-batch quantity without a partial sale', () => {
    const { h, ids } = unloadedNorthSwords(), expected = [...ids].sort()
    const first = h.sell('gladius_standard')
    expect(first).toMatchObject({ sold: true, soldCount: 1, earnedMerit: 360 })
    expect(h.reload().townEquipment!.roman!.soldNativeIds).toEqual([expected[0]])
    expect(h.read().townEquipment!.roman!.nativeReserve).toContain(expected[1])
    const before = cloneCareerProfile(h.read()), disk = h.saved()
    expect(h.sell('gladius_standard', 2)).toMatchObject({ sold: false, soldCount: 0, earnedMerit: 0 })
    expect(h.read()).toEqual(before)
    expect(h.saved()).toBe(disk)
    expect(resolveTownActorEquipment(h.reload(), 'roman', 'gate:north:0').refs.melee?.source).toBe('inventory')
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
  it('keeps merchant weapons fixed while allocating, releasing and rolling back purchased mounts', () => {
    const h = harness(); h.context.safeActorIds = new Set(['merchant', 'civilian-0'])
    const merchant = resolveTownActorEquipment(h.read(), 'roman', 'merchant')
    expect(merchant).toMatchObject({ readOnly: false, fixedWeapons: true, loadout: {
      meleeWeaponId: 'sword_t5', secondaryMeleeWeaponId: 'axe_t5', shieldId: 'byzantine_eagle_shield_t5', rangedWeaponId: null, mountId: null,
    } })
    expect(careerItemTotal(h.read(), 'sword_t5')).toBe(0)
    expect(h.change('merchant', 'melee', 'paladin_sword_t4').reason).toBe('fixed-equipment')
    expect(h.change('merchant', 'shield', null).reason).toBe('fixed-equipment')
    expect(h.change('merchant', 'ranged', 'bow_t5').reason).toBe('fixed-equipment')
    h.buy('xongkoro')
    expect(h.change('merchant', 'mount', 'xongkoro').reason).toBe('invalid-item')
    expect(h.change('merchant', 'mount', 'horse').reason).toBe('no-available-item')
    h.buy('horse'); h.buy('black-cat')
    const before = cloneCareerProfile(h.read()); h.storage.failWrites = true
    expect(h.change('merchant', 'mount', 'horse').reason).toBe('save-failed')
    expect(h.read()).toEqual(before)
    h.storage.failWrites = false
    expect(h.change('merchant', 'mount', 'horse').changed).toBe(true)
    expect(careerItemAllocated(h.read(), 'horse')).toBe(1)
    expect(h.change('civilian-0', 'mount', 'horse').reason).toBe('no-available-item')
    expect(resolveTownActorEquipment(h.reload(), 'roman', 'merchant').loadout.mountId).toBe('horse')
    expect(h.change('merchant', 'mount', 'black-cat').changed).toBe(true)
    expect(availableCareerItem(h.read(), 'horse')).toBe(1)
    expect(resolveTownActorEquipment(h.reload(), 'roman', 'merchant').loadout.mountId).toBe('black-cat')
    expect(h.change('merchant', 'mount', null).changed).toBe(true)
    expect(availableCareerItem(h.read(), 'black-cat')).toBe(1)
  })

  it('migrates legacy saved paladin_shield_t4 on merchant to byzantine_eagle_shield_t5', () => {
    const h = harness()
    h.buy('black-cat')
    const legacy = cloneCareerProfile(h.read())
    legacy.townEquipment = {
      roman: {
        version: 2,
        nativeReserve: [],
        actors: {
          merchant: {
            melee: { itemId: 'sword_t5', source: 'native', nativeId: 'roman/merchant/melee' },
            ranged: null,
            shield: { itemId: 'paladin_shield_t4', source: 'native', nativeId: 'roman/merchant/shield' },
            mount: { itemId: 'black-cat', source: 'inventory' },
          },
        },
      },
    }
    h.save(h.read())
    h.storage.setItem(h.storage.key(0)!, JSON.stringify(legacy))
    const reloaded = resolveTownActorEquipment(h.reload(), 'roman', 'merchant')
    expect(reloaded.loadout.shieldId).toBe('byzantine_eagle_shield_t5')
    expect(reloaded.loadout.mountId).toBe('black-cat')
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
    expect(h.sell('gladius_rusty').sold).toBe(true)
    expect(resolveTownActorEquipment(h.reload(), 'roman', 'civilian-0').refs.melee).toBeNull()
    expect(h.read().townEquipment!.roman!.nativeReserve).not.toContain(id)
    expect(h.read().townEquipment!.roman!.soldNativeIds).toEqual([id])
    expect(h.sell('sword_t5').sold).toBe(false)
  })
})


it('空手 Duel 以空手開始，但允許明確換裝與卸下；保存失敗仍保持空手', () => {
  let profile = createCareerProfile('roman')
  Object.assign(profile.inventory!.quantities, Object.fromEntries(['steel_lance'].map(id => [id, 1]))); profile.ownedWeapons = ['steel_lance']; profile.equipment = { melee: 'steel_lance' }
  let saveAllowed = true
  const commit = (next: CareerProfile) => { if (!saveAllowed) return false; profile = next; return true }
  const equipment = new TownEquipment(() => profile, commit)
  equipment.prepareForCombat()
  expect(equipment.activeMelee?.id).toBe('steel_lance')
  const before = JSON.stringify(profile.equipment)
  profile.activeMission = createCareerDuelMission(profile, 'roman_archer', 1, 'soldier', 'captain', 'boxing', 'captain', 'unarmed')!
  expect(equipment.activeMelee).toBeUndefined()
  expect(equipment.meleeEnabled || equipment.rangedEnabled || equipment.shieldEnabled).toBe(false)
  saveAllowed = false
  expect(equipment.equipWeapon('steel_lance')).toBe(false)
  expect(equipment.activeMelee).toBeUndefined()
  expect(JSON.stringify(profile.equipment)).toBe(before)
  saveAllowed = true
  expect(equipment.canEquipWeapon('steel_lance')).toBe(true)
  expect(equipment.equipWeapon('steel_lance')).toBe(true)
  expect(equipment.activeMelee?.id).toBe('steel_lance')
  expect(profile.activeMission?.duelFailureReason).toBeUndefined()
  expect(equipment.unequipWeapon('steel_lance')).toBe(true)
  expect(equipment.activeMelee).toBeUndefined()
  expect(equipment.equipWeapon('steel_lance')).toBe(true)
  profile = parseCareerProfile(JSON.parse(JSON.stringify(profile)))!
  const reloaded = new TownEquipment(() => profile, commit)
  reloaded.prepareForCombat()
  expect(reloaded.activeMelee).toBeUndefined()
  delete profile.activeMission
  equipment.prepareForCombat(); reloaded.prepareForCombat()
  expect(equipment.activeMelee?.id).toBe('steel_lance')
  expect(reloaded.activeMelee?.id).toBe('steel_lance')
  expect(profile.ownedWeapons).toContain('steel_lance')
  equipment.dispose(); reloaded.dispose()
})
