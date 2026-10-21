const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { assetPath } = require('../../electron/asset-path.cjs')
const root = path.resolve('dist-desktop')

test('serves entry and nested asset URLs with queries from the bundle', () => {
  assert.equal(assetPath(root, 'sagaburst://game/'), path.join(root, 'index.html'))
  assert.equal(assetPath(root, 'sagaburst://game/models/horse.glb?v=1'), path.join(root, 'models/horse.glb'))
})
for (const { name, url } of [
  { name: 'an external protocol', url: 'https://game/index.html' },
  { name: 'another bundle host', url: 'sagaburst://other/index.html' },
  { name: 'encoded POSIX traversal', url: 'sagaburst://game/%2e%2e%2fpackage.json' },
  { name: 'encoded Windows traversal', url: 'sagaburst://game/%2e%2e%5cpackage.json' },
  { name: 'URL credentials', url: 'sagaburst://user@game/index.html' },
]) {
  test(`rejects ${name}`, () => assert.equal(assetPath(root, url), null))
}
