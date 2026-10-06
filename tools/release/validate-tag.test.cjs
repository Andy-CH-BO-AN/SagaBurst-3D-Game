const { test } = require('node:test')
const assert = require('node:assert/strict')
const { validateRelease } = require('./validate-tag.cjs')
const version = '1.2.3'
const lock = { version, packages: { '': { version } } }
const git = ref => ({ 'v1.2.3^{commit}': 'release-commit', HEAD: 'release-commit', 'origin/main': 'release-commit' })[ref]
test('allows a version-matched release at current main HEAD', () => assert.equal(validateRelease(version, lock, 'v1.2.3', git), 'release-commit'))
test('rejects dev-only tags and tags at older main commits', () => {
  assert.throws(() => validateRelease(version, lock, 'v1.2.3', ref => ref === 'origin/main' ? 'other-commit' : git(ref)), /main HEAD/)
  assert.throws(() => validateRelease(version, lock, 'v1.2.3', ref => ref === 'HEAD' ? 'other-commit' : git(ref)), /main HEAD/)
})
test('rejects wrong tags, prereleases and mismatched lockfile versions', () => {
  for (const tag of ['v1.2.4', '1.2.3', 'v1.2.3-beta']) assert.throws(() => validateRelease(version, lock, tag, git), /must equal/)
  assert.throws(() => validateRelease('1.2.3-beta', lock, 'v1.2.3-beta', git), /must equal/)
  assert.throws(() => validateRelease(version, { ...lock, version: '0.0.1' }, 'v1.2.3', git), /lock/)
  assert.throws(() => validateRelease(version, { ...lock, packages: { '': { version: '0.0.1' } } }, 'v1.2.3', git), /lock/)
})
