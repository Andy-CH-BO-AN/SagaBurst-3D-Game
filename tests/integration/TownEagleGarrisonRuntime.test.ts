import { TownScene } from '../../src/town/TownScene'
import { createEnemyTownAssaultMission } from '../../src/career/EnemyTownAssault'
import type { CareerProfile } from '../../src/career/CareerProfile'
import * as THREE from 'three'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { NPC, AIType, Faction } from '../../src/world/NPC'
import { Mount, MountType } from '../../src/world/Mount'
import { Player } from '../../src/player/Player'
import { NavigationWorld } from '../../src/navigation/NavigationWorld'
import { TownEagleGarrisonController, stageTownEaglePlayerCommand } from '../../src/town/TownEagleGarrisonController'
import { townEagleRoster } from '../../src/town/TownEagleGarrison'
import { townMilitaryEquipment } from '../../src/town/TownRules'
import { cloneCareerProfile, createCareerProfile } from '../../src/career/CareerProfile'
import type { TownEagleGarrisonState } from '../../src/town/TownEagleGarrisonState'
import { CareerProfileStore } from '../../src/career/CareerProfileStore'
import { MemoryStorage } from '../helpers/memoryStorage'
import { advanceUntil } from '../helpers/simulation'
import { EagleLandingQueue } from '../../src/world/EagleLandingQueue'

vi.mock('../../src/world/XongkoroVisual', async () => ({ XongkoroVisual: (await import('../helpers/gameplayEagleVisual')).GameplayEagleVisualDouble }))
vi.mock('../../src/world/Terrain', async original => ({ ...(await original<typeof import('../../src/world/Terrain')>()), getTerrainHeight: () => 0 }))

/** One real rider/eagle, one non-targetable Player for the normal combat caller; zero GLBs/TownWorlds. */
function fixture(landingQueue?: EagleLandingQueue) {
  const scene = new THREE.Scene(), spec = townEagleRoster({ pads: [{ id: 'town-eagle-pad:1', x: 0, z: 0, yaw: 0 }] })[0]
  const gear = townMilitaryEquipment('viking', spec)
  const npc = new NPC(scene, spec.x, spec.z, Faction.TOWN, 'viking', AIType.RANGED, 'Town eagle archer', 3, false, gear.loadout, gear.presetId, undefined, spec.id)
  const mount = new Mount(scene, MountType.XONGKORO, 0, 0, 0), player = new Player(scene)
  player.spectatorOnly = true
  npc.setTownPeaceful(); mount.reservedForTown = true
  onTestFinished(() => { npc.dispose(); mount.dispose(); player.dispose() })
  const runtime = new TownEagleGarrisonController([{ spec, npc, homeMount: mount }], landingQueue), navigation = new NavigationWorld()
  navigation.sync([])
  const targets: NPC[] = [], shots: THREE.Vector3[] = [], contacts: NPC[] = []
  const step = (combat: boolean) => {
    navigation.beginFrame(); runtime.beginFrame(1 / 60)
    landingQueue?.beginFrame(1 / 60)
    const handled = runtime.update(npc, 1 / 60, combat, new THREE.Vector3(0, 20, 0), [], navigation, [], [mount])
    if (!handled) npc.update(1 / 60, player, [npc, ...targets], [], [], { setFill() {} }, (_damage, _isPlayer, target) => { if (target) contacts.push(target) }, origin => { shots.push(origin.clone()) }, false, 30, null, null, navigation)
    if (mount.dead || !mount.riderNpc) mount.update(1 / 60, [])
  }
  const report = () => JSON.stringify({ duty: runtime.dutyFor(npc), rider: npc.group.position, mount: mount.group.position, flight: mount.flight!.snapshot() })
  return { runtime, npc, mount, spec, step, report, scene, targets, shots, contacts, player }
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
    const eagleGarrison: Pick<TownEagleGarrisonController, 'snapshot' | 'setAmbientPatrolAllowed'> = { setAmbientPatrolAllowed: vi.fn(), snapshot: sceneKey => state(sceneKey, ammo) }
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
    const queue = new EagleLandingQueue()
    const { runtime, npc, mount, spec, step, report, scene, targets, shots } = fixture(queue)
    for (let frame = 0; frame < 60; frame++) step(false)
    expect(npc.mount).toBeNull(); expect(mount.isAirborne).toBe(false)
    expect(mount.availableForPlayer).toBe(false)
    const start = npc.group.position.clone()
    npc.beginExternalThreat(); step(true)
    expect(runtime.dutyFor(npc)).toBe('walking-to-mount')
    expect(npc.mount).toBeNull(); expect(npc.group.position.distanceTo(start)).toBeGreaterThan(0); expect(npc.group.position.distanceTo(mount.group.position)).toBeGreaterThan(2.4)
    advanceUntil(() => mount.isAirborne && mount.group.position.y >= 19, () => step(true), { maxSimulationSeconds: 30, failureMessage: 'Town eagle walk/mount/climb' })
    expect(npc.mount).toBe(mount); expect(npc.hasActiveRangedWeapon).toBe(true)
    expect(queue.request('personal:landing')).toBe(true)
    const airborne = mount.group.position.clone(); step(false)
    expect(runtime.dutyFor(npc)).toBe('return-queue'); expect(mount.group.position.distanceTo(airborne)).toBeLessThan(1)
    queue.release('personal:landing')
    advanceUntil(() => runtime.dutyFor(npc) === 'returning', () => step(false), {
      maxSimulationSeconds: 5, failureMessage: 'Town caller waits for private final approach clearance',
    })
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
    queue.beginFrame(3)
    expect(queue.request('personal:next')).toBe(true)
  })
})

it('autonomously walks, takes off, finishes a bounded circuit, lands and refits before resting', () => {
  // One real rider/mount protects physical flight and grounded refit; route/clock matrices use data doubles.
  const { runtime, npc, mount, step, report } = fixture()
  runtime.setAmbientPatrolAllowed(true)
  npc.restoreCombatHealth(npc.maxHp - 10); npc.restoreCombatAmmo(7); mount.currentHp -= 20
  const initial = mount.group.position.clone()
  step(false)
  expect(runtime.dutyFor(npc)).toBe('walking-to-mount')
  expect(mount.group.position).toEqual(initial)
  advanceUntil(() => mount.isAirborne && mount.group.position.y >= 19, () => step(false), {
    maxSimulationSeconds: 35, failureMessage: 'Autonomous physical takeoff',
  })
  expect(runtime.dutyFor(npc)).toBe('patrolling')
  expect(npc.hp).toBe(npc.maxHp - 10); expect(npc.combatAmmo).toBe(7); expect(mount.currentHp).toBe(mount.maxHp - 20)
  const waypoint = runtime.snapshot('town:roman').pairs[0].patrol!.waypoint
  npc.beginExternalThreat(); step(true)
  expect(runtime.dutyFor(npc)).toBe('sortie')
  step(false)
  expect(runtime.dutyFor(npc)).toBe('patrolling')
  expect(runtime.snapshot('town:roman').pairs[0].patrol!.waypoint).toBe(waypoint)
  try {
    advanceUntil(() => runtime.dutyFor(npc) === 'resting', () => step(false), {
      maxSimulationSeconds: 300, failureMessage: 'Autonomous circuit/return/refit',
    })
  } catch (error) {
    if (error instanceof Error) error.message += `: ${report()}`
    throw error
  }
  expect(mount.isAirborne).toBe(false); expect(npc.mount).toBeNull()
  expect(npc.hp).toBe(npc.maxHp); expect(npc.combatAmmo).toBe(30); expect(mount.currentHp).toBe(mount.maxHp)
  for (let frame = 0; frame < 60; frame++) step(false)
  expect(runtime.dutyFor(npc)).toBe('resting')
})


it.each(['patrol', 'return', 'hold'] as const)('an airborne player formation replaces a stale %s order and keeps flying toward its own destination', nativeOrder => {
  // One real rider/eagle protects pilot movement, not only the command setter call.
  const { runtime, npc, mount, step, spec } = fixture()
  runtime.setAmbientPatrolAllowed(true)
  advanceUntil(() => mount.isAirborne && mount.group.position.y >= 19, () => step(false), {
    maxSimulationSeconds: 35, failureMessage: 'Native takeoff before command handoff',
  })
  const destination = mount.group.position.clone().add(new THREE.Vector3(95, 0, 0))
  const oldDestination = mount.group.position.clone().add(new THREE.Vector3(-150, 0, 0))
  npc.setEagleFlightOrder(nativeOrder === 'hold' ? { kind: 'hold' }
    : nativeOrder === 'return' ? { kind: 'return', target: oldDestination.setY(0), landingYaw: 0 }
    : { kind: 'patrol', target: oldDestination })
  const source = runtime.snapshot('town:roman')
  const staged = stageTownEaglePlayerCommand(source, [spec.id], true)
  expect(source.pairs[0].commandReturn).toBeUndefined()
  expect(staged.pairs[0].hp).toBe(npc.hp)
  expect(runtime.claimPlayerCommand(npc)).toBe(true)
  npc.assignFormationTarget(91, destination, new THREE.Vector3(0, 0, 1))
  const checkpoint = npc.combatFormationCheckpoint
  advanceUntil(() => Math.hypot(mount.group.position.x - destination.x, mount.group.position.z - destination.z) < 30,
    () => step(false), { maxSimulationSeconds: 45, failureMessage: `Player formation after ${nativeOrder}` })
  expect(runtime.isPlayerCommandOwned(npc)).toBe(true)
  expect(mount.isAirborne).toBe(true); expect(mount.group.position.y).toBeGreaterThan(10)
  expect(npc.combatFormationCheckpoint?.commandId).toBe(checkpoint?.commandId)
  expect(npc.combatFormationCheckpoint?.reached).toBe(true)
  expect(npc.tacticalOrder).toBe('formation')
})

it('boards the existing grounded eagle for Follow, preserves its leader, and dismisses through return/refit back to autonomous patrol', () => {
  const queue = new EagleLandingQueue()
  const { runtime, npc, mount, player, spec, step, report } = fixture(queue)
  runtime.setAmbientPatrolAllowed(true)
  npc.restoreCombatHealth(npc.maxHp - 10); npc.restoreCombatAmmo(7); mount.currentHp -= 20
  player.group.position.set(95, 0, 0)
  const start = npc.group.position.clone()
  expect(runtime.claimPlayerCommand(npc)).toBe(true)
  npc.assignFollowTarget(player, 0)
  step(false)
  expect(npc.mount).toBeNull()
  expect(npc.group.position.distanceTo(start)).toBeGreaterThan(0)
  expect(npc.group.position.distanceTo(start)).toBeLessThan(1)
  expect(npc.tacticalOrder).toBe('follow')
  advanceUntil(() => mount.isAirborne && mount.group.position.x > 45, () => step(false), {
    maxSimulationSeconds: 45, failureMessage: 'Claimed rider physically boards and follows east',
  })
  expect(npc.mount).toBe(mount); expect(npc.tacticalOrder).toBe('follow')
  player.group.position.set(-95, 0, 0)
  advanceUntil(() => mount.group.position.x < -45, () => step(false), {
    maxSimulationSeconds: 60, failureMessage: 'Preserved follow leader moves west after boarding',
  })
  expect(npc.hp).toBe(npc.maxHp - 10); expect(npc.combatAmmo).toBe(7); expect(mount.currentHp).toBe(mount.maxHp - 20)
  expect(queue.request('personal:other-eagle')).toBe(true)
  const before = mount.group.position.clone()
  expect(runtime.releasePlayerCommand(npc)).toBe(true)
  step(false)
  expect(runtime.dutyFor(npc)).toBe('return-queue')
  expect(mount.group.position.distanceTo(before)).toBeLessThan(1)
  queue.release('personal:other-eagle')
  advanceUntil(() => runtime.dutyFor(npc) === 'resting', () => step(false), {
    maxSimulationSeconds: 180, failureMessage: `Dismiss return/refit ${report()}`,
  })
  expect(npc.mount).toBeNull(); expect(mount.isAirborne).toBe(false)
  expect(npc.hp).toBe(npc.maxHp); expect(npc.combatAmmo).toBe(30); expect(mount.currentHp).toBe(mount.maxHp)
  expect(Math.hypot(npc.group.position.x - spec.x, npc.group.position.z - spec.z)).toBeLessThan(1)
  expect(runtime.snapshot('town:roman').pairs[0].commandReturn).toBeUndefined()
  advanceUntil(() => runtime.dutyFor(npc) === 'patrolling' && mount.isAirborne, () => step(false), {
    maxSimulationSeconds: 40, failureMessage: 'Same pair resumes autonomous patrol after dismissal rest',
  })
  expect(npc.mount).toBe(mount); expect(runtime.isPlayerCommandOwned(npc)).toBe(false)
})

it.each(['attack', 'charge', 'defend'] as const)('keeps a saved player %s order through native duty updates on the real airborne pair', order => {
  const { runtime, npc, mount, step, scene, targets, shots, contacts } = fixture()
  const target = new NPC(scene, 0, 80, Faction.ENEMY, 'roman', AIType.MELEE, 'Command target', 1, false)
  onTestFinished(() => target.dispose()); targets.push(target)
  runtime.setAmbientPatrolAllowed(true)
  advanceUntil(() => mount.isAirborne && mount.group.position.y >= 19, () => step(false), {
    maxSimulationSeconds: 35, failureMessage: 'Native takeoff before tactical command',
  })
  expect(runtime.claimPlayerCommand(npc)).toBe(true)
  npc.setTacticalOrder(order)
  const initial = mount.group.position.clone()
  advanceUntil(() => order === 'charge' ? contacts.length > 0 : shots.length > 0, () => step(true), {
    maxSimulationSeconds: 90, failureMessage: `Airborne ${order} hits or fires at legal target`,
  })
  expect(mount.group.position.distanceTo(initial)).toBeGreaterThan(1)
  expect(mount.isAirborne).toBe(true); expect(npc.tacticalOrder).toBe(order)
  expect(runtime.isPlayerCommandOwned(npc)).toBe(true)
})
