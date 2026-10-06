const path = require('node:path')

function assetPath(root, address) {
  const url = new URL(address)
  if (url.protocol !== 'sagaburst:' || url.host !== 'game' || url.username || url.password) return null
  const pathname = decodeURIComponent(url.pathname)
  if (pathname.includes('\\') || pathname.includes('\0')) return null
  const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname))
  const relative = path.relative(root, file)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null
  return file
}
module.exports = { assetPath }
