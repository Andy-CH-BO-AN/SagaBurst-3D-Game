'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { decodeAffected } = require('../tooling/supercov-related.cjs')
const { planShards } = require('../tooling/ci-plan.cjs')
const run = 'run_abcdef0123'
const inventory = [
  { runner: 'vitest', file: 'tests/example.test.ts', names: ['suite > A', 'suite > B', 'suite > C'] },
  { runner: 'node', file: 'tests/release/gate.test.cjs', names: ['Node test'] },
]
const entry = name => ({ file: 'tests/example.test.ts', name, reasons: ['source changed'] })
function response({ affected = [entry('suite > A')], undetermined = [entry('suite > B')],
  unaffected = [entry('suite > C')], workingTree = {}, overrides = {} } = {}) {
  return {
    schemaVersion: 1, ok: true, command: 'runs.tests.affected',
    data: { run, affected, undetermined, unaffected,
      summary: { tests: affected.length + undetermined.length + unaffected.length,
        affected: affected.length, undetermined: undetermined.length, unaffected: unaffected.length },
      workingTree: { stale: true, reasons: ['instrumented source changed'], runWide: [],
        sourceSetChanged: false, ...workingTree }, ...overrides },
  }
}
const changed = [{ status: 'M', file: 'src/example.ts' }]
test('native exact leaves include undetermined but exclude unexecuted sibling', () => {
  const selection = decodeAffected(response(), inventory, changed, run)
  assert.deepEqual(selection.selectedCases['tests/example.test.ts'], [0, 1])
  assert.deepEqual(selection.selectedCases['tests/release/gate.test.cjs'], [0])
  assert.equal(selection.native.affected, 1)
  assert.equal(selection.native.undetermined, 1)
  assert.equal(planShards(selection.selected.map(file => ({ file, runner: file.endsWith('.cjs') ? 'node' : 'vitest',
    names: selection.selectedCases[file].map(() => 'x') })), 'related')[0].expectedCount, 3)
})
test('changed test runs every discovered leaf including newly registered test', () => {
  const selection = decodeAffected(response(), inventory, [{ status: 'M', file: 'tests/example.test.ts' }], run)
  assert.deepEqual(selection.selectedCases['tests/example.test.ts'], [0, 1, 2])
})
test('missing/ambiguous/duplicate/truncated native identities fail closed', () => {
  const invalid = [
    response({ affected: [entry('suite > X')] }),
    response({ affected: [entry('suite > A'), entry('suite > A')], unaffected: [] }),
    response({ overrides: { affectedCount: 300 } }),
    response({ overrides: { summary: { tests: 999, affected: 1, undetermined: 1, unaffected: 1 } } }),
    { schemaVersion: 1, ok: false, command: 'runs.tests.affected', error: { code: 'NO_RUN' } },
  ]
  for (const item of invalid) assert.throws(() => decodeAffected(item, inventory, changed, run), /unsafe/)
})
test('source scope and unsupported lifecycle changes fail rather than fallback Full', () => {
  assert.throws(() => decodeAffected(response({ workingTree: { sourceSetChanged: true } }), inventory, changed, run), /unsafe/)
  assert.throws(() => decodeAffected(response(), inventory, [{ status: 'A', file: 'src/new.ts' }], run), /unsafe/)
  assert.throws(() => decodeAffected(response(), inventory, [{ status: 'D', file: 'src/old.ts' }], run), /unsafe/)
  assert.throws(() => decodeAffected(response(), inventory, [{ status: 'M', file: 'public/model.glb' }], run), /unsafe/)
})
test('zero source attribution cannot silently become Node-only success', () => {
  const nothing = response({ affected: [], undetermined: [],
    unaffected: [entry('suite > A'), entry('suite > B'), entry('suite > C')] })
  assert.throws(() => decodeAffected(nothing, inventory, changed, run), /unsafe/)
})
test('500 is a Related aggregate limit, not per-shard; no Full fallback', () => {
  const files = count => [{ file: 'tests/a.test.ts', runner: 'vitest',
    names: Array.from({ length: count }, (_, i) => 'leaf ' + i) }]
  assert.equal(planShards(files(500), 'related')[0].expectedCount, 500)
  assert.throws(() => planShards(files(501), 'related'), /Related selection contains 501 leaves/)
  assert.throws(() => planShards(files(501), 'full'), /split its independent suites/)
})
