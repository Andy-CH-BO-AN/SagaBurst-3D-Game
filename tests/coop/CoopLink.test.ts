import { describe, expect, it } from 'vitest'
import { CoopSession, DEFAULT_COOP_PORT, parseCoopAddress, type CoopBridge, type CoopLinkState } from '../../src/coop/CoopLink'

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
  it('says hello when joining a room the host is already in, so the host re-sends its scene', async () => {
    const sent: unknown[] = []
    let deliver: (data: string) => void = () => {}
    let publish: (state: CoopLinkState) => void = () => {}
    const connected: CoopLinkState = { role: 'guest', status: 'connected', address: '172.20.10.4', port: DEFAULT_COOP_PORT, error: null }
    const bridge: CoopBridge = {
      status: async () => ({ ...connected, status: 'idle', role: null }),
      host: async () => connected,
      join: async () => { publish(connected); return connected },
      leave: async () => {},
      send: data => { sent.push(JSON.parse(String(data))) },
      onMessage: listener => { deliver = data => listener(data); return () => {} },
      onState: listener => { publish = listener; return () => {} },
    }
    const session = new CoopSession(bridge)
    await session.join('172.20.10.4')
    deliver(JSON.stringify({ t: 'hub', event: 'welcome', role: 'guest', peer: true }))
    expect(session.peerConnected).toBe(true)
    expect(sent).toEqual([{ t: 'hello' }])
    // An empty room has nobody to greet yet; the host's later peer-joined greeting covers it.
    sent.length = 0
    deliver(JSON.stringify({ t: 'hub', event: 'welcome', role: 'guest', peer: false }))
    expect(sent).toEqual([])
  })
})
