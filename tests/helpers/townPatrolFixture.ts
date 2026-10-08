import * as THREE from 'three'
import { afterEach, beforeEach, vi } from 'vitest'
import { NavigationWorld } from '../../src/navigation/NavigationWorld'
import { TOWN_NAVIGATION_BOUNDS } from '../../src/town/TownBounds'
import { TownCavalryPatrolController } from '../../src/town/TownCavalryPatrolController'
import { townActorCaptainProfile, townMilitaryEquipment, townRoster, type TownPatrolId } from '../../src/town/TownRules'
import { TownWorld } from '../../src/town/TownWorld'
import { AIType, Faction, NPC } from '../../src/world/NPC'
import { Mount, MountType, mountTypeFromId } from '../../src/world/Mount'
import { HorseAssetRegistry } from '../../src/world/HorseAssetRegistry'
import { advanceUntil, type AdvanceUntilOptions } from './simulation'
import { createThreeTestScene, installFakeCanvasEnvironment } from './threeTestEnvironment'

function runCleanup(actions: readonly (() => void)[]): void {
  const errors: unknown[] = []
  for (const action of [...actions].reverse()) {
    try { action() } catch (error) { errors.push(error) }
  }
  if (errors.length) throw new AggregateError(errors, 'Town patrol fixture cleanup failed')
}

export interface TownPatrolFixtureOptions {
  faction?: 'roman' | 'viking'
  withWorld?: boolean
  /** Whole squads only: each selected patrol retains its canonical Captain and follower slots. */
  patrolIds?: readonly TownPatrolId[]
}

/** Explicit suite setup; importing this helper registers no hooks or asset loading. */
export function installTownPatrolFixtureEnvironment() {
  const fixtures = new Set<() => void>()

  // Substitute rendering only: travel, mount physics, collision and navigation remain real.
  // Per-test spies also work when another import has already loaded the registry.
  beforeEach(() => {
    vi.spyOn(HorseAssetRegistry, 'ready', 'get').mockReturnValue(true)
    vi.spyOn(HorseAssetRegistry, 'createInstance').mockImplementation(() => {
      const root = new THREE.Group(), saddleSeat = new THREE.Object3D()
      saddleSeat.position.y = 1.7; root.add(saddleSeat)
      return { root, saddleSeat, lod: new THREE.LOD(), skeleton: new THREE.Skeleton(),
        mixer: new THREE.AnimationMixer(root), stirrupLeft: new THREE.Object3D(),
        stirrupRight: new THREE.Object3D(), cameraSocket: new THREE.Object3D(),
        bounds: new THREE.Box3(), attribution: 'test rendering substitute', appearanceVariant: 0,
        setLocomotion() {}, setAppearanceVariant() {}, playOnce() {}, playDeath() {},
        playStudioClip() {}, update() {}, dispose() {}, togglePaused: () => false,
        debugState: () => ({ clip: 'idle', time: 0, playbackRate: 1, paused: false,
          lod: 0, variant: 0, mixerCount: 1, skeletonCount: 1 }),
      }
    })
  })

  afterEach(() => {
    try { runCleanup([...fixtures]) }
    finally { fixtures.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals() }
  })

  /** Arrange real patrol residents; own every allocation even when setup or assertions throw. */
  return function createTownPatrolFixture({ faction = 'roman', withWorld = false, patrolIds = ['A', 'B'] }: TownPatrolFixtureOptions = {}) {
    const cleanup: (() => void)[] = []
    let disposed = false
    const dispose = () => {
      if (disposed) return
      disposed = true
      fixtures.delete(dispose)
      runCleanup(cleanup)
    }
    fixtures.add(dispose)
    try {
      const scene = createThreeTestScene()
      const context = new Proxy<Record<string, unknown>>({ measureText: () => ({ width: 100 }) }, {
        get: (target, key) => typeof key === 'string' ? target[key] ?? (() => {}) : undefined,
      })
      cleanup.push(installFakeCanvasEnvironment({ context,
        imageData: class { constructor(public data: unknown, public width: number, public height: number) {} },
      }))
      const world = withWorld ? new TownWorld(faction, scene) : undefined
      if (world) cleanup.push(() => world.dispose())
      const residents = townRoster().filter(spec => spec.duty === 'patrol' && patrolIds.includes(spec.patrolId!)).map(spec => {
        const equipment = townMilitaryEquipment(faction, spec)
        const npc = new NPC(scene, spec.x, spec.z, Faction.TOWN, faction, AIType.MELEE, spec.id,
          equipment.level, true, equipment.loadout, equipment.presetId, undefined, spec.id)
        cleanup.push(() => npc.dispose())
        const captain = townActorCaptainProfile(faction, spec)
        const homeMount = new Mount(scene, captain ? mountTypeFromId(captain.mountOverride) : MountType.HORSE, spec.x, spec.z)
        cleanup.push(() => homeMount.dispose())
        homeMount.group.rotation.y = spec.yaw!; npc.mountVehicle(homeMount); npc.setTownPeaceful()
        return { spec, npc, homeMount, cycle: -1, walkTime: 0 }
      })
      const controller = new TownCavalryPatrolController(residents)
      const navigation = new NavigationWorld(TOWN_NAVIGATION_BOUNDS), camera = new THREE.Vector3(0, 0, 100)
      const obstacles = world?.obstacles ?? []
      navigation.sync(obstacles)
      const stepFrame = (excluded: ReadonlySet<NPC> = new Set()) => {
        navigation.beginFrame(); controller.beginFrame(excluded)
        for (const resident of residents) controller.updateResident(resident, .1, camera, obstacles, navigation)
      }
      const stepFrames = (frames: number, excluded: ReadonlySet<NPC> = new Set()) => {
        for (let frame = 0; frame < frames; frame++) stepFrame(excluded)
      }
      const advance = (condition: () => boolean, options: AdvanceUntilOptions) =>
        advanceUntil(condition, () => stepFrame(), { secondsPerStep: .1, ...options })
      return { scene, residents, controller, navigation, camera, obstacles, world,
        stepFrame, stepFrames, advanceUntil: advance, dispose }
    } catch (error) {
      dispose()
      throw error
    }
  }
}

export type TownPatrolFixture = ReturnType<ReturnType<typeof installTownPatrolFixtureEnvironment>>
