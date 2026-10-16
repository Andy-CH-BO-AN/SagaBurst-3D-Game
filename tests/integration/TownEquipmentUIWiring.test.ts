import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import type { TownEquipmentContext } from '../../src/career/CareerTownEquipment'
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
  // One legitimate inventory-backed member exercises the shared bulk caller without a native Town loadout.
  let profile: CareerProfile = { ...createCareerProfile('roman'), rank: 'captain', totalMerit: 5000, availableMerit: 5000,
    ownedWeapons: ['gladius_rusty', 'paladin_sword_t4'],
    inventory: { version: 1, quantities: { gladius_rusty: 1, paladin_sword_t4: 1 } },
    personalSquad: { members: [{ id: 'personal:ui-soldier', type: 'soldier', originalHirePrice: 50,
      equipment: { melee: 'gladius_rusty', ranged: null, shield: null, mount: null } }] },
  }
  expect(store.save(profile)).toBe(true)
  const save = (next: CareerProfile) => {
    events.push('save')
    if (!store.save(next)) return false
    profile = next; return true
  }
  const context: TownEquipmentContext = { townFaction: 'roman', peaceful: true, personalState: 'RESERVE', safeActorIds: new Set(['personal:ui-soldier']) }
  const apply = vi.fn((_before: CareerProfile, current: CareerProfile, _ids: readonly string[]) => {
    events.push('apply')
    expect(store.load()!.personalSquad).toEqual(current.personalSquad)
    return 0
  })
  createTownCareerEquipmentUI(() => profile, () => context, () => [], save, apply)
  return { read: () => profile, store, storage, events, apply, bulk: () => bindings.bulk('personal', 'sword') }
}
describe('Town equipment caller transaction ordering', () => {
  it('serializes a bulk loadout before applying its runtime side effect once', () => {
    const h = fixture(), previous = h.read()
    h.bulk()
    expect(h.events).toEqual(['save', 'apply'])
    expect(h.apply).toHaveBeenCalledExactlyOnceWith(previous, h.read(), ['personal:ui-soldier'])
    const saved = h.store.load()!
    expect(saved.personalSquad!.members[0].equipment?.melee).toBe('paladin_sword_t4')
    expect(saved.inventory!.quantities.paladin_sword_t4).toBe(1)
  })
  it('leaves profile and runtime unchanged when the bulk save fails', () => {
    const h = fixture(), previous = h.read(), stored = h.store.load()
    h.storage.failWrites = true; h.bulk()
    expect(h.events).toEqual(['save']); expect(h.apply).not.toHaveBeenCalled()
    expect(h.read()).toBe(previous); expect(h.store.load()).toEqual(stored)
  })
})

it('shows civilian native T1 weapons and exposes only the merchant military horse selector after save', () => {
  let profile: CareerProfile = { ...createCareerProfile('roman'), rank: 'commander', commanderMeleeGranted: true,
    totalMerit: 20000, inventory: { version: 1, quantities: { horse: 1, 'black-cat': 1 } } }
  const events: string[] = []
  createTownCareerEquipmentUI(() => profile, () => ({ townFaction: 'roman', peaceful: true, personalState: 'RESERVE', safeActorIds: new Set(['merchant']) }),
    () => [{ spec: { id: 'merchant' }, npc: { name: 'Merchant', dead: false } }], next => {
      profile = next; events.push('save'); return true
    }, () => { events.push('deferred'); return 1 })
  const squad = bindings.read().squads.find(squad => squad.id === 'civilian')!
  const merchant = squad.members.find(member => member.id === 'merchant')!
  expect(merchant).toMatchObject({ readOnly: false, lockedSlots: ['melee', 'ranged', 'shield'], equipment: {
    melee: { id: 'sword_t5', tier: 5 }, shield: { id: 'paladin_shield_t4', tier: 4 }, mount: { id: null },
  } })
  expect(merchant.fixedEquipment?.join(' ')).not.toMatch(/Mace|戰槌/)
  expect(squad.members.filter(member => member.id.startsWith('civilian-')).every(member => member.equipment.melee.id === 'gladius_rusty' && member.equipment.melee.tier === 1)).toBe(true)
  expect(bindings.options('civilian', 'merchant', 'mount').map(option => option.id)).toEqual([null, 'horse'])
  expect(bindings.change('civilian', 'merchant', 'mount', 'horse')).toContain('待下次回城')
  expect(events).toEqual(['save', 'deferred'])
  expect(profile.townEquipment!.roman!.actors.merchant.mount).toEqual({ itemId: 'horse', source: 'inventory' })
})
