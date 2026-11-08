'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { planShards, shardFiles, validateManifest, selectedNames, selectionSummary,
  nonRuntimePath, cssPath } = require('../tooling/ci-plan.cjs')
const { aggregate, verifiedFullSha } = require('../tooling/ci-run.cjs')
const item = (file, count, runner = 'vitest') => ({
  file, runner, names: Array.from({ length: count }, (_, i) => 'suite > case ' + i),
  nativeNames: Array.from({ length: count }, (_, i) => 'suite case ' + i) })
const vitest = item('tests/a.test.ts', 3)
const node = item('tests/release/ci.test.cjs', 1, 'node')
function related() {
  const selectedCases = { [vitest.file]: [0, 2], [node.file]: [0] }
  return { planId: 'synthetic', mode: 'related', source: 'Supercov native tests affected',
    baseSha: 'a'.repeat(40), headSha: 'b'.repeat(40), changedFiles: ['src/a.ts'],
    inventory: [vitest, node], selected: [vitest.file, node.file], selectedCases,
    shards: planShards([item(vitest.file, 2), node], 'related'), fallback: null }
}
test('Supercov Related plan resolves exact full names and is aggregate limited', () => {
  const plan = validateManifest(related())
  assert.deepEqual(selectedNames(plan, vitest.file), [vitest.names[0], vitest.names[2]])
  assert.equal(plan.shards.length, 1)
  assert.equal(plan.shards[0].expectedCount, 3)
  assert.match(selectionSummary(plan), /Supercov native tests affected/)
  assert.match(selectionSummary(plan), /Total suite: 4 leaves; Selected: 3 leaves/)
})
test('Related 500 aggregate must not become multiple shards or Full fallback', () => {
  const many = [item('tests/a.test.ts', 300), item('tests/b.test.ts', 201)]
  assert.throws(() => planShards(many, 'related'), /500-leaf limit: 501/)
  assert.equal(shardFiles(many).length, 2)
  assert.throws(() => validateManifest({ ...related(), shards: [
    { id: 'a', vitestFiles: [vitest.file], nodeFiles: [], expectedCount: 2 },
    { id: 'b', vitestFiles: [], nodeFiles: [node.file], expectedCount: 1 },
  ] }), /Related aggregate exceeds 500/)
})
test('Full remains separate and can split across multiple shards', () => {
  const files = [item('tests/a.test.ts', 300), item('tests/b.test.ts', 300)]
  const sha = 'a'.repeat(40)
  const manifest = { mode: 'full', inventory: files, selected: files.map(f => f.file),
    changedFiles: [], headSha: sha, checkoutSha: sha, shards: shardFiles(files) }
  assert.equal(validateManifest(manifest).shards.length, 2)
  assert.equal(verifiedFullSha(manifest), sha)
})
test('strict non-runtime and CSS-only policies may intentionally have no gameplay tests', () => {
  const empty = { mode: 'related', inventory: [], selected: [], shards: [] }
  assert.equal(validateManifest({ ...empty, docsOnly: true, changedFiles: ['docs/README.md'] }).shards.length, 0)
  assert.equal(validateManifest({ ...empty, nonRuntimeOnly: true, changedFiles: ['CLAUDE.md'] }).shards.length, 0)
  assert.equal(validateManifest({ ...empty, styleOnly: true, changedFiles: ['src/ui/battle-setup.css'] }).shards.length, 0)
  assert.throws(() => validateManifest({ ...empty, changedFiles: ['src/a.ts'] }), /Empty code selection/)
  assert.equal(nonRuntimePath('CLAUDE.md'), true)
  assert.equal(nonRuntimePath('tests/tooling/supercov-related.cjs'), false)
  assert.equal(cssPath('src/ui/battle-setup.css'), true)
  assert.equal(cssPath('public/model.glb'), false)
})
test('invalid selected ordinal, duplicate identity and unexpected shard are rejected', () => {
  assert.throws(() => validateManifest({ ...related(), selectedCases: {
    [vitest.file]: [0, 0], [node.file]: [0] } }), /Invalid selected/)
  assert.throws(() => validateManifest({ ...related(), selectedCases: {
    [vitest.file]: [0, 100], [node.file]: [0] } }), /Invalid selected/)
  assert.throws(() => validateManifest({ ...related(), shards: [] }), /Missing\/duplicate/)
})
function reportFor(plan, runId) {
  const shard = plan.shards[0]
  const runners = [
    { runner: 'vitest', files: shard.vitestFiles },
    { runner: 'node', files: shard.nodeFiles },
  ]
  const reports = runners.map(group => ({
    runner: group.runner, runId, complete: true, errors: [],
    files: group.files.map(file => ({ file })),
    cases: group.files.flatMap(file => selectedNames(plan, file).map(name => ({
      file, name, state: 'passed', ms: 5 }))),
  }))
  return { runId, planId: plan.planId, planDigest: createHash('sha256').update(JSON.stringify(plan)).digest('hex'),
    shardId: shard.id, result: 'passed', reports }
}
test('normal Vitest execution must match exactly selected individual leaves', () => {
  const plan = related()
  const good = reportFor(plan, 'run')
  assert.equal(aggregate(plan, [good]).count, 3)
  const missing = structuredClone(good)
  missing.reports[0].cases.pop()
  assert.throws(() => aggregate(plan, [missing]), /Missing|duplicate|Unexpected/)
  const unexpected = structuredClone(good)
  unexpected.reports[0].cases.push({ file: vitest.file, name: vitest.names[1], state: 'passed', ms: 5 })
  assert.throws(() => aggregate(plan, [unexpected]), /Missing|duplicate|Unexpected/)
})
