// Sandboxed preload: exposes only the LAN co-op bridge to the game page.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('sagaburstCoop', {
  status: () => ipcRenderer.invoke('coop:status'),
  host: port => ipcRenderer.invoke('coop:host', port),
  join: (address, port) => ipcRenderer.invoke('coop:join', address, port),
  leave: () => ipcRenderer.invoke('coop:leave'),
  send: data => ipcRenderer.send('coop:send', data),
  onMessage: listener => {
    const handler = (_event, data) => listener(data)
    ipcRenderer.on('coop:message', handler)
    return () => ipcRenderer.removeListener('coop:message', handler)
  },
  onState: listener => {
    const handler = (_event, state) => listener(state)
    ipcRenderer.on('coop:state', handler)
    return () => ipcRenderer.removeListener('coop:state', handler)
  },
})
