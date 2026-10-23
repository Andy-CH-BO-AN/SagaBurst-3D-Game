const { test } = require('node:test')
const assert = require('node:assert/strict')
const { validateRelease } = require('../../.github/scripts/release/validate-tag.cjs')
const version = '1.2.3'
const lock = { version, packages: { '': { version } } }
const git = ref => ({ 'v1.2.3^{commit}': 'release-commit', HEAD: 'release-commit', 'origin/main': 'release-commit' })[ref]

test('allows a version-matched release at current main HEAD', () => {
  assert.equal(validateRelease(version, lock, 'v1.2.3', git), 'release-commit')
})
for (const ref of ['HEAD', 'origin/main']) {
  test(`rejects a release tag that does not match ${ref}`, () => {
    assert.throws(() => validateRelease(version, lock, 'v1.2.3', candidate => candidate === ref ? 'other-commit' : git(candidate)), /main HEAD/)
  })
}
test('rejects a tag for a different package version', () => {
  assert.throws(() => validateRelease(version, lock, 'v1.2.4', git), /must equal/)
})
test('rejects a prerelease package even when its tag matches', () => {
  assert.throws(() => validateRelease('1.2.3-beta', lock, 'v1.2.3-beta', git), /must equal/)
})
for (const { name, invalid } of [
  { name: 'lock root', invalid: { ...lock, version: '0.0.1' } },
  { name: 'lock package', invalid: { ...lock, packages: { '': { version: '0.0.1' } } } },
]) {
  test(`rejects an inconsistent ${name} version`, () => {
    assert.throws(() => validateRelease(version, invalid, 'v1.2.3', git), /lock/)
  })
}
