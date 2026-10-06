const { app, BrowserWindow, Menu, net, protocol, session } = require('electron')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { assetPath } = require('./asset-path.cjs')

// A stable standard origin keeps localStorage and relative URLs working offline.
protocol.registerSchemesAsPrivileged([{
  scheme: 'sagaburst',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
}])

async function createWindow() {
  const window = new BrowserWindow({
    title: 'SagaBurst', width: 1440, height: 900, minWidth: 960, minHeight: 640,
    backgroundColor: '#171411',
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webviewTag: false },
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, address) => {
    const url = new URL(address)
    if (url.protocol !== 'sagaburst:' || url.host !== 'game') event.preventDefault()
  })
  await window.loadURL('sagaburst://game/')
}

app.whenReady().then(async () => {
  const root = path.join(app.getAppPath(), 'dist-desktop')
  protocol.handle('sagaburst', async request => {
    try {
      const file = assetPath(root, request.url)
      if (!file || !['GET', 'HEAD'].includes(request.method)) return new Response('Forbidden', { status: 403 })
      return await net.fetch(pathToFileURL(file).href)
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
  // Pointer lock is needed for the game's camera; no other native permissions.
  const allowed = (permission, address) => permission === 'pointerLock' && address?.startsWith('sagaburst://game/')
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => callback(allowed(permission, contents.getURL())))
  session.defaultSession.setPermissionCheckHandler((_contents, permission, origin) => allowed(permission, origin + '/'))
  Menu.setApplicationMenu(null)
  await createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow() })
}).catch(error => { console.error(error); app.exit(1) })
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
