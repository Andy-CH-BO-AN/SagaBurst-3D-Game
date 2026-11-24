// LAN co-op relay: one host and one guest exchange frames through this hub.
// The host game stays authoritative; the hub never inspects game payloads.
const os = require('node:os')
const { WebSocketServer } = require('ws')

const DEFAULT_COOP_PORT = 47820

function lanAddresses() {
  const out = []
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) out.push(entry.address)
    }
  }
  return out
}

function startHub(port = DEFAULT_COOP_PORT, log = () => {}) {
  return new Promise((resolve, reject) => {
    const server = new WebSocketServer({ port, host: '0.0.0.0', maxPayload: 16 * 1024 * 1024 })
    const peers = { host: null, guest: null }
    const other = role => (role === 'host' ? peers.guest : peers.host)
    const notify = (socket, event) => {
      if (socket && socket.readyState === socket.OPEN) socket.send(JSON.stringify({ t: 'hub', ...event }))
    }
    server.on('connection', (socket, request) => {
      const role = new URL(request.url ?? '/', 'ws://hub').searchParams.get('role')
      if (role !== 'host' && role !== 'guest') { socket.close(4000, 'role'); return }
      if (peers[role]) { socket.close(4001, 'occupied'); return }
      peers[role] = socket
      log(`[coop-hub] ${role} connected`)
      notify(socket, { event: 'welcome', role, peer: Boolean(other(role)) })
      notify(other(role), { event: 'peer-joined', role })
      socket.on('message', (data, isBinary) => {
        const target = other(role)
        if (target && target.readyState === target.OPEN) target.send(data, { binary: isBinary })
      })
      socket.on('close', () => {
        if (peers[role] !== socket) return
        peers[role] = null
        log(`[coop-hub] ${role} left`)
        notify(other(role), { event: 'peer-left', role })
      })
    })
    server.once('listening', () => resolve({
      port,
      close: () => new Promise(done => {
        for (const client of server.clients) client.terminate()
        server.close(() => done())
      }),
    }))
    server.once('error', reject)
  })
}

module.exports = { DEFAULT_COOP_PORT, lanAddresses, startHub }

if (require.main === module) {
  const port = Number(process.argv[2]) || DEFAULT_COOP_PORT
  startHub(port, message => console.log(message)).then(() => {
    console.log(`[coop-hub] listening on port ${port}`)
    for (const address of lanAddresses()) console.log(`[coop-hub] 隊友在「區網合作」輸入主機 IP：${address}`)
  }).catch(error => { console.error(error); process.exit(1) })
}
