import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EnemyEaglePatrolController } from '../../src/town/EnemyEaglePatrolController'
import { parseEnemyEaglePatrolCheckpoint } from '../../src/town/EnemyEaglePatrolState'
import { NpcSpawnScheduler } from '../../src/world/NpcSpawnScheduler'
import type { NPC } from '../../src/world/NPC'
import { Faction } from '../../src/world/NPC'
import type { Mount } from '../../src/world/Mount'
import type { Player } from '../../src/player/Player'
import type { NavigationWorld } from '../../src/navigation/NavigationWorld'
import { RecordingNpc, RecordingMount, resetSpawnRecording } from '../helpers/npcSpawnRecording'
import type { OutskirtsFactories } from '../../src/town/TownOutskirtsWarfareController'
/** Constructor recording only: no real actor, asset, navigation or TownWorld materialization.
 * Extra methods record the air-owner protocol; they do not simulate flight or combat. */
class AirNpc extends RecordingNpc {
  isFalling = false
  deathPresentationComplete = false
  readonly setEagleCruiseAltitude = vi.fn()
  readonly updateTownTravel = vi.fn()
  readonly updateTownPeace = vi.fn()
  readonly refitCombat = vi.fn(() => {
    this.hp = this.maxHp
    this.combatAmmo = 30
  })
  readonly releaseCombatTarget = vi.fn()
}
class AirMount extends RecordingMount {
  isAirborne = false
  deathPresentationComplete = false
  reservedForTown = false
  disposed = false
  readonly takeDamage = vi.fn(() => {
    this.dead = true
    this.currentHp = 0
  })
}
const cleanup: Array<() => void> = []
afterEach(() => {
  cleanup
    .splice(0)
    .reverse()
    .forEach((fn) => fn())
  resetSpawnRecording()
  vi.restoreAllMocks()
})
function fixture(
  options: {
    suspend?: boolean
    bindFailure?: boolean
  } = {},
) {
  const scheduler = new NpcSpawnScheduler(),
    scene = new THREE.Scene(),
    npcs: AirNpc[] = [],
    mounts: AirMount[] = []
  const factories: OutskirtsFactories = {
    createNpc: (spec) => {
      const npc = new AirNpc(
        scene,
        spec.x,
        spec.z,
        spec.faction,
        spec.characterFaction,
        spec.aiType,
        spec.name,
        spec.tier,
        false,
        spec.loadout,
        spec.presetId,
        undefined,
        spec.actorId,
      )
      if (options.bindFailure)
        npc.mountVehicle.mockImplementation(() => {
          throw new Error('binding failure')
        })
      npcs.push(npc)
      return npc as unknown as NPC
    },
    createMount: (x, z, type) => {
      const mount = new AirMount(scene, type, x, z)
      mounts.push(mount)
      return mount as unknown as Mount
    },
  }
  const owner = new EnemyEaglePatrolController(
    scene,
    'roman',
    () => ({ rank: 'captain', faction: 'roman' }),
    [],
    {} as NavigationWorld,
    factories,
    scheduler,
    options.suspend,
  )
  cleanup.push(() => owner.dispose())
  const player = { dead: false, targetable: false, combatPosition: new THREE.Vector3() } as Player
  let frame = 0
  const tick = () => scheduler.tick(++frame)
  const drain = () => {
    for (let i = 0; i < 9 && scheduler.pending; i++) tick()
    expect(scheduler.pending).toBe(0)
  }
  const advance = (dt: number) => owner.prepareFrame(dt, owner.actors, player)
  return { owner, scheduler, scene, npcs, mounts, tick, drain, advance, player }
}
describe('independent ambient enemy eagle spawn and lifecycle wiring', () => {
  it('queues exactly three grounded unique T3 pairs and registers each only after binding', () => {
    const f = fixture()
    expect(f.owner.actors).toHaveLength(0)
    expect(f.scheduler.pending).toBe(3)
    f.tick()
    expect(f.owner.actors).toHaveLength(1)
    expect(f.scheduler.pending).toBe(2)
    f.drain()
    expect(f.npcs.map((n) => n.combatantId)).toEqual([
      'enemy-eagle-patrol:1:generation:0:rider',
      'enemy-eagle-patrol:2:generation:0:rider',
      'enemy-eagle-patrol:3:generation:0:rider',
    ])
    expect(f.mounts.map((m) => m.group.name)).toEqual([
      'enemy-eagle-patrol:1:generation:0:mount',
      'enemy-eagle-patrol:2:generation:0:mount',
      'enemy-eagle-patrol:3:generation:0:mount',
    ])
    for (const [index, npc] of f.npcs.entries()) {
      expect(npc.mountVehicle).toHaveBeenCalledWith(f.mounts[index])
      expect(f.mounts[index].isAirborne).toBe(false)
      expect(f.owner.owns(npc as unknown as NPC)).toBe(true)
      expect(f.mounts[index].reservedForTown).toBe(true)
    }
    f.owner.synchronizeRank()
    f.drain()
    expect(f.npcs).toHaveLength(3)
  })
  it('staggered takeoff sends waypoint orders once instead of resetting flight each frame', () => {
    const f = fixture()
    f.drain()
    f.advance(0)
    expect(f.owner.checkpoint().pairs.map((p) => p.state)).toEqual(['PATROLLING', 'WAITING', 'WAITING'])
    const count = f.npcs[0].setEagleFlightOrder.mock.calls.length
    f.advance(0.5)
    f.advance(0.5)
    expect(f.npcs[0].setEagleFlightOrder.mock.calls).toHaveLength(count)
    f.advance(0.5)
    expect(f.owner.checkpoint().pairs.map((p) => p.state)).toEqual(['PATROLLING', 'PATROLLING', 'WAITING'])
  })
  it('keeps a fractional-frame takeoff interval within the strict saved timer contract', () => {
    const f = fixture()
    f.drain()
    f.advance(0.6166666666666669)
    const saved = f.owner.checkpoint()
    expect(saved.nextTakeoffRemaining).toBe(1.5)
    expect(parseEnemyEaglePatrolCheckpoint(JSON.parse(JSON.stringify(saved)))).toEqual(saved)
  })
  it.each(['rider', 'mount', 'both'] as const)(
    '%s incapacity waits through59s then queues one generation at60s',
    (kind) => {
      const f = fixture()
      f.drain()
      if (kind !== 'mount') f.npcs[0].dead = true
      if (kind !== 'rider') f.mounts[0].dead = true
      f.advance(0)
      expect(f.owner.checkpoint().pairs[0].respawnRemaining).toBe(60)
      f.advance(30)
      f.advance(29)
      expect(f.scheduler.pending).toBe(0)
      expect(f.owner.checkpoint().pairs[0].respawnRemaining).toBe(1)
      f.advance(1)
      expect(f.scheduler.pending).toBe(1)
      expect(f.owner.checkpoint().pairs[0]).toMatchObject({ generation: 1, state: 'SPAWNING' })
      f.advance(0)
      expect(f.scheduler.pending).toBe(1)
      expect(f.npcs[0].dispose).not.toHaveBeenCalled()
      expect(f.mounts[0].dispose).not.toHaveBeenCalled()
      f.drain()
      expect(f.npcs[3].combatantId).toBe('enemy-eagle-patrol:1:generation:1:rider')
      f.npcs[0].isFalling = true
      f.npcs[0].deathPresentationComplete = true
      f.mounts[0].deathPresentationComplete = true
      f.advance(0)
      expect(f.npcs[0].dispose).not.toHaveBeenCalled()
      f.npcs[0].isFalling = false
      f.advance(0)
      expect(f.npcs[0].dispose).toHaveBeenCalledTimes(1)
      expect(f.mounts[0].dispose).toHaveBeenCalledTimes(1)
      expect(f.owner.owns(f.npcs[0] as unknown as NPC)).toBe(false)
    },
  )
  it('suspended formal missions materialize no roster and freeze saved cooldown then resume once', () => {
    const f = fixture({ suspend: true })
    expect(f.scheduler.pending).toBe(0)
    expect(f.owner.actors).toHaveLength(0)
    f.owner.resumeAfterMission()
    f.drain()
    f.npcs[0].dead = true
    f.advance(0)
    f.advance(30)
    f.owner.suspendForMission()
    const saved = f.owner.checkpoint()
    expect(saved.pairs[0].respawnRemaining).toBe(30)
    f.advance(900)
    expect(f.owner.actors).toHaveLength(0)
    expect(f.owner.mounts).toHaveLength(0)
    expect(f.owner.checkpoint()).toEqual(saved)
    f.owner.resumeAfterMission()
    f.owner.resumeAfterMission()
    expect(f.scheduler.pending).toBe(3)
    f.drain()
    expect(f.owner.checkpoint().pairs[0].respawnRemaining).toBe(30)
  })
  it('retires a stranded living riderless mount after replacement without skipping rider fall or corpse presentation', () => {
    const f = fixture()
    f.drain()
    f.npcs[0].dead = true
    f.mounts[0].isAirborne = true
    f.advance(0); f.advance(59)
    expect(f.mounts[0].dispose).not.toHaveBeenCalled()
    f.advance(1); f.advance(0)
    expect(f.mounts[0].dispose).not.toHaveBeenCalled()
    f.npcs[0].deathPresentationComplete = true
    f.npcs[0].isFalling = true
    f.advance(0); expect(f.mounts[0].dispose).not.toHaveBeenCalled()
    f.npcs[0].isFalling = false
    f.advance(0)
    expect(f.mounts[0].dispose).toHaveBeenCalledTimes(1)
    expect(f.npcs[0].dispose).toHaveBeenCalledTimes(1)
    f.drain()
    expect(f.owner.actors).toHaveLength(3)
    expect(f.owner.mounts).toHaveLength(3)
  })
  it('partial deployment saves queued injured flight checkpoint without healing and replays only once', () => {
    const f = fixture()
    f.drain()
    f.npcs[2].hp = 21
    f.npcs[2].combatAmmo = 7
    f.mounts[2].currentHp = 41
    const saved = parseEnemyEaglePatrolCheckpoint(JSON.parse(JSON.stringify(f.owner.checkpoint())))!
    f.owner.restore(saved)
    f.tick()
    const partial = parseEnemyEaglePatrolCheckpoint(JSON.parse(JSON.stringify(f.owner.checkpoint())))!
    expect(partial.pairs[2].state).toBe('SPAWNING')
    expect(partial.pairs[2].member).toMatchObject({ hp: 21, ammo: 7, mount: { hp: 41 } })
    f.owner.restore(partial)
    f.drain()
    expect(f.owner.actors).toHaveLength(3)
    expect(f.owner.actors[2].hp).toBe(21)
    expect(f.owner.actors[2].combatAmmo).toBe(7)
    expect(f.owner.mounts[2].currentHp).toBe(41)
  })
  it.each(['PATROLLING', 'ENGAGING', 'RETURNING', 'RETURN_QUEUE', 'RESTING', 'RESPAWN_COOLDOWN'] as const)(
    'reloads %s HP, ammo and flight through parser and repeated partial deployment',
    (state) => {
      const f = fixture()
      f.drain()
      f.npcs[0].hp = 24
      f.npcs[0].combatAmmo = 6
      f.mounts[0].currentHp = 39
      f.mounts[0].flight!.restore({
        phase: 'cruise',
        yaw: 0.4,
        pitch: 0.1,
        bank: 0.2,
        speed: 12,
        velocity: { x: 4, y: 1, z: 11 },
      })
      const saved = f.owner.checkpoint()
      saved.pairs[0].state = state
      saved.pairs[0].respawnRemaining = state === 'RESPAWN_COOLDOWN' ? 17 : 0
      if (state === 'RESPAWN_COOLDOWN') {
        saved.pairs[0].member!.hp = 0
        saved.pairs[0].member!.status = 'dead'
      }
      f.owner.restore(parseEnemyEaglePatrolCheckpoint(JSON.parse(JSON.stringify(saved))))
      // Saving again before the first scheduler frame preserves not-yet-materialized state.
      const pending = parseEnemyEaglePatrolCheckpoint(JSON.parse(JSON.stringify(f.owner.checkpoint())))!
      expect(pending.pairs[0].member).toEqual(saved.pairs[0].member)
      f.owner.restore(pending)
      f.drain()
      expect(f.owner.actors[0].hp).toBe(state === 'RESPAWN_COOLDOWN' ? 0 : 24)
      expect(f.owner.actors[0].combatAmmo).toBe(6)
      expect(f.owner.mounts[0].currentHp).toBe(39)
      expect(f.owner.mounts[0].flight!.snapshot()).toEqual(saved.pairs[0].member!.mount!.flight)
      expect(f.owner.checkpoint().pairs[0].respawnRemaining).toBe(state === 'RESPAWN_COOLDOWN' ? 17 : 0)
      expect(f.owner.checkpoint().pairs[0].state).toBe(
        state === 'RETURNING' ? 'RETURN_QUEUE' : state === 'ENGAGING' ? 'PATROLLING' : state,
      )
    },
  )
  it('reload at exactly60s preserves one pending next-generation deployment and takeoff spacing', () => {
    const f = fixture()
    f.drain()
    f.advance(0)
    f.npcs[0].dead = true
    f.advance(0)
    f.advance(60)
    const saved = parseEnemyEaglePatrolCheckpoint(JSON.parse(JSON.stringify(f.owner.checkpoint())))!
    expect(saved.pairs[0]).toMatchObject({ generation: 1, state: 'SPAWNING', arrivalState: 'WAITING' })
    f.owner.restore(saved)
    f.drain()
    expect(f.owner.actors[0].combatantId).toBe('enemy-eagle-patrol:1:generation:1:rider')
    expect(f.owner.actors).toHaveLength(3)
    f.advance(0)
    const spaced = f.owner.checkpoint()
    expect(spaced.nextTakeoffRemaining).toBeGreaterThan(0)
    f.owner.restore(spaced)
    f.drain()
    expect(f.owner.checkpoint().nextTakeoffRemaining).toBe(spaced.nextTakeoffRemaining)
  })
  it('a foreign eagle parked at the external home blocks takeoff', () => {
    const f = fixture()
    f.drain()
    const home = f.owner.checkpoint().pairs[0].home
    const foreign = new AirMount(f.scene, f.mounts[0].type, home.x, home.z)
    f.owner.setLandingOccupants([foreign as unknown as Mount])
    f.advance(0)
    expect(f.owner.checkpoint().pairs[0].state).toBe('WAITING')
    f.owner.setLandingOccupants([])
    f.advance(1.5)
    expect(f.owner.checkpoint().pairs[0].state).toBe('PATROLLING')
  })
  it('binding failure rolls back rider and mount and cancels other queued pairs', () => {
    const f = fixture({ bindFailure: true })
    f.tick()
    expect(f.scheduler.pending).toBe(0)
    expect(f.owner.actors).toHaveLength(0)
    expect(f.owner.mounts).toHaveLength(0)
    expect(f.npcs[0].dispose).toHaveBeenCalledTimes(1)
    expect(f.mounts[0].dispose).toHaveBeenCalledTimes(1)
    expect(f.owner.batches.some((b) => b.status === 'failed')).toBe(true)
    f.owner.retryFailedDeployment()
    expect(f.scheduler.pending).toBe(3)
    expect(f.owner.checkpoint().pairs.map((p) => p.generation)).toEqual([0, 0, 0])
  })
  it('replacement failure remains durable without healing unaffected aircraft on reload', () => {
    const options = { bindFailure: false }
    const f = fixture(options)
    f.drain()
    f.npcs[1].hp = 19
    f.npcs[1].combatAmmo = 4
    f.mounts[1].currentHp = 38
    f.mounts[1].flight!.restore({
      phase: 'cruise',
      yaw: 0.4,
      pitch: 0,
      bank: 0,
      speed: 12,
      velocity: { x: 4, y: 0, z: 11 },
    })
    f.npcs[0].dead = true
    f.advance(0)
    f.advance(60)
    options.bindFailure = true
    f.tick()
    const saved = parseEnemyEaglePatrolCheckpoint(JSON.parse(JSON.stringify(f.owner.checkpoint())))!
    expect(saved.pairs[1].member).toMatchObject({ hp: 19, ammo: 4, mount: { hp: 38, flight: { phase: 'cruise' } } })
    f.owner.suspendForMission()
    expect(f.owner.checkpoint()).toEqual(saved)
    options.bindFailure = false
    f.owner.resumeAfterMission()
    f.drain()
    expect(f.owner.actors[1].hp).toBe(19)
    expect(f.owner.actors[1].combatAmmo).toBe(4)
    expect(f.owner.mounts[1].currentHp).toBe(38)
    expect(f.owner.mounts[1].flight!.snapshot().phase).toBe('cruise')
  })
  it('bounded air-priority target is released when it leaves the route leash', () => {
    const f = fixture()
    f.drain()
    const observer = f.npcs[0]
    const target = new AirNpc(
      f.scene,
      -180,
      -200,
      Faction.TOWN,
      'roman',
      observer.aiType,
      'defender',
      3,
      false,
      observer.loadout,
    )
    const mount = new AirMount(f.scene, f.mounts[0].type, -180, -200)
    mount.isAirborne = true
    target.mountVehicle(mount)
    f.owner.prepareFrame(0, [...f.owner.actors, target as unknown as NPC], f.player)
    expect(observer.setMissionCombatTarget).toHaveBeenLastCalledWith(target)
    expect(f.owner.combatEnabled(observer as unknown as NPC)).toBe(true)
    mount.group.position.set(340, 30, 340)
    f.owner.prepareFrame(0.35, [...f.owner.actors, target as unknown as NPC], f.player)
    expect(observer.setMissionCombatTarget).toHaveBeenLastCalledWith(null)
    expect(f.owner.combatEnabled(observer as unknown as NPC)).toBe(false)
  })
})
