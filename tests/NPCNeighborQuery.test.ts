import * as THREE from 'three'
import { describe, it, expect, vi } from 'vitest'
import { SpatialGrid, type SpatialEntity } from '../src/world/SpatialGrid'
import { NPC, Faction, AIType, AIState, NPC_SEPARATION_RADIUS, NPC_NEIGHBOR_QUERY_RADIUS } from '../src/world/NPC'
import { Player } from '../src/player/Player'
import { HORSE_RIDER_PELVIS_SADDLE_FORWARD_OFFSET, Mount, MountType } from '../src/world/Mount'
import {
  HorseAssetRegistry,
  type HorseAnimationState,
  type HorseAssetManifest,
} from '../src/world/HorseAssetRegistry'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'

class TestEntity implements SpatialEntity {
  constructor(public id: string, private pos: THREE.Vector3) {}
  get combatPosition(): THREE.Vector3 {
    return this.pos
  }
}

describe('SpatialGrid getNearbyInto & Reusable Buffer', () => {
  it('only returns entities within radius and getNearby delegates correctly', () => {
    const grid = new SpatialGrid<TestEntity>(20)
    const e1 = new TestEntity('e1', new THREE.Vector3(0, 0, 0))
    const e2 = new TestEntity('e2', new THREE.Vector3(1.5, 0, 0))
    const e3 = new TestEntity('e3', new THREE.Vector3(3.0, 0, 0))
    const e4 = new TestEntity('e4', new THREE.Vector3(50, 0, 50))

    grid.insert(e1)
    grid.insert(e2)
    grid.insert(e3)
    grid.insert(e4)

    const buffer: TestEntity[] = []
    const returned = grid.getNearbyInto(new THREE.Vector3(0, 0, 0), 2.0, buffer)
    expect(returned).toBe(buffer)
    expect(buffer.map(e => e.id).sort()).toEqual(['e1', 'e2'])

    // getNearby delegates to getNearbyInto
    const fresh = grid.getNearby(new THREE.Vector3(0, 0, 0), 2.0)
    expect(fresh.map(e => e.id).sort()).toEqual(['e1', 'e2'])
  })

  it('clears previous contents and avoids retaining previous NPC neighbors on reuse', () => {
    const grid = new SpatialGrid<TestEntity>(20)
    const e1 = new TestEntity('e1', new THREE.Vector3(0, 0, 0))
    const e2 = new TestEntity('e2', new THREE.Vector3(100, 0, 100))

    grid.insert(e1)
    grid.insert(e2)

    const sharedBuffer: TestEntity[] = []

    // First query near e1
    grid.getNearbyInto(new THREE.Vector3(0, 0, 0), 2.0, sharedBuffer)
    expect(sharedBuffer.map(e => e.id)).toEqual(['e1'])

    // Second query at an empty location reuses sharedBuffer
    grid.getNearbyInto(new THREE.Vector3(50, 0, 50), 2.0, sharedBuffer)
    expect(sharedBuffer.length).toBe(0)

    // Third query near e2
    grid.getNearbyInto(new THREE.Vector3(100, 0, 100), 2.0, sharedBuffer)
    expect(sharedBuffer.map(e => e.id)).toEqual(['e2'])
  })
})

describe('NPC Separation & Query Range Contracts', () => {
  it('exports valid separation radius and query radius constants', () => {
    expect(NPC_SEPARATION_RADIUS).toBe(1.2)
    expect(NPC_NEIGHBOR_QUERY_RADIUS).toBe(2.0)
    expect(NPC_NEIGHBOR_QUERY_RADIUS).toBeGreaterThan(NPC_SEPARATION_RADIUS)
  })

  it('triggers separation when distance < 1.2m, and no separation when distance >= 1.2m', () => {
    const scene = new THREE.Scene()
    const player = new Player(scene)
    player.setPosition(0, 0, 100) // Target far away along +Z so initial moveDir is (0, 0, 1)

    const npcA = new NPC(scene, 0, 0, Faction.ENEMY, 'roman', AIType.MELEE, 'NPCA', 1, false)
    const npcB = new NPC(scene, 0.8, 0, Faction.ENEMY, 'roman', AIType.MELEE, 'NPCB', 1, false)

    ;(npcA as any).state = AIState.CHASE
    ;(npcB as any).state = AIState.CHASE

    // 1. Distance = 0.8m (< 1.2m NPC_SEPARATION_RADIUS)
    const distClose = npcA.group.position.distanceTo(npcB.group.position)
    expect(distClose).toBeLessThan(NPC_SEPARATION_RADIUS)
    expect(distClose).toBeCloseTo(0.8, 1)

    // Run npcA update with npcB in nearby list
    const prevPosA = npcA.group.position.clone()
    npcA.update(0.016, player, [npcA, npcB], [npcB], [], null as any, () => {}, () => {}, false)
    
    // npcA should be pushed in -X direction away from npcB (npcB is at +0.8 X)
    const deltaXClose = npcA.group.position.x - prevPosA.x
    expect(deltaXClose).toBeLessThan(0) // pushed left (away from npcB)

    // 2. Now place npcB at distance 1.5m (> 1.2m NPC_SEPARATION_RADIUS, but < 2.0m query radius)
    npcA.group.position.set(0, 0, 0)
    npcB.group.position.set(1.5, 0, 0)
    const distFar = npcA.group.position.distanceTo(npcB.group.position)
    expect(distFar).toBeCloseTo(1.5, 2)

    const prevPosFar = npcA.group.position.clone()
    npcA.update(0.016, player, [npcA, npcB], [npcB], [], null as any, () => {}, () => {}, false)

    // At 1.5m, no separation push occurs, so npcA moves purely towards target (z > 0, x approx 0)
    const deltaXFar = npcA.group.position.x - prevPosFar.x
    expect(Math.abs(deltaXFar)).toBeLessThan(0.001)
  })

  it('cavalry regression (corgi mount baseline): 2.0m query radius captures neighbors for mounted NPCs without missing < 1.2m separation', () => {
    const scene = new THREE.Scene()
    const player = new Player(scene)
    player.setPosition(0, 0, 100)

    // Create two mounted NPCs side by side (Corgi mount has zero horizontal saddle offset)
    const mountA = new Mount(scene, MountType.CORGI, 0, 0)
    const horseNpcA = new NPC(scene, 0, 0, Faction.ENEMY, 'roman', AIType.MELEE, 'HorseA', 1, false)
    horseNpcA.mount = mountA
    mountA.setNpcRider(horseNpcA, horseNpcA.faction)

    const mountB = new Mount(scene, MountType.CORGI, 0.9, 0)
    const horseNpcB = new NPC(scene, 0.9, 0, Faction.ENEMY, 'roman', AIType.MELEE, 'HorseB', 1, false)
    horseNpcB.mount = mountB
    mountB.setNpcRider(horseNpcB, horseNpcB.faction)

    // Insert both into a SpatialGrid
    const grid = new SpatialGrid<NPC>(20)
    grid.insert(horseNpcA)
    grid.insert(horseNpcB)

    // Query with NPC_NEIGHBOR_QUERY_RADIUS (2.0m) using horseNpcA.combatPosition
    const buffer: NPC[] = []
    grid.getNearbyInto(horseNpcA.combatPosition, NPC_NEIGHBOR_QUERY_RADIUS, buffer)

    // Must find horseNpcB
    expect(buffer).toContain(horseNpcB)

    // Verify actual rider distance in world space is < 1.2m
    const riderDist = horseNpcA.group.position.distanceTo(horseNpcB.group.position)
    expect(riderDist).toBeLessThan(NPC_SEPARATION_RADIUS)

    // Execute update in CHASE state with retrieved buffer
    ;(horseNpcA as any).state = AIState.CHASE
    const prevA = horseNpcA.group.position.clone()
    horseNpcA.update(0.016, player, [horseNpcA, horseNpcB], buffer, [], null as any, () => {}, () => {}, false)

    // Rider A must experience separation push away from horseNpcB (-X)
    const deltaX = horseNpcA.group.position.x - prevA.x
    expect(deltaX).toBeLessThan(0)
  })

  it('cavalry regression (realistic horse): uses the visual saddle centre and proves the 2.0m query catches < 1.2m rider separation', () => {
    // Setup realistic horse template matching production GLB metrics
    const horseScene = new THREE.Group()
    const rootBone = new THREE.Bone()
    rootBone.name = 'horse.rig'
    const childBone = new THREE.Bone()
    childBone.name = 'DEF-spine.003'
    childBone.position.y = 1
    rootBone.add(childBone)
    horseScene.add(rootBone)

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-0.25, 0, 0, 0.25, 0, 0, 0, 1, 0], 3))
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0], 4))
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4))
    geometry.setIndex([0, 1, 2])

    const sourceMaterial = new THREE.MeshStandardMaterial()
    const skeleton = new THREE.Skeleton([rootBone, childBone])
    const lodNodes = ['horse_lod0', 'horse_lod1', 'horse_lod2']
    const bodyMeshNames = ['horse_body_lod0', 'horse_body_lod1', 'horse_body_lod2']
    for (let index = 0; index < lodNodes.length; index++) {
      const level = new THREE.Group()
      level.name = lodNodes[index]
      const mesh = new THREE.SkinnedMesh(geometry, sourceMaterial)
      mesh.name = bodyMeshNames[index]
      mesh.bind(skeleton)
      level.add(mesh)
      horseScene.add(level)
    }

    // Realistic socket matching production runtime GLB:
    // saddleSeat local translation: [0, 1.74, -0.18]
    const saddleSocket = new THREE.Object3D()
    saddleSocket.name = 'socket_saddle_seat'
    saddleSocket.position.set(0, 1.74, -0.18)
    horseScene.add(saddleSocket)

    for (const name of ['socket_stirrup_l', 'socket_stirrup_r', 'socket_camera']) {
      const socket = new THREE.Object3D()
      socket.name = name
      horseScene.add(socket)
    }

    const clips: HorseAnimationState[] = ['idle', 'walk', 'trot', 'canter', 'gallop', 'jump', 'land', 'hit', 'death']
    const manifest: HorseAssetManifest = {
      schemaVersion: 2,
      id: 'test-realistic-horse',
      status: 'ready',
      attribution: 'test',
      sources: [],
      file: 'horse.glb',
      basisPath: '/basis/',
      lodNodes: { lod0: lodNodes[0], lod1: lodNodes[1], lod2: lodNodes[2] },
      bodyMeshNames,
      sharedBodyMaps: { normal: 'normal.ktx2', roughness: 'roughness.ktx2' },
      variants: [
        { id: 'paint_01', label: '1', baseColor: '1.ktx2' },
        { id: 'paint_02', label: '2', baseColor: '2.ktx2' },
        { id: 'paint_03', label: '3', baseColor: '3.ktx2' },
      ],
      compression: { geometry: 'EXT_meshopt_compression', textures: 'KHR_texture_basisu' },
      metrics: {
        shoulderHeightM: 1.65,
        overallHeightM: 2.27,
        saddleHeightM: 1.74,
        widthM: 0.7,
        lengthM: 2.67,
        packageBytes: 1,
        triangles: { lod0: 1, lod1: 1, lod2: 1 },
        textureMaxSize: 2048,
      },
      forward: '+Z',
      clips,
      sockets: ['socket_saddle_seat', 'socket_stirrup_l', 'socket_stirrup_r', 'socket_camera'],
    }

    const animations = clips.map((name) => new THREE.AnimationClip(name, 1, []))
    const gltf = { scene: horseScene, scenes: [horseScene], animations } as unknown as GLTF
    const horseRegistry = HorseAssetRegistry as unknown as { template: unknown }
    const originalHorseTemplate = horseRegistry.template
    try {
      horseRegistry.template = {
        manifest,
        gltf,
        bodyMaterials: [
          new THREE.MeshStandardMaterial({ color: 0x442211 }),
          new THREE.MeshStandardMaterial({ color: 0x221100 }),
          new THREE.MeshStandardMaterial({ color: 0x110000 }),
        ],
      }

    const scene = new THREE.Scene()
    const player = new Player(scene)
    player.setPosition(0, 0, 100)

    // 1. Verify saddle seat offset metrics
    const mountA = new Mount(scene, MountType.HORSE, 0, 0)
    const localSaddle = mountA.getSaddleSeatLocal(new THREE.Vector3())
    expect(localSaddle.y).toBeCloseTo(1.74, 2)
    expect(localSaddle.z).toBeCloseTo(-0.18, 2)
    const horizontalSaddleOffset = Math.hypot(localSaddle.x, localSaddle.z)
    expect(horizontalSaddleOffset).toBeCloseTo(0.18, 2)
    const localRiderSeat = mountA.getRiderPelvisSeatLocal(new THREE.Vector3())
    expect(localRiderSeat.z).toBeCloseTo(localSaddle.z + HORSE_RIDER_PELVIS_SADDLE_FORWARD_OFFSET, 2)

    // Theoretical worst case:
    // When two horses face opposite directions, maximum delta between mount distance and rider distance
    // is twice the corrected visual rider-seat offset (about 0.27m in this fixture).
    // At the 1.20m rider separation limit, mounts can be about 1.74m apart.
    // Query radius 2.0m retains a safety margin.

    // 2. Construct worst-case opposite facing scenario:
    // Horse A at (0, 0, 0) facing +Z, rider seat at +0.27.
    mountA.group.rotation.y = 0
    const horseNpcA = new NPC(scene, 0, 0, Faction.ENEMY, 'roman', AIType.MELEE, 'RealHorseA', 1, false)
    horseNpcA.mount = mountA
    mountA.setNpcRider(horseNpcA, horseNpcA.faction)
    ;(horseNpcA as any)._syncToMount()

    // Horse B at (0, 0, 1.51) facing -Z, rider seat at 1.51 - 0.27 = 1.24.
    const mountB = new Mount(scene, MountType.HORSE, 0, 1.51)
    mountB.group.rotation.y = Math.PI
    const horseNpcB = new NPC(scene, 0, 1.51, Faction.ENEMY, 'roman', AIType.MELEE, 'RealHorseB', 1, false)
    horseNpcB.mount = mountB
    mountB.setNpcRider(horseNpcB, horseNpcB.faction)
    ;(horseNpcB as any)._syncToMount()

    // Verify root horse distance (combatPosition distance) is 1.51m (> 1.2m)
    const horseRootDist = horseNpcA.combatPosition.distanceTo(horseNpcB.combatPosition)
    expect(horseRootDist).toBeCloseTo(1.51, 2)

    // Verify riders are 1.24 - 0.27 = 0.97m apart (< 1.2m separation threshold).
    const riderWorldDist = horseNpcA.group.position.distanceTo(horseNpcB.group.position)
    expect(riderWorldDist).toBeCloseTo(0.97, 2)
    expect(riderWorldDist).toBeLessThan(NPC_SEPARATION_RADIUS)

    // Insert into grid
    const grid = new SpatialGrid<NPC>(20)
    grid.insert(horseNpcA)
    grid.insert(horseNpcB)

    // A 1.2m radius query would fail here because horseRootDist (1.51m) > 1.2m:
    const narrowBuffer: NPC[] = []
    grid.getNearbyInto(horseNpcA.combatPosition, 1.2, narrowBuffer)
    expect(narrowBuffer).not.toContain(horseNpcB)

    // But with NPC_NEIGHBOR_QUERY_RADIUS (2.0m), it reliably captures horseNpcB:
    const candidateBuffer: NPC[] = []
    grid.getNearbyInto(horseNpcA.combatPosition, NPC_NEIGHBOR_QUERY_RADIUS, candidateBuffer)
    expect(candidateBuffer).toContain(horseNpcB)

    // Execute update in CHASE state to ensure separation push works between real horse riders
    ;(horseNpcA as any).state = AIState.CHASE
    const prevZ = horseNpcA.group.position.z
    horseNpcA.update(0.016, player, [horseNpcA, horseNpcB], candidateBuffer, [], null as any, () => {}, () => {}, false)

    // Rider A is behind rider B along +Z, so separation pushes rider A in -Z.
    const deltaZ = horseNpcA.group.position.z - prevZ
    expect(deltaZ).toBeLessThan(0)
    } finally {
      horseRegistry.template = originalHorseTemplate
    }
  })

  it('non-CHASE states (IDLE, ALERT, ATTACK) do not require nearbyNPCs and behave identically with empty array', () => {
    const scene = new THREE.Scene()
    const player = new Player(scene)
    player.setPosition(0, 0, 100)

    const npc = new NPC(scene, 0, 0, Faction.ENEMY, 'roman', AIType.MELEE, 'TestNPC', 1, false)
    const nearbyOther = new NPC(scene, 0.5, 0, Faction.ENEMY, 'roman', AIType.MELEE, 'OtherNPC', 1, false)

    // 1. IDLE state with empty array vs with nearbyOther (target beyond 300m detection range)
    player.setPosition(0, 0, 500)
    ;(npc as any).state = AIState.IDLE
    npc.group.position.set(0, 0, 0)
    npc.update(0.016, player, [npc, nearbyOther], [], [], null as any, () => {}, () => {}, false)
    expect(npc.currentState).toBe(AIState.IDLE)

    // 2. ALERT state
    ;(npc as any).state = AIState.ALERT
    ;(npc as any).alertTimer = 1.0
    npc.update(0.016, player, [npc, nearbyOther], [], [], null as any, () => {}, () => {}, false)
    expect(npc.currentState).toBe(AIState.ALERT)

    // 3. ATTACK state (melee)
    player.setPosition(0, 0, 1.0) // Within melee range
    ;(npc as any).state = AIState.ATTACK
    ;(npc as any).attackTimer = 0.1
    npc.update(0.016, player, [npc, nearbyOther], [], [], null as any, () => {}, () => {}, false)
    expect(npc.currentState).toBe(AIState.ATTACK)
  })

  it('infantry and cavalry continue moving forward in CHASE without stopping or stalling', () => {
    const scene = new THREE.Scene()
    const player = new Player(scene)
    player.setPosition(0, 0, 50)

    // Foot NPC
    const footNpc = new NPC(scene, 0, 0, Faction.ENEMY, 'roman', AIType.MELEE, 'FootNpc', 1, false)
    ;(footNpc as any).state = AIState.CHASE
    const prevZFoot = footNpc.group.position.z
    footNpc.update(0.05, player, [footNpc], [], [], null as any, () => {}, () => {}, false)
    expect(footNpc.group.position.z).toBeGreaterThan(prevZFoot)

    // Mounted NPC
    const mount = new Mount(scene, MountType.CORGI, 5, 0)
    const mountedNpc = new NPC(scene, 5, 0, Faction.ENEMY, 'roman', AIType.MELEE, 'MountedNpc', 1, false)
    mountedNpc.mount = mount
    mount.setNpcRider(mountedNpc, mountedNpc.faction)
    ;(mountedNpc as any).state = AIState.CHASE
    const prevZMounted = mountedNpc.group.position.z
    mountedNpc.update(0.05, player, [mountedNpc], [], [], null as any, () => {}, () => {}, false)
    expect(mountedNpc.group.position.z).toBeGreaterThan(prevZMounted)
  })
})
