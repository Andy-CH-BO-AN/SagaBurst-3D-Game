const { test } = require('node:test')
const assert = require('node:assert/strict')
const { validateReports, readReport } = require('../tooling/budget.cjs')
const nodeReporter = require('../tooling/node-budget-reporter.cjs')
// Load real dependencies before replacing only the external I/O boundaries.
require('../tooling/ci-run.cjs')

const report = (runner, count, ms = 100) => ({ runner, runId: 'current', complete: true, errors: [],
  cases: Array.from({ length: count }, (_, index) => ({ file: `${runner}.test`, name: `case ${index}`, state: 'passed', ms })) })

async function captureReporter(events) {
  const oldPath = process.env.LOGIC_TEST_NODE_REPORT
  const oldExitCode = process.exitCode
  const oldTargeted = process.env.LOGIC_TEST_TARGETED
  delete process.env.LOGIC_TEST_NODE_REPORT
  process.env.LOGIC_TEST_TARGETED = '0'
  try {
    let output = ''
    for await (const item of nodeReporter(events)) output += item
    return { output, exitCode: process.exitCode }
  } finally {
    if (oldPath === undefined) delete process.env.LOGIC_TEST_NODE_REPORT
    else process.env.LOGIC_TEST_NODE_REPORT = oldPath
    if (oldTargeted === undefined) delete process.env.LOGIC_TEST_TARGETED
    else process.env.LOGIC_TEST_TARGETED = oldTargeted
    process.exitCode = oldExitCode
  }
}

test('combined leaf budget accepts 500 and rejects 501', () => {
  assert.equal(validateReports([report('vitest', 480), report('node', 20)]).count, 500)
  assert.throws(() => validateReports([report('vitest', 481), report('node', 20)]), /501/)
})

test('inclusive case budget accepts 100ms and rejects any excess with case identity', () => {
  assert.equal(validateReports([report('node', 1)], { runners: ['node'] }).maxMs, 100)
  assert.throws(() => validateReports([report('node', 1, 100.001)], { runners: ['node'] }), /node.test > case 0: 100.001ms/)
})

test('missing, stale and failed collection evidence cannot pass', () => {
  assert.throws(() => readReport('/missing/logic-test-report.json', 'current'), /ENOENT/)
  assert.throws(() => validateReports([report('vitest', 1)]), /Missing.*node/)
  assert.throws(() => validateReports([report('vitest', 0), report('node', 1)]), /empty/)
  assert.throws(() => validateReports([{ ...report('vitest', 1), complete: false, errors: ['collection failed'] }, report('node', 1)]), /collection/)
  assert.throws(() => validateReports([report('vitest', 1), report('node', 1)], { runId: 'new' }), /stale/)
})

test('Node reporter counts nested leaf tests and rejects cleanup-inclusive duration', async () => {
  async function* events() {
    yield { type: 'test:start', data: { nesting: 0, name: 'parent' } }
    yield { type: 'test:start', data: { nesting: 1, name: 'child' } }
    yield { type: 'test:pass', data: { nesting: 1, name: 'child', file: 'nested.cjs', details: { type: 'test', duration_ms: 100.001 } } }
    yield { type: 'test:pass', data: { nesting: 0, name: 'parent', file: 'nested.cjs', details: { type: 'test', duration_ms: 150 } } }
    yield { type: 'test:summary', data: { success: true } }
  }
  // Keep this synthetic reporter invocation from writing the live run report.
  const result = await captureReporter(events())
  assert.match(result.output, /parent > child: 100.001ms/)
  assert.doesNotMatch(result.output, /parent: 150/)
  assert.equal(result.exitCode, 1)
})

test('Node reporter refuses a skipped suite even when another leaf passes', async () => {
  async function* events() {
    yield { type: 'test:start', data: { nesting: 0, name: 'live' } }
    yield { type: 'test:pass', data: { nesting: 0, name: 'live', file: 'mixed.cjs', details: { type: 'test', duration_ms: 1 } } }
    yield { type: 'test:start', data: { nesting: 0, name: 'hidden' } }
    yield { type: 'test:pass', data: { nesting: 0, name: 'hidden', file: 'mixed.cjs', skip: true, details: { type: 'suite', duration_ms: 0 } } }
    yield { type: 'test:summary', data: { success: true } }
  }
  const result = await captureReporter(events())
  assert.equal(result.exitCode, 1)
  assert.match(result.output, /mixed.cjs > hidden: skipped\/todo/)
})


function withShardBoundary(t, staleAfterRun, check) {
  const fs = require('node:fs')
  const childProcess = require('node:child_process')
  const subject = require.resolve('../tooling/ci-run.cjs')
  const cached = require.cache[subject]
  const children = [...module.children]
  const originalRead = fs.readFileSync
  const output = new Map()
  const calls = []
  const sha = 'a'.repeat(40)
  const file = 'tests/release/example.test.cjs'
  const plan = {
    planId: 'immutable-runtime-contract', mode: 'related', baseSha: 'c'.repeat(40), headSha: sha, checkoutSha: sha,
    executionSnapshot: { checkoutSha: sha }, changedFiles: ['src/example.js'],
    inventory: [{ file, runner: 'node', names: ['selected leaf', 'unselected leaf'] }],
    selected: [file], selectedCases: { [file]: [0] }, reasons: { [file]: ['runtime contract'] },
    shards: [{ id: 'related', vitestFiles: [], nodeFiles: [file], expectedCount: 1 }],
  }
  let executed = false
  try {
    t.mock.method(childProcess, 'execFileSync', (command, args) => {
      assert.equal(command, 'git')
      calls.push(args.join(' '))
      if (args.join(' ') === 'rev-parse HEAD') return `${executed && staleAfterRun ? 'b'.repeat(40) : sha}\n`
      assert.deepEqual(args, ['status', '--porcelain', '--untracked-files=all'])
      return ''
    })
    t.mock.method(childProcess, 'spawnSync', (command, args, options) => {
      assert.equal(command, process.execPath)
      assert.ok(args.includes('--test-name-pattern=^(?:selected leaf)$'))
      assert.equal(args.at(-1), file)
      assert.deepEqual(JSON.parse(options.env.LOGIC_TEST_CASES), ['selected leaf'])
      assert.equal(options.env.LOGIC_TEST_TARGETED, '0')
      calls.push('runner')
      executed = true
      output.set(options.env.LOGIC_TEST_NODE_REPORT, JSON.stringify({
        runner: 'node', runId: options.env.LOGIC_TEST_RUN_ID, complete: true, errors: [],
        files: [{ file }], cases: [{ file, name: 'selected leaf', state: 'passed', ms: 1 }],
      }))
      return { status: 0 }
    })
    t.mock.method(fs, 'readFileSync', (path, ...args) => output.has(path) ? output.get(path) : originalRead(path, ...args))
    t.mock.method(fs, 'writeFileSync', (path, content) => {
      assert.equal(path, 'memory-summary.json')
      output.set(path, content)
    })
    t.mock.method(fs, 'mkdirSync', (path, options) => {
      assert.ok(path === require('node:path').resolve('.') || path.replaceAll('\\', '/').includes('/output/test-budget/'))
      assert.deepEqual(options, { recursive: true })
    })
    t.mock.method(fs, 'rmSync', path => { assert.ok(output.delete(path), 'runner report is removed after consumption') })
    delete require.cache[subject]
    const { executeShard } = require('../tooling/ci-run.cjs')
    check({ execute: () => executeShard(plan, 'related', 'memory-summary.json'), output, calls, sha })
  } finally {
    t.mock.restoreAll()
    delete require.cache[subject]
    if (cached) require.cache[subject] = cached
    module.children.splice(0, module.children.length, ...children)
  }
}

test('shard execution binds exact selected leaves and complete reports to the immutable checkout', t => {
  withShardBoundary(t, false, ({ execute, output, calls, sha }) => {
    const summary = execute()
    assert.equal(summary.result, 'passed')
    assert.equal(summary.count, 1)
    assert.equal(summary.checkoutSha, sha)
    assert.equal(summary.maxMs, 1)
    assert.deepEqual(summary.reports[0].cases.map(item => item.name), ['selected leaf'])
    assert.deepEqual(JSON.parse(output.get('memory-summary.json')), summary)
    assert.deepEqual(calls, ['rev-parse HEAD', 'status --porcelain --untracked-files=all', 'runner',
      'rev-parse HEAD', 'status --porcelain --untracked-files=all'])
    assert.equal(output.size, 1)
  })
})

test('shard execution rejects a checkout changed by the runner and records failure', t => {
  withShardBoundary(t, true, ({ execute, output, calls }) => {
    assert.throws(execute, /Stale checkout/)
    const summary = JSON.parse(output.get('memory-summary.json'))
    assert.equal(summary.result, 'failed')
    assert.match(summary.error, /Stale checkout/)
    assert.equal(summary.reports[0].cases.length, 1)
    assert.deepEqual(calls, ['rev-parse HEAD', 'status --porcelain --untracked-files=all', 'runner',
      'rev-parse HEAD', 'status --porcelain --untracked-files=all'])
    assert.equal(output.size, 1)
  })
})
