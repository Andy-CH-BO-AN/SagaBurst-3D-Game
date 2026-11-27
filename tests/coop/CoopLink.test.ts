import { describe, expect, it } from 'vitest'
import { CoopSession, DEFAULT_COOP_PORT, parseCoopAddress, type CoopBridge, type CoopLinkState } from '../../src/coop/CoopLink'
import { connectedCoopSession } from '../helpers/coopBridgeDouble'

describe('Co-op host address input', () => {
  it('accepts a bare IP or a pasted hub/page address without doubling the port, and rejects junk', () => {
    expect(parseCoopAddress(' 172.20.10.4 ')).toEqual({ host: '172.20.10.4', port: DEFAULT_COOP_PORT })
    expect(parseCoopAddress('172.20.10.4:47820')).toEqual({ host: '172.20.10.4', port: 47820 })
    expect(parseCoopAddress('ws://172.20.10.4:47821/')).toEqual({ host: '172.20.10.4', port: 47821 })
    // The guest's own page URL: the hub keeps its port.
    expect(parseCoopAddress('http://192.168.1.20:5173/?nolock')).toEqual({ host: '192.168.1.20', port: DEFAULT_COOP_PORT })
    expect(parseCoopAddress('[fe80::1]:47820')).toEqual({ host: 'fe80::1', port: 47820 })
    expect(parseCoopAddress('')).toBeNull()
    expect(parseCoopAddress('host name')).toBeNull()
    expect(parseCoopAddress('1.2.3.4:99999')).toBeNull()
  })
})

describe('Co-op session handshake', () => {
  it('says hello to the host when joining a room it is already in, so the host re-sends its scene', async () => {
    const { session, sent, hub } = await connectedCoopSession('guest', [])
    expect(session.peerConnected).toBe(false)
    // An empty room has nobody to greet yet; the host's later peer-joined greeting covers it.
    expect(sent).toEqual([])
    hub({ event: 'welcome', role: 'guest', seat: 2, peers: [0] })
    expect(session.peerConnected).toBe(true)
    expect(session.seat).toBe(2)
    expect(sent).toEqual([{ to: 0, message: { t: 'hello' } }])
  })

})

describe('Co-op session attempts', () => {
  it('ignores the late result of a superseded join', async () => {
    const state = (address: string): CoopLinkState => ({ role: 'guest', status: 'connected', address, port: DEFAULT_COOP_PORT, error: null })
    const resolvers: Array<(s: CoopLinkState) => void> = []
    const bridge: CoopBridge = {
      status: async () => state('x'), host: async () => state('x'),
      join: () => new Promise(resolve => { resolvers.push(resolve) }),
      leave: async () => {}, send: () => {}, onMessage: () => () => {}, onState: () => () => {},
    }
    const session = new CoopSession(bridge)
    const first = session.join('1.1.1.1'), second = session.join('2.2.2.2')
    resolvers[1](state('2.2.2.2'))
    await second
    resolvers[0]({ ...state('1.1.1.1'), status: 'closed' })
    await first
    expect(session.state.address).toBe('2.2.2.2')
    expect(session.connected).toBe(true)
  })
})
