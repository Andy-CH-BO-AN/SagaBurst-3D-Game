import { describe, expect, it, vi, afterEach, onTestFinished } from 'vitest'
import { damageNpc } from '../../src/combat/DamageRouter'
import { Mount, MountType } from '../../src/world/Mount'
import { createCareerProfile } from '../../src/career/CareerProfile'
import { createActiveCareerMission } from '../../src/career/CareerMissionState'
import { createTownCombatFixture } from '../helpers/townCombatFixture'

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

describe('Town temporary mount ownership', () => {
  it('Town cavalry released in combat can be ridden with E and stays reserved when peace returns', () => {
    const { rider, mount, player } = fixture()
    mount.reservedForTown = true
    const town = createTownCombatFixture()
    town.profile = createCareerProfile('roman'); town.profile.townEvent = { id: 'town-combat', state: 'hostile' }
    town.player = player; town.mounts = [mount]; town.residents = [{ npc: rider, homeMount: mount }]
    town.event = { hostile: true }; town.equipment = { visible: false }; town.stableHorses = []
    town.hint = { style: {} }; town.commit = vi.fn(next => { town.profile = next; return true })
    town.openPanel = vi.fn(); town.button = vi.fn()
    damageNpc(rider, 9999, ctx(player, 'body'))
    player.position.set(0, 50.9, 1)
    town.refreshCombatMounts(); town.interaction()
    expect(mount.temporaryCombatId).toBe('town-combat'); expect(mount.availableForPlayer).toBe(true)
    const key = { code: 'KeyE', preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() }
    town.key(key); expect(player.currentMount).toBe(mount)
    town.key(key); expect(player.isMounted).toBe(false)
    town.interaction(); town.key(key); expect(player.currentMount).toBe(mount)
    town.finish('player_defeated')
    expect(player.isMounted).toBe(false); expect(mount.disposed).toBe(false)
    expect(mount.temporaryCombatId).toBeNull(); expect(mount.availableForPlayer).toBe(false)
    expect(town.profile.ownedMounts).toEqual([])
  })

  it('Town combat cleanup removes released battlefield horses without touching services or owned mounts', () => {
    const { scene, rider, mount, player } = fixture()
    const service = new Mount(scene, MountType.HORSE, 10, 10, 50), owned = new Mount(scene, MountType.BLACK_CAT, 20, 10, 50)
    onTestFinished(() => service.dispose())
    onTestFinished(() => owned.dispose())
    disposables.push(service, owned); service.reservedForTown = true
    const town = createTownCombatFixture()
    town.profile = createCareerProfile('roman'); town.profile.ownedMounts = ['black-cat']; town.profile.selectedMountId = 'black-cat'
    town.profile.activeMission = createActiveCareerMission('recruit-bandits-02', 1, 12, 0, 'temporary-test')
    town.player = player; town.mounts = [service]; town.residents = []
    town.mission = { battlefieldMounts: [mount, service, owned], fieldNpcs: [rider], freezeStats: vi.fn() }
    town.careerMounts = { activeMount: owned }; town.event = { hostile: false }; town.stableHorses = [service]
    town.refreshCombatMounts()
    expect([...town.temporaryMounts.all]).toEqual([mount])
    damageNpc(rider, 9999, ctx(player, 'body')); player.mountVehicle(mount)
    town.missionSettlement = { finish: () => ({ status: 'saved', result: {} }) }; town.openMissionResult = vi.fn()
    town.finishMission('victory')
    expect(town.mission.freezeStats).toHaveBeenCalledOnce()
    expect(mount.disposed).toBe(true); expect(player.isMounted).toBe(false)
    expect(service.disposed).toBe(false); expect(owned.disposed).toBe(false)
    expect(town.profile.selectedMountId).toBe('black-cat'); expect(town.profile.ownedMounts).toEqual(['black-cat'])
  })

  it('failed Town settlement save preserves temporary riding until retry succeeds', () => {
    const { rider, mount, player } = fixture()
    const town = createTownCombatFixture()
    town.profile = createCareerProfile('roman'); town.profile.townEvent = { id: 'town-combat', state: 'hostile' }
    town.player = player; town.openPanel = vi.fn(); town.button = vi.fn()
    town.temporaryMounts.track(mount, 'town-combat'); damageNpc(rider, 9999, ctx(player, 'body')); player.mountVehicle(mount)
    town.commit = vi.fn(() => false); town.finish('player_defeated')
    expect(player.currentMount).toBe(mount); expect(mount.disposed).toBe(false)
    town.commit.mockReturnValue(true); town.finish('player_defeated')
    expect(player.isMounted).toBe(false); expect(mount.disposed).toBe(true)
  })
})
