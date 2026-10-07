const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { assetPath } = require('../../electron/asset-path.cjs')
const root = path.resolve('dist-desktop')
test('serves entry, nested models and URLs with queries from the bundle', () => {
  assert.equal(assetPath(root, 'sagaburst://game/'), path.join(root, 'index.html'))
  assert.equal(assetPath(root, 'sagaburst://game/models/horse.glb?v=1'), path.join(root, 'models/horse.glb'))
})
test('rejects external origins and encoded traversal on both platforms', () => {
  for (const url of ['https://game/index.html', 'sagaburst://other/index.html', 'sagaburst://game/%2e%2e%2fpackage.json', 'sagaburst://game/%2e%2e%5cpackage.json', 'sagaburst://game/%00foo', 'sagaburst://user@game/index.html']) {
    assert.equal(assetPath(root, url), null, url)
  }
})
