import { describe, expect, it, onTestFinished } from 'vitest'
import { Vector3 } from 'three'
import { TownFourGateSiege } from '../../src/career/TownFourGateSiege'
import { createTownSiegeCrewSlots } from '../../src/career/TownFourGateSiegePolicy'
import { TownGateBreachPolicy } from '../../src/career/TownGateBreachPolicy'
import { TownLayeredNavigation } from '../../src/navigation/TownLayeredNavigation'
import { getTownRampartLayout } from '../../src/town/TownRamparts'
import { SpatialGrid } from '../../src/world/SpatialGrid'
import { ActorDouble, asNpc } from '../helpers/careerActorDoubles'
import { preparedTownSiege, recordingRampFactory, townSiegeWorld } from '../helpers/townSiegeDoubles'

function wallDefender(id: string): ActorDouble {
  const actor = new ActorDouble(id)
  actor.activateTownRampartGarrison('defend', false)
  actor.setMissionCombatTarget(null)
  return actor
}

describe('Town gate breach wall defender release', () => {
  it('dispatches releaseWall once per gate and prevents duplicate replay on subsequent calls or docking', () => {
    const events: string[] = []
    const policy = new TownGateBreachPolicy(event => {
      events.push(`${event.gateId}:${event.kind}`)
      return [`${event.gateId}:wall:1`]
    })

    policy.releaseWall('north')
    policy.releaseWall('north')
    policy.ramp('north', -1, true)

    expect(events).toEqual(['north:wall'])
    expect(policy.gates.get('north')).toMatchObject({
      wallEventHandled: true,
      releasedWallActorIds: ['north:wall:1'],
      dockedRampIds: ['town-siege-ramp:north:left'],
      cavalryEventHandled: false,
    })
  })

  it('releases a gate wall sector only after all siege ramps for that gate are disabled', () => {
    const northAuto = wallDefender('north:auto')
    const northFollow = wallDefender('north:follow')
    northFollow.assignFollowTarget(null, 0)
    const northFormation = wallDefender('north:formation')
    northFormation.assignFormationTarget(9, new Vector3())
    const northPlayer = wallDefender('north:player')
    const eastAuto = wallDefender('east:auto')
    const defenders = [northAuto, northFollow, northFormation, northPlayer, eastAuto]

    const h = preparedTownSiege({
      sectors: [
        { gateId: 'north', wallActorIds: ['north:auto', 'north:follow', 'north:formation', 'north:player'], cavalryActorIds: [] },
        { gateId: 'east', wallActorIds: ['east:auto'], cavalryActorIds: [] },
      ],
    })
    onTestFinished(() => h.siege.dispose())
    for (const actor of defenders) h.siege.register(asNpc(actor))
    h.siege.notifyPlayerOrder(asNpc(northPlayer))

    const leftRamp = h.ramps.get('town-siege-ramp:north:left')!
    const rightRamp = h.ramps.get('town-siege-ramp:north:right')!
    for (const id of leftRamp.assignment.pusherIds) leftRamp.controller.withdraw(id)
    h.siege.update(0.05)

    expect(leftRamp.controller.state).toBe('ABANDONED')
    expect(rightRamp.controller.state).toBe('PUSHING')
    expect(h.siege.policy.gates.get('north')!.wallEventHandled).toBe(false)
    expect(northAuto.tacticalOrder).toBe('defend')
    expect(northAuto.isTownRampartGarrisonActive).toBe(true)

    rightRamp.controller.destroy()

    expect(rightRamp.controller.state).toBe('DESTROYED')
    expect(h.siege.policy.gates.get('north')).toMatchObject({
      wallEventHandled: true,
      releasedWallActorIds: ['north:auto'],
    })
    expect(northAuto.tacticalOrder).toBe('attack')
    expect(northAuto.isTownRampartGarrisonActive).toBe(false)
    expect(northAuto.missionCombatTarget).toBeUndefined()
    expect(northFollow.tacticalOrder).toBe('follow')
    expect(northFormation.tacticalOrder).toBe('formation')
    expect(northPlayer.tacticalOrder).toBe('defend')
    expect(eastAuto.tacticalOrder).toBe('defend')
    expect(eastAuto.isTownRampartGarrisonActive).toBe(true)
  })

  it('releases wall defenders on update after restoring a checkpoint whose gate ramps are already disabled', () => {
    const sectors = [
      { gateId: 'north' as const, wallActorIds: ['north:auto'], cavalryActorIds: [] as string[] },
      { gateId: 'south' as const, wallActorIds: ['south:auto'], cavalryActorIds: [] as string[] },
    ]
    const initial = preparedTownSiege({ sectors })
    const initialNorth = wallDefender('north:auto')
    const initialSouth = wallDefender('south:auto')
    initial.siege.register(asNpc(initialNorth))
    initial.siege.register(asNpc(initialSouth))
    const saved = initial.siege.snapshot()
    initial.siege.dispose()

    const northLeft = saved.ramps.find(r => r.assignment.id === 'town-siege-ramp:north:left')!
    const northRight = saved.ramps.find(r => r.assignment.id === 'town-siege-ramp:north:right')!
    northLeft.state = 'ABANDONED'
    northRight.state = 'DESTROYED'
    northRight.hp = 0

    const layout = getTownRampartLayout()
    const world = townSiegeWorld(layout)
    const createRamp = recordingRampFactory()
    const navigation = { townNav: new TownLayeredNavigation(layout, () => true), areConnected: () => true, sync: () => false }
    const restoredSiege = new TownFourGateSiege({
      createRamp,
      world,
      navigation,
      grid: new SpatialGrid(),
      actors: () => [],
      sectors,
      acceptsOrders: () => true,
      registerHit: () => {},
      unregisterHit: () => {},
    }, saved)
    onTestFinished(() => restoredSiege.dispose())

    const slots = createTownSiegeCrewSlots('viking')
    restoredSiege.prepare(slots)
    for (const slot of slots) {
      restoredSiege.register(asNpc(new ActorDouble(slot.spec.actorId!, { faction: slot.spec.faction, characterFaction: 'viking', x: slot.spec.x, z: slot.spec.z })))
    }
    const northDefender = wallDefender('north:auto')
    const southDefender = wallDefender('south:auto')
    restoredSiege.register(asNpc(northDefender))
    restoredSiege.register(asNpc(southDefender))

    expect(restoredSiege.policy.gates.get('north')!.wallEventHandled).toBe(false)
    expect(northDefender.tacticalOrder).toBe('defend')

    restoredSiege.update(0.05)

    expect(restoredSiege.policy.gates.get('north')).toMatchObject({
      wallEventHandled: true,
      releasedWallActorIds: ['north:auto'],
    })
    expect(northDefender.tacticalOrder).toBe('attack')
    expect(northDefender.isTownRampartGarrisonActive).toBe(false)
    expect(northDefender.missionCombatTarget).toBeUndefined()
    expect(southDefender.tacticalOrder).toBe('defend')
    expect(southDefender.isTownRampartGarrisonActive).toBe(true)
  })
})
