const { spawnSync } = require('node:child_process')
const { mkdtempSync, mkdirSync, writeFileSync, readdirSync } = require('node:fs')
const { resolve, join } = require('node:path')
const { randomUUID } = require('node:crypto')
const { hrtime } = require('node:process')
const { validateReports, readReport } = require('./budget.cjs')

const root = resolve(__dirname, '../..')
const releaseOnly = process.argv[2] === '--release'
const args = process.argv.slice(releaseOnly ? 3 : 2)
const targeted = args.length > 0
const runId = randomUUID()
mkdirSync(join(root, 'output/test-budget'), { recursive: true })
const dir = mkdtempSync(join(root, 'output/test-budget/run-'))
const env = { ...process.env, LOGIC_TEST_RUN_ID: runId, LOGIC_TEST_TARGETED: targeted ? '1' : '0',
  LOGIC_TEST_VITEST_REPORT: join(dir, 'vitest.json'), LOGIC_TEST_NODE_REPORT: join(dir, 'node.json') }
const started = hrtime.bigint()
let failed = false
function run(commandArgs) {
  const result = spawnSync(process.execPath, commandArgs, { cwd: root, env, stdio: 'inherit' })
  if (result.error) console.error(result.error.message)
  if (result.status !== 0 || result.error || result.signal) failed = true
}

if (!releaseOnly) run(['node_modules/vitest/vitest.mjs', 'run', ...args])
if (releaseOnly || !targeted) {
  // Keep the existing Node release discovery; do not depend on shell globbing
  // (Windows npm uses cmd.exe) and never reuse another invocation's report.
  const files = readdirSync(join(root, 'tests/release')).filter(file => file.endsWith('.test.cjs')).sort().map(file => `tests/release/${file}`)
  const explicitFiles = args.some(arg => arg.endsWith('.test.cjs'))
  if (files.length === 0) { console.error('Node logic collection is empty'); failed = true }
  else run(['--test', '--test-reporter=./tools/tests/node-budget-reporter.cjs', ...args, ...(explicitFiles ? [] : files)])
}
try {
  const runners = releaseOnly ? ['node'] : targeted ? ['vitest'] : ['vitest', 'node']
  const reports = runners.map(runner => readReport(join(dir, `${runner}.json`), runId))
  // Report real leaf durations after completion, without adding work to test timings.
  // Print diagnostics before validation so over-budget runs identify the culprit.
  const measured = reports.flatMap(report => (Array.isArray(report.cases) ? report.cases : [])
    .filter(item => Number.isFinite(item.ms))
    .map(item => ({ ...item, runner: report.runner })))
  const slowest = [...measured].sort((a, b) => b.ms - a.ms).slice(0, 10)
  console.log('Slowest logic leaf cases (including hooks/cleanup):')
  for (const item of slowest) console.log(`  ${item.ms.toFixed(3)}ms [${item.runner}] ${item.file} > ${item.name}`)
  if (!releaseOnly && !targeted) {
    const nearTimeLimit = measured.filter(item => item.ms >= 70).length
    if (measured.length > 450 || nearTimeLimit > 0) {
      console.warn(`Logic budget headroom advisory (not a gate): ${measured.length} cases (prefer <=450), ${nearTimeLimit} cases >=70ms (prefer <70ms)`)
    }
  }
  const result = validateReports(reports, { runId, runners })
  const summary = { ...result, runId, full: !releaseOnly && !targeted, runners: Object.fromEntries(reports.map(report => [report.runner, report.cases.length])), wallMs: Number(hrtime.bigint() - started) / 1e6 }
  writeFileSync(join(dir, 'summary.json'), JSON.stringify(summary, null, 2))
  console.log(`${summary.full ? 'Full Vitest + Node budget' : 'Component/targeted budget (aggregate not checked)'}: ${result.count}/500 cases, max ${result.maxMs.toFixed(3)}ms, wall ${(summary.wallMs / 1000).toFixed(2)}s`)
} catch (error) {
  console.error(error.message)
  failed = true
}
console.log(`Current-run evidence: ${dir}`)
process.exitCode = failed ? 1 : 0
