'use strict'
// Explicit maintenance-only seed from an immutable dev checkout. Runs from
// the feature branch controller, but executes unmodified dev's Full planner,
// runner and Vitest tests. It never runs in normal PR/push Related.
const { execFileSync, spawnSync } = require('node:child_process')
const { readFileSync, writeFileSync, existsSync, mkdirSync } = require('node:fs')
const { resolve, join } = require('node:path')
const sourceRoot = resolve(process.argv[2] || 'source')
const version = '4.24.2'
const die = msg => { throw new Error('Explicit dev Supercov seed bootstrap failed: ' + msg) }
const exec = (command, args, env = process.env) => {
  const result = spawnSync(command, args, { cwd: sourceRoot, env, encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024 })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.error || result.signal || result.status !== 0) {
    die(command + ' failed: ' + (result.error?.message || result.signal || result.status))
  }
  return result.stdout
}
const sha = execFileSync('git', ['rev-parse', 'HEAD'],
  { cwd: sourceRoot, encoding: 'utf8' }).trim()
const devSha = execFileSync('git', ['rev-parse', 'refs/remotes/origin/dev'],
  { cwd: sourceRoot, encoding: 'utf8' }).trim()
if (sha !== devSha) die('Refusing Full bootstrap from a checkout other than current origin/dev')
if (!/^[a-f0-9]{40}$/.test(sha)) die('Invalid dev checkout SHA')
mkdirSync(join(sourceRoot, 'output'), { recursive: true })
const planPath = 'output/supercov-bootstrap-full-plan.json'
const reportsPath = 'output/supercov-bootstrap-shards'
const aggregatePath = 'output/supercov-bootstrap-aggregate.json'
exec(process.execPath, ['tests/tooling/ci-plan.cjs', '--mode', 'full', '--head', sha,
  '--event', 'workflow_dispatch', '--out', planPath])
const plan = JSON.parse(readFileSync(join(sourceRoot, planPath), 'utf8'))
if (plan.mode !== 'full' || plan.checkoutSha !== sha || !plan.shards?.length) {
  die('Unbound or empty dev Full manifest')
}
const expected = plan.inventory.reduce((count, item) => count + item.names.length, 0)
const vitest = plan.inventory.filter(item => item.runner === 'vitest')
  .reduce((count, item) => count + item.names.length, 0)
if (!vitest) die('No Vitest leaves discovered')
for (const shard of plan.shards) {
  exec(process.execPath, ['tests/tooling/ci-run.cjs', '--manifest', planPath,
    '--shard', shard.id, '--out', reportsPath + '/' + shard.id + '.json'])
}
exec(process.execPath, ['tests/tooling/ci-run.cjs', '--manifest', planPath,
  '--reports', reportsPath, '--out', aggregatePath])
const aggregate = JSON.parse(readFileSync(join(sourceRoot, aggregatePath), 'utf8'))
if (aggregate.planId !== plan.planId || aggregate.mode !== 'full' ||
  aggregate.result !== 'passed' || aggregate.count !== expected) {
  die('Normal dev Full 100ms/500-per-shard gate did not pass')
}
const runs = []
for (const shard of plan.shards.filter(item => item.vitestFiles.length)) {
  const runIdFile = 'output/supercov-bootstrap-' + shard.id + '.id'
  exec('npx', ['--yes', 'supercov@' + version, '--', 'node',
    'node_modules/vitest/vitest.mjs', 'run', '--reporter=default'],
  { ...process.env, SUPERCOV_SOURCE_ROOTS: 'src,tests/helpers',
    SUPERCOV_RUN_ID_FILE: join(sourceRoot, runIdFile),
    LOGIC_TEST_FILES: JSON.stringify(shard.vitestFiles),
    LOGIC_TEST_CASES: '', LOGIC_TEST_TARGETED: '0' })
  const idPath = join(sourceRoot, runIdFile)
  if (!existsSync(idPath)) die('Missing Supercov run ID for ' + shard.id)
  const id = readFileSync(idPath, 'utf8').trim()
  if (!/^run_[a-z0-9]+$/i.test(id) || !existsSync(join(sourceRoot, '.supercov/runs', id))) {
    die('Untrusted Supercov instrumented Full run ' + shard.id)
  }
  runs.push(id)
}
if (!runs.length) die('No instrumented Vitest evidence')
let runId = runs[0]
if (runs.length > 1) {
  const output = exec('npx', ['--yes', 'supercov@' + version, 'merge', ...runs])
  const identities = [...output.matchAll(/\[supercov\] merged run (run_[a-z0-9]+)/ig)]
  if (identities.length !== 1) die('Strict Full merge lacks a unique run identity')
  runId = identities[0][1]
}
const summary = JSON.parse(exec('npx', ['--yes', 'supercov@' + version,
  'runs', runId, '--json']))
if (summary.schemaVersion !== 1 || summary.ok !== true ||
  summary.data?.valid !== true || summary.data?.complete !== true ||
  summary.data?.testExitCode !== 0) die('Full seed is not valid/complete/passed')
const affected = JSON.parse(exec('npx', ['--yes', 'supercov@' + version,
  'runs', runId, 'tests', 'affected', '--json']))
if (affected.schemaVersion !== 1 || affected.ok !== true ||
  affected.data?.summary?.tests !== vitest ||
  affected.data?.workingTree?.sourceSetChanged ||
  affected.data?.workingTree?.runWide?.length) {
  die('Full seed lacks an exact, clean Vitest test inventory')
}
writeFileSync(join(sourceRoot, 'output/supercov-seed.json'),
  JSON.stringify({ version, sha, runId, valid: true, complete: true }, null, 2) + '\n')
console.log('Explicit Full dev seed established: ' + runId + ' @ ' + sha +
  ', exact Vitest leaves ' + vitest)
