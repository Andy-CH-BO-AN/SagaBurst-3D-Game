/**
 * LAN co-op link. Electron keeps the socket in the main process (it survives the
 * Town <-> mission page reloads); a plain browser connects directly to a hub
 * started with `npm run coop:hub` and reconnects after reloads from sessionStorage.
 */
export type CoopRole = 'host' | 'guest'
export type CoopLinkStatus = 'idle' | 'connecting' | 'connected' | 'closed'
export const DEFAULT_COOP_PORT = 47820

export interface CoopLinkState {
  role: CoopRole | null
  status: CoopLinkStatus
  address: string | null
  port: number
  error: string | null
  addresses?: string[]
}

export type CoopFrame = string | Uint8Array

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

  async status(): Promise<CoopLinkState> {
    if (this.state.role || !this.storage) return this.state
    try {
      const saved = JSON.parse(this.storage.getItem(BROWSER_LINK_KEY) ?? 'null') as { role?: CoopRole; address?: string; port?: number } | null
      if (saved && (saved.role === 'host' || saved.role === 'guest') && typeof saved.address === 'string') {
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
    this.storage?.setItem(BROWSER_LINK_KEY, JSON.stringify({ role, address, port }))
    this.setState({ role, status: 'connecting', address, port, error: null })
    this.settlePendingOpen()
    return new Promise(resolve => {
      this.settleOpen = () => resolve(this.state)
      let socket: WebSocket
      try { socket = new WebSocket(`ws://${address}:${port}/?role=${role}`) }
      catch (error) { this.setState({ status: 'closed', error: String(error) }); resolve(this.state); return }
      socket.binaryType = 'arraybuffer'
      this.socket = socket
      socket.onopen = () => { this.setState({ status: 'connected' }); resolve(this.state) }
      socket.onerror = () => this.setState({ error: `無法連線到 ${address}:${port}（主機需先執行 npm run coop:hub）` })
      socket.onclose = () => {
        if (this.socket !== socket) return
        this.socket = null
        this.setState({ status: 'closed' })
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

/** One renderer-wide session: link state, peer presence and typed message fan-out. */
export class CoopSession {
  private linkState: CoopLinkState = { role: null, status: 'idle', address: null, port: DEFAULT_COOP_PORT, error: null }
  private peer = false
  private readonly jsonListeners = new Map<string, Set<(message: CoopMessage) => void>>()
  private readonly binaryListeners = new Set<(data: Uint8Array) => void>()
  private readonly changeListeners = new Set<() => void>()
  private ready: Promise<void> | null = null

  constructor(private readonly bridge: CoopBridge) {
    bridge.onState(state => {
      this.linkState = state
      if (state.status !== 'connected') this.peer = false
      this.changed()
    })
    bridge.onMessage(data => this.receive(data))
  }

  /** Re-attaches to an existing Electron/browser link. Safe to call more than once. */
  init(): Promise<void> {
    this.ready ??= this.bridge.status().then(state => {
      this.linkState = state
      // Ask the peer to announce itself again after a page reload.
      if (state.status === 'connected') this.send({ t: 'hello' })
      this.changed()
    }).catch(() => {})
    return this.ready
  }

  get state(): Readonly<CoopLinkState> { return this.linkState }
  get role(): CoopRole | null { return this.linkState.status === 'connected' || this.linkState.status === 'connecting' ? this.linkState.role : null }
  get connected(): boolean { return this.linkState.status === 'connected' }
  get peerConnected(): boolean { return this.connected && this.peer }
  get isHost(): boolean { return this.role === 'host' }
  get isGuest(): boolean { return this.role === 'guest' }

  /** Counts host/join/leave calls: a superseded attempt's late result never overwrites a newer one. */
  private attempt = 0

  async host(port?: number): Promise<CoopLinkState> { const n = ++this.attempt; return this.settle(n, await this.bridge.host(port)) }
  async join(address: string, port?: number): Promise<CoopLinkState> { const n = ++this.attempt; return this.settle(n, await this.bridge.join(address, port)) }
  async leave(): Promise<void> { this.attempt++; await this.bridge.leave(); this.peer = false; this.changed() }

  private settle(attempt: number, state: CoopLinkState): CoopLinkState {
    if (attempt === this.attempt) { this.linkState = state; this.changed() }
    return this.linkState
  }

  send(message: CoopMessage): void { if (this.connected) this.bridge.send(JSON.stringify(message)) }
  sendBinary(data: Uint8Array): void { if (this.connected) this.bridge.send(data) }

  on(type: string, listener: (message: CoopMessage) => void): () => void {
    let set = this.jsonListeners.get(type)
    if (!set) this.jsonListeners.set(type, set = new Set())
    set.add(listener)
    return () => { set!.delete(listener) }
  }

  onBinary(listener: (data: Uint8Array) => void): () => void {
    this.binaryListeners.add(listener)
    return () => { this.binaryListeners.delete(listener) }
  }

  onChange(listener: () => void): () => void {
    this.changeListeners.add(listener)
    return () => { this.changeListeners.delete(listener) }
  }

  private changed(): void { for (const listener of this.changeListeners) listener() }

  private receive(data: CoopFrame): void {
    if (typeof data !== 'string') {
      for (const listener of this.binaryListeners) listener(data)
      return
    }
    let message: CoopMessage
    try { message = JSON.parse(data) as CoopMessage } catch { return }
    if (!message || typeof message.t !== 'string') return
    if (message.t === 'hub') {
      const event = message.event
      if (event === 'welcome') {
        this.peer = message.peer === true
        // Joining a room the other side is already in: introduce ourselves so it re-sends its scene.
        if (this.peer) this.send({ t: 'hello' })
      } else if (event === 'peer-joined') { this.peer = true; this.send({ t: 'hello' }) }
      else if (event === 'peer-left') this.peer = false
      this.changed()
    } else if (message.t === 'hello') {
      if (!this.peer) { this.peer = true; this.changed() }
    }
    for (const listener of this.jsonListeners.get(message.t) ?? []) listener(message)
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
