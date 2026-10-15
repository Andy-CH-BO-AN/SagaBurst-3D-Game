import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import { addCareerItem, normalizeCareerInventory } from '../../src/career/CareerInventory'
import { resolveTownActorEquipment, type TownEquipmentContext } from '../../src/career/CareerTownEquipment'
import { createTownCareerEquipmentUI } from '../../src/town/TownCareerEquipmentUI'
import type { TownEquipmentUIBindings } from '../../src/town/TownSquadEquipmentUI'
import { MemoryStorage } from '../helpers/memoryStorage'

let bindings: TownEquipmentUIBindings
vi.mock('../../src/town/TownSquadEquipmentUI', async original => ({
  ...(await original<typeof import('../../src/town/TownSquadEquipmentUI')>()),
  // Capture the UI's callbacks at its rendering boundary. Domain transactions and caller ordering stay real.
  townEquipmentUI: (value: TownEquipmentUIBindings) => { bindings = value; return { render() {} } },
}))
afterEach(() => vi.restoreAllMocks())
function fixture() {
  const storage = new MemoryStorage(), store = new CareerProfileStore(storage), events: string[] = []
  let profile: CareerProfile = { ...createCareerProfile('roman'), rank: 'commander', totalMerit: 100000, availableMerit: 100000 }
  normalizeCareerInventory(profile); addCareerItem(profile, 'paladin_sword_t4', 2)
  const save = (next: CareerProfile) => {
    events.push('save')
    if (!store.save(next)) return false
    profile = next; return true
  }
  const context: TownEquipmentContext = { townFaction: 'roman', peaceful: true, personalState: 'RESERVE', safeActorIds: new Set(['gate:north:0']) }
  const apply = vi.fn((_before: CareerProfile, current: CareerProfile, _ids: readonly string[]) => {
    events.push('apply')
    expect(store.load()!.townEquipment).toEqual(current.townEquipment)
    return 0
  })
  createTownCareerEquipmentUI(() => profile, () => context,
    () => [{ spec: { id: 'gate:north:0' }, npc: { name: 'North guard', dead: false } }], save, apply)
  return { read: () => profile, store, storage, events, apply, bulk: () => bindings.bulk(1, 'sword') }
}
describe('Town equipment caller transaction ordering', () => {
  it('serializes a bulk loadout before applying its runtime side effect once', () => {
    const h = fixture(), previous = h.read()
    h.bulk()
    expect(h.events).toEqual(['save', 'apply'])
    expect(h.apply).toHaveBeenCalledExactlyOnceWith(previous, h.read(), ['gate:north:0'])
    expect(resolveTownActorEquipment(h.store.load()!, 'roman', 'gate:north:0').loadout.meleeWeaponId).toBe('paladin_sword_t4')
    expect(h.store.load()!.inventory!.quantities.paladin_sword_t4).toBe(2)
  })
  it('leaves profile and runtime unchanged when the bulk save fails', () => {
    const h = fixture(), previous = h.read(), stored = h.store.load()
    h.storage.failWrites = true; h.bulk()
    expect(h.events).toEqual(['save']); expect(h.apply).not.toHaveBeenCalled()
    expect(h.read()).toBe(previous); expect(h.store.load()).toEqual(stored)
  })
})
