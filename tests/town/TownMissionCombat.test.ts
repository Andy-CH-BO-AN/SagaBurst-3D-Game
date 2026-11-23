import { describe, expect, it } from 'vitest'
import { Box3, Vector3 } from 'three'
import { TownMissionCombat } from '../../src/town/TownMissionCombat'
import type { NPC } from '../../src/world/NPC'
import type { ObstacleData } from '../../src/world/Terrain'

type Inputs = ConstructorParameters<typeof TownMissionCombat>
/** Grid entries only read liveness and position; no actor or scene is built. */
const body = (x: number, dead = false) => ({ dead, combatPosition: new Vector3(x, 0, 0) }) as unknown as NPC

describe('Town runtime combat roster', () => {
  it('lets hostile actors acquire the living co-op partner through the shared warfare roster and grid', () => {
    const squadMember = body(4), partner = body(10)
    let partnerBody: NPC = partner
    const combat = new TownMissionCombat({
      field: { fieldNpcs: [], ambientBandits: [] }, defense: { fieldNpcs: [] },
      duel: { fieldNpcs: [], isParkedResident: () => false },
    } as unknown as Inputs[0], {
      residents: [], personalSquad: () => ({ actors: [squadMember] }), coopPartner: () => partnerBody,
    } as unknown as Inputs[1])
    combat['prepareOutskirtsFrame'](1 / 60)
    expect(combat.runtimeParticipants).toEqual([squadMember, partner])
    expect(combat.runtimeGrid.getNearby(partner.combatPosition, 1)).toEqual([partner])
    // A fallen partner leaves the roster on the next frame.
    partnerBody = body(10, true)
    combat['prepareOutskirtsFrame'](1 / 60)
    expect(combat.runtimeParticipants).toEqual([squadMember])
    expect(combat.runtimeGrid.getNearby(partner.combatPosition, 1)).toEqual([])
  })

  it('separates overlapping combat actors without pushing them into adjacent solid obstacles', () => {
    const skirt: ObstacleData = { box: new Box3(new Vector3(-2.5, 0, -0.25), new Vector3(2.5, 9, 0)), isBarricade: true }
    const obstacles = [skirt]
    const combat = new TownMissionCombat({
      field: { fieldNpcs: [], ambientBandits: [] }, defense: { fieldNpcs: [] },
      duel: { fieldNpcs: [], isParkedResident: () => false },
    } as unknown as Inputs[0], {
      residents: [], obstacles,
    } as unknown as Inputs[1])

    const a = { dead: false, isFalling: false, isMounted: false, siegeTransport: null, combatPosition: new Vector3(0, 0, 0.55) } as unknown as NPC
    const b = { dead: false, isFalling: false, isMounted: false, siegeTransport: null, combatPosition: new Vector3(0.2, 0, 0.55) } as unknown as NPC
    const resolve = combat as unknown as { resolveCombatActorCollisions(actors: readonly NPC[]): void }
    resolve.resolveCombatActorCollisions([a, b])

    expect(a.combatPosition.distanceTo(b.combatPosition)).toBeGreaterThanOrEqual(1 - 1e-6)
    expect(a.combatPosition.z).toBeGreaterThanOrEqual(0.5 - 1e-6)
    expect(b.combatPosition.z).toBeGreaterThanOrEqual(0.5 - 1e-6)
  })

  it('keeps siegeTransport anchored, skips dead/falling/flying actors, and syncs rider group when mount is pushed', () => {
    const obstacles: ObstacleData[] = []
    const combat = new TownMissionCombat({
      field: { fieldNpcs: [], ambientBandits: [] }, defense: { fieldNpcs: [] },
      duel: { fieldNpcs: [], isParkedResident: () => false },
    } as unknown as Inputs[0], {
      residents: [], obstacles,
    } as unknown as Inputs[1])

    const pusher = { dead: false, isFalling: false, isMounted: false, siegeTransport: 'north:left', combatPosition: new Vector3(0, 0, 0) } as unknown as NPC
    const freeFoot = { dead: false, isFalling: false, isMounted: false, siegeTransport: null, combatPosition: new Vector3(0.4, 0, 0) } as unknown as NPC
    const fallen = { dead: true, isFalling: false, isMounted: false, siegeTransport: null, combatPosition: new Vector3(5, 0, 0) } as unknown as NPC
    const falling = { dead: false, isFalling: true, isMounted: false, siegeTransport: null, combatPosition: new Vector3(5, 0, 0) } as unknown as NPC
    const flyer = { dead: false, isFalling: false, isMounted: true, siegeTransport: null,
      mount: { dead: false, isFlyingMount: true, group: { position: new Vector3(5, 0, 0) } },
      group: { position: new Vector3(5, 0, 0) }, combatPosition: new Vector3(5, 0, 0) } as unknown as NPC
    const activeAtFive = { dead: false, isFalling: false, isMounted: false, siegeTransport: null, combatPosition: new Vector3(5, 0, 0) } as unknown as NPC

    const mountPos = new Vector3(10, 0, 0)
    const riderPos = new Vector3(10, 1.4, 0.1)
    const mounted = { dead: false, isFalling: false, isMounted: true, siegeTransport: null,
      mount: { dead: false, isFlyingMount: false, movementSpeed: 0, group: { position: mountPos } },
      group: { position: riderPos }, combatPosition: mountPos } as unknown as NPC
    const blockerAtMount = { dead: false, isFalling: false, isMounted: false, siegeTransport: 'anchored',
      combatPosition: new Vector3(9.2, 0, 0) } as unknown as NPC

    const resolve = combat as unknown as { resolveCombatActorCollisions(actors: readonly NPC[]): void }
    resolve.resolveCombatActorCollisions([pusher, freeFoot, fallen, falling, flyer, activeAtFive, mounted, blockerAtMount])

    expect(pusher.combatPosition.toArray()).toEqual([0, 0, 0])
    expect(freeFoot.combatPosition.x).toBeGreaterThanOrEqual(1 - 1e-6)
    expect(activeAtFive.combatPosition.toArray()).toEqual([5, 0, 0])
    expect(mountPos.x).toBeGreaterThanOrEqual(10.7 - 1e-6)
    expect(riderPos.x - mountPos.x).toBeCloseTo(0)
    expect(riderPos.y).toBeCloseTo(1.4)
    expect(riderPos.z - mountPos.z).toBeCloseTo(0.1)
  })
})
