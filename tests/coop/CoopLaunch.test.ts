import { afterEach, describe, expect, it } from 'vitest'
import { announceCoopScene, announceCoopTownReturn, isCoopSeatAdmitted, type CoopLaunchPayload } from '../../src/coop/CoopLaunch'
import type { CareerCombatLaunch } from '../../src/career/CaptainBattleLaunch'
import { coopSession } from '../../src/coop/CoopLink'
import { coopBridgeDouble } from '../helpers/coopBridgeDouble'
import { MemoryStorage } from '../helpers/memoryStorage'

const globals = globalThis as unknown as { localStorage?: Storage; sessionStorage?: Storage; window?: unknown }
/** The page's one co-op link (CoopLaunch keeps the renderer-wide session). */
const double = coopBridgeDouble('host')

afterEach(() => { delete globals.localStorage; delete globals.sessionStorage; delete globals.window })

/** The host page in a room with these guest seats (the hub's welcome replaces the previous room). */
async function hostPage(guests: number[]) {
  globals.window = { sagaburstCoop: double.bridge }
  await coopSession().host()
  double.hub({ event: 'welcome', role: 'host', seat: 0, peers: guests })
  double.sent.length = 0
  const launches = () => double.messages('launch').map(frame => ({ to: frame.to, payload: frame.message!.payload as CoopLaunchPayload }))
  const waits = () => double.messages('wait').map(frame => frame.to)
  return { ...double, announceCoopScene, announceCoopTownReturn, isCoopSeatAdmitted, launches, waits }
}

describe('Co-op host Town return', () => {
  it('sends the guest to the Town as the host leaves its mission, and the host Town re-announces under that id', async () => {
    globals.localStorage = new MemoryStorage({ initialValues: [['sagaburst_career_v2', 'return save']] })
    globals.sessionStorage = new MemoryStorage({ initialValues: [['sagaburst_career_town', '1']] })
    const host = await hostPage([1])

    host.announceCoopTownReturn()
    const [leaving] = host.launches()
    expect(leaving.to).toBe(1)
    expect(leaving.payload.scene).toBe('town')
    // The guest builds its Town from the host's return save and Town entry session.
    expect(leaving.payload.session).toEqual({ sagaburst_career_town: '1' })

    // The host's Town page: the guest that already followed keeps its Town (same id, no second reload).
    host.announceCoopScene('town')
    expect(host.launches()[1].payload.id).toBe(leaving.payload.id)
    // Used once: a later Town visit is a new scene the guest follows again.
    host.announceCoopScene('town')
    expect(host.launches()[2].payload.id).not.toBe(leaving.payload.id)
  })
})

describe('Co-op scene audience', () => {
  it('takes every guest to the battlefield, keeps one partner in the Town across the host reload, and gives a left place to a waiting guest', async () => {
    globals.localStorage = new MemoryStorage()
    globals.sessionStorage = new MemoryStorage()
    const mission = await hostPage([1, 2, 3])
    mission.announceCoopScene('game', { careerMissionId: 'm1' } as CareerCombatLaunch)
    expect(mission.launches().map(launch => launch.to)).toEqual([1, 2, 3])
    expect(mission.waits()).toEqual([])
    mission.sent.length = 0
    mission.announceCoopTownReturn()
    expect(mission.launches().map(launch => launch.to)).toEqual([1])
    expect(mission.waits()).toEqual([2, 3])

    // The host's own page reloads into the Town (the audience is kept in its session): the same partner,
    // and only it, follows under the same id.
    const leftFor = mission.launches()[0].payload.id
    const town = await hostPage([1, 2, 3])
    town.announceCoopScene('town')
    expect(town.launches().map(launch => [launch.to, launch.payload.id])).toEqual([[1, leftFor]])
    expect(town.waits()).toEqual([2, 3])
    expect([1, 2, 3].map(seat => town.isCoopSeatAdmitted(seat))).toEqual([true, false, false])

    // A reloading guest asks again: still waiting while the partner is there, admitted once its place is free.
    town.sent.length = 0
    town.receive(2, { t: 'hello' })
    expect(town.waits()).toEqual([2])
    town.hub({ event: 'peer-left', seat: 1 })
    town.receive(3, { t: 'hello' })
    expect(town.launches().map(launch => launch.to)).toEqual([3])
    expect(town.isCoopSeatAdmitted(3)).toBe(true)
    expect(town.isCoopSeatAdmitted(1)).toBe(false)
  })
})
