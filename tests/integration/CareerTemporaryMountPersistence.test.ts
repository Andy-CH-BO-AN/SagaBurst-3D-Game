import { MemoryStorage } from '../helpers/memoryStorage'
import { describe, expect, it, vi, afterEach, onTestFinished } from 'vitest'
import { damageNpc } from '../../src/combat/DamageRouter'
import { Mount, MountType } from '../../src/world/Mount'
import { TemporaryBattlefieldMounts } from '../../src/career/TemporaryBattlefieldMounts'
import { CareerMountController, ownedCareerMountIds } from '../../src/career/CareerMountController'
import { createCareerProfile, clearCareerMission } from '../../src/career/CareerProfile'
import { createActiveCareerMission } from '../../src/career/CareerMissionState'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'

import { createMountedCombatActors, createMountedDamageContext as ctx } from '../helpers/mountedCombatActors'
function fixture(type = MountType.HORSE) {
  return createMountedCombatActors(type, resource => onTestFinished(() => resource.dispose()))
}

vi.mock('../../src/world/HorseAssetRegistry', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/world/HorseAssetRegistry')>()),
  HorseAssetRegistry: {
    ready: true,
    createInstance: (await import('../helpers/gameplayHorseVisual')).createGameplayHorseVisual,
  },
}))
vi.mock('../../src/world/CorgiVisual', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/world/CorgiVisual')>()),
  CorgiVisual: (await import('../helpers/gameplayQuadrupedVisual')).GameplayQuadrupedVisualDouble,
}))
vi.mock('../../src/world/BlackCatVisual', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/world/BlackCatVisual')>()),
  BlackCatVisual: (await import('../helpers/gameplayQuadrupedVisual')).GameplayQuadrupedVisualDouble,
}))

const disposables: Array<{ dispose(): void }> = []
afterEach(() => disposables.splice(0).reverse().forEach(object => object.dispose()))

describe('Career temporary mount persistence', () => {
  it.each([false, true])('save/reload/return preserve ownership, owns Black Cat=%s', purchased => {
    const { scene, rider, mount, player } = fixture()
    let profile = createCareerProfile('roman'); profile.rank = 'captain'
    profile.activeMission = createActiveCareerMission('recruit-bandits-02', 1, 12, 0, 'temporary-test')
    if (purchased) { profile.ownedMounts = ['black-cat']; profile.selectedMountId = 'black-cat' }
    const values = new MemoryStorage()
    const store = new CareerProfileStore(values)
    const controller = new CareerMountController(scene, () => player, () => profile, next => { profile = next; return store.save(next) }, () => [], () => [])
    disposables.push(controller)
    if (purchased) expect(controller.activate('black-cat')).toBe(true)
    const owned = controller.activeMount
    const service = new Mount(scene, MountType.HORSE, 10, 10, 50); onTestFinished(() => service.dispose()); service.reservedForTown = true; disposables.push(service)
    const temporary = new TemporaryBattlefieldMounts(); temporary.track(mount, profile.activeMission!.id)
    rider.restoreCombatHealth(20); damageNpc(rider, 30, ctx(player, 'body'))
    player.mountVehicle(mount)
    expect(player.currentMount).toBe(mount); expect(controller.activeMount).toBe(owned)
    player.dismountFromMount(); player.mountVehicle(mount)
    controller.update(.016); expect(store.save(profile)).toBe(true)
    const loaded = store.load()!
    expect(ownedCareerMountIds(loaded)).toEqual(purchased ? ['black-cat'] : [])
    expect(loaded.selectedMountId).toBe(purchased ? 'black-cat' : undefined)
    expect(loaded.activeMission?.mountState?.activeMountId).not.toBe('horse')
    expect(JSON.stringify(loaded)).not.toContain(mount.group.uuid)
    temporary.cleanup()
    expect(player.isMounted).toBe(false); expect(mount.disposed).toBe(true)
    expect(owned?.disposed ?? false).toBe(false); expect(service.disposed).toBe(false)
    profile = clearCareerMission(profile, profile.activeMission!.id)
    store.save(profile)
    expect(ownedCareerMountIds(store.load()!)).toEqual(purchased ? ['black-cat'] : [])
  })
})
