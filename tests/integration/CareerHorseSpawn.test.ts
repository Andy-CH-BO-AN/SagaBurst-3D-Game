import { afterEach, describe, expect, it, vi } from 'vitest'
import * as MountModule from '../../src/world/Mount'
import { horseVariantForStableKey } from '../../src/world/HorseAssetRegistry'
import { CareerMountController } from '../../src/career/CareerMountController'
import { BanditMissionController } from '../../src/career/BanditMissionController'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { addCareerItem } from '../../src/career/CareerInventory'
import type { NpcSpawnSpec } from '../../src/battle/BattleSpawner'
import type { RaceRider } from '../../src/career/CareerRaceState'

// The render constructor is the external boundary: capture arguments only, with data
// needed for HP/heading restoration. No scene, actor, model or visual is constructed.
function captureMountConstruction() {
  return vi.spyOn(MountModule, 'Mount').mockImplementation(function () {
    return { maxHp: 100, currentHp: 100, group: { rotation: { y: 0 } }, onDeathCallbacks: [], dispose() {} } as unknown as MountModule.Mount
  })
}
afterEach(() => vi.restoreAllMocks())

describe('Career horse spawn appearance forwarding', () => {
  it('restores a race horse using the persisted player coat while retaining saved HP and heading', () => {
    const create = captureMountConstruction()
    const profile = createCareerProfile('roman'); addCareerItem(profile, 'horse', 1); profile.horseAppearanceVariant = 2
    const owner = Object.assign(Object.create(CareerMountController.prototype) as Pick<CareerMountController, 'restoreRaceMount' | 'activeMount'>, {
      readProfile: () => profile, hp: new Map(), unavailable: new Set(), active: null,
    })
    const saved: RaceRider = { actorId: 'player', mountId: 'horse', hp: 80, stamina: 50, mountHp: 37,
      mounted: true, dead: false, checkpoint: 1, position: { x: 1, y: 0, z: 2, yaw: .5 },
      mountPosition: { x: 3, y: 4, z: 5, yaw: 1.2 } }
    expect(owner.restoreRaceMount(saved)).toBe(true)
    expect(create).toHaveBeenCalledExactlyOnceWith(undefined, MountModule.MountType.HORSE, 3, 5, 4, 2)
    expect(owner.activeMount?.currentHp).toBe(37)
    expect(owner.activeMount?.group.rotation.y).toBe(1.2)
  })

  it('passes distinct stable actor coats to mission mounts independently of spawn position/order', () => {
    const create = captureMountConstruction()
    interface MountEntry { createVeteranMount(spec: NpcSpawnSpec): MountModule.Mount }
    const owner = Object.assign(Object.create(BanditMissionController.prototype) as MountEntry, { veteranFieldFactories: {} })
    // One roster's invariant: coats vary and an actor retains
    // its assigned coat when reconstructed at a different checkpoint position.
    const colors = new Set<number>()
    for (const actorId of ['mission:cavalry:1', 'mission:cavalry:2', 'mission:cavalry:3']) {
      const spec = { actorId, x: 1, z: 2, loadout: { mountId: 'horse' } } as NpcSpawnSpec
      owner.createVeteranMount(spec)
      const variant = create.mock.calls.at(-1)![5]!
      colors.add(variant)
      expect(variant).toBe(horseVariantForStableKey(actorId))
      owner.createVeteranMount({ ...spec, x: 20, z: 30 })
      expect(create.mock.calls.at(-1)![5]).toBe(variant)
    }
    expect(colors.size).toBeGreaterThan(1)
  })
})
