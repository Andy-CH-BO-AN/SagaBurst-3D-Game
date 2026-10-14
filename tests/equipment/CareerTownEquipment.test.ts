import { describe, expect, it } from 'vitest'
import { createCareerProfile, cloneCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore, parseCareerProfile } from '../../src/career/CareerProfileStore'
import { addCareerItem, availableCareerItem, careerItemAllocated, careerItemTotal, normalizeCareerInventory } from '../../src/career/CareerInventory'
import { recruitPersonalSquadMember } from '../../src/career/CareerPersonalSquad'
import { bulkCareerEquipment, changeTownEquipment, townEquipmentSquads, resolveTownActorEquipment, careerEquipmentCategory, townNativeItems,
  type TownEquipmentContext } from '../../src/career/CareerTownEquipment'
import { townEquipmentActorSpecs } from '../../src/career/CareerTownEquipmentState'
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
  it('exposes 210 stable military members plus 21 civilians and the exact existing HR roster', () => {
    const h = harness(), member = h.hire(), squads = townEquipmentSquads(h.read())
    expect(squads.slice(0, 8).map(squad => squad.actorIds.length)).toEqual([30, 30, 30, 30, 30, 30, 25, 5])
    expect(new Set(squads.slice(0, 8).flatMap(squad => squad.actorIds)).size).toBe(210)
    expect(squads[1].actorIds).toContain('commander'); expect(squads[7].actorIds).toEqual([1, 2, 3, 4, 5].map(id => `town-eagle-rider:${id}`))
    expect(squads.find(squad => squad.id === 'personal')!.actorIds).toEqual([member])
    expect(squads.find(squad => squad.id === 'civilian')!.actorIds).toHaveLength(21)
    expect(squads.slice(0, 8).every(squad => !squad.actorIds.includes(member))).toBe(true)
    for (const squad of squads.filter(squad => squad.id !== 'personal')) for (const actor of squad.actorIds) expect(resolveTownActorEquipment(h.read(), 'roman', actor).spec.id).toBe(actor)
  })
  it('classifies purchasable Ranger Bow, mace and melee lances while excluding Maki action bow, javelins and eagles', () => {
    expect(careerEquipmentCategory('maki-ranger-bow-ranged')).toBe('bow')
    expect(careerEquipmentCategory('maki-ranger-bow')).toBeUndefined()
    expect(careerEquipmentCategory('pilum_basic')).toBeUndefined()
    expect(careerEquipmentCategory('paladin_mace_t4')).toBe('axe')
    expect(careerEquipmentCategory('paladin_sword_t4')).toBe('sword')
    expect(careerEquipmentCategory('heavy_lance')).toBe('spear')
    expect(careerEquipmentCategory('xongkoro')).toBeUndefined()
    expect(careerEquipmentCategory('black-cat')).toBe('mount')
  })
  it('assigns five purchased swords to natural civilian IDs and reports the remaining fifteen short', () => {
    const h = harness(); h.buy('centurion_blade', 5)
    const result = h.bulk('civilian', 'sword')
    expect(result.summary).toEqual({ equipped: 5, upgraded: 5, unchanged: 15, insufficient: 15, ineligible: 1 })
    expect(result.changedActorIds).toEqual(['civilian-0', 'civilian-1', 'civilian-2', 'civilian-3', 'civilian-4'])
    expect(careerItemTotal(h.read(), 'centurion_blade')).toBe(5); expect(availableCareerItem(h.read(), 'centurion_blade')).toBe(0)
    expect(resolveTownActorEquipment(h.read(), 'roman', 'civilian-10').refs.melee).toBeNull()
    const prior = cloneCareerProfile(h.read()); expect(h.bulk('civilian', 'sword').reason).toBe('no-op'); expect(h.read()).toEqual(prior)
  })
  it('keeps two distinct equal-tier current swords in place despite an earlier Item ID in idle stock', () => {
    const h = harness(); h.buy('runic_greatsword'); h.buy('centurion_blade', 2)
    h.change('civilian-0', 'melee', 'runic_greatsword'); h.change('civilian-1', 'melee', 'centurion_blade')
    h.context.safeActorIds = new Set(['civilian-0', 'civilian-1'])
    const before = cloneCareerProfile(h.read()); let saves = 0
    const result = bulkCareerEquipment(h.read, h.context, 'civilian', 'sword', next => { saves++; return h.save(next) })
    expect(result).toMatchObject({ changed: false, reason: 'no-op', changedActorIds: [], summary: { equipped: 0, upgraded: 0 } })
    expect(saves).toBe(0); expect(h.read()).toEqual(before); expect(h.store.load()).toEqual(before)
    expect(availableCareerItem(h.read(), 'centurion_blade')).toBe(1)
  })
  it.each(['civilian', 'personal'] as const)('keeps the %s member’s effective T4 melee and shield when only a T1 bow is available', target => {
    const h = harness(), actor = target === 'personal' ? h.hire() : 'civilian-0'
    h.context.safeActorIds = new Set([actor]); h.buy('paladin_sword_t4'); h.buy('paladin_shield_t4')
    expect(h.change(actor, 'melee', 'paladin_sword_t4').changed).toBe(true)
    expect(h.change(actor, 'shield', 'paladin_shield_t4').changed).toBe(true)
    h.buy('wooden_shortbow'); expect(h.store.save(h.read())).toBe(true)
    const before = cloneCareerProfile(h.read()); let saves = 0
    const result = bulkCareerEquipment(h.read, h.context, target, 'bow', next => { saves++; return h.save(next) })
    expect(result).toMatchObject({ changed: false, reason: 'no-op', summary: { equipped: 0, upgraded: 0, unchanged: 1, insufficient: 0 } })
    expect(saves).toBe(0); expect(h.read()).toEqual(before); expect(h.reload()).toEqual(before)
    expect(availableCareerItem(h.read(), 'wooden_shortbow')).toBe(1)
    expect(availableCareerItem(h.read(), 'paladin_shield_t4')).toBe(0)
  })
  it('retains the T4 member while giving the T3 bow to the eligible T2 member in one legal plan', () => {
    const h = harness(); h.context.safeActorIds = new Set(['civilian-0', 'civilian-1'])
    h.buy('paladin_sword_t4'); h.buy('gladius_standard'); h.buy('paladin_shield_t4', 2)
    h.change('civilian-0', 'melee', 'paladin_sword_t4'); h.change('civilian-1', 'melee', 'gladius_standard')
    h.change('civilian-0', 'shield', 'paladin_shield_t4'); h.change('civilian-1', 'shield', 'paladin_shield_t4')
    const blocked = resolveTownActorEquipment(h.read(), 'roman', 'civilian-0').refs
    h.buy('elven_runebow')
    const result = h.bulk('civilian', 'bow')
    expect(result.changedActorIds).toEqual(['civilian-1'])
    expect(result.summary).toMatchObject({ equipped: 1, upgraded: 1, unchanged: 1, insufficient: 0 })
    expect(resolveTownActorEquipment(h.read(), 'roman', 'civilian-0').refs).toEqual(blocked)
    expect(resolveTownActorEquipment(h.read(), 'roman', 'civilian-1')).toMatchObject({ tier: 3, refs: {
      melee: { itemId: 'gladius_standard', source: 'inventory' }, ranged: { itemId: 'elven_runebow', source: 'inventory' }, shield: null,
    } })
    expect(careerItemAllocated(h.read(), 'elven_runebow')).toBe(1)
    expect(availableCareerItem(h.read(), 'paladin_shield_t4')).toBe(1)
  })
  it('maximizes real weapon upgrades before Actor ID when both members have empty ranged slots', () => {
    const h = harness(); h.context.safeActorIds = new Set(['civilian-0', 'civilian-1'])
    h.buy('gladius_rusty'); h.buy('centurion_blade')
    h.change('civilian-0', 'melee', 'gladius_rusty'); h.change('civilian-1', 'melee', 'centurion_blade')
    h.buy('elven_runebow'); h.buy('maki-ranger-bow-ranged')
    const result = h.bulk('civilian', 'bow')
    expect(result.summary).toMatchObject({ equipped: 2, upgraded: 2 })
    expect(resolveTownActorEquipment(h.read(), 'roman', 'civilian-0')).toMatchObject({ tier: 3, refs: { ranged: { itemId: 'elven_runebow', source: 'inventory' } } })
    expect(resolveTownActorEquipment(h.read(), 'roman', 'civilian-1')).toMatchObject({ tier: 4, refs: { ranged: { itemId: 'maki-ranger-bow-ranged', source: 'inventory' } } })
    expect(careerItemAllocated(h.read(), 'elven_runebow')).toBe(1); expect(careerItemAllocated(h.read(), 'maki-ranger-bow-ranged')).toBe(1)
  })
  it.each(['native', 'inventory'] as const)('bulk bow returns the %s shield to its original ownership pool and persists the exact result', source => {
    const h = harness(), actor = source === 'native' ? 'gate:north:0' : 'civilian-0'
    h.context.safeActorIds = new Set([actor])
    const sword = source === 'native' ? 'centurion_blade' : 'paladin_sword_t4'
    const bow = source === 'native' ? 'elven_runebow' : 'maki-ranger-bow-ranged'
    h.buy(sword); h.change(actor, 'melee', sword)
    if (source === 'inventory') { h.buy('paladin_shield_t4'); h.change(actor, 'shield', 'paladin_shield_t4') }
    const shield = resolveTownActorEquipment(h.read(), 'roman', actor).refs.shield!
    expect(shield.source).toBe(source); h.buy(bow)
    expect(h.bulk(source === 'native' ? 1 : 'civilian', 'bow').summary).toMatchObject({ equipped: 1, upgraded: 0 })
    expect(resolveTownActorEquipment(h.read(), 'roman', actor)).toMatchObject({ refs: {
      melee: { itemId: sword, source: 'inventory' }, ranged: { itemId: bow, source: 'inventory' }, shield: null,
    } })
    if (source === 'native') {
      expect(h.read().townEquipment!.roman!.nativeReserve).toContain(shield.nativeId)
      expect(careerItemTotal(h.read(), shield.itemId)).toBe(0)
    } else expect(availableCareerItem(h.read(), shield.itemId)).toBe(1)
    const committed = cloneCareerProfile(h.read()); expect(h.reload()).toEqual(committed)
    expect(h.bulk(source === 'native' ? 1 : 'civilian', 'bow').reason).toBe('no-op')
    expect(h.read()).toEqual(committed); expect(careerItemTotal(h.read(), bow)).toBe(1)
  })
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
  it('does not count a melee improvement as a weapon upgrade while a T4 bow remains the effective weapon', () => {
    const h = harness(); h.context.safeActorIds = new Set(['civilian-0'])
    h.buy('gladius_rusty'); h.buy('maki-ranger-bow-ranged'); h.buy('centurion_blade')
    h.change('civilian-0', 'melee', 'gladius_rusty'); h.change('civilian-0', 'ranged', 'maki-ranger-bow-ranged')
    const result = h.bulk('civilian', 'sword')
    expect(result.summary).toMatchObject({ equipped: 1, upgraded: 0 })
    expect(resolveTownActorEquipment(h.read(), 'roman', 'civilian-0')).toMatchObject({ tier: 4, refs: {
      melee: { itemId: 'centurion_blade', source: 'inventory' }, ranged: { itemId: 'maki-ranger-bow-ranged', source: 'inventory' },
    } })
  })
  it('reports no stock and never announces a successful civilian bulk transaction', () => {
    const h = harness(), save = () => { throw new Error('must not save') }
    expect(bulkCareerEquipment(h.read, h.context, 'civilian', 'axe', save)).toMatchObject({ changed: false, reason: 'no-available-item', summary: { equipped: 0, insufficient: 20 } })
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
    const nativeHolders = townEquipmentSquads(h.read()).filter(squad => squad.id !== 'personal').flatMap(squad =>
      squad.actorIds.flatMap(id => Object.values(resolveTownActorEquipment(h.read(), 'roman', id).refs).flatMap(ref => ref?.source === 'native' ? [ref.nativeId!] : [])))
    const conserved = [...nativeHolders, ...h.read().townEquipment!.roman!.nativeReserve]
    expect(conserved.length).toBe(new Set(conserved).size)
    expect([...conserved].sort()).toEqual(townNativeItems('roman').map(item => item.nativeId).sort())
  })
  it('makes displaced native shields available only as native reserves while returning bought shields to owned stock', () => {
    const h = harness(); h.buy('maki-ranger-bow-ranged', 2); h.buy('paladin_shield_t4')
    expect(h.change('gate:north:0', 'ranged', 'maki-ranger-bow-ranged').changed).toBe(true)
    expect(h.read().townEquipment!.roman!.nativeReserve).toContain('roman/gate:north:0/shield')
    expect(careerItemTotal(h.read(), 'scutum_t2')).toBe(0)
    expect(h.change('civilian-0', 'shield', 'paladin_shield_t4').changed).toBe(true)
    expect(h.change('civilian-0', 'ranged', 'maki-ranger-bow-ranged').changed).toBe(true)
    expect(availableCareerItem(h.read(), 'paladin_shield_t4')).toBe(1)
    expect(resolveTownActorEquipment(h.read(), 'roman', 'civilian-0').refs.shield).toBeNull()
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
  it('rejects enemy towns, hostile peace claims and active missions at the domain boundary', () => {
    const h = harness(); h.context.townFaction = 'viking'; expect(h.bulk(1, 'sword').reason).toBe('enemy-town')
    h.context.townFaction = 'roman'; h.set({ ...h.read(), townEvent: { id: 'hostile', state: 'hostile' } }); expect(h.bulk(1, 'sword').reason).toBe('not-safe')
    h.set({ ...h.read(), townEvent: undefined, activeOutpostMission: { id: 'mission', kind: 'outpost-defense', stageId: 1, acceptedAt: 0 } }); expect(h.bulk(1, 'sword').reason).toBe('mission-active')
  })
  it('uses the same HR pool, preserves fixed Maki and whole-squad RESERVE restrictions', () => {
    const h = harness(), soldier = h.hire(), ranger = h.hire('ranger')
    h.context.safeActorIds = new Set([soldier, ranger]); h.buy('maki-ranger-bow-ranged')
    expect(h.bulk('personal', 'bow').changedActorIds).toEqual([soldier])
    expect(h.read().personalSquad!.members[1].equipment!.ranged).toBeNull()
    expect(resolveTownActorEquipment(h.read(), 'roman', 'eagle-trainer').fixedWeapons).toBe(true)
    const previous = cloneCareerProfile(h.read()); h.context.personalState = 'RETURNING'
    expect(h.bulk('personal', 'sword').reason).toBe('not-reserve'); expect(h.read()).toEqual(previous)
  })
  it('keeps Maki native T4 Black Cat when its squad offers only a retired native T1 Horse', () => {
    const h = harness(), squads = townEquipmentSquads(h.read()), squad = squads.find(squad => squad.actorIds.includes('ranger'))!
    const maki = resolveTownActorEquipment(h.read(), 'roman', 'ranger')
    expect(maki.refs.mount).toEqual({ itemId: 'black-cat', source: 'native', nativeId: 'roman/ranger/mount' })
    expect(maki.mountTier).toBe(4)
    expect(resolveTownActorEquipment(h.read(), 'roman', 'eagle-trainer').refs.mount).toBeNull()
    const horseRider = squad.actorIds.find(id => resolveTownActorEquipment(h.read(), 'roman', id).refs.mount?.itemId === 'horse')!
    h.buy('corgi'); expect(h.change(horseRider, 'mount', 'corgi').changed).toBe(true)
    const before = cloneCareerProfile(h.read()); h.context.safeActorIds = new Set(['ranger'])
    expect(h.bulk(squad.id, 'mount').reason).toBe('no-op')
    expect(h.read()).toEqual(before); expect(resolveTownActorEquipment(h.read(), 'roman', 'ranger').mountTier).toBe(4)
    expect(h.read().townEquipment!.roman!.nativeReserve).toContain(`roman/${horseRider}/mount`)
    h.buy('horse'); expect(h.bulk(squad.id, 'mount').reason).toBe('no-op')
    expect(resolveTownActorEquipment(h.read(), 'roman', 'ranger').refs.mount).toEqual(maki.refs.mount)
  })
  it('suppresses a transferred native mount at a sparse origin entry without recreating a second copy', () => {
    const h = harness(), squads = townEquipmentSquads(h.read()), squad = squads.find(squad => squad.actorIds.includes('ranger'))!
    const recipient = squad.actorIds.find(id => id !== 'ranger' && resolveTownActorEquipment(h.read(), 'roman', id).refs.mount?.itemId === 'horse')!
    const refs = { ...resolveTownActorEquipment(h.read(), 'roman', recipient).refs, mount: resolveTownActorEquipment(h.read(), 'roman', 'ranger').refs.mount }
    const next = cloneCareerProfile(h.read()); next.townEquipment = { roman: { version: 1, actors: { [recipient]: refs }, nativeReserve: [] } }
    expect(h.save(next)).toBe(true); h.reload()
    expect(h.read().townEquipment!.roman!.actors.ranger).toBeUndefined()
    expect(resolveTownActorEquipment(h.read(), 'roman', 'ranger').refs.mount).toBeNull()
    expect(resolveTownActorEquipment(h.read(), 'roman', recipient).refs.mount?.nativeId).toBe('roman/ranger/mount')
  })
  it('keeps Merchant fixed T4 gear and garrison eagles outside both individual and bulk reassignment', () => {
    const h = harness(); h.buy('paladin_sword_t4'); h.buy('horse'); h.buy('xongkoro')
    expect(h.change('merchant', 'melee', 'paladin_sword_t4').reason).toBe('fixed-equipment')
    expect(h.change('town-eagle-rider:1', 'mount', 'horse').reason).toBe('fixed-equipment')
    expect(h.change('civilian-0', 'mount', 'xongkoro').reason).toBe('invalid-item')
    expect(h.bulk(8, 'mount').changed).toBe(false)
    expect(resolveTownActorEquipment(h.read(), 'roman', 'merchant').loadout).toMatchObject({ meleeWeaponId: 'paladin_sword_t4', secondaryMeleeWeaponId: 'paladin_mace_t4', shieldId: 'paladin_shield_t4' })
    expect(careerItemAllocated(h.read(), 'paladin_sword_t4')).toBe(0)
  })
  it('rolls back the complete bulk plan and persistent ownership on a failed final save', () => {
    const h = harness(); h.buy('paladin_sword_t4', 3); expect(h.store.save(h.read())).toBe(true)
    const before = cloneCareerProfile(h.read()), disk = h.store.load(); h.storage.failWrites = true
    expect(h.bulk('civilian', 'sword')).toMatchObject({ changed: false, reason: 'save-failed', changedActorIds: [], summary: { equipped: 0 } })
    expect(h.read()).toEqual(before); expect(h.store.load()).toEqual(disk)
    expect(bulkCareerEquipment(h.read, h.context, 'civilian', 'sword', () => { throw new Error('quota') }).reason).toBe('save-failed')
    expect(h.read()).toEqual(before)
  })
  it('rejects duplicate or cross-squad native claims and unknown or overallocated owned references through the storage parser', () => {
    const h = harness(); h.buy('paladin_sword_t4'); h.change('gate:north:0', 'melee', 'paladin_sword_t4')
    const valid = cloneCareerProfile(h.read()), native = resolveTownActorEquipment(valid, 'roman', 'gate:north:1').refs.melee!
    const duplicate = cloneCareerProfile(valid); duplicate.townEquipment!.roman!.actors['gate:north:0'].melee = native
    duplicate.townEquipment!.roman!.actors['gate:north:1'] = { ...resolveTownActorEquipment(valid, 'roman', 'gate:north:1').refs }
    expect(parseCareerProfile(duplicate)).toBeNull()
    const cross = cloneCareerProfile(valid); cross.townEquipment!.roman!.actors['gate:north:0'].melee = resolveTownActorEquipment(valid, 'roman', 'gate:south:0').refs.melee
    expect(parseCareerProfile(cross)).toBeNull()
    const foreign = cloneCareerProfile(valid); foreign.townEquipment!.roman!.actors['gate:north:0'].melee = { ...native, nativeId: 'viking/gate:north:1/melee' }
    expect(parseCareerProfile(foreign)).toBeNull()
    const over = cloneCareerProfile(valid); over.equipment = { melee: 'paladin_sword_t4' }; expect(parseCareerProfile(over)).toBeNull()
    const unknown = cloneCareerProfile(valid); unknown.townEquipment!.roman!.actors['enemy-1'] = { ...unknown.townEquipment!.roman!.actors['gate:north:0'] }; expect(parseCareerProfile(unknown)).toBeNull()
    expect(h.store.load()).toEqual(valid)
  })
  it.each(['roman', 'viking'] as const)('loads old %s saves without promoting any authored gear into Inventory', faction => {
    const h = harness(faction), before = cloneCareerProfile(h.read()); delete before.townEquipment
    expect(h.store.save(before)).toBe(true); const loaded = h.reload()
    expect(loaded.townEquipment).toBeUndefined(); expect(loaded.inventory!.quantities).toEqual({})
    expect(resolveTownActorEquipment(loaded, faction, 'merchant').loadout.meleeWeaponId).toBe('paladin_sword_t4')
    expect(townEquipmentActorSpecs(faction).length).toBeGreaterThan(210)
  })
})
