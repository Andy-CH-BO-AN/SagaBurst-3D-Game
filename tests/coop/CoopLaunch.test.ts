import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_COOP_PORT, coopSession, type CoopBridge, type CoopLinkState } from '../../src/coop/CoopLink'
import { announceCoopScene, announceCoopTownReturn, type CoopLaunchPayload } from '../../src/coop/CoopLaunch'
import { MemoryStorage } from '../helpers/memoryStorage'

const globals = globalThis as unknown as { localStorage?: Storage; sessionStorage?: Storage; window?: unknown }

afterEach(() => { delete globals.localStorage; delete globals.sessionStorage; delete globals.window })

describe('Co-op host Town return', () => {
  it('sends the guest to the Town as the host leaves its mission, and the host Town re-announces under that id', async () => {
    const sent: { t: string; payload?: CoopLaunchPayload }[] = []
    const connected: CoopLinkState = { role: 'host', status: 'connected', address: null, port: DEFAULT_COOP_PORT, error: null }
    const bridge: CoopBridge = {
      status: async () => connected, host: async () => connected, join: async () => connected, leave: async () => {},
      send: data => { sent.push(JSON.parse(String(data))) }, onMessage: () => () => {}, onState: () => () => {},
    }
    globals.window = { sagaburstCoop: bridge }
    globals.localStorage = new MemoryStorage({ initialValues: [['sagaburst_career_v2', 'return save']] })
    globals.sessionStorage = new MemoryStorage({ initialValues: [['sagaburst_career_town', '1']] })
    await coopSession().host()
    const launches = () => sent.filter(message => message.t === 'launch').map(message => message.payload!)

    announceCoopTownReturn()
    const [leaving] = launches()
    expect(leaving.scene).toBe('town')
    // The guest builds its Town from the host's return save and Town entry session.
    expect(leaving.session).toEqual({ sagaburst_career_town: '1' })

    // The host's Town page: the guest that already followed keeps its Town (same id, no second reload).
    announceCoopScene('town')
    expect(launches()[1].id).toBe(leaving.id)
    // Used once: a later Town visit is a new scene the guest follows again.
    announceCoopScene('town')
    expect(launches()[2].id).not.toBe(leaving.id)
  })
})
