'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { finishRelatedPlan, validateManifest, selectedNames, selectionSummary, requireRelatedBudget } = require('../tooling/ci-plan.cjs')
const { aggregate, partialBatches, verifiedFullSha } = require('../tooling/ci-run.cjs')
const item = (file, count, runner = 'vitest') => ({
  file, runner, names: Array.from({ length: count }, (_, i) => 'suite > case ' + i),
  nativeNames: Array.from({ length: count }, (_, i) => 'suite case ' + i) })
const vitest = item('tests/a.test.ts', 3)
const node = item('tests/release/ci.test.cjs', 1, 'node')
const sha = 'a'.repeat(40)
function related() {
  return { planId: 'synthetic', mode: 'related', source: 'Supercov native tests affected',
    baseSha: 'b'.repeat(40), headSha: sha, changedFiles: ['src/a.ts'],
    inventory: [vitest, node], selected: [vitest.file, node.file],
    selectedCases: { [vitest.file]: [0, 2], [node.file]: [0] }, expectedCount: 3, fallback: null,
    breakdown: { nativeAffected: 2, nativeUndetermined: 0, directTests: 1, nodeContracts: 1, duplicatesRemoved: 1, total: 3 } }
}
function full(...sizes) {
  const inventory = sizes.map((size, i) => item('tests/f' + i + '.test.ts', size))
  return { planId: 'synthetic', mode: 'full', inventory, selected: inventory.map(f => f.file), changedFiles: [],
    headSha: sha, checkoutSha: sha, expectedCount: sizes.reduce((a, b) => a + b, 0) }
}
// What the runner reports back: every selected leaf passed, unless a test changes it.
function run(plan, change = cases => cases) {
  const reports = ['vitest', 'node'].flatMap(runner => {
    const files = plan.selected.filter(file => plan.inventory.find(f => f.file === file).runner === runner)
    return files.length ? [{ runner, runId: 'run', complete: true, errors: [], files: files.map(file => ({ file })),
      cases: change(files.flatMap(file => selectedNames(plan, file).map(name => ({ file, name, state: 'passed', ms: 5 })))) }] : []
  })
  return { runId: 'run', planId: plan.planId, result: 'passed', reports }
}
test('Related summary resolves exact names and reports a reconciling breakdown', () => {
  const plan = validateManifest(related())
  assert.deepEqual(selectedNames(plan, vitest.file), [vitest.names[0], vitest.names[2]])
  const summary = selectionSummary(plan)
  assert.match(summary, /Total suite: 4 leaves; Selected: 3 leaves/)
  for (const line of [/Native affected runnable cases: 2/, /Native undetermined runnable cases: 0/,
    /Added\/modified test cases: 1/, /Fixed Node contracts: 1/, /Duplicates removed: 1/,
    /Final unique selected cases: 3 \/ 500/]) assert.match(summary, line)
})
test('Related accepts exactly 500 unique cases and rejects 501 without fallback', () => {
  const plan = count => {
    const big = item('tests/big.test.ts', count)
    return { ...related(), inventory: [big], selected: [big.file],
      selectedCases: { [big.file]: big.names.map((_, i) => i) }, expectedCount: count }
  }
  assert.equal(validateManifest(plan(500)).expectedCount, 500)
  assert.throws(() => validateManifest(plan(501)), /500-case limit: 501 unique cases\. Split the feature PR/)
  assert.doesNotThrow(() => requireRelatedBudget(500))
  assert.throws(() => requireRelatedBudget(501), /no Full fallback/)
})
test('an over-limit selection still reports its breakdown before failing', () => {
  const big = item('tests/big.test.ts', 501)
  const plan = { ...related(), inventory: [big], selected: [big.file],
    selectedCases: { [big.file]: big.names.map((_, i) => i) }, expectedCount: 501 }
  const published = []
  assert.throws(() => finishRelatedPlan(plan, summary => published.push(selectionSummary(summary))), /501 unique cases/)
  assert.match(published[0], /Native affected runnable cases: 2/)
  assert.deepEqual(finishRelatedPlan(related(), () => assert.fail('within the limit')).expectedCount, 3)
})
test('no plan can be divided into shards to escape the Related limit', () => {
  assert.throws(() => validateManifest({ ...related(), shards: [] }), /cannot be sharded/)
  assert.throws(() => validateManifest({ ...full(1), shards: [] }), /cannot be sharded/)
})
test('Full has no aggregate limit and verifies execution at any size', () => {
  for (const sizes of [[500], [500, 1], [500, 480], [600, 600]]) {
    const plan = validateManifest(full(...sizes))
    assert.equal(verifiedFullSha(plan), sha)
    assert.match(selectionSummary(plan), /Related health: N\/A/)
    assert.match(selectionSummary(plan), /Case limit: none/)
  }
  const justOver = validateManifest(full(500, 1))
  assert.equal(aggregate(justOver, run(justOver)).count, 501)
})
test('Full must select the whole inventory and cannot filter individual cases', () => {
  const plan = full(2, 2)
  assert.throws(() => validateManifest({ ...plan, selected: [plan.selected[0]], expectedCount: 2 }), /Missing\/duplicate/)
  assert.throws(() => validateManifest({ ...plan, selectedCases: {} }), /cannot filter/)
  assert.throws(() => validateManifest({ ...plan, expectedCount: 3 }), /expected case count/)
})
test('missing, duplicate, skipped, failed or over-budget Full cases fail the gate', () => {
  const plan = validateManifest(full(2))
  const leaf = plan.inventory[0]
  for (const change of [
    cases => cases.slice(1),
    cases => [...cases, cases[0]],
    cases => [...cases, { file: leaf.file, name: 'suite > extra', state: 'passed', ms: 1 }],
    cases => [{ ...cases[0], state: 'skipped' }, cases[1]],
    cases => [{ ...cases[0], state: 'failed' }, cases[1]],
    cases => [{ ...cases[0], ms: 100.001 }, cases[1]],
  ]) assert.throws(() => aggregate(plan, run(plan, change)))
  assert.equal(aggregate(plan, run(plan, cases => [{ ...cases[0], ms: 100 }, cases[1]])).maxMs, 100)
  assert.throws(() => aggregate(plan, { ...run(plan), result: 'failed' }), /failed logic run/)
  assert.throws(() => aggregate(plan, null), /failed logic run/)
})
test('docs-only and CSS-only empty plans require explicit safe classification', () => {
  const empty = { mode: 'related', docsOnly: true, inventory: [], selected: [],
    changedFiles: ['docs/README.md'], expectedCount: 0 }
  assert.equal(validateManifest(empty).selected.length, 0)
  assert.equal(aggregate(empty, null).count, 0)
  assert.equal(validateManifest({ ...empty, docsOnly: false, cssOnly: true }).selected.length, 0)
  assert.throws(() => validateManifest({ ...empty, docsOnly: false }), /Empty code selection/)
})
test('invalid selected ordinal, duplicate identity and stale count are rejected', () => {
  assert.throws(() => validateManifest({ ...related(), selectedCases: {
    [vitest.file]: [0, 0], [node.file]: [0] } }), /Invalid selected/)
  assert.throws(() => validateManifest({ ...related(), selectedCases: {
    [vitest.file]: [0, 100], [node.file]: [0] } }), /Invalid selected/)
  assert.throws(() => validateManifest({ ...related(), expectedCount: 2 }), /expected case count/)
})
test('normal Vitest execution must match exactly selected individual leaves', () => {
  const plan = related()
  assert.equal(aggregate(plan, run(plan)).count, 3)
  assert.throws(() => aggregate(plan, run(plan, cases => cases[0].file === vitest.file ? cases.slice(0, -1) : cases)), /Missing|duplicate|Unexpected/)
  assert.throws(() => aggregate(plan, run(plan, cases => cases[0].file === vitest.file
    ? [...cases, { file: vitest.file, name: vitest.names[1], state: 'passed', ms: 5 }] : cases)), /Missing|duplicate|Unexpected/)
})
test('partial files share a process unless a selected name would run an unselected leaf elsewhere', () => {
  const file = (name, ...names) => ({ file: name, runner: 'vitest', names, nativeNames: names })
  const a = file('tests/a.test.ts', 'one', 'shared')
  const b = file('tests/b.test.ts', 'two', 'other')
  const c = file('tests/c.test.ts', 'one', 'three')
  const plan = { inventory: [a, b, c], selectedCases: { [a.file]: [0], [b.file]: [0], [c.file]: [1] } }
  assert.deepEqual(partialBatches(plan, [a.file, b.file, c.file]), [[a.file, b.file], [c.file]])
})
