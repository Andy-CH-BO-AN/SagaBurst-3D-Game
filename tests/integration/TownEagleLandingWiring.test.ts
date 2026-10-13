import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { snapshotPersonalMission } from '../../src/career/CareerPersonalSquadMission'
import type { EagleFlightSnapshot } from '../../src/movement/EagleFlightController'
import type { NavigationWorld } from '../../src/navigation/NavigationWorld'
import type { Player } from '../../src/player/Player'
import type { EnemyEaglePatrolController } from '../../src/town/EnemyEaglePatrolController'
import { TownEagleGarrisonController } from '../../src/town/TownEagleGarrisonController'
import { townEagleRoster } from '../../src/town/TownEagleGarrison'
import type { TownPersonalSquadController } from '../../src/town/TownPersonalSquadController'
import { TownScene } from '../../src/town/TownScene'
import { EagleLandingQueue } from '../../src/world/EagleLandingQueue'
import { Mount, MountType } from '../../src/world/Mount'
import { NPC, AIType, Faction } from '../../src/world/NPC'
import { gameplayNpcSpawns } from '../../src/world/NpcSpawnScheduler'
import { gameplayNpcSpawnDriver } from '../helpers/npcSpawnFrames'
import { resetSpawnRecording } from '../helpers/npcSpawnRecording'

// Constructor boundaries only: the real Town callers, controllers and queues run;
// these doubles accept flight observations but do not simulate locomotion or combat.
vi.mock('../../src/world/NPC', async original => {
  const { RecordingNpc } = await import('../helpers/npcSpawnRecording')
  return { ...(await original<typeof import('../../src/world/NPC')>()), NPC: class extends RecordingNpc {
    isFalling = false
    readonly setEagleCruiseAltitude = vi.fn()
    readonly updateTownTravel = vi.fn()
    readonly updateTownPeace = vi.fn()
    readonly releaseCombatTarget = vi.fn()
    readonly refitCombat = vi.fn()
  } }
})
vi.mock('../../src/world/Mount', async original => {
  const { RecordingMount } = await import('../helpers/npcSpawnRecording')
  return { ...(await original<typeof import('../../src/world/Mount')>()), Mount: class extends RecordingMount {
    get flight() { const flight = super.flight; return flight && Object.assign(flight, flight.snapshot()) }
    get isAirborne() { return this.flight?.phase !== 'grounded' }
  } }
})
vi.mock('../../src/world/Terrain', async original => ({
  ...(await original<typeof import('../../src/world/Terrain')>()), getTerrainHeight: () => 0,
}))

const cleanups: (() => void)[] = []
afterEach(() => {
  cleanups.splice(0).reverse().forEach(dispose => dispose())
  expect(gameplayNpcSpawns.pending).toBe(0)
  resetSpawnRecording()
  vi.restoreAllMocks()
})

const cruise: EagleFlightSnapshot = {
  phase: 'cruise', yaw: 0, pitch: 0, bank: 0, speed: 12, velocity: { x: 0, y: 0, z: 12 },
}
type TownOwner = 'garrison' | 'HR'
interface TownLandingCaller {
  enemyEaglePatrol: EnemyEaglePatrolController
  personalSquad?: TownPersonalSquadController
  initializeEnemyEaglePatrol(faction: CareerProfile['faction']): void
  initializePersonalSquad(): void
}

/** Three enemy pairs plus one town pair, all recording doubles; zero real actors,
 * TownWorlds, navigation graphs, assets or renderers. Exercise the actual TownScene
 * constructor/restore wiring rather than manually supplying a separate enemy queue. */
function fixture(townOwner: TownOwner) {
  const scene = new THREE.Scene(), queue = new EagleLandingQueue()
  const profile: CareerProfile = { ...createCareerProfile('roman'), rank: 'captain' }
  const player = { group: new THREE.Group(), dead: false, targetable: false,
    combatPosition: new THREE.Vector3() } as Player
  const navigation = {} as NavigationWorld
  const town = Object.assign(Object.create(TownScene.prototype) as TownLandingCaller, {
    scene, profile, player, navigation, eagleLandingQueue: queue, combatMounts: [],
    world: { faction: 'roman', airspaceObstacles: [], obstacles: [],
      hr: { muster: [{ x: 30, z: 30, yaw: 0 }] },
      eagleTraining: { pads: [{ id: 'private-eagle-pad:1', x: 30, z: 0, yaw: 0 }] } },
    synchronizeCommandActors: vi.fn(),
  })
  town.initializeEnemyEaglePatrol('roman')
  const enemy = town.enemyEaglePatrol
  cleanups.push(() => enemy.dispose())
  gameplayNpcSpawnDriver.drain()
  expect(enemy.actors).toHaveLength(3)

  let requestTownReturn: () => void, townReturning: () => boolean
  if (townOwner === 'garrison') {
    const spec = townEagleRoster({ pads: [{ id: 'town-eagle-pad:1', x: 0, z: 80, yaw: 0 }] })[0]
    const npc = new NPC(scene, spec.x, spec.z, Faction.TOWN, 'roman', AIType.RANGED, 'Town eagle', 3, false)
    const mount = new Mount(scene, MountType.XONGKORO, 0, 80)
    cleanups.push(() => { npc.dispose(); mount.dispose() })
    const garrison = new TownEagleGarrisonController([{ spec, npc, homeMount: mount }], queue)
    mount.group.position.y = 25; mount.flight!.restore(cruise); npc.mountVehicle(mount)
    requestTownReturn = () => {
      garrison.update(npc, 0, true, player.combatPosition, [], navigation)
      garrison.update(npc, 0, false, player.combatPosition, [], navigation)
    }
    townReturning = () => garrison.dutyFor(npc) === 'returning'
  } else {
    profile.personalSquad = { members: [{ id: 'personal:eagle', type: 'captain',
      equipment: { melee: null, ranged: null, shield: null, mount: 'xongkoro' } }] }
    town.initializePersonalSquad()
    const personal = town.personalSquad!
    cleanups.push(() => personal.cleanup())
    const saved = snapshotPersonalMission(profile, 'town-home')!
    saved.state = 'ACTIVE'
    saved.members['personal:eagle'] = { status: 'deployed', hp: 100, order: 'follow',
      position: { x: 30, y: 25, z: 40, yaw: 0 },
      mount: { hp: 100, mounted: true, position: { x: 30, y: 25, z: 40, yaw: 0 }, flight: cruise } }
    personal.restoreMission(saved)
    gameplayNpcSpawnDriver.drain()
    expect(personal.error).toBeUndefined()
    expect(personal.actors).toHaveLength(1)
    requestTownReturn = () => { expect(personal.dismiss()).toBe(true) }
    townReturning = () => vi.mocked(personal.actors[0].setEagleFlightOrder).mock.lastCall?.[0]?.kind === 'return'
  }

  const advance = (dt = 0) => enemy.prepareFrame(dt, enemy.actors, player)
  const requestEnemyReturns = () => {
    // Controller takeoff cadence is real; only the resulting flight observation is supplied.
    for (let index = 0; index < 3; index++) {
      advance(index === 0 ? 0 : 1.5)
      enemy.mounts[index].group.position.y = 25
      enemy.mounts[index].flight!.restore(cruise)
    }
    for (const npc of enemy.actors) npc.restoreCombatAmmo(0)
    advance()
  }
  const landEnemy = (index: number) => {
    const home = enemy.checkpoint().pairs[index].home, mount = enemy.mounts[index]
    mount.group.position.set(home.x, 0, home.z)
    mount.flight!.restore({ ...cruise, phase: 'grounded', yaw: home.yaw, speed: 0, velocity: { x: 0, y: 0, z: 0 } })
    advance()
  }
  return { enemy, queue, requestTownReturn, townReturning, requestEnemyReturns, landEnemy }
}

describe('TownScene independent landing-base wiring', () => {
  it.each(['garrison', 'HR'] as const)('an enemy approach cannot block the %s town approach', owner => {
    const f = fixture(owner)
    f.requestEnemyReturns()
    expect(f.enemy.checkpoint().pairs.map(pair => pair.state)).toEqual(['RETURNING', 'RETURN_QUEUE', 'RETURN_QUEUE'])

    f.requestTownReturn()

    expect(f.townReturning()).toBe(true)
    // Town users still share their existing queue, even while the enemy queue is active.
    expect(f.queue.request('player')).toBe(false)
  })

  it.each(['garrison', 'HR'] as const)('an active %s town approach cannot block the three serialized enemy returns', owner => {
    const f = fixture(owner)
    f.requestTownReturn()
    expect(f.townReturning()).toBe(true)

    f.requestEnemyReturns()

    expect(f.enemy.checkpoint().pairs.map(pair => pair.state)).toEqual(['RETURNING', 'RETURN_QUEUE', 'RETURN_QUEUE'])
    f.landEnemy(0)
    expect(f.enemy.checkpoint().pairs.map(pair => pair.state)).toEqual(['RESTING', 'RETURNING', 'RETURN_QUEUE'])
    f.landEnemy(1)
    expect(f.enemy.checkpoint().pairs.map(pair => pair.state)).toEqual(['RESTING', 'RESTING', 'RETURNING'])
    f.landEnemy(2)
    expect(f.enemy.checkpoint().pairs.map(pair => pair.state)).toEqual(['RESTING', 'RESTING', 'RESTING'])
    expect(f.townReturning()).toBe(true)
    expect(f.queue.request('player')).toBe(false)
  })
})
