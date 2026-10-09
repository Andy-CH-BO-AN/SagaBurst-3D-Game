import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { siegeRoster, siegeDefensePlans, siegeGate, siegePoint, siegeOutward, siegeReservePoint, siegeMuster, siegeNearestGate } from '../../src/career/TownSiege'
import { townRoster } from '../../src/town/TownRules'
import { createAssaultRoster, createEnemyTownAssaultMission, resolveAssaultOutcome } from '../../src/career/EnemyTownAssault'

describe('Siege gate direction data', () => {
  it.each([
    { id: 'north', squadId: 1, leaderId: 'captain', yaw: Math.PI, origin: [0, -115], outward: [0, -1], inside: [-2, -110], reserve: [10, -85], muster: [12.5, -305] },
    { id: 'south', squadId: 2, leaderId: 'ranger', yaw: 0, origin: [0, 100], outward: [0, 1], inside: [2, 95], reserve: [-10, 70], muster: [-12.5, 305] },
    { id: 'east', squadId: 3, leaderId: 'town-patrol:a:captain', yaw: Math.PI / 2, origin: [150, 45], outward: [1, 0], inside: [145, 43], reserve: [120, 55], muster: [305, 57.5] },
    { id: 'west', squadId: 4, leaderId: 'town-patrol:b:captain', yaw: -Math.PI / 2, origin: [-110, 0], outward: [-1, 0], inside: [-105, 2], reserve: [-80, -10], muster: [-305, -12.5] },
  ] as const)('$id maps yaw, local offsets, nearest gate and assignments to its own sector', data => {
    const gate = siegeGate(data.id)
    expect([gate.x, gate.z, gate.yaw]).toEqual([...data.origin, data.yaw])
    const expectXZ = (point: THREE.Vector3, expected: readonly [number, number]) => {
      expect(point.x).toBeCloseTo(expected[0], 8)
      expect(point.y).toBe(0)
      expect(point.z).toBeCloseTo(expected[1], 8)
    }
    expectXZ(siegeOutward(data.id), data.outward)
    expectXZ(siegePoint(data.id, 2, 5), data.inside)
    expectXZ(siegeReservePoint(data.id, 0), data.reserve)
    expectXZ(siegeMuster(data.id, 0), data.muster)
    expect(siegeNearestGate(new THREE.Vector3(data.reserve[0], 0, data.reserve[1]))).toBe(data.id)
    const plan = siegeDefensePlans(townRoster()).find(plan => plan.gateId === data.id)!
    expect(plan.leaderId).toBe(data.leaderId)
    expect(plan.cavalry).toContain(data.leaderId)
    expect(plan.infantry.filter(id => id.startsWith('gate:'))).toEqual(
      Array.from({ length: 10 }, (_, index) => 'gate:' + data.id + ':' + index))
    const slots = siegeRoster('roman', false).filter(slot => slot.gateId === data.id)
    expect(slots).toHaveLength(30)
    expect(slots.every(slot => slot.spec.squadId === data.squadId)).toBe(true)
    expectXZ(new THREE.Vector3(slots[0].spec.x, 0, slots[0].spec.z), data.muster)
  })
})

// Pure rosters/objectives own every faction/mode input without constructing actors.
for (const faction of ['roman', 'viking'] as const) describe(`${faction} shared four-gate Siege`, () => {
  it('fills each gate with ten lancers, ten horse archers and ten faction-specific foot ranged soldiers, counting Player and T4 officers inside thirty', () => {
    for (const assault of [false, true]) {
      const roster = siegeRoster(faction, assault)
      expect(roster).toHaveLength(assault ? 119 : 120)
      expect(roster.filter(s => s.spec.tier === 4)).toHaveLength(4)
      expect(roster.filter(s => s.spec.combatProfileId === 'ranger')).toHaveLength(1)
      expect(roster.find(s => s.spec.combatProfileId === 'ranger')!.spec.loadout?.mountId).toBe('black-cat')
      for (const id of ['north', 'south', 'east', 'west']) expect(roster.filter(s => s.gateId === id).length + (assault && id === 'north' ? 1 : 0)).toBe(30)
      expect(roster.every(s => s.spec.tier === 4 || s.spec.tier === 3)).toBe(true)
      expect(roster.filter(s => s.spec.cavalry)).toHaveLength(assault ? 79 : 80)
      expect(roster.filter(s => !s.spec.cavalry)).toHaveLength(40)
      if (assault) expect(createAssaultRoster(faction)).toEqual(roster.map(({ spec }) => spec))
      for (const gateId of ['north', 'south', 'east', 'west']) {
        const group = roster.filter(slot => slot.gateId === gateId)
        const playerSlot = assault && gateId === 'north' ? 1 : 0
        expect(group.filter(({ spec }) => spec.presetId === `${faction}_lancer`).length + playerSlot).toBe(10)
        expect(group.filter(({ spec }) => spec.presetId === `${faction}_horse_archer`)).toHaveLength(10)
        expect(group.filter(({ spec }) => spec.presetId === `${faction}_archer`)).toHaveLength(faction === 'viking' ? 10 : 5)
        expect(group.filter(({ spec }) => spec.presetId === 'roman_javelin_infantry')).toHaveLength(faction === 'roman' ? 5 : 0)
        expect(group.filter(({ spec }) => spec.tier === 4)).toHaveLength(1)
      }
      for (const { spec, slot } of roster) {
        expect(spec.characterFaction).toBe(faction)
        expect(spec.faction).toBe(assault ? 'TOWN' : 'ENEMY')
        expect(spec.presetId?.startsWith(`${faction}_`)).toBe(true)
        expect(spec.aiType).toBe(slot < 10 ? 'MELEE' : 'RANGED')
        expect(Boolean(spec.loadout?.mountId)).toBe(spec.cavalry)
        const bow = spec.specialCombatProfile === 'maki-ranger' ? 'maki-ranger-bow-ranged' : 'elven_runebow'
        expect(spec.loadout).toMatchObject(slot < 10
          ? { meleeWeaponId: 'heavy_lance', rangedWeaponId: null, shieldId: null }
          : { meleeWeaponId: faction === 'roman' ? 'gladius_rusty' : 'rusty_dagger',
            rangedWeaponId: slot >= 25 && faction === 'roman' ? 'legionary_pilum' : bow, shieldId: null })
      }
    }
  })
})

describe('Siege officer profile policy without actor materialization', () => {
  it.each([
    ['roman', true, 'praetorian', 'roman-hero-t4', 'corgi'],
    ['roman', false, 'praetorian', 'roman-hero-t4', 'corgi'],
    ['viking', true, 'varangian', 'viking-hero-t4', 'black-cat'],
    ['viking', false, 'varangian', 'viking-hero-t4', 'black-cat'],
  ] as const)('%s assault=%s selects the canonical Captain and Ranger profiles', (faction, assault, combatProfileId, visualAssetId, mountId) => {
    const roster = siegeRoster(faction, assault)
    const captains = roster.filter(({ spec }) => spec.name === 'Captain')
    expect(captains.map(slot => slot.gateId)).toEqual(['north', 'south', 'east'])
    for (const { spec } of captains) expect(spec).toMatchObject({
      characterFaction: faction, faction: assault ? 'TOWN' : 'ENEMY', tier: 4,
      combatProfileId, visualAssetId, loadout: { mountId },
    })
    expect(roster.filter(({ spec }) => spec.combatProfileId === 'ranger')).toMatchObject([{
      gateId: 'west', slot: 10, spec: { characterFaction: faction, tier: 4,
        visualAssetId: 'maki-archer-t4', combatProfileId: 'ranger', specialCombatProfile: 'maki-ranger',
        loadout: { mountId: 'black-cat' } },
    }])
  })
})

describe('Siege deployment and shared rule ownership', () => {
  it('keeps gate guards local, balances infantry and assigns four existing cavalry officers', () => {
    const plans = siegeDefensePlans(townRoster())
    expect(plans.map(p => p.infantry.length).sort()).toEqual([25, 25, 25, 26])
    expect(plans.map(p => p.cavalry.length).sort()).toEqual([25, 25, 26, 26])
    for (const p of plans) expect(p.infantry.filter(id => id.startsWith('gate:')).every(id => id.startsWith(`gate:${p.gateId}:`))).toBe(true)
    expect(plans.map(p => p.leaderId)).toEqual(['captain', 'ranger', 'town-patrol:a:captain', 'town-patrol:b:captain'])
  })

  it('counts military objectives independently of faction and excludes civilians', () => {
    const objective = createEnemyTownAssaultMission().targetActorIds
    expect(objective).toHaveLength(208)
    expect(objective.filter(id => id.startsWith('gate:'))).toHaveLength(40)
    expect(objective.filter(id => id.startsWith('town-patrol:'))).toHaveLength(40)
    expect(objective.some(id => id.startsWith('civilian'))).toBe(false)
  })
})

describe('Enemy Town Assault retained contracts', () => {
  it.each([
    [true, 0, 0, 'victory'], [false, 0, 0, 'victory'], [true, 1, 1, null],
    [true, 1, 0, 'failure'], [false, 1, 0, null],
  ] as const)('assault dead=%s military=%s NPC=%s => %s', (dead, military, allies, outcome) => {
    expect(resolveAssaultOutcome(dead, military, allies)).toBe(outcome)
  })
})
