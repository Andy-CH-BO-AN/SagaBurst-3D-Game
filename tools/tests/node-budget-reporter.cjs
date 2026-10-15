const { writeFileSync } = require('node:fs')
const { hrtime } = require('node:process')
const { resolve } = require('node:path')
const { validateReports } = require('./budget.cjs')

// Node's test result duration uses process.hrtime and ends in postRun after
// inherited beforeEach/afterEach and context.after cleanup, also on failures.
module.exports = async function* (source) {
  const start = hrtime.bigint()
  const cases = []
  const ancestors = []
  const errors = []
  let complete = false
  for await (const { type, data } of source) {
    if (type === 'test:stdout' || type === 'test:stderr') yield data.message
    if (type === 'test:start') {
      // Buffered events are reported in tree order, including nested tests.
      if (data.nesting > 0 && ancestors[data.nesting - 1]) ancestors[data.nesting - 1].hasChildren = true
      ancestors[data.nesting] = { name: data.name, hasChildren: false }
      ancestors.length = data.nesting + 1
    }
    if (type === 'test:pass' || type === 'test:fail') {
      // Name-filtered development runs report unselected tests as skipped.
      // They are explicitly partial; a full run still rejects every skip/todo.
      if ((data.skip || data.todo) && process.env.LOGIC_TEST_TARGETED === '1') continue
      if (data.skip || data.todo) errors.push(`${data.file} > ${data.name}: skipped/todo tests or suites are prohibited`)
      // Node emits a file wrapper when no leaf matches a name filter (and for
      // import crashes). It is startup/collection, never a logical leaf case.
      const fileWrapper = data.file && data.line === 1 && data.column === 1 && resolve(data.name) === resolve(data.file)
      if (fileWrapper && type === 'test:pass' && process.env.LOGIC_TEST_TARGETED !== '1') errors.push(`${data.file}: no leaf tests collected`)
      if (data.details.type === 'test' && !fileWrapper && !ancestors[data.nesting]?.hasChildren) {
        cases.push({
          file: data.file, name: ancestors.slice(0, data.nesting).map(item => item.name).concat(data.name).join(' > '),
          nesting: data.nesting, ms: data.details.duration_ms,
          state: type === 'test:pass' && !data.skip && !data.todo ? 'passed' : 'failed',
        })
      }
      if (type === 'test:fail') {
        errors.push(`${data.file} > ${data.name}: ${data.details.error?.message ?? 'failed'}`)
        yield `${data.details.error?.stack ?? data.details.error?.message ?? 'Test failed'}\n`
      }
    }
    if (type === 'test:summary') {
      complete = data.success === true
    }
    // Node 22 has no test:summary; its root plan/diagnostics and process status
    // are checked too. A collection crash emits test:fail and cannot pass.
    if (type === 'test:plan' && data.nesting === 0 && data.count > 0) complete = true
  }
  const report = { runner: 'node', runId: process.env.LOGIC_TEST_RUN_ID, complete, errors, cases, wallMs: Number(hrtime.bigint() - start) / 1e6 }
  if (process.env.LOGIC_TEST_NODE_REPORT) writeFileSync(process.env.LOGIC_TEST_NODE_REPORT, JSON.stringify(report, null, 2))
  try {
    const result = validateReports([report], { runners: ['node'] })
    yield `Node logic budget: ${result.count} cases; max ${result.maxMs.toFixed(3)}ms including hooks/cleanup\n`
  } catch (error) {
    process.exitCode = 1
    yield `${error.message}\n`
  }
}
