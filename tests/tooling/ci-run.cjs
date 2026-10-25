const childProcess = require('node:child_process')
const { readFileSync, writeFileSync, mkdirSync, readdirSync, appendFileSync } = require('node:fs')
const { resolve, join, relative } = require('node:path')
const { randomUUID, createHash } = require('node:crypto')
const { validateReports } = require('./budget.cjs')
const { validateManifest, options, createPlan, shardFiles, discoverNode, selectedNames } = require('./ci-plan.cjs')
const root = resolve(__dirname, '../..')
const normalize = file => relative(root, resolve(root, file)).replaceAll('\\', '/')
const digest = plan => createHash('sha256').update(JSON.stringify(plan)).digest('hex')
function assertPlanCheckout(plan, state) {
  if (!plan.checkoutSha) return // Explicit development subsets have no Git-bound manifest.
  if (state.sha !== plan.checkoutSha) throw new Error('Stale checkout: manifest is for a different commit')
  if ((plan.comparison || plan.executionSnapshot) && state.dirty) throw new Error('Dirty checkout: sources differ from the planned commit')
}
function checkCurrentCheckout(plan) {
  if (!plan.checkoutSha) return
  assertPlanCheckout(plan, {
    sha: childProcess.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    dirty: Boolean(childProcess.execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: root, encoding: 'utf8' }).trim()),
  })
}
function exact(actual, expected, label) {
  if (JSON.stringify([...actual].sort()) !== JSON.stringify([...expected].sort())) throw new Error(`Missing, unexpected or duplicate ${label}`)
}
function verifyShard(plan, shard, summary) {
  if (!summary || !summary.runId || summary.planId !== plan.planId || summary.planDigest !== digest(plan) || summary.shardId !== shard.id || summary.result !== 'passed') throw new Error(`Missing, stale or failed shard: ${shard.id}`)
  if (plan.checkoutSha && summary.checkoutSha !== plan.checkoutSha) throw new Error(`Stale execution snapshot: ${shard.id}`)
  const runners = ['vitest', 'node'].filter(runner => shard[runner === 'vitest' ? 'vitestFiles' : 'nodeFiles'].length)
  const result = validateReports(summary.reports, { runId: summary.runId, runners })
  const actualFiles = []
  for (const report of summary.reports) {
    const files = (report.files ?? []).map(item => normalize(item.file))
    exact(files, shard[report.runner === 'vitest' ? 'vitestFiles' : 'nodeFiles'], `${report.runner} files in ${shard.id}`)
    actualFiles.push(...files)
    for (const file of files) {
      exact(report.cases.filter(item => normalize(item.file) === file).map(item => item.name), selectedNames(plan, file), `leaves in ${file}`)
    }
    for (const item of report.cases) if (!files.includes(normalize(item.file))) throw new Error(`Unexpected leaf file: ${item.file}`)
  }
  if (result.count !== shard.expectedCount) throw new Error(`Collection changed in ${shard.id}`)
  return { ...result, files: actualFiles }
}
function aggregate(plan, summaries) {
  checkCurrentCheckout(plan)
  validateManifest(plan)
  exact(summaries.map(summary => summary.shardId), plan.shards.map(shard => shard.id), 'shard reports')
  const results = plan.shards.map(shard => verifyShard(plan, shard, summaries.find(summary => summary.shardId === shard.id)))
  exact(results.flatMap(result => result.files), plan.mode === 'full' ? plan.inventory.map(item => item.file) : plan.selected, 'aggregate files')
  const cases = summaries.flatMap(summary => summary.reports.flatMap(report => report.cases.map(item => ({ ...item, file: normalize(item.file), runner: report.runner }))))
  const slowest = [...cases].sort((a, b) => b.ms - a.ms).slice(0, 10)
  const count = results.reduce((sum, result) => sum + result.count, 0)
  const result = { planId: plan.planId, mode: plan.mode, docsOnly: Boolean(plan.docsOnly), fallback: plan.fallback ?? null, baseSha: plan.baseSha, headSha: plan.headSha,
    count, shardCount: results.length, shards: results.map((result, index) => ({ id: plan.shards[index].id, count: result.count })),
    maxMs: slowest[0]?.ms ?? 0, slowest, missing: [], duplicates: [], result: 'passed' }
  console.log(plan.message ?? `${plan.scope === 'node-release' ? 'Node release component' : plan.mode === 'full' ? 'Full suite' : 'Related suite'}: ${count} total cases across ${results.length} shards`)
  console.log(`Per-shard counts: ${JSON.stringify(result.shards)}; missing: 0; duplicate files: 0`)
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
function executeShard(plan, id, out) {
  validateManifest(plan)
  checkCurrentCheckout(plan)
  const shard = plan.shards.find(shard => shard.id === id)
  if (!shard) throw new Error(`Unknown shard: ${id}`)
  const runId = randomUUID()
  const dir = join(root, 'output/test-budget', runId)
  mkdirSync(dir, { recursive: true })
  const env = { ...process.env, LOGIC_TEST_RUN_ID: runId, LOGIC_TEST_TARGETED: '0',
    LOGIC_TEST_VITEST_REPORT: join(dir, 'vitest.json'), LOGIC_TEST_NODE_REPORT: join(dir, 'node.json') }
  const summary = { planId: plan.planId, planDigest: digest(plan), runId, shardId: id, mode: plan.mode,
    baseSha: plan.baseSha, headSha: plan.headSha, checkoutSha: plan.checkoutSha, selectedFiles: [...shard.vitestFiles, ...shard.nodeFiles],
    reasons: Object.fromEntries([...shard.vitestFiles, ...shard.nodeFiles].map(file => [file, plan.reasons[file]])), result: 'failed', reports: [] }
  try {
    const runnerErrors = []
    for (const runner of ['vitest', 'node']) {
      const files = shard[runner === 'vitest' ? 'vitestFiles' : 'nodeFiles']
      if (!files.length) continue
      const reports = []
      // Per-file filters prevent a matching name in a different file from running.
      const fullFiles = files.filter(file => selectedNames(plan, file).length === plan.inventory.find(item => item.file === file).names.length)
      const groups = [...(fullFiles.length ? [fullFiles] : []), ...files.filter(file => !fullFiles.includes(file)).map(file => [file])]
      for (const group of groups) {
        const file = group[0]
        const item = plan.inventory.find(item => item.file === file)
        const names = selectedNames(plan, file)
        const partial = names.length !== item.names.length
        env.LOGIC_TEST_CASES = partial ? JSON.stringify(names) : ''
        const escape = name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const nativeNames = (plan.selectedCases?.[file] ?? item.names.map((_,i)=>i)).map(i => item.nativeNames?.[i] ?? item.names[i].replaceAll(' > ', ' '))
        const pattern = `^(?:${nativeNames.map(escape).join('|')})$`
        let args
        if (runner === 'vitest') {
          env.LOGIC_TEST_FILES = JSON.stringify(group)
          args = ['node_modules/vitest/vitest.mjs', 'run', ...(partial ? ['--testNamePattern', pattern] : [])]
        } else {
          delete env.LOGIC_TEST_FILES
          args = ['--test', '--test-concurrency=1', '--test-reporter=./tests/tooling/node-budget-reporter.cjs', ...(partial ? [`--test-name-pattern=${pattern}`] : []), ...group]
        }
        const result = childProcess.spawnSync(process.execPath, args, { cwd: root, env, stdio: 'inherit' })
        if (result.error || result.signal || result.status !== 0) runnerErrors.push(`${file} failed: ${result.error?.message ?? result.signal ?? result.status}`)
        try { reports.push(JSON.parse(readFileSync(join(dir, `${runner}.json`), 'utf8'))) }
        catch (error) { runnerErrors.push(`Missing ${runner} report: ${error.message}`) }
        // A following process must not accidentally reuse this file's report.
        require('node:fs').rmSync(join(dir, `${runner}.json`), { force: true })
      }
      summary.reports.push({ runner, runId, complete: reports.length === groups.length && reports.every(r => r.complete && r.runId === runId),
        errors: reports.flatMap(r => r.errors), cases: reports.flatMap(r => r.cases), files: reports.flatMap(r => r.files) })
    }
    console.log('Top 10 slow leaf cases for this shard (including hooks/cleanup):')
    const measured = summary.reports.flatMap(report => report.cases ?? []).filter(item => Number.isFinite(item.ms)).sort((a, b) => b.ms - a.ms)
    for (const item of measured.slice(0, 10)) console.log(`  ${item.ms.toFixed(3)}ms ${item.file} > ${item.name}`)
    if (measured.some(item => item.ms >= 70)) console.warn('Non-blocking advisory: logic leaves >=70ms')
    if (runnerErrors.length) throw new Error(runnerErrors.join('\n'))
    checkCurrentCheckout(plan)
    summary.result = 'passed'
    const result = verifyShard(plan, shard, summary)
    Object.assign(summary, result)
    console.log(`${plan.mode === 'full' ? 'Full' : 'Related'} shard budget: ${result.count}/500 cases; max ${result.maxMs.toFixed(3)}ms; ${id}`)
  } catch (error) {
    summary.result = 'failed'
    summary.error = error.message
    throw error
  } finally {
    mkdirSync(resolve(out, '..'), { recursive: true })
    writeFileSync(out, JSON.stringify(summary, null, 2))
  }
  return summary
}
if (require.main === module) (async () => {
  const args = options(process.argv.slice(2))
  if (args['verified-sha']) {
    console.log(`sha=${verifiedFullSha(JSON.parse(readFileSync(args['verified-sha'], 'utf8')))}`)
  } else if (args.local) {
    const inventory = args.local === 'release' ? discoverNode() : null
    const plan = inventory ? { planId: randomUUID(), mode: 'related', scope: 'node-release', event: 'local', baseSha: '', headSha: '', changedFiles: [], inventory, selected: inventory.map(item => item.file), reasons: Object.fromEntries(inventory.map(item => [item.file, ['Node release component']])), shards: shardFiles(inventory) } : await createPlan({ mode: 'full', event: 'local' })
    const out = 'output/test-budget/local'
    mkdirSync(out, { recursive: true })
    writeFileSync(`${out}/plan.json`, JSON.stringify(plan, null, 2))
    aggregate(plan, plan.shards.map(shard => executeShard(plan, shard.id, `${out}/${shard.id}.json`)))
  } else {
    const plan = validateManifest(JSON.parse(readFileSync(args.manifest, 'utf8')))
    if (args.shard) executeShard(plan, args.shard, args.out ?? `output/shard-reports/${args.shard}.json`)
    else if (args.reports) {
      const summaries = readdirSync(args.reports).filter(file => file.endsWith('.json')).map(file => JSON.parse(readFileSync(join(args.reports, file), 'utf8')))
      const result = aggregate(plan, summaries)
      if (args.out) writeFileSync(args.out, JSON.stringify(result, null, 2))
    } else throw new Error('Expected --shard or --reports')
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
module.exports = { verifyShard, aggregate, executeShard, verifiedFullSha, assertPlanCheckout }
