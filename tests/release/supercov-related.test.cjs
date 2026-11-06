'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { decodeAffected } = require('../tooling/supercov-related.cjs')
const { planShards } = require('../tooling/ci-plan.cjs')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const run = 'run_abcdef0123'
const inventory = [
  { runner: 'vitest', file: 'tests/example.test.ts', names: ['suite > A', 'suite > B', 'suite > C'],
    nativeNames: ['suite A', 'suite B', 'suite C'] },
  { runner: 'node', file: 'tests/release/gate.test.cjs', names: ['Node test'] },
]
const leaf = name => ({ file: 'tests/example.test.ts', name, reasons: ['executed changed source'] })
function answer({ affected = [leaf('suite > A')], undetermined = [leaf('suite > B')],
    unaffected = [leaf('suite > C')], workingTree = {}, overrides = {} } = {}) {
  return { schemaVersion: 1, ok: true, command: 'runs.tests.affected', data: {
    run, affected, undetermined, unaffected,
    summary: { tests: affected.length + undetermined.length + unaffected.length,
      affected: affected.length, undetermined: undetermined.length, unaffected: unaffected.length },
    workingTree: { stale: true, reasons: ['instrumented source changed'],
      runWide: [], sourceSetChanged: false, ...workingTree }, ...overrides } }
}
const source = [{ status: 'M', file: 'src/example.ts' }]
test('native exact individual identities select only affected and undetermined siblings', () => {
  const selected = decodeAffected(answer(), inventory, source, run)
  assert.deepEqual(selected.selectedCases['tests/example.test.ts'], [0, 1])
  assert.deepEqual(selected.selectedCases['tests/release/gate.test.cjs'], [0])
  assert.equal(selected.source, 'Supercov native tests affected')
  assert.equal(selected.fallback, null)
  assert.equal(selected.native.total, 3)
})
test('direct changed test runs all current leaves including newly registered cases', () => {
  const selected = decodeAffected(answer(), inventory, [{ status: 'M', file: 'tests/example.test.ts' }], run)
  assert.deepEqual(selected.selectedCases['tests/example.test.ts'], [0, 1, 2])
})
test('renamed direct-test identity uses newly collected names, no guesswork', () => {
  const renamed = inventory.map(item => item.file === 'tests/example.test.ts'
    ? { ...item, names: ['suite > renamed', 'suite > B', 'suite > C'] } : item)
  const selected = decodeAffected(answer(), renamed, [{ status: 'M', file: 'tests/example.test.ts' }], run)
  assert.deepEqual(selected.selectedCases['tests/example.test.ts'], [0, 1, 2])
})
test('missing, duplicate, corrupt or truncated CLI JSON fails closed', () => {
  const cases = [
    answer({ affected: [leaf('suite > absent')] }),
    answer({ affected: [leaf('suite > A'), leaf('suite > A')], unaffected: [] }),
    answer({ overrides: { affectedCount: 3 } }),
    answer({ overrides: { summary: { tests: 999, affected: 1, undetermined: 1, unaffected: 1 } } }),
    { schemaVersion: 1, ok: false, command: 'runs.tests.affected' },
  ]
  for (const item of cases) assert.throws(() => decodeAffected(item, inventory, source, run), /unsafe/)
})
test('unmeasured source and unsupported asset/rename/delete fail closed', () => {
  const cases = [
    [answer({ workingTree: { sourceSetChanged: true } }), source],
    [answer(), [{ status: 'A', file: 'src/new.ts' }]],
    [answer(), [{ status: 'D', file: 'src/removed.ts' }]],
    [answer(), [{ status: 'R100', oldFile: 'src/x.ts', file: 'src/y.ts' }]],
    [answer(), [{ status: 'M', file: 'public/weapon.glb' }]],
  ]
  for (const [result, diff] of cases) assert.throws(() => decodeAffected(result, inventory, diff, run), /unsafe/)
})
test('source changes with no native coverage fail rather than Node-only success', () => {
  const result = answer({ affected: [], undetermined: [],
    unaffected: [leaf('suite > A'), leaf('suite > B'), leaf('suite > C')] })
  assert.throws(() => decodeAffected(result, inventory, source, run), /unsafe/)
})
test('native run identity and workingTree integrity are mandatory', () => {
  assert.throws(() => decodeAffected(answer(), inventory, source, 'run_wrong'), /unsafe/)
  assert.throws(() => decodeAffected(answer({ overrides: { workingTree: null } }), inventory, source, run), /unsafe/)
})
test('500 aggregate leaves passes, 501 fails without Full fallback or shard bypass', () => {
  const files = count => [{ file: 'tests/a.test.ts', runner: 'vitest',
    names: Array.from({ length: count }, (_, i) => 'leaf ' + i) }]
  assert.equal(planShards(files(500), 'related')[0].expectedCount, 500)
  assert.throws(() => planShards(files(501), 'related'), /500-leaf limit: 501/)
  assert.throws(() => planShards(files(501), 'full'), /File exceeds 500/)
})

test('incremental refresh calls only strict public Supercov merge (no unsafe override)', () => {
  const script = readFileSync(resolve(__dirname, '../tooling/supercov-refresh.cjs'), 'utf8')
  assert.match(script, /sc\('merge', seed\.runId, \.\.\.candidateRuns\)/)
  // Check the executable args, not comments explaining why overrides are unsafe.
  assert.doesNotMatch(script, /sc\('merge',\s*'--allow-changed'/)
  assert.match(script, /const newId = matches\[0\]\[1\]/)
  assert.match(script, /valid !== true/)
  assert.match(script, /complete !== true/)
})
