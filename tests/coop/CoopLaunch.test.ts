import { afterEach, describe, expect, it } from 'vitest'
import { announceCoopScene, announceCoopTownReturn, type CoopLaunchPayload } from '../../src/coop/CoopLaunch'
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
  return { ...double, announceCoopScene, announceCoopTownReturn, launches }
}

describe('Co-op host Town return', () => {
  it('sends the guest to the Town as the host leaves its mission, and the host Town re-announces under that id', async () => {
    globals.localStorage = new MemoryStorage({ initialValues: [['sagaburst_career_v2', 'return save']] })
    globals.sessionStorage = new MemoryStorage({ initialValues: [['sagaburst_career_town', '1']] })
    const host = await hostPage([1])

    host.announceCoopTownReturn()
    const [leaving] = host.launches()
    expect(leaving.to).toBe('all')
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

describe('Co-op launch delivery', () => {
  it('takes every guest along, and gives a guest that (re)joins the running scene at its own seat only', async () => {
    globals.localStorage = new MemoryStorage()
    globals.sessionStorage = new MemoryStorage()
    const host = await hostPage([1, 2, 3])
    host.announceCoopScene('game', { careerMissionId: 'm1' } as CareerCombatLaunch)
    const [launch] = host.launches()
    expect(host.launches().map(sent => sent.to)).toEqual(['all'])
    host.sent.length = 0
    host.receive(2, { t: 'hello' })
    expect(host.launches()).toEqual([{ to: 2, payload: launch.payload }])
  })
})
