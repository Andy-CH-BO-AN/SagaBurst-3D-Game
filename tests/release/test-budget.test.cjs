const { test } = require('node:test')
const assert = require('node:assert/strict')
const { validateReports, readReport } = require('../../tools/tests/budget.cjs')
const nodeReporter = require('../../tools/tests/node-budget-reporter.cjs')

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
