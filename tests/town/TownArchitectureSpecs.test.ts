import { describe, expect, it } from 'vitest'
import {
  architectureSpec, CIVIC_BUILDING_KINDS, originalTownFootprint, townPlazaLayout,
  type ArchitectureCollider, type ArchitectureFaction, type BuildingSpec, type LocalRect,
} from '../../src/town/architecture/ArchitectureSpecs'
import { stableHorsePositions, TOWN_SITES, townPlayerEntryPoint, townRoster } from '../../src/town/TownRules'
import { TOWN_CENTER, TOWN_PLAZA, TOWN_WELL } from '../../src/town/TownLayout'

const FACTIONS: readonly ArchitectureFaction[] = ['roman', 'viking']
const SPECS: readonly BuildingSpec[] = FACTIONS.flatMap(faction => CIVIC_BUILDING_KINDS.map(kind => architectureSpec(faction, kind)))
/** Everything an on-foot or mounted body can hit (overhead roof volumes start above riders). */
const blocking = (spec: BuildingSpec): ArchitectureCollider[] => spec.colliders.filter(c => c.role !== 'roof' && c.role !== 'overhead')
const overlaps = (c: ArchitectureCollider, r: LocalRect, margin = 0): boolean =>
  c.box[0] < r.maxX + margin && c.box[3] > r.minX - margin && c.box[2] < r.maxZ + margin && c.box[5] > r.minZ - margin
const label = (spec: BuildingSpec) => `${spec.faction}/${spec.kind}`

describe('Town architecture plans', () => {
  it('keep every collider and floor inside the original Town occupancy', () => {
    for (const spec of SPECS) {
      const e = spec.envelope, original = originalTownFootprint(spec.faction, spec.kind)
      if (spec.kind === 'weapons') {
        const publicFloorFront = Math.max(...spec.floor.filter(r => spec.entrance.x > r.minX && spec.entrance.x < r.maxX).map(r => r.maxZ))
        expect(spec.entrance.z, label(spec)).toBe(publicFloorFront)
      }
      // The envelope never shrinks below the body the Town already reserves.
      expect(e.maxX - e.minX, label(spec)).toBeGreaterThanOrEqual(original.width)
      expect(e.maxZ - e.minZ, label(spec)).toBeGreaterThanOrEqual(original.depth)
      for (const c of [...spec.colliders.map(c => ({ minX: c.box[0], maxX: c.box[3], minZ: c.box[2], maxZ: c.box[5] })), ...spec.floor]) {
        expect(c.minX, label(spec)).toBeGreaterThanOrEqual(e.minX - 1e-6)
        expect(c.maxX, label(spec)).toBeLessThanOrEqual(e.maxX + 1e-6)
        expect(c.minZ, label(spec)).toBeGreaterThanOrEqual(e.minZ - 1e-6)
        expect(c.maxZ, label(spec)).toBeLessThanOrEqual(e.maxZ + 1e-6)
      }
    }
  })

  it('give enterable halls an open doorway, a clear aisle and NPC anchors on free floor', () => {
    const halls = SPECS.filter(spec => spec.interior)
    expect(halls.map(label).sort()).toEqual(['roman/hr-center', 'roman/town-center', 'viking/hr-center', 'viking/town-center'])
    for (const spec of halls) {
      const e = spec.entrance, solid = blocking(spec)
      expect(e.doorWidth, label(spec)).toBeGreaterThanOrEqual(3.6)
      expect(e.height, label(spec)).toBeGreaterThanOrEqual(3.2)
      // Door passage from the foot of the steps through the threshold into the aisle (entrances face local +Z).
      const doorway: LocalRect = { minX: e.x - e.doorWidth / 2 + .05, maxX: e.x + e.doorWidth / 2 - .05, minZ: e.z - 1.5, maxZ: e.z + e.approach }
      for (const corridor of [doorway, spec.aisle!]) {
        expect(solid.filter(c => overlaps(c, corridor)).map(c => c.box), label(spec)).toEqual([])
      }
      const npcs = spec.anchors.filter(a => a.role !== 'merchant' && a.role !== 'horse')
      expect(npcs.filter(a => a.role === 'recruit' || a.role === 'npc').length, label(spec)).toBeGreaterThanOrEqual(12)
      for (const anchor of npcs) {
        const spot: LocalRect = { minX: anchor.x, maxX: anchor.x, minZ: anchor.z, maxZ: anchor.z }
        expect(spec.floor.some(r => anchor.x > r.minX && anchor.x < r.maxX && anchor.z > r.minZ && anchor.z < r.maxZ), `${label(spec)} ${anchor.id}`).toBe(true)
        expect(solid.filter(c => overlaps(c, spot, .45)).map(c => c.box), `${label(spec)} ${anchor.id}`).toEqual([])
      }
    }
  })

  it('keep the five stable stalls on the Town horse spawns with clear exits', () => {
    const { x: sx, z: sz, yaw } = TOWN_SITES.stable
    const expected = stableHorsePositions().map(p => ({ x: Math.cos(yaw) * (p.x - sx) - Math.sin(yaw) * (p.z - sz), z: Math.sin(yaw) * (p.x - sx) + Math.cos(yaw) * (p.z - sz) }))
    expect(stableHorsePositions('roman').map(p => p.type)).toEqual(['ORANGE_CAT', 'HORSE', 'ARMORED_HORSE', 'CORGI', 'BLACK_CAT'])
    expect(stableHorsePositions('viking').map(p => p.type)).toEqual(['SNOW_LEOPARD', 'ORANGE_CAT', 'WHITE_CAT', 'SERVAL', 'CARACAL'])
    for (const faction of FACTIONS) {
      const spec = architectureSpec(faction, 'stable'), stalls = spec.anchors.filter(a => a.role === 'horse')
      expect(stalls.map(a => [a.x, a.z]), faction).toEqual(expected.map(p => [expect.closeTo(p.x, 6), expect.closeTo(p.z, 6)]))
      for (const stall of stalls) {
        // A 2m-wide horse body walks straight out of the open front.
        const lane: LocalRect = { minX: stall.x - 1, maxX: stall.x + 1, minZ: stall.z - 1, maxZ: spec.envelope.maxZ + 1 }
        expect(blocking(spec).filter(c => overlaps(c, lane)).map(c => c.box), `${faction} ${stall.id}`).toEqual([])
      }
    }
  })

  it('keep plaza furniture off resident stations, the player entry and the Captain approach', () => {
    const roster = townRoster()
    const stations = roster.flatMap(actor => [{ id: actor.id, x: actor.x, z: actor.z }, ...(actor.garrison ? [{ id: `${actor.id}/garrison`, ...actor.garrison }] : [])])
    const entry = townPlayerEntryPoint()
    for (const faction of FACTIONS) for (const prop of townPlazaLayout(faction)) {
      const name = `${faction} ${prop.kind} ${prop.x},${prop.z}`
      expect(prop.x - prop.radius >= TOWN_PLAZA.minX && prop.x + prop.radius <= TOWN_PLAZA.maxX
        && prop.z - prop.radius >= TOWN_PLAZA.minZ && prop.z + prop.radius <= TOWN_PLAZA.maxZ, name).toBe(true)
      // A standing body (.4m) keeps another .8m of walking room around every prop.
      expect(stations.filter(s => Math.hypot(s.x - prop.x, s.z - prop.z) < prop.radius + 1.2).map(s => s.id), name).toEqual([])
      expect(Math.hypot(entry.x - prop.x, entry.z - prop.z), name).toBeGreaterThan(prop.radius + 3)
      expect(Math.hypot(TOWN_WELL.x - prop.x, TOWN_WELL.z - prop.z), name).toBeGreaterThan(prop.radius + TOWN_WELL.radius + 1)
      // The Captain's mounted approach in front of the hall stays open (TownCivilianLife).
      const approach = Math.abs(prop.x - (TOWN_CENTER.x - 8)) < 13 + prop.radius && prop.z > TOWN_CENTER.z + 13 - prop.radius && prop.z < TOWN_CENTER.z + 28 + prop.radius
      expect(approach, name).toBe(false)
    }
  })
})
