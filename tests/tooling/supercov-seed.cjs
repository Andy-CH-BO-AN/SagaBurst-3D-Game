'use strict'
const { execFileSync, spawnSync } = require('node:child_process')
const { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } = require('node:fs')
const { resolve, dirname } = require('node:path')
const { validateManifest } = require('./ci-plan.cjs')
const { validateRunSummary, buildSeed, validateAffectedQuery,
  validateRoster, requireVerifiedFullPlan } = require('./supercov-measured-evidence.cjs')

const root = resolve(__dirname, '../..')
const version = '4.24.2'
const fail = msg => { throw new Error('Supercov Full seed unsafe: ' + msg) }
const path = file => resolve(root, file)
const read = file => JSON.parse(readFileSync(path(file), 'utf8'))
const plan = validateManifest(read(process.argv[2] || 'output/test-plan.json'))
const aggregate = read(process.argv[3] || 'output/aggregate.json')
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
const inventory = requireVerifiedFullPlan(plan, aggregate, sha)
const vitestCount = inventory.reduce((count, item) => count + item.names.length, 0)
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
// One complete instrumented Vitest run over the inventory that already passed the
// normal gate. Instrumentation timing never participates in the 100ms leaf gate.
const runIdFile = path('output/supercov-full.id')
const rosterFile = path('output/supercov-full-vitest.json')
mkdirSync(dirname(runIdFile), { recursive: true })
rmSync(runIdFile, { force: true })
rmSync(rosterFile, { force: true })
run(['--', 'node', 'node_modules/vitest/vitest.mjs', 'run', '--reporter=default', '--reporter=json',
  '--outputFile.json=' + rosterFile], { ...process.env, SUPERCOV_RUN_ID_FILE: runIdFile,
  SUPERCOV_SOURCE_ROOTS: 'src,tests/helpers',
  LOGIC_TEST_FILES: JSON.stringify(inventory.map(item => item.file)),
  LOGIC_TEST_CASES: '', LOGIC_TEST_TARGETED: '0' })
if (!existsSync(runIdFile) || !existsSync(rosterFile)) fail('Missing run ID or Vitest roster')
const id = readFileSync(runIdFile, 'utf8').trim()
if (!/^run_[a-z0-9]+$/i.test(id) || !existsSync(path('.supercov/runs/' + id))) {
  fail('Missing instrumented Full evidence')
}
// Supercov reports counts; Vitest's own roster proves they are the planned tests.
validateRoster(read(rosterFile), inventory)
const summary = JSON.parse(run(['runs', id, '--json']))
const measured = validateRunSummary(summary, vitestCount)
if (measured.runId !== id) fail('Full evidence identity mismatch')
const affected = JSON.parse(run(['runs', id, 'tests', 'affected', '--json']))
validateAffectedQuery(affected, id, {
  tests: measured.tests, setups: measured.setups, pristine: true,
})
writeFileSync(path('output/supercov-seed.json'),
  JSON.stringify(buildSeed({ sha, ...measured }), null, 2) + '\n')
console.log('Valid strict Supercov Full seed ' + id + ': ' + vitestCount + ' Vitest leaves @ ' + sha)
