import { describe, expect, it } from 'vitest'
import { Box3, Vector3 } from 'three'
import { allocateSiegeRampCrews, getSiegeRampPlacement, placeSiegeRampCrew, SIEGE_RAMP } from '../../src/campaign/MobileSiegeRampPolicy'
import type { OutpostWalkwayLayout } from '../../src/campaign/CampaignOutpostWalkways'
import { MobileSiegeRamp } from '../../src/campaign/MobileSiegeRamp'
import { MovingPlatformSupport } from '../../src/movement/MovingPlatformSupport'
import { MobileSiegeRampController } from '../../src/campaign/MobileSiegeRampController'
import { parseCampaignSiegeCheckpoint } from '../../src/campaign/CampaignSiegeCheckpoint'
import { allocateTownSiegeCrews, createTownSiegeCrewSlots, townSiegeFrame } from '../../src/career/TownFourGateSiegePolicy'
import { getTerrainHeight } from '../../src/world/Terrain'

describe('shared siege crew and vehicle lifecycle', () => {
  it('allocates eighty unique Town crew with four T4 pushers and five T4 plus one T5 assault per vehicle', () => {
    const slots = createTownSiegeCrewSlots('roman'), crews = allocateTownSiegeCrews([...slots].reverse())
    expect(crews).toHaveLength(8)
    expect(new Set(crews.flatMap(c => [...c.pusherIds, ...c.assaultIds])).size).toBe(80)
    expect(slots.filter(s => s.spec.visualAssetId === 'roman-hero-t4')).toHaveLength(72)
    expect(slots.filter(s => s.spec.combatProfileId === 'roman-commander')).toHaveLength(8)
    const east = crews.find(c => c.id === 'town-siege-ramp:east:left')!
    expect(east.pusherIds.every(id => id.startsWith('town-siege-ramp:east:left:crew:'))).toBe(true)
    expect(east.assaultIds).toHaveLength(6)
    const duplicate = structuredClone(slots); duplicate[10].spec.actorId = duplicate[0].spec.actorId
    expect(() => allocateTownSiegeCrews(duplicate)).toThrow('Invalid Town siege crew')
  })

  it('uses the same directional frame for all four placements and ground/passage crew positions', () => {
    const slots = createTownSiegeCrewSlots('viking'), assignments = allocateTownSiegeCrews(slots)
    const expected = { north: [0, 1], south: [0, -1], east: [-1, 0], west: [1, 0] }
    for (const gateId of ['north', 'south', 'east', 'west'] as const) {
      const frame = townSiegeFrame(gateId), crew = assignments.find(c => c.gateId === gateId && c.side === -1)!
      expect([frame.inward.x + 0, frame.inward.z + 0]).toEqual(expected[gateId])
      const start = new Vector3(200, 12, 200), dock = start.clone().addScaledVector(frame.inward, 40)
      const surface = { startX: dock.x - frame.inward.x * 30, startZ: dock.z - frame.inward.z * 30,
        startY: 0, topY: 12, dirX: frame.inward.x, dirZ: frame.inward.z, length: 24, landing: 6, halfWidth: 2.5 }
      placeSiegeRampCrew(slots.map(s => s.spec), crew, { id: crew.id, side: -1, start, dock, surface,
        deckConnection: dock.clone().addScaledVector(frame.inward, 4), dirX: frame.inward.x, dirZ: frame.inward.z })
      const passenger = slots.find(s => s.spec.actorId === crew.assaultIds[0])!.spec
      expect(passenger.x).toBe(200 - frame.inward.z - frame.inward.x)
      expect(passenger.z).toBe(200 + frame.inward.x - frame.inward.z)
      expect(passenger.spawnY).toBe(12)
      const pusher = slots.find(s => s.spec.actorId === crew.pusherIds[0])!.spec
      expect(pusher.spawnY).toBe(getTerrainHeight(pusher.x, pusher.z))
      expect((pusher.x - start.x) * frame.inward.x + (pusher.z - start.z) * frame.inward.z).toBeCloseTo(-31.6)
    }
  })

  it('reduces native speed with each lost pusher and never replaces a withdrawn/dead crew member', () => {
    const assignment = allocateTownSiegeCrews(createTownSiegeCrewSlots('roman'))[0], controller = new MobileSiegeRampController(assignment, 100)
    const crew = [...assignment.pusherIds, ...assignment.assaultIds].map(combatantId => ({ combatantId, dead: false }))
    for (const actor of crew) controller.register(actor)
    expect(controller.advance(.1, false)).toBe(0)
    expect(controller.advance(.1)).toBeCloseTo(SIEGE_RAMP.speed * .1)
    for (let lost = 1; lost <= 4; lost++) {
      if (lost === 2) controller.withdraw(crew[lost - 1].combatantId)
      else crew[lost - 1].dead = true
      expect(controller.advance(.1)).toBeCloseTo(SIEGE_RAMP.speed * .1 * (4 - lost) / 4)
    }
    expect(controller.state).toBe('ABANDONED')
    expect(() => controller.register({ combatantId: 'unassigned', dead: false })).toThrow()
    expect(controller.advance(10)).toBe(0)
  })

  it('retains Outpost left/right identities, excludes T4, pushes on Z and keeps the old two-ramp parser contract', () => {
    const specs = createTownSiegeCrewSlots('viking').slice(0, 20).map(({ spec }, index) => ({ ...spec, actorId: `outpost:${index}`, tier: 3 as const }))
    const t4 = { ...specs[0], actorId: 'outpost:t4', tier: 4 as const }
    const crews = allocateSiegeRampCrews([t4, ...specs], 'viking')
    expect(crews.map(c => c.id)).toEqual(['siege-ramp-left', 'siege-ramp-right'])
    expect(crews.flatMap(c => [...c.pusherIds, ...c.assaultIds])).not.toContain(t4.actorId)
    // Named adapter supplies only the placement owner's deck/slab dependency; no world builder.
    const layout = { zSign: 1, decks: [{ side: -1, topY: 8,
      slab: new Box3(new Vector3(-25, 7.5, 50), new Vector3(-15, 8, 56)) }] } as OutpostWalkwayLayout
    const p = getSiegeRampPlacement(layout, -1, -20)
    expect(p.start.x).toBe(-20); expect(p.dock.x).toBe(-20); expect(p.dirZ).toBe(1); expect(p.surface.dirX).toBe(0)
  })

  it('retains the Outpost 1.5-second bridge transition and restores the controller without replaying Dock', () => {
    const crews = allocateSiegeRampCrews(createTownSiegeCrewSlots('viking').slice(0, 20).map(({ spec }) => ({ ...spec, tier: 3 as const })))
    const events: string[] = [], lifecycle = new MobileSiegeRampController(crews[0], 1, state => events.push(state))
    for (const combatantId of [...crews[0].pusherIds, ...crews[0].assaultIds]) lifecycle.register({ combatantId, dead: false })
    lifecycle.advance(1); expect(lifecycle.state).toBe('DOCKING')
    lifecycle.advance(1.49); expect(lifecycle.state).toBe('DOCKING')
    lifecycle.advance(.01); expect(lifecycle.state).toBe('DOCKED')
    const restored = new MobileSiegeRampController(crews[0], 1, () => { throw new Error('Dock replayed') })
    restored.restore({ state: 'DOCKED', distance: 1, dockingProgress: 1 })
    expect(restored.advance(10)).toBe(0); expect(restored.dockingProgress).toBe(1)
    expect(events.filter(e => e === 'DOCKED')).toHaveLength(1)
  })

  it('retains the old Campaign v1 checkpoint identities and two-ramp capacity', () => {
    const crews = allocateSiegeRampCrews(createTownSiegeCrewSlots('viking').slice(0, 20).map(({ spec }) => ({ ...spec, tier: 3 as const })))
    const snapshot = { version: 1, breached: true, ramps: crews.map(assignment => ({ assignment, stagingZ: -20, position: { x: -20, y: 8, z: 49 },
      hp: 520, state: 'DOCKED', distance: 69, dockingProgress: 1 })), actors: {}, destroyedPalisadeIds: [] }
    expect(parseCampaignSiegeCheckpoint(snapshot)).toEqual(snapshot)
    expect(parseCampaignSiegeCheckpoint({ ...snapshot, ramps: [...snapshot.ramps, snapshot.ramps[0]] })).toBeUndefined()
  })
  it('moves the real shared vehicle owner, pushers and platform occupants along X without drifting Z', () => {
    const assignment = allocateTownSiegeCrews(createTownSiegeCrewSlots('roman')).find(a => a.id === 'town-siege-ramp:east:left')!
    const controller = new MobileSiegeRampController(assignment, 40)
    const crew = [...assignment.pusherIds, ...assignment.assaultIds].map(combatantId => ({ combatantId, dead: false, position: new Vector3(190, 10, 62) }))
    for (const actor of crew) controller.register(actor)
    const position = new Vector3(191.9, 12, 62), passenger = crew[4], platform = new MovingPlatformSupport(position)
    platform.attach(passenger)
    const box = new Box3(new Vector3(189, 0, 60), new Vector3(192, 12, 65))
    // The renderer/part-mesh boundary is omitted; real update, readiness, terrain, sweep query and carrier math execute.
    const owner = Object.assign(Object.create(MobileSiegeRamp.prototype) as Pick<MobileSiegeRamp, 'update' | 'position'>, {
      disposed: false, position, controller, assignment, placement: { dirX: -1, dirZ: 0, surface: { topY: 10, startY: 0 } },
      surface: { startX: 222, startZ: 62 }, platform, crew: new Map(crew.map(n => [n.combatantId, n])),
      shared: [], obstacles: [], parts: [], wheelBodies: [], deck: { obstacle: { box } }, run: { obstacle: { box } },
      scratch: new Vector3(), updateGeometry() {},
    })
    owner.update(.1, [])
    expect(owner.position.x).toBeCloseTo(191.42); expect(owner.position.z).toBe(62)
    expect(crew[0].position.x).toBeCloseTo(189.52); expect(crew[0].position.z).toBe(62)
    expect(passenger.position.x).toBeCloseTo(189.52); expect(passenger.position.z).toBe(62)
    expect(platform.position).toEqual(position)
  })

})
