// LAN co-op relay: one host and up to three guests exchange frames through this hub.
// The host game stays authoritative; the hub reads only each frame's one-byte route prefix.
//
// Frame prefix (first byte of every peer frame):
//   text frames:   '0'..'3' (a seat) or '*' (every guest); hub notices start with 'h'
//   binary frames: 0..3 (a seat) or 0xff (every guest)
// Sent by the host it names the target guest(s); sent by a guest it is ignored (guests reach only the
// host). The hub rewrites it to the sender's seat before forwarding, so receivers know who spoke.
const os = require('node:os')
const { WebSocketServer } = require('ws')

const DEFAULT_COOP_PORT = 47820
/** Bumped whenever the frame format changes; a mismatched peer is refused with COOP_CLOSE_VERSION. */
const COOP_HUB_VERSION = 2
const COOP_MAX_GUESTS = 3
const COOP_HOST_SEAT = 0
const COOP_CLOSE_ROLE = 4000
const COOP_CLOSE_FULL = 4001
const COOP_CLOSE_VERSION = 4002

const TEXT_ALL = 0x2a // '*'
const TEXT_SEAT_0 = 0x30 // '0'
const BINARY_ALL = 0xff

function lanAddresses() {
  const out = []
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) out.push(entry.address)
    }
  }
  return out
}

function asBuffer(data) {
  if (Buffer.isBuffer(data)) return data
  if (Array.isArray(data)) return Buffer.concat(data)
  return Buffer.from(data)
}

/** The guest seat a joining page takes: its previous seat when still free (a page reload), else the lowest free one. */
function pickGuestSeat(taken, preferred) {
  if (Number.isInteger(preferred) && preferred >= 1 && preferred <= COOP_MAX_GUESTS && !taken.has(preferred)) return preferred
  for (let seat = 1; seat <= COOP_MAX_GUESTS; seat++) if (!taken.has(seat)) return seat
  return null
}

function startHub(port = DEFAULT_COOP_PORT, log = () => {}) {
  return new Promise((resolve, reject) => {
    const server = new WebSocketServer({ port, host: '0.0.0.0', maxPayload: 16 * 1024 * 1024 })
    let host = null
    const guests = new Map()
    /** A guest page's reconnect key -> the seat it last held, so a reloading page keeps its seat. */
    const seatByKey = new Map()
    const open = socket => socket && socket.readyState === socket.OPEN
    const notify = (socket, event) => { if (open(socket)) socket.send(`h${JSON.stringify({ t: 'hub', ...event })}`) }
    const guestSeats = () => [...guests.keys()].sort((a, b) => a - b)

    server.on('connection', (socket, request) => {
      const params = new URL(request.url ?? '/', 'ws://hub').searchParams
      const role = params.get('role')
      if (role !== 'host' && role !== 'guest') { socket.close(COOP_CLOSE_ROLE, 'role'); return }
      if (Number(params.get('v')) !== COOP_HUB_VERSION) { socket.close(COOP_CLOSE_VERSION, 'version'); return }
      let seat
      if (role === 'host') {
        if (host) { socket.close(COOP_CLOSE_FULL, 'occupied'); return }
        seat = COOP_HOST_SEAT
        host = socket
      } else {
        const key = (params.get('key') ?? '').slice(0, 64)
        seat = pickGuestSeat(new Set(guests.keys()), key ? seatByKey.get(key) : undefined)
        if (seat === null) { socket.close(COOP_CLOSE_FULL, 'full'); return }
        if (key) seatByKey.set(key, seat)
        guests.set(seat, socket)
      }
      log(`[coop-hub] ${role} ${seat} connected`)
      if (role === 'host') {
        notify(socket, { event: 'welcome', role, seat, peers: guestSeats() })
        for (const guest of guests.values()) notify(guest, { event: 'peer-joined', seat })
      } else {
        notify(socket, { event: 'welcome', role, seat, peers: host ? [COOP_HOST_SEAT] : [] })
        notify(host, { event: 'peer-joined', seat })
      }
      socket.on('message', (data, isBinary) => {
        const frame = asBuffer(data)
        if (frame.length < 1) return
        if (role === 'guest') {
          if (!open(host)) return
          const out = Buffer.from(frame)
          out[0] = isBinary ? seat : TEXT_SEAT_0 + seat
          host.send(out, { binary: isBinary })
          return
        }
        const route = frame[0]
        const all = isBinary ? route === BINARY_ALL : route === TEXT_ALL
        const target = isBinary ? route : route - TEXT_SEAT_0
        const out = Buffer.from(frame)
        out[0] = isBinary ? COOP_HOST_SEAT : TEXT_SEAT_0
        for (const [guestSeat, guest] of guests) {
          if ((all || guestSeat === target) && open(guest)) guest.send(out, { binary: isBinary })
        }
      })
      socket.on('close', () => {
        if (role === 'host') {
          if (host !== socket) return
          host = null
          for (const guest of guests.values()) notify(guest, { event: 'peer-left', seat })
        } else {
          if (guests.get(seat) !== socket) return
          guests.delete(seat)
          notify(host, { event: 'peer-left', seat })
        }
        log(`[coop-hub] ${role} ${seat} left`)
      })
    })
    server.once('listening', () => resolve({
      port: server.address().port,
      close: () => new Promise(done => {
        for (const client of server.clients) client.terminate()
        server.close(() => done())
      }),
    }))
    server.once('error', reject)
  })
}

module.exports = {
  COOP_CLOSE_FULL, COOP_CLOSE_VERSION, COOP_HUB_VERSION, COOP_MAX_GUESTS, DEFAULT_COOP_PORT, lanAddresses, pickGuestSeat, startHub,
}

if (require.main === module) {
  const port = Number(process.argv[2]) || DEFAULT_COOP_PORT
  startHub(port, message => console.log(message)).then(() => {
    console.log(`[coop-hub] listening on port ${port}（最多 ${COOP_MAX_GUESTS + 1} 人）`)
    for (const address of lanAddresses()) console.log(`[coop-hub] 隊友在「區網合作」輸入主機 IP：${address}`)
  }).catch(error => { console.error(error); process.exit(1) })
}
