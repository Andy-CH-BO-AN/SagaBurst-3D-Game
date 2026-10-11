import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { FORTIFIED_CAMP_HILL, getFortifiedCampHeightOffset, getTerrainHeight, getWalkRampHeight } from '../../src/world/Terrain'
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

  it.each(['roman', 'viking'] as const)(
    'keeps every %s chevaux-de-frise inside the perimeter and leaves the gate corridor open',
    faction => {
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

  it('faces Roman and Viking defenders toward their mirrored front gates', () => {
    expect(getCampaignDefenderFacingYaw('roman')).toBe(0)
    expect(getCampaignDefenderFacingYaw('viking')).toBe(Math.PI)
  })

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
    }
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

  it.each(['roman', 'viking'] as const)('places %s decks and stairs inside the front wall, clear of gate, tents and chevaux', faction => {
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
      // Walkers and mounted riders pass under: every ground point beneath keeps >= 3m headroom.
      for (let x = Math.abs(deck.slab.min.x); x <= Math.abs(deck.slab.max.x); x += 2) {
        for (const z of [deck.slab.min.z, deck.slab.max.z]) {
          expect(deck.slab.min.y - getTerrainHeight(deck.side * x, z)).toBeGreaterThanOrEqual(3)
        }
      }
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

  it('mirrors Roman and Viking walkway footprints across the Z axis', () => {
    const roman = getOutpostWalkwayLayout(getCampaignOutpostPlacement('roman'))
    const viking = getOutpostWalkwayLayout(getCampaignOutpostPlacement('viking'))
    roman.decks.forEach((deck, i) => {
      const mirrored = viking.decks[i]
      expect(deck.side).toBe(mirrored.side)
      expect([deck.slab.min.x, deck.slab.max.x]).toEqual([mirrored.slab.min.x, mirrored.slab.max.x])
      expect(deck.slab.min.z).toBeCloseTo(-mirrored.slab.max.z)
      expect(deck.slab.max.z).toBeCloseTo(-mirrored.slab.min.z)
    })
    roman.stairs.forEach((stair, i) => {
      const mirrored = viking.stairs[i]
      expect(stair.ramp.startX).toBe(mirrored.ramp.startX)
      expect(stair.ramp.dirZ).toBe(-mirrored.ramp.dirZ)
      // Ramp length follows each side's terrain, but both land flush against the deck edge.
      const landingEnd = (r: typeof stair.ramp): number => r.startZ + r.dirZ * (r.length + r.landing)
      expect(landingEnd(stair.ramp)).toBeCloseTo(-landingEnd(mirrored.ramp))
    })
  })

  it.each([
    ['roman', -1], ['roman', 1], ['viking', -1], ['viking', 1],
  ] as const)('%s side %i stair rises continuously from the ground to the deck level and landing', (faction, side) => {
    const { outpost, placement } = build(faction)
    const { ramp } = outpost.walkways!.layout.stairs.find(stair => stair.side === side)!
    const deck = outpost.walkways!.layout.decks.find(candidate => candidate.side === side)!
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

  it('keeps ground navigation under the deck open while the stair mass blocks, and survives gate opening', () => {
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

    const outside = new THREE.Vector3(0, 0, walled.placement.frontZ + 20)
    const inside = new THREE.Vector3(0, 0, walled.placement.frontZ - 25)
    walled.outpost.gateController.open()
    walledNav.sync(walled.outpost.obstacles)
    walledNav.beginFrame()
    expect(walledNav.queryPath(outside, inside).status).toBe('path')

    const destroyed = build('viking')
    destroyed.outpost.gate.takeDamage(destroyed.outpost.gate.maxHp)
    const destroyedNav = new NavigationWorld()
    destroyedNav.sync(destroyed.outpost.obstacles)
    destroyedNav.beginFrame()
    expect(destroyedNav.queryPath(
      new THREE.Vector3(0, 0, destroyed.placement.frontZ - 20),
      new THREE.Vector3(0, 0, destroyed.placement.frontZ + 25),
    ).status).toBe('path')
    expect(destroyed.outpost.obstacles.filter(obstacle => !obstacle.damageable)).toHaveLength(destroyed.outpost.walkways!.obstacles.length)
  })

  it('keeps raised deck slabs solid to projectiles while ground navigation passes underneath', () => {
    const { outpost } = build('roman')
    const { layout } = outpost.walkways!
    const slabs = outpost.walkways!.obstacles.filter(obstacle => layout.decks.some(deck => deck.slab === obstacle.box))
    expect(slabs).toHaveLength(2)
    expect(slabs.every(obstacle => obstacle.navigationPassable && !obstacle.projectilePassable)).toBe(true)
    expect(outpost.obstacles.filter(obstacle => obstacle.damageable).every(obstacle => !obstacle.projectilePassable)).toBe(true)
  })
})

describe('outpost walkway mode isolation', () => {
  const standard: OutpostWalkwayLaunchFields = { type: 'defense' }

  it('enables the rampart for standard Defense Campaign launches', () => {
    expect(isOutpostWalkwayEnabled(standard, false)).toBe(true)
    expect(isOutpostWalkwayEnabled(undefined, false)).toBe(false)
    expect(isOutpostWalkwayEnabled(null, false)).toBe(false)
  })

  it.each<[string, Partial<OutpostWalkwayLaunchFields>]>([
    ['career outpost defense', { careerMissionId: 'm1', careerMissionKind: 'outpost-defense' }],
    ['career outpost relief', { careerMissionKind: 'outpost-relief', careerReliefPhase: 'march' }],
    ['career mission id only', { careerMissionId: 'm1' }],
    ['captain frontline', { careerMissionKind: 'captain-outpost-defense' }],
    ['veteran outpost', { careerVeteranOutpost: { missionId: 'v1' } as any }],
    ['personal squad defense', { careerPersonalSquad: { missionId: 'p1' } as any }],
  ])('keeps %s on the original outpost', (_label, overrides) => {
    expect(isOutpostWalkwayEnabled({ ...standard, ...overrides }, false)).toBe(false)
  })

  it('lets a DEV preview opt in explicitly', () => {
    expect(isOutpostWalkwayEnabled(undefined, true)).toBe(true)
  })
})
