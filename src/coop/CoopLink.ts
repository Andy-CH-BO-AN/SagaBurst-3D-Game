/**
 * LAN co-op link. Electron keeps the socket in the main process (it survives the
 * Town <-> mission page reloads); a plain browser connects directly to a hub
 * started with `npm run coop:hub` and reconnects after reloads from sessionStorage.
 */
export type CoopRole = 'host' | 'guest'
export type CoopLinkStatus = 'idle' | 'connecting' | 'connected' | 'closed'
export const DEFAULT_COOP_PORT = 47820
/** Must match electron/coop-hub.cjs: the hub refuses a page of another frame format. */
export const COOP_HUB_VERSION = 2
/** One host and up to this many guests share a room (electron/coop-hub.cjs). */
export const COOP_MAX_GUESTS = 3
export const COOP_HOST_SEAT = 0
/** `send` target: every guest (host) / the host (guest). */
export const COOP_BROADCAST = -1
const COOP_CLOSE_FULL = 4001
const COOP_CLOSE_VERSION = 4002

/** Why the hub refused this page, in the words the lobby shows. */
export function coopCloseReason(code: number): string | null {
  if (code === COOP_CLOSE_FULL) return `房間已滿（最多 ${COOP_MAX_GUESTS + 1} 人）`
  if (code === COOP_CLOSE_VERSION) return '主機與這台電腦的遊戲版本不同，請更新到同一版本'
  return null
}

export interface CoopLinkState {
  role: CoopRole | null
  status: CoopLinkStatus
  address: string | null
  port: number
  error: string | null
  addresses?: string[]
}

export type CoopFrame = string | Uint8Array

/**
 * Every frame through the hub starts with a one-byte route (see electron/coop-hub.cjs): text frames an
 * ASCII seat digit or '*', binary frames the seat byte or 0xff. Outgoing it names the target; incoming
 * the hub has rewritten it to the sender's seat. Hub notices are text frames starting with 'h'.
 */
export function encodeCoopFrame(payload: string, to: number): string
export function encodeCoopFrame(payload: Uint8Array, to: number): Uint8Array
export function encodeCoopFrame(payload: CoopFrame, to: number): CoopFrame {
  const all = !Number.isInteger(to) || to < 0
  if (typeof payload === 'string') return `${all ? '*' : String(to)}${payload}`
  const out = new Uint8Array(payload.byteLength + 1)
  out[0] = all ? 0xff : to
  out.set(payload, 1)
  return out
}

/** A received frame: who sent it ('hub' for hub notices) and its payload, or null when malformed. */
export function decodeCoopFrame(frame: CoopFrame): { from: number | 'hub'; payload: CoopFrame } | null {
  if (typeof frame === 'string') {
    const head = frame.charAt(0)
    if (head === 'h') return { from: 'hub', payload: frame.slice(1) }
    const seat = Number(head)
    return head && Number.isInteger(seat) && seat <= COOP_MAX_GUESTS ? { from: seat, payload: frame.slice(1) } : null
  }
  if (frame.byteLength < 1 || frame[0] > COOP_MAX_GUESTS) return null
  return { from: frame[0], payload: frame.subarray(1) }
}

/** Shape of `window.sagaburstCoop` exposed by electron/preload.cjs. */
export interface CoopBridge {
  status(): Promise<CoopLinkState>
  host(port?: number): Promise<CoopLinkState>
  join(address: string, port?: number): Promise<CoopLinkState>
  leave(): Promise<void>
  send(data: CoopFrame): void
  onMessage(listener: (data: CoopFrame) => void): () => void
  onState(listener: (state: CoopLinkState) => void): () => void
}

const BROWSER_LINK_KEY = 'sagaburst_coop_link'

/** Browser fallback: same contract as the Electron bridge, direct WebSocket. */
class BrowserCoopBridge implements CoopBridge {
  private socket: WebSocket | null = null
  /** Settles the open() whose socket was replaced or left, so its caller never waits forever. */
  private settleOpen: (() => void) | null = null
  private state: CoopLinkState = { role: null, status: 'idle', address: null, port: DEFAULT_COOP_PORT, error: null }
  private readonly messageListeners = new Set<(data: CoopFrame) => void>()
  private readonly stateListeners = new Set<(state: CoopLinkState) => void>()

  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined) {}

  /** Survives this tab's reloads, so the hub gives a reloading guest page its previous seat. */
  private seatKey = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`

  async status(): Promise<CoopLinkState> {
    if (this.state.role || !this.storage) return this.state
    try {
      const saved = JSON.parse(this.storage.getItem(BROWSER_LINK_KEY) ?? 'null') as { role?: CoopRole; address?: string; port?: number; key?: string } | null
      if (saved && (saved.role === 'host' || saved.role === 'guest') && typeof saved.address === 'string') {
        if (typeof saved.key === 'string' && /^[a-z0-9]{1,64}$/.test(saved.key)) this.seatKey = saved.key
        return this.open(saved.role, saved.address, saved.port ?? DEFAULT_COOP_PORT)
      }
    } catch { /* stale link data is ignored */ }
    return this.state
  }

  host(port = DEFAULT_COOP_PORT): Promise<CoopLinkState> { return this.open('host', window.location.hostname || 'localhost', port) }
  join(address: string, port = DEFAULT_COOP_PORT): Promise<CoopLinkState> { return this.open('guest', address.trim(), port) }

  async leave(): Promise<void> {
    this.storage?.removeItem(BROWSER_LINK_KEY)
    this.closeSocket()
    this.setState({ role: null, status: 'idle', address: null, error: null })
    this.settlePendingOpen()
  }

  send(data: CoopFrame): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(data)
  }

  onMessage(listener: (data: CoopFrame) => void): () => void {
    this.messageListeners.add(listener)
    return () => this.messageListeners.delete(listener)
  }

  onState(listener: (state: CoopLinkState) => void): () => void {
    this.stateListeners.add(listener)
    return () => this.stateListeners.delete(listener)
  }

  private setState(patch: Partial<CoopLinkState>): void {
    this.state = { ...this.state, ...patch }
    for (const listener of this.stateListeners) listener(this.state)
  }

  private settlePendingOpen(): void {
    const settle = this.settleOpen
    this.settleOpen = null
    settle?.()
  }

  private closeSocket(): void {
    const old = this.socket
    this.socket = null
    if (old) { old.onopen = old.onclose = old.onerror = old.onmessage = null; old.close() }
  }

  private open(role: CoopRole, address: string, port: number): Promise<CoopLinkState> {
    this.closeSocket()
    this.storage?.setItem(BROWSER_LINK_KEY, JSON.stringify({ role, address, port, key: this.seatKey }))
    this.setState({ role, status: 'connecting', address, port, error: null })
    this.settlePendingOpen()
    return new Promise(resolve => {
      this.settleOpen = () => resolve(this.state)
      let socket: WebSocket
      try { socket = new WebSocket(`ws://${address}:${port}/?role=${role}&v=${COOP_HUB_VERSION}&key=${this.seatKey}`) }
      catch (error) { this.setState({ status: 'closed', error: String(error) }); resolve(this.state); return }
      socket.binaryType = 'arraybuffer'
      this.socket = socket
      socket.onopen = () => { this.setState({ status: 'connected' }); resolve(this.state) }
      socket.onerror = () => this.setState({ error: `無法連線到 ${address}:${port}（主機需先執行 npm run coop:hub）` })
      socket.onclose = event => {
        if (this.socket !== socket) return
        this.socket = null
        const reason = coopCloseReason(event.code)
        this.setState({ status: 'closed', ...(reason ? { error: reason } : {}) })
        resolve(this.state)
      }
      socket.onmessage = event => {
        const data: CoopFrame = typeof event.data === 'string' ? event.data : new Uint8Array(event.data as ArrayBuffer)
        for (const listener of this.messageListeners) listener(data)
      }
    })
  }
}

/**
 * The host address as people type or paste it: `192.168.1.20`, `192.168.1.20:47820`,
 * `ws://192.168.1.20:47820/`, `http://host:5173` or `[fe80::1]:47820`. A port that is
 * not the hub's own (e.g. the web page's 5173) is ignored. Null when nothing usable remains.
 */
export function parseCoopAddress(input: string, defaultPort = DEFAULT_COOP_PORT): { host: string; port: number } | null {
  let text = input.trim().replace(/^[a-z]+:\/\//i, '').replace(/[/?#].*$/, '')
  let port = defaultPort
  const bracketed = /^\[([0-9a-f:.]+)\](?::(\d+))?$/i.exec(text)
  if (bracketed) {
    text = bracketed[1]
    if (bracketed[2]) port = Number(bracketed[2])
  } else {
    const withPort = /^([^:]+):(\d+)$/.exec(text)
    if (withPort) { text = withPort[1]; port = Number(withPort[2]) }
  }
  // The web page's own port is a common paste; the hub always listens on its own port.
  if (port === 5173 || port === 4173) port = defaultPort
  if (!text || !/^[A-Za-z0-9.:-]+$/.test(text) || !Number.isInteger(port) || port < 1 || port > 65535) return null
  return { host: text, port }
}

export interface CoopMessage { t: string; [key: string]: unknown }

/** One renderer-wide session: link state, which seats are present and typed message fan-out. */
export class CoopSession {
  private linkState: CoopLinkState = { role: null, status: 'idle', address: null, port: DEFAULT_COOP_PORT, error: null }
  /** Host: the guest seats in the room. Guest: the host's seat while it is there. */
  private readonly peerSeats = new Set<number>()
  private ownSeat: number | null = null
  private readonly jsonListeners = new Map<string, Set<(message: CoopMessage, from: number) => void>>()
  private readonly binaryListeners = new Set<(data: Uint8Array, from: number) => void>()
  private readonly changeListeners = new Set<() => void>()
  private ready: Promise<void> | null = null

  constructor(private readonly bridge: CoopBridge) {
    bridge.onState(state => {
      this.linkState = state
      if (state.status !== 'connected') this.clearPeers()
      this.changed()
    })
    bridge.onMessage(data => this.receive(data))
  }

  /** Re-attaches to an existing Electron/browser link. Safe to call more than once. */
  init(): Promise<void> {
    this.ready ??= this.bridge.status().then(state => {
      this.linkState = state
      // Ask the other side to announce itself again after a page reload.
      if (state.status === 'connected') this.send({ t: 'hello' })
      this.changed()
    }).catch(() => {})
    return this.ready
  }

  get state(): Readonly<CoopLinkState> { return this.linkState }
  get role(): CoopRole | null { return this.linkState.status === 'connected' || this.linkState.status === 'connecting' ? this.linkState.role : null }
  get connected(): boolean { return this.linkState.status === 'connected' }
  /** Guest: the host is there. Host: at least one guest is. */
  get peerConnected(): boolean { return this.connected && this.peerSeats.size > 0 }
  get isHost(): boolean { return this.role === 'host' }
  get isGuest(): boolean { return this.role === 'guest' }
  /** This page's seat in the room (host 0, guests 1..COOP_MAX_GUESTS), once the hub said so. */
  get seat(): number | null { return this.connected ? this.ownSeat : null }
  /** Seats this page can talk to, ascending: the guests (host) or the host (guest). */
  get peers(): number[] { return this.connected ? [...this.peerSeats].sort((a, b) => a - b) : [] }
  isPeer(seat: number): boolean { return this.connected && this.peerSeats.has(seat) }

  /** Counts host/join/leave calls: a superseded attempt's late result never overwrites a newer one. */
  private attempt = 0

  async host(port?: number): Promise<CoopLinkState> { const n = ++this.attempt; return this.settle(n, await this.bridge.host(port)) }
  async join(address: string, port?: number): Promise<CoopLinkState> { const n = ++this.attempt; return this.settle(n, await this.bridge.join(address, port)) }
  async leave(): Promise<void> { this.attempt++; await this.bridge.leave(); this.clearPeers(); this.changed() }

  private settle(attempt: number, state: CoopLinkState): CoopLinkState {
    if (attempt === this.attempt) { this.linkState = state; this.changed() }
    return this.linkState
  }

  /** Host: to one guest seat, or every guest by default. Guest: always to the host. */
  send(message: CoopMessage, to = COOP_BROADCAST): void { if (this.connected) this.bridge.send(encodeCoopFrame(JSON.stringify(message), to)) }
  sendBinary(data: Uint8Array, to = COOP_BROADCAST): void { if (this.connected) this.bridge.send(encodeCoopFrame(data, to)) }

  /** `from` is the sender's seat (the host is 0). */
  on(type: string, listener: (message: CoopMessage, from: number) => void): () => void {
    let set = this.jsonListeners.get(type)
    if (!set) this.jsonListeners.set(type, set = new Set())
    set.add(listener)
    return () => { set!.delete(listener) }
  }

  onBinary(listener: (data: Uint8Array, from: number) => void): () => void {
    this.binaryListeners.add(listener)
    return () => { this.binaryListeners.delete(listener) }
  }

  onChange(listener: () => void): () => void {
    this.changeListeners.add(listener)
    return () => { this.changeListeners.delete(listener) }
  }

  private changed(): void { for (const listener of this.changeListeners) listener() }

  private clearPeers(): void {
    this.peerSeats.clear()
    this.ownSeat = null
  }

  private receive(data: CoopFrame): void {
    const frame = decodeCoopFrame(data)
    if (!frame) return
    const { from, payload } = frame
    if (typeof payload !== 'string') {
      if (from === 'hub') return
      for (const listener of this.binaryListeners) listener(payload, from)
      return
    }
    let message: CoopMessage
    try { message = JSON.parse(payload) as CoopMessage } catch { return }
    if (!message || typeof message.t !== 'string') return
    if (from === 'hub') {
      if (message.t === 'hub') this.hubEvent(message)
      return
    }
    if (message.t === 'hello' && !this.peerSeats.has(from)) { this.peerSeats.add(from); this.changed() }
    for (const listener of this.jsonListeners.get(message.t) ?? []) listener(message, from)
  }

  private hubEvent(message: CoopMessage): void {
    const seat = Number(message.seat)
    if (message.event === 'welcome') {
      this.ownSeat = Number.isInteger(seat) ? seat : null
      this.peerSeats.clear()
      for (const peer of Array.isArray(message.peers) ? message.peers : []) if (Number.isInteger(peer)) this.peerSeats.add(peer as number)
      // Joining a room someone is already in: introduce ourselves so the host (re)sends its scene.
      for (const peer of this.peerSeats) this.send({ t: 'hello' }, peer)
    } else if (message.event === 'peer-joined' && Number.isInteger(seat)) {
      this.peerSeats.add(seat)
      this.send({ t: 'hello' }, seat)
    } else if (message.event === 'peer-left' && Number.isInteger(seat)) this.peerSeats.delete(seat)
    else return
    this.changed()
  }
}

function createBridge(): CoopBridge {
  const electron = typeof window !== 'undefined' ? (window as unknown as { sagaburstCoop?: CoopBridge }).sagaburstCoop : undefined
  return electron ?? new BrowserCoopBridge(typeof sessionStorage !== 'undefined' ? sessionStorage : undefined)
}

let session: CoopSession | null = null
export function coopSession(): CoopSession {
  return session ??= new CoopSession(createBridge())
}
