import { CoopSession, DEFAULT_COOP_PORT, type CoopBridge, type CoopFrame, type CoopLinkState, type CoopMessage } from '../../src/coop/CoopLink'

/** A frame this page sent: its hub route ('all' guests, or one seat) and payload. */
export interface SentCoopFrame { to: number | 'all'; message?: CoopMessage; bytes?: Uint8Array }

/**
 * A connected co-op bridge that frames like electron/coop-hub.cjs: outgoing frames must carry the
 * one-byte route (a malformed one throws), incoming frames arrive with the sender's seat.
 */
export function coopBridgeDouble(role: 'host' | 'guest') {
  const sent: SentCoopFrame[] = []
  let deliver: (data: CoopFrame) => void = () => {}
  let publish: (state: CoopLinkState) => void = () => {}
  const connected: CoopLinkState = { role, status: 'connected', address: role === 'guest' ? '10.0.0.2' : null, port: DEFAULT_COOP_PORT, error: null }
  const route = (head: number | string): number | 'all' => {
    if (head === '*' || head === 0xff) return 'all'
    const seat = Number(head)
    if (!Number.isInteger(seat) || seat < 0 || seat > 3) throw new Error(`frame without a hub route: ${String(head)}`)
    return seat
  }
  const bridge: CoopBridge = {
    status: async () => connected, host: async () => { publish(connected); return connected }, join: async () => { publish(connected); return connected },
    leave: async () => { publish({ ...connected, role: null, status: 'idle' }) },
    send: data => {
      if (typeof data === 'string') sent.push({ to: route(data.charAt(0)), message: JSON.parse(data.slice(1)) as CoopMessage })
      else sent.push({ to: route(data[0]), bytes: data.slice(1) })
    },
    onMessage: listener => { deliver = listener; return () => {} },
    onState: listener => { publish = listener; return () => {} },
  }
  return {
    bridge, sent,
    /** JSON messages sent, optionally only those of one type. */
    messages: (type?: string) => sent.filter(frame => frame.message && (!type || frame.message.t === type)),
    /** A message from another page, relayed by the hub with the sender's seat. */
    receive: (from: number, message: Record<string, unknown>) => deliver(`${from}${JSON.stringify(message)}`),
    hub: (event: Record<string, unknown>) => deliver(`h${JSON.stringify({ t: 'hub', ...event })}`),
  }
}

/** A session joined to a room through `coopBridgeDouble`, after the hub's welcome. */
export async function connectedCoopSession(role: 'host' | 'guest', peers: number[], seat = role === 'host' ? 0 : 1) {
  const double = coopBridgeDouble(role)
  const session = new CoopSession(double.bridge)
  if (role === 'host') await session.host()
  else await session.join('10.0.0.2')
  double.hub({ event: 'welcome', role, seat, peers })
  double.sent.length = 0
  return { session, ...double }
}
