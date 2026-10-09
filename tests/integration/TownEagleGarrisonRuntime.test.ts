import { TownScene } from '../../src/town/TownScene'
import { createEnemyTownAssaultMission } from '../../src/career/EnemyTownAssault'
import type { CareerProfile } from '../../src/career/CareerProfile'
import * as THREE from 'three'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { NPC, AIType, Faction } from '../../src/world/NPC'
import { Mount, MountType } from '../../src/world/Mount'
import { Player } from '../../src/player/Player'
import { NavigationWorld } from '../../src/navigation/NavigationWorld'
import { TownEagleGarrisonController } from '../../src/town/TownEagleGarrisonController'
import { townEagleRoster } from '../../src/town/TownEagleGarrison'
import { townMilitaryEquipment } from '../../src/town/TownRules'
import { cloneCareerProfile, createCareerProfile } from '../../src/career/CareerProfile'
import type { TownEagleGarrisonState } from '../../src/town/TownEagleGarrisonState'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import { MemoryStorage } from '../helpers/memoryStorage'
import { advanceUntil } from '../helpers/simulation'

vi.mock('../../src/world/XongkoroVisual', async () => ({ XongkoroVisual: (await import('../helpers/gameplayEagleVisual')).GameplayEagleVisualDouble }))
vi.mock('../../src/world/Terrain', async original => ({ ...(await original<typeof import('../../src/world/Terrain')>()), getTerrainHeight: () => 0 }))

/** One real rider/eagle, one non-targetable Player for the normal combat caller; zero GLBs/TownWorlds. */
function fixture() {
  const scene = new THREE.Scene(), spec = townEagleRoster({ pads: [{ id: 'town-eagle-pad:1', x: 0, z: 0, yaw: 0 }] })[0]
  const gear = townMilitaryEquipment('viking', spec)
  const npc = new NPC(scene, spec.x, spec.z, Faction.TOWN, 'viking', AIType.RANGED, 'Town eagle archer', 3, false, gear.loadout, gear.presetId, undefined, spec.id)
  const mount = new Mount(scene, MountType.XONGKORO, 0, 0, 0), player = new Player(scene)
  player.spectatorOnly = true
  npc.setTownPeaceful(); mount.reservedForTown = true
  onTestFinished(() => { npc.dispose(); mount.dispose(); player.dispose() })
  const runtime = new TownEagleGarrisonController([{ spec, npc, homeMount: mount }]), navigation = new NavigationWorld()
  navigation.sync([])
  const targets: NPC[] = [], shots: THREE.Vector3[] = []
  const step = (combat: boolean) => {
    navigation.beginFrame(); runtime.beginFrame(1 / 60)
    const handled = runtime.update(npc, 1 / 60, combat, new THREE.Vector3(0, 20, 0), [], navigation, [], [mount])
    if (!handled) npc.update(1 / 60, player, [npc, ...targets], [], [], { setFill() {} }, () => {}, origin => { shots.push(origin.clone()) }, false, 30, null, null, navigation)
    if (mount.dead || !mount.riderNpc) mount.update(1 / 60, [])
  }
  const report = () => JSON.stringify({ duty: runtime.dutyFor(npc), rider: npc.group.position, mount: mount.group.position, flight: mount.flight!.snapshot() })
  return { runtime, npc, mount, spec, step, report, scene, targets, shots }
}

describe('Town eagle physical duty caller', () => {
  it.each([
    { transition: 'Enemy Town Assault is cleared', worldFaction: 'viking', nextFaction: 'roman', assault: true },
    { transition: 'the player changes faction', worldFaction: 'roman', nextFaction: 'viking', assault: false },
  ] as const)('keeps both cities separate across consecutive commits after $transition', ({ worldFaction, nextFaction, assault }) => {
    // The commit/storage wiring needs snapshot data, not real actors or a rendered TownWorld.
    const state = (sceneKey: string, ammo: number): TownEagleGarrisonState => ({
      version: 1, sceneKey, pairs: [{
        riderId: 'town-eagle-rider:1', mountId: 'town-eagle-mount:1', homePadId: 'town-eagle-pad:1',
        duty: 'casualty', hp: 23, ammo, position: { x: 4, y: 0, z: 0, yaw: 0 }, mounted: false, refitAllowed: false,
        mount: { hp: 0, position: { x: 0, y: 0, z: 0, yaw: 0 },
          flight: { phase: 'grounded', yaw: 0, pitch: 0, bank: 0, speed: 0, velocity: { x: 0, y: 0, z: 0 } } },
      }],
    })
    const profile = createCareerProfile('roman'), store = new CareerProfileStore(new MemoryStorage())
    profile.townEagleGarrisons = { roman: state('town:roman', 7), viking: state('town:viking', 3) }
    if (assault) profile.activeMission = createEnemyTownAssaultMission('city-transition')
    const otherFaction = worldFaction === 'roman' ? 'viking' : 'roman'
    const untouchedCity = structuredClone(profile.townEagleGarrisons[otherFaction])
    let ammo = 5
    const eagleGarrison: Pick<TownEagleGarrisonController, 'snapshot'> = { snapshot: sceneKey => state(sceneKey, ammo) }
    // Only the production commit's dependencies are supplied at this prototype seam.
    const town = Object.assign(Object.create(TownScene.prototype), {
      profile, store, world: { faction: worldFaction }, garrisonRestored: true, eagleGarrison,
      skills: { skillState: profile.skills }, clearCareerSkillSaveTimer: vi.fn(),
    }) as { profile: CareerProfile; commit(next: CareerProfile): boolean }
    const transition = cloneCareerProfile(town.profile)
    transition.activeMission = undefined
    transition.faction = nextFaction
    expect(town.commit(transition)).toBe(true)
    expect(store.load()!.townEagleGarrisons![worldFaction]!.pairs[0].ammo).toBe(5)
    // The old scene is still alive: another save must keep using its constructed world's identity.
    ammo = 2
    expect(town.commit(cloneCareerProfile(town.profile))).toBe(true)
    const saved = store.load()!.townEagleGarrisons!
    expect(saved[worldFaction]).toEqual(state(`town:${worldFaction}`, 2))
    expect(saved[otherFaction]).toEqual(untouchedCity)
  })
  it('authorizes free-hostility refit only after the matching settlement saves and preserves it through restart', () => {
    const { runtime, npc, mount, spec, step } = fixture()
    npc.restoreCombatAmmo(7); mount.takeDamage(10000); step(true)
    const profile = createCareerProfile('roman'), storage = new MemoryStorage(), store = new CareerProfileStore(storage)
    profile.townEvent = { id: 'free-hostility', state: 'hostile' }
    profile.townEagleGarrisons = { roman: runtime.snapshot('town:roman') }
    const actions: (() => void)[] = [], restarted: CareerProfile[] = []
    const town = Object.assign(Object.create(TownScene.prototype), {
      profile, store, world: { faction: 'roman' }, garrisonRestored: true, eagleGarrison: runtime,
      residents: [{ spec, npc, homeMount: mount }], careerSaveFailures: 0,
      skills: { skillState: profile.skills }, clearCareerSkillSaveTimer: vi.fn(),
      temporaryMounts: { cleanup: vi.fn() }, openPanel: () => ({}),
      button: (_panel: unknown, _label: string, action: () => void) => { actions.push(action) },
      dispose: vi.fn(), onRestart: (next: CareerProfile) => { restarted.push(next) },
    }) as { profile: CareerProfile; commit(next: CareerProfile): boolean; finish(result: 'town_defeated'): void }
    expect(town.commit(cloneCareerProfile(profile))).toBe(true)
    const hostileSnapshot = store.load()!.townEagleGarrisons!.roman!
    expect(hostileSnapshot.pairs[0]).toMatchObject({
      riderId: 'town-eagle-rider:1', mountId: 'town-eagle-mount:1', homePadId: 'town-eagle-pad:1',
      duty: 'casualty', ammo: 7, refitAllowed: false, mount: { hp: 0 },
    })
    const mismatched = cloneCareerProfile(profile)
    mismatched.townEvent = { id: 'another-event', state: 'settled' }
    expect(town.commit(mismatched)).toBe(true)
    expect(runtime.snapshot('town:roman').pairs[0].refitAllowed).toBe(false)
    expect(town.commit(cloneCareerProfile(profile))).toBe(true)

    storage.failWrites = true
    town.finish('town_defeated')
    expect(town.profile.townEvent!.state).toBe('hostile')
    expect(store.load()!.townEvent!.state).toBe('hostile')
    expect(runtime.snapshot('town:roman').pairs[0].refitAllowed).toBe(false)
    expect(mount.dead).toBe(true)
    storage.failWrites = false
    actions.pop()!() // The actual failed-settlement panel's retry action.
    expect(town.profile.townEvent!.state).toBe('settled')
    expect(town.profile.faction).toBe('viking')
    expect(runtime.snapshot('town:roman').pairs[0].refitAllowed).toBe(true)
    expect(mount.dead).toBe(true) // Authorization never performs an immediate refit/teleport.
    expect(town.commit(cloneCareerProfile(town.profile))).toBe(true)
    const saved = store.load()!.townEagleGarrisons!
    expect(saved.roman!.pairs[0]).toMatchObject({ duty: 'casualty', refitAllowed: true, mount: { hp: 0 } })
    actions.pop()!() // The actual settled-result panel's scene restart action.
    expect(restarted).toHaveLength(1)
    expect(restarted[0].townEagleGarrisons).toEqual(saved)
    // One reload graph owns both forbidden early refit and authorized settlement refit.
    const replacement = fixture()
    replacement.runtime.restore(hostileSnapshot, 'town:roman')
    replacement.step(true); replacement.step(false)
    expect(replacement.mount.dead).toBe(true)
    expect(replacement.npc.combatAmmo).toBe(7)
    expect(replacement.runtime.dutyFor(replacement.npc)).toBe('casualty')
    replacement.runtime.restore(saved.roman, 'town:roman')
    replacement.step(false)
    expect(replacement.mount.dead).toBe(false)
    expect(replacement.runtime.dutyFor(replacement.npc)).toBe('standby')
    expect(replacement.npc.mount).toBeNull()
  })
  it('stands beside a grounded reserved eagle, walks to mount, climbs, returns to its pad and walks back without teleporting', () => {
    const { runtime, npc, mount, spec, step, report, scene, targets, shots } = fixture()
    for (let frame = 0; frame < 60; frame++) step(false)
    expect(npc.mount).toBeNull(); expect(mount.isAirborne).toBe(false)
    expect(mount.availableForPlayer).toBe(false)
    const start = npc.group.position.clone()
    npc.beginExternalThreat(); step(true)
    expect(runtime.dutyFor(npc)).toBe('walking-to-mount')
    expect(npc.mount).toBeNull(); expect(npc.group.position.distanceTo(start)).toBeGreaterThan(0); expect(npc.group.position.distanceTo(mount.group.position)).toBeGreaterThan(2.4)
    advanceUntil(() => mount.isAirborne && mount.group.position.y >= 19, () => step(true), { maxSimulationSeconds: 30, failureMessage: 'Town eagle walk/mount/climb' })
    expect(npc.mount).toBe(mount); expect(npc.hasActiveRangedWeapon).toBe(true)
    const airborne = mount.group.position.clone(); step(false)
    expect(runtime.dutyFor(npc)).toBe('returning'); expect(mount.group.position.distanceTo(airborne)).toBeLessThan(1)
    const enemy = new NPC(scene, mount.group.position.x, mount.group.position.z + 60, Faction.ENEMY, 'roman', AIType.MELEE, 'New legal threat', 1, false)
    onTestFinished(() => enemy.dispose()); targets.push(enemy)
    npc.beginExternalThreat(); step(true)
    expect(runtime.dutyFor(npc)).toBe('sortie')
    advanceUntil(() => shots.length > 0, () => step(true), { maxSimulationSeconds: 30, failureMessage: 'return interruption releases target suppression' })
    step(false)
    const returningShotCount = shots.length
    try {
      advanceUntil(() => runtime.dutyFor(npc) === 'standby', () => step(false), {
        maxSimulationSeconds: 120, failureMessage: 'Town eagle return and dismount',
      })
    } catch (error) {
      if (error instanceof Error) error.message += `: ${report()}`
      throw error
    }
    expect(runtime.dutyFor(npc), report()).toBe('standby')
    expect(shots).toHaveLength(returningShotCount)
    expect(npc.mount).toBeNull(); expect(mount.isAirborne).toBe(false)
    expect(Math.hypot(mount.group.position.x, mount.group.position.z)).toBeLessThan(3)
    expect(Math.hypot(npc.group.position.x - spec.x, npc.group.position.z - spec.z)).toBeLessThan(1)
  })
})
