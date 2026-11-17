// Main-process co-op connection. It outlives renderer reloads (Town <-> mission),
// and lets a secure sagaburst:// page reach plain ws:// LAN peers through IPC.
const { ipcMain } = require('electron')
const WebSocket = require('ws')
const { DEFAULT_COOP_PORT, lanAddresses, startHub } = require('./coop-hub.cjs')

function installCoopNet(getWindow) {
  let hub = null
  let socket = null
  let state = { role: null, status: 'idle', address: null, port: DEFAULT_COOP_PORT, error: null }

  const emit = (channel, ...args) => {
    const window = getWindow()
    if (window && !window.isDestroyed()) window.webContents.send(channel, ...args)
  }
  const setState = patch => { state = { ...state, ...patch }; emit('coop:state', snapshot()) }
  const snapshot = () => ({ ...state, addresses: lanAddresses() })

  const closeSocket = () => {
    const old = socket
    socket = null
    if (old) { old.removeAllListeners(); old.on('error', () => {}); old.terminate() }
  }
  const leave = async () => {
    closeSocket()
    const oldHub = hub
    hub = null
    if (oldHub) await oldHub.close()
    setState({ role: null, status: 'idle', address: null, error: null })
  }
  const connect = (url, role, address, port) => new Promise(resolve => {
    closeSocket()
    const next = new WebSocket(`${url}/?role=${role}`)
    socket = next
    setState({ role, status: 'connecting', address, port, error: null })
    next.on('open', () => { if (socket === next) { setState({ status: 'connected' }); resolve(snapshot()) } })
    next.on('message', (data, isBinary) => {
      if (socket !== next) return
      if (isBinary) emit('coop:message', new Uint8Array(data))
      else emit('coop:message', data.toString())
    })
    next.on('error', error => { if (socket === next) setState({ error: String(error?.message ?? error) }) })
    next.on('close', () => {
      if (socket !== next) return
      socket = null
      setState({ status: 'closed' })
      resolve(snapshot())
    })
  })

  ipcMain.handle('coop:status', () => snapshot())
  ipcMain.handle('coop:host', async (_event, port) => {
    await leave()
    const hubPort = Number.isInteger(port) && port > 1024 && port < 65536 ? port : DEFAULT_COOP_PORT
    try { hub = await startHub(hubPort) }
    catch (error) { setState({ status: 'closed', error: `無法開啟連接埠 ${hubPort}：${error?.message ?? error}` }); return snapshot() }
    return connect(`ws://127.0.0.1:${hubPort}`, 'host', '127.0.0.1', hubPort)
  })
  ipcMain.handle('coop:join', async (_event, address, port) => {
    await leave()
    const host = String(address ?? '').trim()
    if (!/^[A-Za-z0-9.:-]+$/.test(host)) { setState({ status: 'closed', error: '主機位址格式不正確' }); return snapshot() }
    const hubPort = Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_COOP_PORT
    return connect(`ws://${host}:${hubPort}`, 'guest', host, hubPort)
  })
  ipcMain.handle('coop:leave', () => leave())
  ipcMain.on('coop:send', (_event, data) => {
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(data)
  })
  return { dispose: leave }
}

module.exports = { installCoopNet }
