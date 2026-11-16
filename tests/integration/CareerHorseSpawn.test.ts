import { afterEach, describe, expect, it, vi } from 'vitest'
import * as MountModule from '../../src/world/Mount'
import { HorseAssetRegistry } from '../../src/world/HorseAssetRegistry'
import { CareerMountController } from '../../src/career/CareerMountController'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { addCareerItem } from '../../src/career/CareerInventory'
import type { RaceRider } from '../../src/career/CareerRaceState'

// The render constructor is the external boundary: capture arguments only, with data
// needed for HP/heading restoration. No scene, actor, model or visual is constructed.
function captureMountConstruction() {
  return vi.spyOn(MountModule, 'Mount').mockImplementation(function () {
    return { maxHp: 100, currentHp: 100, group: { rotation: { y: 0 } }, onDeathCallbacks: [], restoreArmor: vi.fn(), dispose() {} } as unknown as MountModule.Mount
  })
}
afterEach(() => vi.restoreAllMocks())

describe('Career horse spawn appearance forwarding', () => {
  it('restores race horse and armored-horse with saved appearance, HP, zero armor and heading exactly once', () => {
    for (const id of ['horse', 'armored-horse'] as const) {
      const create = captureMountConstruction()
      const profile = createCareerProfile('roman'); addCareerItem(profile, id, 1); profile.horseAppearanceVariant = 2
      vi.spyOn(HorseAssetRegistry, 'armoredReady', 'get').mockReturnValue(true)
      const owner = Object.assign(Object.create(CareerMountController.prototype) as Pick<CareerMountController, 'restoreRaceMount' | 'activeMount'>, {
        readProfile: () => profile, hp: new Map(), armorImpact: new Map(), unavailable: new Set(), active: null,
      })
      const saved: RaceRider = { actorId: 'player', mountId: id, hp: 80, stamina: 50, mountHp: 37, mountArmorImpact: 0,
        mounted: true, dead: false, checkpoint: 1, position: { x: 1, y: 0, z: 2, yaw: .5 },
        mountPosition: { x: 3, y: 4, z: 5, yaw: 1.2 } }
      expect(owner.restoreRaceMount(saved)).toBe(true)
      expect(create).toHaveBeenCalledExactlyOnceWith(undefined, id === 'horse' ? MountModule.MountType.HORSE : MountModule.MountType.ARMORED_HORSE, 3, 5, 4, 2)
      expect(owner.activeMount?.currentHp).toBe(37)
      expect(owner.activeMount?.group.rotation.y).toBe(1.2)
      expect(owner.activeMount?.restoreArmor).toHaveBeenCalledExactlyOnceWith(0)
      expect(owner.restoreRaceMount(saved)).toBe(false)
      expect(create).toHaveBeenCalledTimes(1)
      create.mockRestore()
    }
  })
})
