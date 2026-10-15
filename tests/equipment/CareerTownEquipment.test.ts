import { describe, expect, it } from 'vitest'
import { addCareerItem, availableCareerItem, careerItemAllocated, careerItemTotal, normalizeCareerInventory } from '../../src/career/CareerInventory'
import { recruitPersonalSquadMember } from '../../src/career/CareerPersonalSquad'
import { cloneCareerProfile, createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore, parseCareerProfile } from '../../src/career/CareerProfileStore'
import {
  bulkCareerEquipment, changeTownEquipment,
  resolveTownActorEquipment,
  townEquipmentSquads,
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
    safeActorIds: new Set(townEquipmentSquads(profile).flatMap(squad => [...squad.actorIds])) }
  return { read, save, store, storage, context, set: (next: CareerProfile) => { profile = next },
    buy: (id: string, count = 1) => addCareerItem(profile, id, count),
    change: (actor: string, slot: 'melee' | 'ranged' | 'shield' | 'mount', id: string | null) => changeTownEquipment(read, context, actor, slot, id, save),
    bulk: (target: Parameters<typeof bulkCareerEquipment>[2], category: Parameters<typeof bulkCareerEquipment>[3]) => bulkCareerEquipment(read, context, target, category, save),
    hire(type: 'soldier' | 'captain' | 'ranger' = 'soldier') { const result = recruitPersonalSquadMember(profile, type, save, () => `personal:${profile.personalSquad?.members.length ?? 0}`); expect(result.recruited).toBe(true); return profile.personalSquad!.members.at(-1)!.id },
    reload() { profile = store.load()!; return profile },
  }
}
describe('Town equipment domain, canonical ownership and persisted native sources', () => {
  it('rolls back the bow and displaced native shield together when JSON storage fails, then allows a clean retry', () => {
    const h = harness(); h.context.safeActorIds = new Set(['gate:north:0']); h.buy('elven_runebow')
    const shield = resolveTownActorEquipment(h.read(), 'roman', 'gate:north:0').refs.shield!
    expect(shield.source).toBe('native'); expect(h.store.save(h.read())).toBe(true)
    const before = cloneCareerProfile(h.read()); h.storage.failWrites = true
    expect(h.bulk(1, 'bow')).toMatchObject({ changed: false, reason: 'save-failed', changedActorIds: [], summary: { equipped: 0, upgraded: 0 } })
    expect(h.read()).toEqual(before); expect(h.store.load()).toEqual(before)
    expect(availableCareerItem(h.read(), 'elven_runebow')).toBe(1)
    h.storage.failWrites = false
    expect(h.bulk(1, 'bow').changedActorIds).toEqual(['gate:north:0'])
    expect(h.read().townEquipment!.roman!.nativeReserve).toContain(shield.nativeId)
    expect(availableCareerItem(h.read(), 'elven_runebow')).toBe(0)
    const committed = cloneCareerProfile(h.read()); expect(h.reload()).toEqual(committed)
  })
  it('counts Player, HR, Town and Civilian in one quantity pool and refuses another claimant', () => {
    const h = harness(), member = h.hire(); h.buy('paladin_sword_t4', 4)
    const next = cloneCareerProfile(h.read()); next.equipment = { melee: 'paladin_sword_t4' }
    next.personalSquad!.members[0].equipment!.melee = 'paladin_sword_t4'; h.set(next)
    expect(h.change('gate:north:0', 'melee', 'paladin_sword_t4').changed).toBe(true)
    expect(h.change('civilian-0', 'melee', 'paladin_sword_t4').changed).toBe(true)
    expect(careerItemAllocated(h.read(), 'paladin_sword_t4')).toBe(4); expect(availableCareerItem(h.read(), 'paladin_sword_t4')).toBe(0)
    expect(h.change('civilian-1', 'melee', 'paladin_sword_t4').reason).toBe('no-available-item')
    expect(h.read().personalSquad!.members[0].id).toBe(member)
    expect(h.reload().inventory!.quantities.paladin_sword_t4).toBe(4)
  })
  it('redistributes one native sword in its authored squad and never recreates it at the origin on reload', () => {
    const h = harness(), squad = townEquipmentSquads(h.read())[0]
    const actors = squad.actorIds.map(id => resolveTownActorEquipment(h.read(), 'roman', id))
    const a = actors.find(actor => actor.refs.melee?.itemId === 'gladius_standard')!
    const b = actors.find(actor => actor.refs.melee?.itemId === 'gladius_rusty')!
    h.context.safeActorIds = new Set([a.spec.id, b.spec.id]); h.buy('centurion_blade')
    const origin = a.refs.melee!.nativeId!
    // This squad's native T1 sword belongs to an archer: improving its melee does not improve its active T2 weapon.
    expect(a.tier).toBe(2); expect(b.tier).toBe(2); expect(b.refs.ranged?.itemId).toBe('recurve_longbow')
    expect(h.bulk(1, 'sword').summary).toMatchObject({ equipped: 2, upgraded: 1 })
    expect(resolveTownActorEquipment(h.read(), 'roman', a.spec.id).tier).toBe(3)
    expect(resolveTownActorEquipment(h.read(), 'roman', b.spec.id)).toMatchObject({ tier: 2, refs: { ranged: b.refs.ranged } })
    expect(resolveTownActorEquipment(h.read(), 'roman', a.spec.id).refs.melee).toEqual({ itemId: 'centurion_blade', source: 'inventory' })
    expect(resolveTownActorEquipment(h.read(), 'roman', b.spec.id).refs.melee?.nativeId).toBe(origin)
    expect(careerItemTotal(h.read(), 'gladius_standard')).toBe(0)
    h.reload()
    expect(resolveTownActorEquipment(h.read(), 'roman', b.spec.id).refs.melee?.nativeId).toBe(origin)
    expect(resolveTownActorEquipment(h.read(), 'roman', a.spec.id).refs.melee?.source).toBe('inventory')
    expect(h.bulk(1, 'sword').reason).toBe('no-op')
    expect(h.read().townEquipment!.roman!.nativeReserve).not.toContain(origin)

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
    sellProduct: (itemId: string, quantity: number) => sellTownNativeProducts(h.read, () => context, [{ itemId, quantity }], h.save),
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
  it('rejects a transferred native sword until its recipient actually unloads it', () => {
    const h = resaleHarness(), squad = townEquipmentSquads(h.read())[0]
    const actors = squad.actorIds.map(id => resolveTownActorEquipment(h.read(), 'roman', id))
    const a = actors.find(actor => actor.refs.melee?.itemId === 'gladius_standard')!, b = actors.find(actor => actor.refs.melee?.itemId === 'gladius_rusty')!
    const id = a.refs.melee!.nativeId!
    h.context.safeActorIds = new Set([a.spec.id, b.spec.id]); h.buy('centurion_blade')
    expect(h.bulk(1, 'sword').changed).toBe(true)
    expect(resolveTownActorEquipment(h.read(), 'roman', b.spec.id).refs.melee?.nativeId).toBe(id)
    expect(h.sell([id]).sold).toBe(false)
    h.buy('paladin_sword_t4'); expect(h.change(b.spec.id, 'melee', 'paladin_sword_t4').changed).toBe(true)
    expect(h.sell([id]).earnedMerit).toBe(360)
    expect(h.reload().townEquipment!.roman!.soldNativeIds).toEqual([id])
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
