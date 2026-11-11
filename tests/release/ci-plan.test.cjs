'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { validateManifest, selectedNames, selectionSummary, requireLogicBudget } = require('../tooling/ci-plan.cjs')
const { aggregate, verifiedFullSha } = require('../tooling/ci-run.cjs')
const { assessJobs } = require('../tooling/ci-check-jobs.cjs')
const { MAX_LOGIC_CASES } = require('../tooling/budget.cjs')

const item = (file, count, runner = 'vitest') => ({
  file, runner, names: Array.from({ length: count }, (_, i) => 'suite > case ' + i),
  nativeNames: Array.from({ length: count }, (_, i) => 'suite case ' + i) })
const sha = 'a'.repeat(40)

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

test('Full logic suite enforces 1,000 cases hard limit and verifies execution', () => {
  for (const sizes of [[500], [500, 480], [1000]]) {
    const plan = validateManifest(full(...sizes))
    assert.equal(verifiedFullSha(plan), sha)
    assert.match(selectionSummary(plan), /Case limit: 1000 hard limit/)
  }
  const valid = validateManifest(full(500, 500))
  assert.equal(aggregate(valid, run(valid)).count, 1000)
  assert.throws(() => validateManifest(full(501, 500)), /1000-case limit: 1001 unique cases/)
  assert.throws(() => requireLogicBudget(1001), /1000-case limit/)
  assert.doesNotThrow(() => requireLogicBudget(1000))
})

test('no plan can be divided into shards to escape the budget limit', () => {
  assert.throws(() => validateManifest({ ...full(1), shards: [] }), /cannot be sharded/)
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

test('純資產空選測必須有獨立驗證成功的證據', () => {
  const plan = { mode: 'related', assetOnly: true, inventory: [], selected: [], expectedCount: 0 }
  assert.throws(() => validateManifest(plan), /independent passed validation/)
  assert.equal(validateManifest({ ...plan, assetValidation: { result: 'passed', files: ['model.glb'] } }).expectedCount, 0)
  assert.throws(() => validateManifest({ ...plan, assetValidation: { result: 'failed', files: ['model.glb'] } }), /independent passed validation/)
})

test('必要 Job 缺少、跳過或舊 Attempt 不得冒充成功', () => {
  const run = { id: 20, head_sha: sha, run_attempt: 2, status: 'completed', conclusion: 'success' }
  const jobs = ['logic / gate', 'web'].map(name => ({ name, id: 20, head_sha: sha, run_attempt: 2, status: 'completed', conclusion: 'success' }))
  assert.equal(assessJobs(run, jobs, sha, undefined, { latestRun: run }).result, 'passed')
  assert.equal(assessJobs(run, [], sha).required['logic / gate'], 'missing')
  assert.equal(assessJobs(run, [{ ...jobs[0], conclusion: 'skipped' }, jobs[1]], sha).result, 'unverified')
  assert.equal(assessJobs(run, [{ ...jobs[0], run_attempt: 1 }, jobs[1]], sha).required['logic / gate'], 'stale-attempt')
  assert.equal(assessJobs(run, jobs, 'b'.repeat(40)).result, 'unverified')
})

test('目前驗收拒絕較早綠燈，歷史診斷不回報目前 passed', () => {
  const run = { id: 20, head_sha: sha, run_attempt: 1, status: 'completed', conclusion: 'success' }
  const jobs = ['logic / gate', 'web'].map(name => ({ name, head_sha: sha, run_attempt: 1, status: 'completed', conclusion: 'success' }))
  assert.match(assessJobs(run, jobs, sha, undefined, { latestRun: { ...run, id: 21, conclusion: 'failure' } }).reasons.join(), /newer run exists/)
  assert.equal(assessJobs(run, jobs, sha, undefined, { latestRun: { ...run, run_attempt: 2 } }).result, 'unverified')
  assert.equal(assessJobs(run, jobs, sha, undefined, { historical: true }).result, 'historical-passed')
})
