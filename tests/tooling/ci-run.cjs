const { spawnSync, execFileSync } = require('node:child_process')
const { readFileSync, writeFileSync, mkdirSync, appendFileSync, rmSync } = require('node:fs')
const { resolve, join, relative, dirname } = require('node:path')
const { randomUUID } = require('node:crypto')
const { validateReports, MAX_CASE_MS, MAX_LOGIC_CASES } = require('./budget.cjs')
const { validateManifest, options, createPlan, discoverNode, selectedNames } = require('./ci-plan.cjs')
const root = resolve(__dirname, '../..')
const normalize = file => relative(root, resolve(root, file)).replaceAll('\\', '/')
function exact(actual, expected, label) {
  if (JSON.stringify([...actual].sort()) !== JSON.stringify([...expected].sort())) throw new Error(`Missing, unexpected or duplicate ${label}`)
}
const filesFor = (plan, runner) => plan.selected.filter(file => plan.inventory.find(item => item.file === file).runner === runner)
// The plan is the inventory, the report is what really ran; they must be identical.
function verifyExecution(plan, summary) {
  if (!summary?.runId || summary.planId !== plan.planId || summary.result !== 'passed') throw new Error('Missing, stale or failed logic run')
  const runners = ['vitest', 'node'].filter(runner => filesFor(plan, runner).length)
  const result = validateReports(summary.reports, { runId: summary.runId, runners,
    maxCases: MAX_LOGIC_CASES })
  for (const report of summary.reports) {
    const files = (report.files ?? []).map(item => normalize(item.file))
    exact(files, filesFor(plan, report.runner), `${report.runner} files`)
    for (const file of files) {
      exact(report.cases.filter(item => normalize(item.file) === file).map(item => item.name), selectedNames(plan, file), `leaves in ${file}`)
    }
    for (const item of report.cases) if (!files.includes(normalize(item.file))) throw new Error(`Unexpected leaf file: ${item.file}`)
  }
  if (result.count !== plan.expectedCount) throw new Error('Collected and executed case counts differ')
  return result
}
function aggregate(plan, summary) {
  validateManifest(plan)
  const verified = plan.expectedCount ? verifyExecution(plan, summary) : { count: 0 }
  const cases = (summary?.reports ?? []).flatMap(report => report.cases.map(item => ({ ...item, file: normalize(item.file), runner: report.runner })))
  const slowest = [...cases].sort((a, b) => b.ms - a.ms).slice(0, 10)
  const result = { planId: plan.planId, mode: plan.mode, docsOnly: Boolean(plan.docsOnly), fallback: plan.fallback ?? null, baseSha: plan.baseSha, headSha: plan.headSha,
    count: verified.count, runners: Object.fromEntries((summary?.reports ?? []).map(report => [report.runner, report.cases.length])),
    maxMs: slowest[0]?.ms ?? 0, slowest, missing: [], duplicates: [], result: 'passed' }
  console.log(plan.message ?? `${plan.scope === 'node-release' ? 'Node release component' : plan.mode === 'full' ? 'Full suite' : 'Related suite'}: ${verified.count} total cases ${JSON.stringify(result.runners)}; missing: 0; duplicates: 0`)
  console.log('Top 10 slow leaf cases (including hooks/cleanup):')
  for (const item of slowest) console.log(`  ${item.ms.toFixed(3)}ms [${item.runner}] ${item.file} > ${item.name}`)
  if (cases.some(item => item.ms >= 70)) console.warn(`Non-blocking advisory: ${cases.filter(item => item.ms >= 70).length} leaves >=70ms`)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `\n\`\`\`json\n${JSON.stringify({ ...result, changedFiles: plan.changedFiles, reasons: plan.reasons, fallback: plan.fallback, docsOnly: plan.docsOnly }, null, 2)}\n\`\`\`\n`)
  return result
}
// A same-run consumer may skip a duplicate Full gate only when the manifest is a
// Full plan whose checked-out commit is exactly the requested head. Anything else
// yields no SHA, so the consumer fails closed into its own Full gate.
function verifiedFullSha(plan) {
  validateManifest(plan)
  const sha = plan.mode === 'full' && !plan.scope && plan.headSha && plan.checkoutSha === plan.headSha ? plan.headSha : ''
  return /^[0-9a-f]{40}$/.test(sha) ? sha : ''
}
// Partially selected files share one process and one name filter, except where a
// selected name would also match a leaf that another file in the batch must not run.
function partialBatches(plan, files) {
  const namesOf = file => {
    const item = plan.inventory.find(item => item.file === file)
    const name = i => item.nativeNames?.[i] ?? item.names[i].replaceAll(' > ', ' ')
    const chosen = new Set(plan.selectedCases[file])
    const selected = item.names.flatMap((_, i) => chosen.has(i) ? [name(i)] : [])
    return { file, selected, unselected: item.names.flatMap((_, i) => chosen.has(i) ? [] : [name(i)]) }
  }
  const batches = []
  for (const candidate of files.map(namesOf)) {
    const fits = batch => !batch.some(other =>
      candidate.selected.some(name => other.unselected.includes(name)) ||
      other.selected.some(name => candidate.unselected.includes(name)))
    const batch = batches.find(fits)
    if (batch) batch.push(candidate)
    else batches.push([candidate])
  }
  return batches.map(batch => batch.map(item => item.file))
}
function execute(plan, out) {
  validateManifest(plan)
  if (plan.checkoutSha && execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim() !== plan.checkoutSha) throw new Error('Stale checkout: manifest is for a different commit')
  const runId = randomUUID()
  const dir = join(root, 'output/test-budget', runId)
  mkdirSync(dir, { recursive: true })
  const env = { ...process.env, LOGIC_TEST_RUN_ID: runId, LOGIC_TEST_TARGETED: '0',
    LOGIC_TEST_VITEST_REPORT: join(dir, 'vitest.json'), LOGIC_TEST_NODE_REPORT: join(dir, 'node.json') }
  const summary = { planId: plan.planId, runId, mode: plan.mode, baseSha: plan.baseSha, headSha: plan.headSha,
    selectedFiles: plan.selected, reasons: plan.reasons, result: 'failed', reports: [] }
  try {
    const runnerErrors = []
    for (const runner of ['vitest', 'node']) {
      const files = filesFor(plan, runner)
      if (!files.length) continue
      const reports = []
      const isFull = file => selectedNames(plan, file).length === plan.inventory.find(item => item.file === file).names.length
      const fullFiles = files.filter(isFull)
      const groups = [...(fullFiles.length ? [{ files: fullFiles, partial: false }] : []),
        ...partialBatches(plan, files.filter(file => !isFull(file))).map(batch => ({ files: batch, partial: true }))]
      for (const { files: group, partial } of groups) {
        const names = group.flatMap(file => selectedNames(plan, file))
        env.LOGIC_TEST_CASES = partial ? JSON.stringify(names) : ''
        const escape = name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const nativeNames = group.flatMap(file => {
          const item = plan.inventory.find(item => item.file === file)
          return (plan.selectedCases?.[file] ?? item.names.map((_, i) => i)).map(i => item.nativeNames?.[i] ?? item.names[i].replaceAll(' > ', ' '))
        })
        const pattern = `^(?:${[...new Set(nativeNames)].map(escape).join('|')})$`
        let args
        if (runner === 'vitest') {
          env.LOGIC_TEST_FILES = JSON.stringify(group)
          args = ['node_modules/vitest/vitest.mjs', 'run', ...(partial ? ['--testNamePattern', pattern] : [])]
        } else {
          delete env.LOGIC_TEST_FILES
          args = ['--test', '--test-concurrency=1', '--test-reporter=./tests/tooling/node-budget-reporter.cjs', ...(partial ? [`--test-name-pattern=${pattern}`] : []), ...group]
        }
        const result = spawnSync(process.execPath, args, { cwd: root, env, stdio: 'inherit' })
        if (result.error || result.signal || result.status !== 0) runnerErrors.push(`${runner} run of ${group.length} files failed: ${result.error?.message ?? result.signal ?? result.status}`)
        try { reports.push(JSON.parse(readFileSync(join(dir, `${runner}.json`), 'utf8'))) }
        catch (error) { runnerErrors.push(`Missing ${runner} report: ${error.message}`) }
        // A following process must not accidentally reuse this file's report.
        rmSync(join(dir, `${runner}.json`), { force: true })
      }
      summary.reports.push({ runner, runId, complete: reports.length === groups.length && reports.every(r => r.complete && r.runId === runId),
        errors: reports.flatMap(r => r.errors), cases: reports.flatMap(r => r.cases), files: reports.flatMap(r => r.files) })
    }
    if (runnerErrors.length) throw new Error(runnerErrors.join('\n'))
    summary.result = 'passed'
    const result = verifyExecution(plan, summary)
    console.log(`Full budget: ${result.count}/${MAX_LOGIC_CASES} cases; max ${result.maxMs.toFixed(3)}ms`)
  } catch (error) {
    summary.result = 'failed'
    summary.error = error.message
    const failed = summary.reports.flatMap(report => (report.cases ?? [])
      .filter(item => item.state !== 'passed' || item.ms > MAX_CASE_MS)
      .map(item => ({ runner: report.runner, file: item.file, name: item.name,
        state: item.state === 'passed' ? item.ms.toFixed(3) + 'ms > ' + MAX_CASE_MS + 'ms' : item.state })))
    const label = plan.mode === 'full' ? 'Full' : 'Related'
    console.error(label + ' FAILED; identified failing leaves: ' + failed.length)
    for (const item of failed) console.error('  ' + item.file + ' > ' + item.name + ' [' + item.state + ']')
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      '\n### ' + label + ' FAILED\n\n' +
      failed.map(item => '- `' + item.file + ' > ' + item.name + '` (' + item.state + ')').join('\n') +
      '\n\n' + error.message + '\n')
    throw error
  } finally {
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, JSON.stringify(summary, null, 2))
  }
  return summary
}
function runPlan(plan, runOut, aggregateOut) {
  const summary = plan.expectedCount ? execute(plan, runOut) : null
  const result = aggregate(plan, summary)
  if (aggregateOut) writeFileSync(aggregateOut, JSON.stringify(result, null, 2))
  return result
}
if (require.main === module) (async () => {
  const args = options(process.argv.slice(2))
  if (args['verified-sha']) {
    console.log(`sha=${verifiedFullSha(JSON.parse(readFileSync(args['verified-sha'], 'utf8')))}`)
  } else if (args.local) {
    const inventory = args.local === 'release' ? discoverNode() : null
    const plan = inventory ? { planId: randomUUID(), mode: 'related', scope: 'node-release', event: 'local', baseSha: '', headSha: '', changedFiles: [], inventory, selected: inventory.map(item => item.file), reasons: Object.fromEntries(inventory.map(item => [item.file, ['Node release component']])), expectedCount: inventory.reduce((sum, item) => sum + item.names.length, 0) } : await createPlan({ mode: 'full', event: 'local' })
    const out = 'output/test-budget/local'
    mkdirSync(out, { recursive: true })
    writeFileSync(`${out}/plan.json`, JSON.stringify(plan, null, 2))
    runPlan(plan, `${out}/run.json`, `${out}/aggregate.json`)
  } else if (args.manifest) {
    const plan = validateManifest(JSON.parse(readFileSync(args.manifest, 'utf8')))
    runPlan(plan, args.report ?? 'output/logic-run.json', args.out)
  } else throw new Error('Expected --manifest, --local or --verified-sha')
})().catch(error => { console.error(error); process.exitCode = 1 })
module.exports = { verifyExecution, aggregate, execute, partialBatches, verifiedFullSha }
