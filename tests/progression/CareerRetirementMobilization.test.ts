import { Box3, Vector3 } from 'three'
import { expect, it } from 'vitest'
import { commanderGateDefenseSlots } from '../../src/career/CaptainMissionCatalog'
import { createCareerProfile, type CareerProfile } from '../../src/career/CareerProfile'
import { hasCompleteRetirementMobilizationCheckpoint, retirementAssaultFormations, retirementGroundStaging, retirementMobilizationNeedsPreparation } from '../../src/career/CareerRetirementMobilization'
import { townDefaultActorLoadout, townEquipmentActorSpecs } from '../../src/career/CareerTownEquipmentState'
import { TOWN_CENTER_FRAME, TOWN_CITY_ROADS, TOWN_LOCAL_ROADS, townHousing } from '../../src/town/TownLayout'
import { TOWN_WATCHTOWER_ARCHER_IDS } from '../../src/town/TownNativeGuardIdentity'
import { townRoster, type TownActorSpec } from '../../src/town/TownRules'
import { getTerrainHeight } from '../../src/world/Terrain'
import { withNativeRetirementCheckpoints } from '../helpers/RetirementMobilizationFixture'

it('stages the complete army between the north gate and plaza with roads open', () => {
    const natives = townEquipmentActorSpecs('roman')
    const formations = retirementAssaultFormations([...natives, ...TOWN_WATCHTOWER_ARCHER_IDS.map(id => ({ id, role: 'archer_infantry' as const }))])!
    const groundIds = formations.filter(formation => formation.source !== 'town-air').flatMap(formation => formation.actorIds)
    // Conservative authored building envelopes; no world or mesh construction.
    const hall = TOWN_CENTER_FRAME
    const obstacles = [...townHousing('viking'),
      { x: (hall.minX + hall.maxX) / 2, z: (hall.minZ + hall.maxZ) / 2, width: hall.maxX - hall.minX, depth: hall.maxZ - hall.minZ },
      { x: -6, z: -17, width: 10, depth: 11 }, { x: -5, z: -39, width: 11, depth: 14 },
      { x: 72, z: 30, width: 2.6, depth: 2.6 }, { x: -29, z: -41, width: 22.4, depth: 32.4 },
    ].map(box => ({ isBarricade: false, box: new Box3(new Vector3(box.x - box.width / 2 - .25, -10, box.z - box.depth / 2 - .25),
      new Vector3(box.x + box.width / 2 + .25, 50, box.z + box.depth / 2 + .25)) }))
    const roads = [...TOWN_CITY_ROADS, ...TOWN_LOCAL_ROADS.slice(1)]
    for (const equipment of ['native', 'all-mountable'] as const) {
      const mounted = new Set(equipment === 'native'
        ? natives.filter(spec => townDefaultActorLoadout('roman', spec).mountId).map(spec => spec.id)
        : groundIds.filter(id => !TOWN_WATCHTOWER_ARCHER_IDS.includes(id)))
      expect(groundIds.filter(id => mounted.has(id))).toHaveLength(equipment === 'native' ? 105 : 227)
      const destinations = retirementGroundStaging(formations, mounted, obstacles, { areConnected: () => true })
      expect(destinations?.size).toBe(232)
      expect(new Set(destinations!.keys())).toEqual(new Set(groundIds))
      const points = [...destinations!].map(([id, point]) => ({ ...point, id, radius: mounted.has(id) ? 1.8 : .7 }))
      const invalid: string[] = []
      for (const [index, point] of points.entries()) {
        if (!(point.x >= -15 + point.radius && point.x <= 90 - point.radius
          && point.z >= -105 + point.radius && point.z <= 28 - point.radius)) invalid.push(`${point.id}:outside staging`)
        if (point.y !== getTerrainHeight(point.x, point.z)) invalid.push(`${point.id}:off terrain`)
        for (let otherIndex = 0; otherIndex < index; otherIndex++) {
          const other = points[otherIndex]
          if (Math.hypot(point.x - other.x, point.z - other.z) < point.radius + other.radius - .0001) invalid.push(`${point.id}:overlaps ${other.id}`)
        }
        for (const road of roads) {
          const dx = road.bx - road.ax, dz = road.bz - road.az
          const t = Math.max(0, Math.min(1, ((point.x - road.ax) * dx + (point.z - road.az) * dz) / (dx * dx + dz * dz)))
          if (Math.hypot(point.x - road.ax - dx * t, point.z - road.az - dz * t) < road.width / 2 + point.radius + .5999) invalid.push(`${point.id}:blocks road`)
        }
      }
      expect(invalid).toEqual([])
      expect(points.some(point => point.z < -70)).toBe(true)
      expect(points.some(point => point.z > 0)).toBe(true)
    }
  })

it('assigns every native retirement humanoid exactly once and stops preparation after its durable receipt', () => {
    const natives: Pick<TownActorSpec, 'id' | 'role'>[] = [...townRoster(),
      { id: 'commander', role: 'commander' }, { id: 'hr-officer', role: 'hr-officer' }, { id: 'eagle-trainer', role: 'eagle-trainer' }]
    const excluded: Pick<TownActorSpec, 'id' | 'role'>[] = [
      { id: 'player', role: 'commander' }, { id: 'personal:1', role: 'melee_infantry' },
      { id: 'enemy-town:captain', role: 'captain' }, { id: 'bandit:1', role: 'melee_infantry' },
      { id: 'mission:temporary', role: 'melee_infantry' }, { id: 'town-eagle-mount:1', role: 'cat' },
    ]
    const formations = retirementAssaultFormations([...natives, ...excluded])!
    const actorIds = formations.flatMap(formation => formation.actorIds)
    expect(actorIds).toHaveLength(237)
    expect(new Set(actorIds).size).toBe(237)
    expect(new Set(actorIds)).toEqual(new Set(natives.filter(actor => actor.role !== 'cat').map(actor => actor.id)))
    const ground = formations.filter(formation => formation.source === 'town-ground')
    expect(ground).toHaveLength(8)
    expect(ground.flatMap(formation => formation.actorIds)).toHaveLength(206)
    expect(ground.map(formation => formation.actorIds)).toEqual(commanderGateDefenseSlots().map(squad => squad.actorIds))
    expect(formations.find(formation => formation.source === 'town-air')?.actorIds).toHaveLength(5)
    expect(formations.find(formation => formation.source === 'native-guard')?.actorIds).toHaveLength(5)
    const auxiliary = formations.filter(formation => formation.source === 'auxiliary')
    expect(auxiliary.map(formation => formation.actorIds)).toEqual([
      [...Array.from({ length: 20 }, (_, index) => `civilian-${index}`), 'merchant'].sort(),
    ])
    expect(retirementAssaultFormations([...excluded, ...natives].reverse())).toEqual(formations)
    expect(excluded.every(actor => !actorIds.includes(actor.id))).toBe(true)
    expect(retirementAssaultFormations([...natives, natives[0]])).toBeNull()
    expect(retirementAssaultFormations(natives.filter(actor => actor.id !== 'merchant'))).toBeNull()
    const pending = withNativeRetirementCheckpoints({ ...commander(), careerRetirement: {
      version: 1, phase: 'mobilizing', acceptedAt: 123, combatElapsedSeconds: 0,
    } })
    expect(retirementMobilizationNeedsPreparation(pending)).toBe(true)
    pending.careerRetirement!.mobilization = { version: 1, commandRevoked: true, refillCompleted: true, formationPrepared: true }
    expect(hasCompleteRetirementMobilizationCheckpoint(pending)).toBe(true)
    expect(retirementMobilizationNeedsPreparation(pending)).toBe(false)
  })

const commander = (): CareerProfile => ({ ...createCareerProfile('roman'), rank: 'commander', totalMerit: 20000 })
