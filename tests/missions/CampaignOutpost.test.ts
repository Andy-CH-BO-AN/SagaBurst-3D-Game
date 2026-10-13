import { describe, expect, it, onTestFinished, vi } from 'vitest'
import * as THREE from 'three'
import {
  FORTIFIED_CAMP_HILL,
  getFortifiedCampHeightOffset,
  getTerrainHeight,
  getWalkRampHeight,
  resolveObstacleCollision,
} from '../../src/world/Terrain'
import { NavigationWorld } from '../../src/navigation/NavigationWorld'
import {
  OUTPOST_WALKWAY,
  getOutpostWalkwayLayout,
  isOutpostWalkwayEnabled,
  type OutpostWalkwayLaunchFields,
} from '../../src/campaign/CampaignOutpostWalkways'
import { DAMAGEABLE_OBSTACLE_HP } from '../../src/world/DamageableObstacle'
import {
  CAMPAIGN_PALISADE_HEIGHT,
  CAMPAIGN_STRUCTURE_HP_MULTIPLIER,
  createCampaignOutpost,
  getCampaignDefenderFacingYaw,
  getCampaignOutpostPlacement,
} from '../../src/campaign/CampaignOutpost'
import { createFormationPlacementHarness, placementParticipant } from '../helpers/formationPlacement'

describe('CampaignOutpost', () => {
  it.each(['roman', 'viking'] as const)(
    'builds a %s-owned damageable perimeter around the shared camp area',
    defenderFaction => {
      const scene = new THREE.Scene()
      const outpost = createCampaignOutpost(scene, defenderFaction)

      expect(outpost.root.parent).toBe(scene)
      expect(outpost.root.name).toBe(`campaign-outpost-${defenderFaction}`)
      expect(outpost.gate.kind).toBe('gate')
      expect(outpost.gate.ownerFaction).toBe(defenderFaction)
      expect(outpost.gateController.state).toBe('closed')
      expect(outpost.breachController.breached).toBe(false)
      expect(outpost.damageableObstacles.every(obstacle => obstacle.ownerFaction === defenderFaction)).toBe(true)
      expect(outpost.obstacles.length).toBe(outpost.damageableObstacles.length)
      expect(outpost.damageableObstacles.length).toBeGreaterThan(20)
      expect(outpost.damageableObstacles.filter(obstacle => obstacle.kind === 'tent')).toHaveLength(10)
      expect(outpost.damageableObstacles.filter(obstacle => obstacle.kind === 'campfire')).toHaveLength(2)
      expect(outpost.obstacles.filter(obstacle => !obstacle.isBarricade)).toHaveLength(12)

      const placement = getCampaignOutpostPlacement(defenderFaction)
      expect(placement.halfWidth).toBe(44)
      expect(placement.halfWidth * 2).toBe(88)
      expect(Math.abs(placement.backZ - placement.frontZ)).toBe(72)
      expect(Math.abs(placement.backZ)).toBeLessThanOrEqual(180)
      const gateObstacle = outpost.obstacles.find(obstacle => obstacle.damageable === outpost.gate)
      expect(gateObstacle).toBeDefined()
      expect(gateObstacle!.box.min.x).toBeCloseTo(-placement.gateWidth / 2)
      expect(gateObstacle!.box.max.x).toBeCloseTo(placement.gateWidth / 2)
      expect(gateObstacle!.box.getSize(new THREE.Vector3()).y)
        .toBeCloseTo(CAMPAIGN_PALISADE_HEIGHT[defenderFaction])
      expect(gateObstacle!.box.getCenter(new THREE.Vector3()).z).toBeCloseTo(placement.frontZ)
      expect(Math.sign(placement.frontZ)).toBe(defenderFaction === 'roman' ? -1 : 1)
      expect(Math.abs(placement.backZ)).toBeGreaterThan(Math.abs(placement.frontZ))
    },
  )

  it(
    'quadruples campaign palisade and gate HP without changing geometry',
    () => {
      const defenderFaction = 'roman'
      const scene = new THREE.Scene()
      const outpost = createCampaignOutpost(scene, defenderFaction)
      const palisade = outpost.damageableObstacles.find(
        obstacle => obstacle.kind === 'palisade',
      )

      expect(palisade?.maxHp).toBe(
        DAMAGEABLE_OBSTACLE_HP.palisade * CAMPAIGN_STRUCTURE_HP_MULTIPLIER.palisade,
      )
      expect(outpost.gate.maxHp).toBe(
        DAMAGEABLE_OBSTACLE_HP.gate * CAMPAIGN_STRUCTURE_HP_MULTIPLIER.gate,
      )

      const gateObstacle = outpost.obstacles.find(
        obstacle => obstacle.damageable === outpost.gate,
      )
      expect(gateObstacle?.box.getSize(new THREE.Vector3()).z).toBeCloseTo(0.9)
    },
  )

  it(
    'keeps chevaux-de-frise inside the perimeter and leaves the gate corridor open',
    () => {
      const faction = 'roman'
      const outpost = createCampaignOutpost(new THREE.Scene(), faction)
      const placement = getCampaignOutpostPlacement(faction)
      const stakes = outpost.obstacles.filter(obstacle => obstacle.damageable?.kind === 'chevaux_de_frise')
      expect(stakes).toHaveLength(10)
      for (const stake of stakes) {
        const visualBox = new THREE.Box3().setFromObject(stake.damageable!.root)
        for (const box of [stake.box, visualBox]) {
          expect(box.min.z).toBeGreaterThan(Math.min(placement.frontZ, placement.backZ) + 0.5)
          expect(box.max.z).toBeLessThan(Math.max(placement.frontZ, placement.backZ) - 0.5)
          expect(box.min.x).toBeGreaterThan(-placement.halfWidth + 0.5)
          expect(box.max.x).toBeLessThan(placement.halfWidth - 0.5)
          expect(box.max.x < -placement.gateWidth / 2 || box.min.x > placement.gateWidth / 2).toBe(true)
        }
        stake.damageable!.destroy()
        expect(outpost.obstacles).not.toContain(stake)
        expect(stake.damageable!.root.parent).toBeNull()
        expect(stake.damageable!.hitMeshes.every(mesh => !outpost.obstacleMeshes.includes(mesh))).toBe(true)
      }
    },
  )

  it('treats gate opening or perimeter destruction as one shared breach', () => {
    const scene = new THREE.Scene()
    const outpost = createCampaignOutpost(scene, 'roman')
    const onBreach = vi.fn()
    outpost.breachController.onBreach(onBreach)

    outpost.gateController.open()
    expect(outpost.breachController.breached).toBe(true)
    expect(onBreach).toHaveBeenCalledTimes(1)

    const palisade = outpost.damageableObstacles.find(
      obstacle => obstacle.kind === 'palisade',
    )
    expect(palisade).toBeDefined()
    palisade!.destroy()

    expect(onBreach).toHaveBeenCalledTimes(1)
  })

  it('treats a destroyed palisade as a breach even when the gate stays closed', () => {
    const scene = new THREE.Scene()
    const outpost = createCampaignOutpost(scene, 'viking')
    const onBreach = vi.fn()
    outpost.breachController.onBreach(onBreach)

    const palisades = outpost.damageableObstacles.filter(
      obstacle => obstacle.kind === 'palisade',
    )
    expect(palisades.length).toBeGreaterThan(1)

    palisades[0].destroy()
    expect(outpost.gateController.state).toBe('closed')
    expect(outpost.breachController.breached).toBe(true)
    expect(onBreach).toHaveBeenCalledTimes(1)

    palisades[1].destroy()
    expect(onBreach).toHaveBeenCalledTimes(1)
  })

  it('removes destroyed structures from the shared live collision collections', () => {
    const scene = new THREE.Scene()
    const sharedObstacles: ReturnType<typeof createCampaignOutpost>['obstacles'] = []
    const sharedObstacleMeshes: ReturnType<typeof createCampaignOutpost>['obstacleMeshes'] = []
    const outpost = createCampaignOutpost(scene, 'roman', {
      obstacles: sharedObstacles,
      obstacleMeshes: sharedObstacleMeshes,
    })
    const obstacleCount = sharedObstacles.length
    const meshCount = sharedObstacleMeshes.length
    const gateHitMeshCount = outpost.gate.hitMeshes.length

    outpost.gate.takeDamage(outpost.gate.maxHp)

    expect(outpost.gate.destroyed).toBe(true)
    expect(sharedObstacles).toHaveLength(obstacleCount - 1)
    expect(sharedObstacleMeshes).toHaveLength(meshCount - gateHitMeshCount)
    expect(sharedObstacles.some(obstacle => obstacle.damageable === outpost.gate)).toBe(false)
  })

  it('uses ten large damageable tents and keeps the gate-to-lookout corridor clear', () => {
    const scene = new THREE.Scene()
    const outpost = createCampaignOutpost(scene, 'viking')
    const tents = outpost.damageableObstacles.filter(obstacle => obstacle.kind === 'tent')

    expect(tents).toHaveLength(10)
    expect(tents.every(tent => tent.ownerFaction === 'viking')).toBe(true)

    for (const tent of tents) {
      const obstacle = outpost.obstacles.find(candidate => candidate.damageable === tent)
      expect(obstacle).toBeDefined()
      const size = obstacle!.box.getSize(new THREE.Vector3())
      const center = obstacle!.box.getCenter(new THREE.Vector3())
      expect(size.x).toBeGreaterThanOrEqual(7)
      expect(size.y).toBeGreaterThanOrEqual(3.5)
      expect(Math.abs(center.x)).toBeGreaterThanOrEqual(24)
      expect(obstacle!.box.min.z).toBeGreaterThan(108.5)
      expect(obstacle!.box.max.z).toBeLessThan(179.5)
      expect(tent.root.position.z).toBeCloseTo(center.z)
    }
    // The builder has its own faction sign: a pure placement/layout mirror cannot protect this wiring.
    expect(tents.map(tent => tent.root.position.z).sort((a, b) => a - b))
      .toEqual([124, 124, 136, 136, 150, 150, 162, 162, 174, 174])
    for (const [name, expectedZ] of [
      ['campaign-chevaux-de-frise-1', 114.2],
      ['campaign-chevaux-de-frise-2', 115.8],
    ] as const) {
      const stake = outpost.obstacles.find(obstacle => obstacle.damageable?.root.name === name)!
      expect(stake).toBeDefined()
      expect(stake.damageable!.root.position.z).toBeCloseTo(expectedZ)
      expect(stake.box.getCenter(new THREE.Vector3()).z).toBeCloseTo(expectedZ)
      expect(stake.box.min.z).toBeGreaterThan(108.5)
      expect(stake.box.max.z).toBeLessThan(179.5)
      expect(stake.box.max.x < -4 || stake.box.min.x > 4).toBe(true)
    }

    // Reuse this builder fixture for the real registered-tent -> placement consumer contract.
    // No extra Outpost, Terrain, NPC or Mount materialization.
    const navigation = new NavigationWorld()
    navigation.sync(outpost.obstacles)
    const participants = Array.from({ length: 5 }, (_, index) => {
      const participant = placementParticipant(`tent-placement-${index}`, index - 2)
      participant.combatPosition.z = 140
      return participant
    })
    const fixture = createFormationPlacementHarness(outpost.obstacles, participants, navigation,
      { minX: -44, maxX: 44, minZ: 108, maxZ: 180 })
    onTestFinished(() => fixture.dispose())
    const tentObstacle = outpost.obstacles.find(obstacle => obstacle.damageable === tents[0])!
    const center = tentObstacle.box.getCenter(new THREE.Vector3())
    center.y = getTerrainHeight(center.x, center.z)
    const placement = fixture.solve(center)
    const collisionChecks = fixture.formation as unknown as {
      isSlotBlocked(slot: THREE.Vector3, mounted: boolean): boolean
    }
    expect(placement).not.toBeNull()
    expect(placement?.slots.every(slot => !collisionChecks.isSlotBlocked(slot, false))).toBe(true)
    expect(placement?.slots.every(slot => navigation.areConnected(participants[0].combatPosition, slot))).toBe(true)
  })

  it('makes campfires damageable small obstacles', () => {
    const scene = new THREE.Scene()
    const outpost = createCampaignOutpost(scene, 'roman')
    const campfires = outpost.damageableObstacles.filter(obstacle => obstacle.kind === 'campfire')

    expect(campfires).toHaveLength(2)
    expect(campfires.every(campfire => campfire.ownerFaction === 'roman')).toBe(true)
    for (const campfire of campfires) {
      const obstacle = outpost.obstacles.find(candidate => candidate.damageable === campfire)
      expect(obstacle).toBeDefined()
      const size = obstacle!.box.getSize(new THREE.Vector3())
      expect(size.x).toBeLessThanOrEqual(2)
      expect(size.z).toBeLessThanOrEqual(2)
    }
  })

  it.each(['roman', 'viking'] as const)(
    'renders %s palisades as solid low timber walls for both actor and projectile collision',
    defenderFaction => {
      const scene = new THREE.Scene()
      const outpost = createCampaignOutpost(scene, defenderFaction)
      const palisades = outpost.damageableObstacles.filter(obstacle => obstacle.kind === 'palisade')

      expect(palisades.length).toBeGreaterThan(0)

      for (const palisade of palisades) {
        const stakes = palisade.root.children.find(
          child => child instanceof THREE.InstancedMesh,
        ) as THREE.InstancedMesh | undefined
        expect(stakes).toBeDefined()
        expect(
          (stakes!.geometry as THREE.CylinderGeometry).parameters.height,
        ).toBeCloseTo(CAMPAIGN_PALISADE_HEIGHT[defenderFaction])

        const obstacle = outpost.obstacles.find(candidate => candidate.damageable === palisade)
        expect(obstacle).toBeDefined()
        expect(obstacle!.box.getSize(new THREE.Vector3()).length()).toBeGreaterThan(1)
        expect(obstacle!.projectileBoxes).toBeUndefined()
      }
    },
  )

  it('adds a smooth raised lookout hill at both campaign camp centers', () => {
    expect(getFortifiedCampHeightOffset(0, -FORTIFIED_CAMP_HILL.centerAbsZ, 'roman'))
      .toBeCloseTo(FORTIFIED_CAMP_HILL.height)
    expect(getFortifiedCampHeightOffset(0, FORTIFIED_CAMP_HILL.centerAbsZ, 'viking'))
      .toBeCloseTo(FORTIFIED_CAMP_HILL.height)
    expect(getFortifiedCampHeightOffset(0, FORTIFIED_CAMP_HILL.centerAbsZ, 'roman'))
      .toBe(0)
    expect(
      getFortifiedCampHeightOffset(
        FORTIFIED_CAMP_HILL.radiusX + 1,
        -FORTIFIED_CAMP_HILL.centerAbsZ,
        'roman',
      ),
    ).toBe(0)
  })
})

describe('CampaignOutpost walkways', () => {
  const build = (faction: 'roman' | 'viking', walkways = true) => {
    const outpost = createCampaignOutpost(new THREE.Scene(), faction, { obstacles: [], obstacleMeshes: [] }, { walkways })
    const geometries = new Set<THREE.BufferGeometry>()
    outpost.root.traverse(object => { if (object instanceof THREE.Mesh) geometries.add(object.geometry) })
    onTestFinished(() => {
      for (const geometry of geometries) geometry.dispose()
      outpost.root.removeFromParent()
      // Environment materials are shared cache entries, owned by production.
    })
    return { outpost, placement: getCampaignOutpostPlacement(faction) }
  }
  const xzOverlap = (a: THREE.Box3, b: THREE.Box3): boolean =>
    a.min.x < b.max.x && a.max.x > b.min.x && a.min.z < b.max.z && a.max.z > b.min.z

  it('adds no structure by default and only non-damageable structures when enabled', () => {
    const plain = build('roman', false)
    const walled = build('roman')

    expect(plain.outpost.walkways).toBeNull()
    expect(walled.outpost.damageableObstacles).toHaveLength(plain.outpost.damageableObstacles.length)
    expect(walled.outpost.obstacles.length).toBeGreaterThan(plain.outpost.obstacles.length)
    const added = walled.outpost.obstacles.filter(obstacle => !obstacle.damageable)
    expect(added).toHaveLength(walled.outpost.walkways!.obstacles.length)
    expect(added.every(obstacle => !obstacle.isBarricade)).toBe(true)
    // Palisade stays a low destructible wall; only the separate deck is high.
    const palisades = walled.outpost.damageableObstacles.filter(obstacle => obstacle.kind === 'palisade')
    expect(palisades.length).toBe(plain.outpost.damageableObstacles.filter(obstacle => obstacle.kind === 'palisade').length)
    expect(walled.outpost.walkways!.layout.decks.every(deck => deck.topY > 3)).toBe(true)
  })

  it.each(['roman', 'viking'] as const)('places terrain-sized %s decks and stairs inside the front wall, clear of gate, tents and chevaux', faction => {
    // Stair lengths follow non-mirrored terrain, so scenery clearance owns both local geometries.
    const { outpost, placement } = build(faction)
    const { layout } = outpost.walkways!
    const zSign = faction === 'roman' ? -1 : 1
    expect(layout.zSign).toBe(zSign)
    expect(layout.decks.map(deck => deck.side).sort()).toEqual([-1, 1])
    expect(layout.stairs.map(stair => stair.side).sort()).toEqual([-1, 1])

    const original = outpost.obstacles.filter(obstacle => obstacle.damageable)
    for (const deck of layout.decks) {
      const inward = (z: number): number => (z - placement.frontZ) * zSign
      expect(Math.min(inward(deck.slab.min.z), inward(deck.slab.max.z))).toBeCloseTo(0)
      expect(Math.max(inward(deck.slab.min.z), inward(deck.slab.max.z))).toBeCloseTo(3.2)
      expect(Math.min(Math.abs(deck.slab.min.x), Math.abs(deck.slab.max.x))).toBeGreaterThan(placement.gateWidth / 2)
      expect(Math.max(Math.abs(deck.slab.min.x), Math.abs(deck.slab.max.x))).toBeLessThan(placement.halfWidth)
      for (const post of deck.posts) {
        for (const other of original) expect(xzOverlap(post, other.box), `post vs ${other.damageable?.kind}`).toBe(false)
      }
    }
    for (const stair of layout.stairs) {
      for (const volume of [stair.bounds, stair.cap, ...stair.rails]) {
        for (const other of original) expect(xzOverlap(volume, other.box), `stair ${stair.side} vs ${other.damageable?.kind}`).toBe(false)
        expect(Math.abs(volume.min.x) > placement.gateWidth / 2 + 20 || Math.abs(volume.max.x) > placement.gateWidth / 2 + 20).toBe(true)
        expect(Math.min(...[volume.min.z, volume.max.z].map(z => (z - placement.frontZ) * zSign))).toBeGreaterThan(-1e-9)
        expect(Math.max(...[volume.min.z, volume.max.z].map(z => (z - placement.frontZ) * zSign)))
          .toBeLessThan(Math.abs(placement.backZ - placement.frontZ))
      }
    }
  })

  it('mirrors front/back, gate facing and walkway connections while respecting each terrain height', () => {
    // Sole faction/side geometry owner: pure data, zero Scenes/NPCs/Mounts.
    // Behavioral owners below and in OutpostLayeredNavigation use one layout.
    const romanPlacement = getCampaignOutpostPlacement('roman')
    const vikingPlacement = getCampaignOutpostPlacement('viking')
    const roman = getOutpostWalkwayLayout(romanPlacement)
    const viking = getOutpostWalkwayLayout(vikingPlacement)
    expect([romanPlacement.frontZ, romanPlacement.backZ, romanPlacement.stakeLineZ]).toEqual([-108, -180, -115])
    expect([vikingPlacement.frontZ, vikingPlacement.backZ, vikingPlacement.stakeLineZ]).toEqual([108, 180, 115])
    expect([romanPlacement.centerX, romanPlacement.halfWidth, romanPlacement.gateWidth]).toEqual([0, 44, 8])
    expect([vikingPlacement.centerX, vikingPlacement.halfWidth, vikingPlacement.gateWidth]).toEqual([0, 44, 8])
    expect(getCampaignDefenderFacingYaw('roman')).toBe(0)
    expect(getCampaignDefenderFacingYaw('viking')).toBe(Math.PI)
    expect(roman.zSign).toBe(-1)
    expect(viking.zSign).toBe(1)

    const mirrorFootprint = (a: THREE.Box3, b: THREE.Box3): void => {
      expect([a.min.x, a.max.x]).toEqual([b.min.x, b.max.x])
      expect(a.min.z).toBeCloseTo(-b.max.z)
      expect(a.max.z).toBeCloseTo(-b.min.z)
    }
    roman.decks.forEach((deck, i) => {
      const mirrored = viking.decks[i]
      expect(deck.side).toBe(mirrored.side)
      mirrorFootprint(deck.slab, mirrored.slab)
      expect(deck.walkSurface.dirX).toBe(mirrored.walkSurface.dirX)
      expect(deck.walkSurface.startZ).toBeCloseTo(-mirrored.walkSurface.startZ)
      deck.rails.forEach((rail, index) => mirrorFootprint(rail, mirrored.rails[index]))
      deck.posts.forEach((post, index) => mirrorFootprint(post, mirrored.posts[index]))
    })
    roman.stairs.forEach((stair, i) => {
      const mirrored = viking.stairs[i]
      expect(stair.ramp.startX).toBe(mirrored.ramp.startX)
      expect(stair.ramp.dirZ).toBe(-mirrored.ramp.dirZ)
      // Ramp length follows each side's terrain, but both land flush against the deck edge.
      const landingEnd = (r: typeof stair.ramp): number => r.startZ + r.dirZ * (r.length + r.landing)
      expect(landingEnd(stair.ramp)).toBeCloseTo(-landingEnd(mirrored.ramp))
    })
    mirrorFootprint(roman.bridge.slab, viking.bridge.slab)
    expect(roman.bridge.walkSurface.length).toBeCloseTo(viking.bridge.walkSurface.length)
    expect(roman.bridge.walkSurface.halfWidth).toBeCloseTo(viking.bridge.walkSurface.halfWidth)
    roman.bridge.rails.forEach((rail, i) => mirrorFootprint(rail, viking.bridge.rails[i]))

    // Absolute Y and stair length vary with terrain; check each local connection.
    for (const [placement, layout] of [[romanPlacement, roman], [vikingPlacement, viking]] as const) {
      expect(layout.decks.map(deck => deck.side)).toEqual([-1, 1])
      expect(layout.stairs.map(stair => stair.side)).toEqual([-1, 1])
      const [left, right] = layout.decks
      const bridge = layout.bridge
      expect(bridge.slab.min.y - getTerrainHeight(0, placement.frontZ)).toBeGreaterThanOrEqual(4.2)
      expect(left.slab.min.x).toBeCloseTo(-43.6)
      expect(right.slab.max.x).toBeCloseTo(43.6)
      expect(left.slab.max.x).toBeCloseTo(-5.2)
      expect(right.slab.min.x).toBeCloseTo(5.2)
      expect(bridge.slab.min.x).toBeCloseTo(left.slab.max.x)
      expect(bridge.slab.max.x).toBeCloseTo(right.slab.min.x)
      expect(Math.abs(bridge.slab.min.x - left.slab.max.x)).toBeLessThan(1e-6)
      expect(Math.abs(right.slab.min.x - bridge.slab.max.x)).toBeLessThan(1e-6)
      expect([bridge.slab.min.z, bridge.slab.max.z]).toEqual([left.slab.min.z, left.slab.max.z])
      expect([bridge.slab.min.z, bridge.slab.max.z]).toEqual([right.slab.min.z, right.slab.max.z])
      const midZ = bridge.walkSurface.startZ
      expect(getWalkRampHeight(bridge.walkSurface, left.slab.max.x, midZ)).toBeCloseTo(left.topY)
      expect(getWalkRampHeight(bridge.walkSurface, right.slab.min.x, midZ)).toBeCloseTo(right.topY)

      for (const deck of layout.decks) {
        expect(deck.walkSurface.dirX).toBe(deck.side)
        expect(deck.walkSurface.dirZ).toBe(0)
        expect(deck.walkSurface.topY).toBe(deck.topY)
        expect(deck.walkSurface.length).toBeCloseTo(38.4)
        expect(deck.walkSurface.halfWidth).toBeCloseTo(1.6)
        const stair = layout.stairs.find(candidate => candidate.side === deck.side)!
        const ramp = stair.ramp
        expect(ramp.startX).toBe(deck.side * 36)
        expect(ramp.halfWidth).toBeCloseTo(1.1)
        expect(ramp.landing).toBeCloseTo(0.9)
        expect(ramp.dirZ).toBe(-layout.zSign)
        expect(ramp.topY).toBe(deck.topY)
        expect(ramp.startY - getTerrainHeight(ramp.startX, ramp.startZ)).toBeLessThan(0.05)
        expect((ramp.topY - ramp.startY) / ramp.length).toBeGreaterThan(0)
        expect((ramp.topY - ramp.startY) / ramp.length).toBeLessThanOrEqual(0.5)
        const endZ = ramp.startZ + ramp.dirZ * (ramp.length + ramp.landing)
        expect((endZ - placement.frontZ) * layout.zSign).toBeCloseTo(3.2)
        expect((ramp.startZ - placement.frontZ) * layout.zSign).toBeGreaterThan(3.2)
        expect((ramp.startZ - endZ) * layout.zSign).toBeGreaterThan(0)
        // Terrain is not mirrored: every stair must clear its own ground along the slope and landing.
        for (let along = 0.05; along <= ramp.length + ramp.landing; along += 0.05) {
          const z = ramp.startZ + ramp.dirZ * along
          const height = getWalkRampHeight(ramp, ramp.startX, z)
          expect(height).not.toBeNull()
          expect(height!).toBeGreaterThanOrEqual(getTerrainHeight(ramp.startX, z))
        }
        // Own-terrain clearance is a special geometric input, not a second behavior simulation.
        for (let x = deck.slab.min.x; x <= deck.slab.max.x; x += 2) {
          for (const z of [deck.slab.min.z, deck.slab.max.z]) {
            expect(deck.slab.min.y - getTerrainHeight(x, z)).toBeGreaterThanOrEqual(3)
          }
        }
      }
    }
  })

  it('stair rises continuously from the ground to the deck level and landing', () => {
    const faction = 'roman'
    const side = -1
    const placement = getCampaignOutpostPlacement(faction)
    const layout = getOutpostWalkwayLayout(placement)
    const { ramp } = layout.stairs.find(stair => stair.side === side)!
    const deck = layout.decks.find(candidate => candidate.side === side)!
    const zSign = faction === 'roman' ? -1 : 1

    expect(ramp.topY).toBe(deck.topY)
    expect(ramp.startX).toBe(side * OUTPOST_WALKWAY.stairCenterX)
    expect((ramp.topY - ramp.startY) / ramp.length).toBeLessThanOrEqual(0.5)
    const landingEndInward = (ramp.startZ + ramp.dirZ * (ramp.length + ramp.landing) - placement.frontZ) * zSign
    expect(landingEndInward).toBeCloseTo(3.2)
    expect(ramp.startY - getTerrainHeight(ramp.startX, ramp.startZ)).toBeLessThan(0.05)

    let previous = getWalkRampHeight(ramp, ramp.startX, ramp.startZ)!
    for (let along = 0.05; along <= ramp.length + ramp.landing; along += 0.05) {
      const z = ramp.startZ + ramp.dirZ * along
      const height = getWalkRampHeight(ramp, ramp.startX, z)!
      expect(height, `ramp undefined at ${along.toFixed(2)}m`).not.toBeNull()
      expect(height).toBeGreaterThanOrEqual(previous - 1e-9)
      expect(height - previous).toBeLessThanOrEqual(0.5 * 0.05 + 1e-9)
      expect(height).toBeGreaterThanOrEqual(getTerrainHeight(ramp.startX, z))
      previous = height
    }
    expect(previous).toBeCloseTo(deck.topY)
  })

  it('keeps ground navigation under the deck open while the stair mass blocks', () => {
    const plain = build('roman', false)
    const walled = build('roman')
    const plainNav = new NavigationWorld()
    const walledNav = new NavigationWorld()
    plainNav.sync(plain.outpost.obstacles)
    walledNav.sync(walled.outpost.obstacles)
    const { layout } = walled.outpost.walkways!
    const cell = (nav: NavigationWorld, x: number, z: number): boolean =>
      nav.grid.isBlocked(nav.grid.worldToCell(new THREE.Vector3(x, 0, z))!)

    for (const deck of layout.decks) {
      // 3m behind the wall: clear of the palisade's own blocked cells, still under the deck.
      const midZ = walled.placement.frontZ + 3 * Math.sign(walled.placement.frontZ)
      expect(midZ > deck.slab.min.z && midZ < deck.slab.max.z).toBe(true)
      for (const x of [12, 20, 28]) {
        expect(cell(walledNav, deck.side * x, midZ), `ground under deck at x=${deck.side * x}`).toBe(false)
        expect(cell(walledNav, deck.side * x, midZ)).toBe(cell(plainNav, deck.side * x, midZ))
      }
    }
    for (const stair of layout.stairs) {
      const midZ = stair.ramp.startZ + stair.ramp.dirZ * stair.ramp.length / 2
      expect(cell(plainNav, stair.ramp.startX, midZ)).toBe(false)
      expect(cell(walledNav, stair.ramp.startX, midZ)).toBe(true)
    }
  })

  it('keeps raised deck slabs solid to projectiles while ground navigation passes underneath', () => {
    const { outpost } = build('roman')
    const { layout } = outpost.walkways!
    const slabs = outpost.walkways!.obstacles.filter(obstacle => layout.decks.some(deck => deck.slab === obstacle.box))
    expect(slabs).toHaveLength(2)
    expect(slabs.every(obstacle => obstacle.navigationPassable && !obstacle.projectilePassable)).toBe(true)
    expect(outpost.obstacles.filter(obstacle => obstacle.damageable).every(obstacle => !obstacle.projectilePassable)).toBe(true)
    // No walkway obstacle should ever be blanket-marked projectilePassable:
    expect(outpost.walkways!.obstacles.every(obstacle => !obstacle.projectilePassable)).toBe(true)

    // Front parapets have physical projectileBoxes for lower sill + merlons:
    const frontRails = outpost.walkways!.obstacles.filter(obstacle => layout.decks.some(deck => deck.rails[0] === obstacle.box))
    expect(frontRails).toHaveLength(2)
    for (const rail of frontRails) {
      expect(rail.projectileBoxes).toBeDefined()
      expect(rail.projectileBoxes!.length).toBeGreaterThan(1)
      expect(rail.projectilePassable).toBeFalsy()
    }
  })

  it(
    'elevates palisades and gate to meet the walkway deck height while remaining damageable',
    () => {
      const faction = 'roman'
      const plain = build(faction, false)
      const walled = build(faction, true)
      const { layout } = walled.outpost.walkways!
      const leftDeck = layout.decks.find(d => d.side === -1)!
      const rightDeck = layout.decks.find(d => d.side === 1)!

      // Plain mode gate remains low
      const plainGateObstacle = plain.outpost.obstacles.find(o => o.damageable === plain.outpost.gate)!
      expect(plainGateObstacle.box.getSize(new THREE.Vector3()).y).toBeCloseTo(CAMPAIGN_PALISADE_HEIGHT[faction])
      expect(plain.outpost.root.getObjectByName('campaign-gate-frame')).toBeUndefined()

      // Elevated gate leaf top clears below the lintel and bridge underside
      const walledGateObstacle = walled.outpost.obstacles.find(o => o.damageable === walled.outpost.gate)!
      const gateFrame = walled.outpost.root.getObjectByName('campaign-gate-frame')
      expect(gateFrame).toBeDefined()
      const bridgeSlab = walled.outpost.walkways!.layout.bridge.slab
      expect(walledGateObstacle.box.max.y).toBeLessThan(bridgeSlab.min.y)
      // Underside of bridge over gate leaves keeps >= 4.2m headroom for cavalry
      expect(bridgeSlab.min.y - plainGateObstacle.box.min.y).toBeGreaterThanOrEqual(4.2)


      // Front palisades match corresponding deck topY
      for (let i = 1; i <= 3; i++) {
        const leftPalisade = walled.outpost.damageableObstacles.find(
          o => o.root.name === `campaign-front-palisade-left-${i}`,
        )!
        const rightPalisade = walled.outpost.damageableObstacles.find(
          o => o.root.name === `campaign-front-palisade-right-${i}`,
        )!
        const leftBox = walled.outpost.obstacles.find(o => o.damageable === leftPalisade)!.box
        const rightBox = walled.outpost.obstacles.find(o => o.damageable === rightPalisade)!.box
        expect(leftBox.max.y).toBeCloseTo(leftDeck.topY)
        expect(rightBox.max.y).toBeCloseTo(rightDeck.topY)
      }

      // Side and rear palisades are elevated to fortress wall height (>= 3.0m)
      const sidePalisades = walled.outpost.damageableObstacles.filter(
        o => o.root.name.includes('side-palisade'),
      )
      expect(sidePalisades).toHaveLength(10)
      for (const sidePalisade of sidePalisades) {
        const obs = walled.outpost.obstacles.find(o => o.damageable === sidePalisade)!
        expect(obs.box.max.y).toBeGreaterThanOrEqual(3.0)
      }

      const rearPalisades = walled.outpost.damageableObstacles.filter(
        o => o.root.name.includes('rear-palisade'),
      )
      expect(rearPalisades).toHaveLength(7)
      for (const rearPalisade of rearPalisades) {
        const obs = walled.outpost.obstacles.find(o => o.damageable === rearPalisade)!
        expect(obs.box.max.y).toBeGreaterThanOrEqual(3.0)
      }
    },
  )

  it(
    'removes collision and allows ground A* breach passage when an elevated front palisade is destroyed',
    () => {
      const faction = 'roman'
      const walled = build(faction, true)
      const zSign = faction === 'roman' ? -1 : 1
      const targetPalisade = walled.outpost.damageableObstacles.find(
        o => o.root.name === 'campaign-front-palisade-left-2',
      )!
      const palisadeObstacle = walled.outpost.obstacles.find(o => o.damageable === targetPalisade)!
      const segmentX = (palisadeObstacle.box.min.x + palisadeObstacle.box.max.x) / 2

      const nav = new NavigationWorld()
      nav.sync(walled.outpost.obstacles)
      nav.beginFrame()

      const outsidePoint = new THREE.Vector3(segmentX, 0, walled.placement.frontZ - zSign * 10)
      const insidePoint = new THREE.Vector3(segmentX, 0, walled.placement.frontZ + zSign * 10)

      // Before destruction, closed perimeter cannot connect outside and inside
      expect(nav.areConnected(outsidePoint, insidePoint)).toBe(false)
      expect(nav.queryPath(outsidePoint, insidePoint).status).toBe('unreachable')

      // Destroy the elevated palisade
      targetPalisade.destroy()
      expect(walled.outpost.obstacles).not.toContain(palisadeObstacle)
      expect(targetPalisade.root.parent).toBeNull()

      nav.sync(walled.outpost.obstacles)
      nav.beginFrame()
      expect(nav.areConnected(outsidePoint, insidePoint)).toBe(true)
      const breachResult = nav.queryPath(outsidePoint, insidePoint)
      expect(breachResult.status).toBe('path')
      if (breachResult.status === 'path') {
        const worldPath = breachResult.path.map(cell => nav.grid.cellToWorld(cell))
        const crossedThroughBreach = worldPath.some(
          pt => Math.abs(pt.x - segmentX) < 4.0 && Math.abs(pt.z - walled.placement.frontZ) < 3.0,
        )
        expect(crossedThroughBreach).toBe(true)
      }
    },
  )

  it('retains overhead lintel without blocking ground passage when gate is opened or destroyed', () => {
    const walled = build('roman', true)
    const gateFrame = walled.outpost.root.getObjectByName('campaign-gate-frame')
    expect(gateFrame).toBeDefined()

    // Gate open
    walled.outpost.gateController.open()
    expect(gateFrame!.parent).toBe(walled.outpost.root)
    const outside = new THREE.Vector3(0, 0, walled.placement.frontZ + 15)
    const inside = new THREE.Vector3(0, 0, walled.placement.frontZ - 15)
    const nav = new NavigationWorld()
    nav.sync(walled.outpost.obstacles)
    nav.beginFrame()
    expect(nav.queryPath(outside, inside).status).toBe('path')

    // Destroy gate
    walled.outpost.gate.destroy()
    expect(walled.outpost.gate.root.parent).toBeNull()
    expect(gateFrame!.parent).toBe(walled.outpost.root)
    nav.sync(walled.outpost.obstacles)
    nav.beginFrame()
    expect(nav.queryPath(outside, inside).status).toBe('path')
    expect(walled.outpost.obstacles.filter(obstacle => !obstacle.damageable)).toHaveLength(walled.outpost.walkways!.obstacles.length)
  })

  it(
    'provides continuous walking surface across left deck, gatehouse bridge, and right deck',
    () => {
      const faction = 'roman'
      const placement = getCampaignOutpostPlacement(faction)
      const layout = getOutpostWalkwayLayout(placement)
      const leftDeck = layout.decks.find(d => d.side === -1)!
      const rightDeck = layout.decks.find(d => d.side === 1)!
      const bridge = layout.bridge
      const xNear = placement.gateWidth / 2 + OUTPOST_WALKWAY.gateMargin
      const midZ = (bridge.slab.min.z + bridge.slab.max.z) / 2

      // Heights at boundaries match deck top surfaces perfectly
      const heightAtLeftJamb = getWalkRampHeight(bridge.walkSurface, -xNear, midZ)!
      const heightAtRightJamb = getWalkRampHeight(bridge.walkSurface, xNear, midZ)!
      expect(heightAtLeftJamb).toBeCloseTo(leftDeck.topY)
      expect(heightAtRightJamb).toBeCloseTo(rightDeck.topY)

      // Walking across the bridge in fine steps has continuous smooth height without jumps
      let prevHeight = heightAtLeftJamb
      for (let x = -xNear + 0.1; x < xNear - 1e-4; x += 0.2) {
        const height = getWalkRampHeight(bridge.walkSurface, x, midZ)
        expect(height).not.toBeNull()
        expect(Math.abs(height! - prevHeight)).toBeLessThanOrEqual(0.2 * 0.25 + 1e-4)
        prevHeight = height!
      }
      expect(Math.abs(heightAtRightJamb - prevHeight)).toBeLessThanOrEqual(0.2 * 0.25 + 1e-4)
      expect(heightAtRightJamb).toBeCloseTo(rightDeck.topY)
    },
  )

  it(
    'removes inner end-cap rails at deck-bridge portals while keeping outer end-caps and rear safety rails',
    () => {
      const faction = 'roman'
      const { outpost, placement } = build(faction)
      const { layout } = outpost.walkways!
      const leftDeck = layout.decks.find(d => d.side === -1)!
      const rightDeck = layout.decks.find(d => d.side === 1)!
      const bridge = layout.bridge
      const xNear = placement.gateWidth / 2 + OUTPOST_WALKWAY.gateMargin

      // Decks only have 2 rails: front parapet and outer end-cap
      expect(leftDeck.rails).toHaveLength(2)
      expect(rightDeck.rails).toHaveLength(2)

      // No deck rail blocks the portal at x = +-xNear
      for (const deck of [leftDeck, rightDeck]) {
        for (const rail of deck.rails) {
          const blocksInnerPortal = (rail.min.x <= -xNear && rail.max.x >= -xNear) ||
            (rail.min.x <= xNear && rail.max.x >= xNear)
          // The only rail touching xNear is the front parapet (Z within railThickness of front wall)
          if (blocksInnerPortal) {
            expect(rail.max.z - rail.min.z).toBeCloseTo(OUTPOST_WALKWAY.railThickness)
          }
        }
      }

      // Bridge has 2 rails: front parapet and rear safety rail, with no lateral end-caps
      expect(bridge.rails).toHaveLength(2)
      const bridgeRailsObstacles = outpost.walkways!.obstacles.filter(
        o => bridge.rails.includes(o.box),
      )
      expect(bridgeRailsObstacles).toHaveLength(2)
      for (const rail of bridge.rails) {
        expect(rail.min.x).toBeCloseTo(-xNear)
        expect(rail.max.x).toBeCloseTo(xNear)
      }
    },
  )

  it(
    'allows walking entity body collision across gatehouse bridge in both directions',
    () => {
      const faction = 'roman'
      const { outpost, placement } = build(faction)
      const { layout } = outpost.walkways!
      const leftDeck = layout.decks.find(d => d.side === -1)!
      const rightDeck = layout.decks.find(d => d.side === 1)!
      const bridge = layout.bridge
      const xNear = placement.gateWidth / 2 + OUTPOST_WALKWAY.gateMargin
      const midZ = (bridge.slab.min.z + bridge.slab.max.z) / 2
      const radius = 0.35
      const height = 1.8
      const bottomOffset = 0

      // Direction A: Left deck -> bridge -> right deck (-8m to +8m)
      const pos = new THREE.Vector3(-8, leftDeck.topY, midZ)
      const prev = pos.clone()
      for (let x = -7.6; x <= 8.0; x += 0.4) {
        prev.copy(pos)
        pos.x = x
        pos.y -= 0.08
        const result = resolveObstacleCollision(
          pos,
          prev,
          -0.1,
          true,
          radius,
          height,
          bottomOffset,
          outpost.obstacles,
          { walkSurfaces: true },
        )
        expect(result.onGround).toBe(true)
        expect(pos.x).toBeCloseTo(x, 1)
        if (x < -xNear) {
          expect(pos.y).toBeCloseTo(leftDeck.topY, 1)
        } else if (x > xNear) {
          expect(pos.y).toBeCloseTo(rightDeck.topY, 1)
        } else {
          expect(pos.y).toBeCloseTo(getWalkRampHeight(bridge.walkSurface, x, midZ)!, 1)
        }
      }

      // Direction B: Right deck -> bridge -> left deck (+8m to -8m)
      pos.set(8, rightDeck.topY, midZ)
      for (let x = 7.6; x >= -8.0; x -= 0.4) {
        prev.copy(pos)
        pos.x = x
        pos.y -= 0.08
        const result = resolveObstacleCollision(
          pos,
          prev,
          -0.1,
          true,
          radius,
          height,
          bottomOffset,
          outpost.obstacles,
          { walkSurfaces: true },
        )
        expect(result.onGround).toBe(true)
        expect(pos.x).toBeCloseTo(x, 1)
      }
    },
  )

  it(
    'stops projectiles striking solid bridge slab or merlons while passing arrows through open crenels and under bridge',
    () => {
      const faction = 'roman'
      const { outpost } = build(faction)
      const { layout } = outpost.walkways!
      const bridge = layout.bridge
      const midZ = (bridge.slab.min.z + bridge.slab.max.z) / 2
      const bridgeSlabObstacle = outpost.walkways!.obstacles.find(o => o.box === bridge.slab)!
      const bridgeFrontRailObstacle = outpost.walkways!.obstacles.find(o => o.box === bridge.rails[0])!

      // 1. Bridge slab physically blocks projectiles (not projectilePassable)
      expect(bridgeSlabObstacle.projectilePassable).toBeFalsy()
      expect(bridgeSlabObstacle.navigationPassable).toBe(true)

      // 2. Front rail has projectile boxes for sill + merlons
      expect(bridgeFrontRailObstacle.projectileBoxes).toBeDefined()
      expect(bridgeFrontRailObstacle.projectileBoxes!.length).toBeGreaterThan(1)

      // 3. Central open crenel above gate center (x=0) lets arrows through above sill height
      const centerSurfaceY = getWalkRampHeight(bridge.walkSurface, 0, midZ)!
      const frontRailMidZ = (bridge.rails[0].min.z + bridge.rails[0].max.z) / 2
      const arrowPointInCrenel = new THREE.Vector3(0, centerSurfaceY + 0.65, frontRailMidZ)
      const hitCrenelMerlon = bridgeFrontRailObstacle.projectileBoxes!.some(
        box => box.containsPoint(arrowPointInCrenel),
      )
      expect(hitCrenelMerlon).toBe(false)

      // 4. Solid merlon at x=1.2 intercepts arrows at chest/eye height
      const merlonSurfaceY = getWalkRampHeight(bridge.walkSurface, 1.2, midZ)!
      const arrowPointInMerlon = new THREE.Vector3(1.2, merlonSurfaceY + 0.65, frontRailMidZ)
      const hitMerlon = bridgeFrontRailObstacle.projectileBoxes!.some(
        box => box.containsPoint(arrowPointInMerlon),
      )
      expect(hitMerlon).toBe(true)
    },
  )
})

describe('outpost walkway mode isolation', () => {
  const standard: OutpostWalkwayLaunchFields = { type: 'defense' }

  it('enables the rampart for standard Defense Campaign launches', () => {
    expect(isOutpostWalkwayEnabled(standard, false)).toBe(true)
    expect(isOutpostWalkwayEnabled(undefined, false)).toBe(false)
    expect(isOutpostWalkwayEnabled(null, false)).toBe(false)
  })

  it.each<[string, Partial<OutpostWalkwayLaunchFields>]>([
    ['career outpost relief', { careerMissionKind: 'outpost-relief', careerReliefPhase: 'march' }],
    ['career mission id only', { careerMissionId: 'm1' }],
    ['veteran assault', { careerMissionKind: 'veteran-outpost-assault', careerVeteranOutpost: { missionKind: 'veteran-outpost-assault' } as any }],
    ['personal squad defense', { careerPersonalSquad: { missionId: 'p1' } as any }],
  ])('keeps %s on the original outpost', (_label, overrides) => {
    expect(isOutpostWalkwayEnabled({ ...standard, ...overrides }, false)).toBe(false)
  })

  it.each<[string, Partial<OutpostWalkwayLaunchFields>]>([
    ['career outpost defense', { careerMissionId: 'm1', careerMissionKind: 'outpost-defense' }],
    ['captain frontline', { careerMissionId: 'm2', careerMissionKind: 'captain-outpost-defense' }],
    ['veteran defense', { careerMissionKind: 'veteran-outpost-defense', careerVeteranOutpost: { missionKind: 'veteran-outpost-defense' } as any }],
  ])('enables the shared rampart for %s', (_label, overrides) => {
    expect(isOutpostWalkwayEnabled({ ...standard, ...overrides }, false)).toBe(true)
  })

  it('lets a DEV preview opt in explicitly', () => {
    expect(isOutpostWalkwayEnabled(undefined, true)).toBe(true)
  })
})
