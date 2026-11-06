'use strict'
const { execFileSync, spawnSync } = require('node:child_process')
const { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } = require('node:fs')
const { resolve, dirname } = require('node:path')
const { validateManifest } = require('./ci-plan.cjs')
const { validateRunSummary, buildSeed, validateAffectedQuery } = require('./supercov-measured-evidence.cjs')

const root = resolve(__dirname, '../..')
const version = '4.24.2'
const fail = msg => { throw new Error('Supercov Full seed unsafe: ' + msg) }
const path = file => resolve(root, file)
const read = file => JSON.parse(readFileSync(path(file), 'utf8'))
const plan = validateManifest(read(process.argv[2] || 'output/test-plan.json'))
const aggregate = read(process.argv[3] || 'output/aggregate.json')
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
if (plan.mode !== 'full' || plan.checkoutSha !== sha || plan.headSha !== sha ||
    !Array.isArray(plan.shards) || !plan.shards.length) {
  fail('Only an exact-SHA verified Full plan can bootstrap evidence')
}
const vitestCount = plan.inventory.filter(item => item.runner === 'vitest')
  .reduce((count, item) => count + item.names.length, 0)
const fullCount = plan.inventory.reduce((count, item) => count + item.names.length, 0)
if (aggregate.planId !== plan.planId || aggregate.mode !== 'full' ||
    aggregate.result !== 'passed' || aggregate.count !== fullCount ||
    aggregate.shardCount !== plan.shards.length || !vitestCount) {
  fail('A complete, passing, normal-Vitest Full aggregate must exist before instrumentation')
}
function run(args, env = process.env) {
  const result = spawnSync('npx', ['--yes', 'supercov@' + version, ...args],
    { cwd: root, env, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.error || result.signal || result.status !== 0) {
    fail('Supercov failed: ' + (result.error?.message || result.signal || result.status))
  }
  return result.stdout
}
const runs = []
for (const shard of plan.shards.filter(shard => shard.vitestFiles.length)) {
  // Shard boundaries come only from the already-passed normal Full plan.
  // Instrumentation timing never participates in the 100ms leaf gate.
  const runIdFile = path('output/supercov-full-' + shard.id + '.id')
  mkdirSync(dirname(runIdFile), { recursive: true })
  rmSync(runIdFile, { force: true })
  const env = { ...process.env, SUPERCOV_RUN_ID_FILE: runIdFile,
    SUPERCOV_SOURCE_ROOTS: 'src,tests/helpers',
    LOGIC_TEST_FILES: JSON.stringify(shard.vitestFiles),
    LOGIC_TEST_CASES: '', LOGIC_TEST_TARGETED: '0' }
  run(['--', 'node', 'node_modules/vitest/vitest.mjs', 'run', '--reporter=default'], env)
  if (!existsSync(runIdFile)) fail('Missing run ID for ' + shard.id)
  const id = readFileSync(runIdFile, 'utf8').trim()
  if (!/^run_[a-z0-9]+$/i.test(id) || !existsSync(path('.supercov/runs/' + id))) {
    fail('Missing instrumented Full shard evidence for ' + shard.id)
  }
  runs.push(id)
}
if (!runs.length) fail('No instrumented Full Vitest evidence')
let id = runs[0]
if (runs.length > 1) {
  // Strict merge across identical source snapshots; never override stale-source protection.
  const stdout = run(['merge', ...runs])
  const match = [...stdout.matchAll(/\[supercov\] merged run (run_[a-z0-9]+)/ig)]
  if (match.length !== 1) fail('Cannot identify merged Full evidence')
  id = match[0][1]
}
if (!existsSync(path('.supercov/runs/' + id))) fail('Merged Full run is unavailable')
const summary = JSON.parse(run(['runs', id, '--json']))
const measured = validateRunSummary(summary, vitestCount)
if (measured.runId !== id) fail('Merged Full evidence identity mismatch')
const affected = JSON.parse(run(['runs', id, 'tests', 'affected', '--json']))
validateAffectedQuery(affected, id, {
  tests: measured.tests, setups: measured.setups, pristine: true,
})
writeFileSync(path('output/supercov-seed.json'),
  JSON.stringify(buildSeed({ sha, ...measured }), null, 2) + '\n')
console.log('Valid strict Supercov Full seed ' + id + ': ' + vitestCount + ' Vitest leaves @ ' + sha)
