const { test } = require('node:test')
const assert = require('node:assert/strict')
const WebSocket = require('ws')
const { COOP_CLOSE_FULL, COOP_CLOSE_VERSION, COOP_HUB_VERSION, startHub } = require('../../electron/coop-hub.cjs')

/** A page's socket on the hub, collecting what it receives as [kind, route char/byte, payload]. */
function page(port, role, { key, version = COOP_HUB_VERSION } = {}) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/?role=${role}&v=${version}${key ? `&key=${key}` : ''}`)
  const frames = []
  const waiters = []
  const settle = () => { for (const waiter of [...waiters]) if (waiter.done()) waiters.splice(waiters.indexOf(waiter), 1) }
  socket.on('message', (data, isBinary) => {
    const buffer = Buffer.from(data)
    frames.push(isBinary ? { binary: true, from: buffer[0], bytes: [...buffer.subarray(1)] } : { text: buffer.toString('utf8') })
    settle()
  })
  const closed = new Promise(resolve => socket.on('close', code => resolve(code)))
  /** Resolves once `count` frames matching `match` have arrived. */
  const next = (match, count = 1) => new Promise(resolve => {
    const waiter = { done: () => { const hits = frames.filter(match); if (hits.length < count) return false; resolve(hits); return true } }
    if (!waiter.done()) waiters.push(waiter)
  })
  const hubEvent = event => next(frame => frame.text?.startsWith('h') && JSON.parse(frame.text.slice(1)).event === event)
  return { socket, frames, closed, next, hubEvent, welcome: () => hubEvent('welcome').then(([frame]) => JSON.parse(frame.text.slice(1))) }
}

async function withHub(run) {
  const hub = await startHub(0)
  const pages = []
  try { await run(hub.port, (...args) => { const p = page(hub.port, ...args); pages.push(p); return p }) }
  finally { for (const p of pages) p.socket.terminate(); await hub.close() }
}

test('seats a host and three guests, refuses a fifth page and a page of another frame format', () => withHub(async (port, open) => {
  const host = open('host')
  assert.deepEqual((await host.welcome()).peers, [])
  const guests = [open('guest'), open('guest'), open('guest')]
  const seats = (await Promise.all(guests.map(g => g.welcome()))).map(w => w.seat).sort()
  assert.deepEqual(seats, [1, 2, 3])
  assert.equal(await open('guest').closed, COOP_CLOSE_FULL)
  assert.equal(await open('guest', { version: COOP_HUB_VERSION - 1 }).closed, COOP_CLOSE_VERSION)
}))

test('routes host frames to one guest or every guest and stamps guest frames with the sender seat', () => withHub(async (port, open) => {
  const host = open('host')
  await host.welcome()
  const one = open('guest'), two = open('guest')
  const [a, b] = await Promise.all([one.welcome(), two.welcome()])
  const [first, second] = a.seat === 1 ? [one, two] : [two, one]
  await host.hubEvent('peer-joined')
  host.socket.send(`2{"t":"only-two"}`)
  host.socket.send(`*{"t":"all"}`)
  host.socket.send(Buffer.from([0xff, 7, 8]))
  // Every guest hears from seat 0; only seat 2 gets the targeted frame.
  const [, all] = await Promise.all([second.next(f => f.text === '0{"t":"only-two"}'), first.next(f => f.text === '0{"t":"all"}'), first.next(f => f.binary)])
  assert.equal(all[0].text, '0{"t":"all"}')
  assert.deepEqual(first.frames.find(f => f.binary), { binary: true, from: 0, bytes: [7, 8] })
  assert.equal(first.frames.some(f => f.text?.includes('only-two')), false)
  // A guest cannot address another guest: its route byte is overwritten and the frame goes to the host.
  second.socket.send(`1{"t":"hit"}`)
  const [fromGuest] = await host.next(f => f.text?.endsWith('{"t":"hit"}'))
  assert.equal(fromGuest.text, `2{"t":"hit"}`)
  assert.deepEqual(b.peers, [0])
}))
