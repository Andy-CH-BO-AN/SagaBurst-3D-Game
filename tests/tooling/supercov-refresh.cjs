'use strict'
const { execFileSync, spawnSync } = require('node:child_process')
const { readFileSync, writeFileSync, existsSync, mkdirSync } = require('node:fs')
const { resolve, dirname } = require('node:path')
const { validateManifest, selectedNames } = require('./ci-plan.cjs')
const root = resolve(__dirname, '../..')
const version = '4.24.2'
const fail = message => { throw new Error('Supercov incremental Related evidence unsafe: ' + message) }
const path = file => resolve(root, file)
const read = file => JSON.parse(readFileSync(path(file), 'utf8'))
const run = (cmd, args, env = process.env) => {
  const child = spawnSync(cmd, args, { cwd: root, env, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
  if (child.stdout) process.stdout.write(child.stdout)
  if (child.stderr) process.stderr.write(child.stderr)
  if (child.status !== 0 || child.error || child.signal) fail(cmd + ' failed: ' + (child.error?.message || child.signal || child.status))
  return child.stdout
}
const sc = (...args) => run('npx', ['--yes', 'supercov@' + version, ...args])
const plan = validateManifest(read(process.argv[2] || 'output/test-plan.json'))
const aggregate = read(process.argv[3] || 'output/aggregate.json')
const seed = read(process.argv[4] || 'output/supercov-seed.json')
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
if (process.env.GITHUB_EVENT_NAME !== 'push' || process.env.GITHUB_REF !== 'refs/heads/dev' ||
    plan.mode !== 'related' || plan.event !== 'push' || plan.checkoutSha !== sha ||
    plan.headSha !== sha || !plan.shards.length) {
  fail('Refresh is allowed only for an exact-SHA push → dev that already executed Related')
}
const expected = plan.shards.reduce((sum, item) => sum + item.expectedCount, 0)
if (aggregate.planId !== plan.planId || aggregate.mode !== 'related' ||
    aggregate.result !== 'passed' || aggregate.count !== expected || expected > 500) {
  fail('Normal Vitest Related aggregate has not passed with exact selected leaves')
}
if (seed.version !== version || seed.valid !== true || seed.complete !== true ||
    !/^run_[a-z0-9]+$/i.test(seed.runId) || !existsSync(path('.supercov/runs/' + seed.runId))) {
  fail('Missing valid/complete pre-merge seed')
}
if (!plan.native || plan.supercovRun !== seed.runId) fail('Seed is not the plan native source')
const escape = name => [...name].map(ch => '\\.^$*+?()[]{}|'.includes(ch) ? '\\' + ch : ch).join('')
const candidateRuns = []
const files = plan.selected.filter(file => plan.inventory.find(item => item.file === file)?.runner === 'vitest')
for (const [index, file] of files.entries()) {
  const item = plan.inventory.find(item => item.file === file)
  const indices = plan.selectedCases[file]
  const partial = indices.length !== item.names.length
  const names = indices.map(i => item.nativeNames[i] || item.names[i].replaceAll(' > ', ' '))
  const pattern = '^(?:' + names.map(escape).join('|') + ')$'
  const idFile = path('output/supercov-related-' + index + '.id')
  mkdirSync(dirname(idFile), { recursive: true })
  const env = { ...process.env, SUPERCOV_SOURCE_ROOTS: 'src,tests/helpers',
    SUPERCOV_RUN_ID_FILE: idFile, LOGIC_TEST_FILES: JSON.stringify([file]),
    LOGIC_TEST_CASES: partial ? JSON.stringify(selectedNames(plan, file)) : '',
    LOGIC_TEST_TARGETED: '0' }
  const args = ['--', 'node', 'node_modules/vitest/vitest.mjs', 'run', '--reporter=default',
    ...(partial ? ['--testNamePattern', pattern] : [])]
  run('npx', ['--yes', 'supercov@' + version, ...args], env)
  if (!existsSync(idFile)) fail('Instrumented Related did not write a run ID for ' + file)
  const runId = readFileSync(idFile, 'utf8').trim()
  if (!/^run_[a-z0-9]+$/i.test(runId) || !existsSync(path('.supercov/runs/' + runId))) {
    fail('Instrumented run missing or corrupt for ' + file)
  }
  candidateRuns.push(runId)
}
if (!candidateRuns.length) {
  console.log('Node-only Related: preserving existing Supercov seed')
  process.exit(0)
}
const mergedText = sc('merge', '--allow-changed', seed.runId, ...candidateRuns)
const matches = [...mergedText.matchAll(/\[supercov\] merged run (run_[a-z0-9]+)/ig)]
if (matches.length !== 1) fail('Cannot verify exact Supercov merged-run identity')
const newId = matches[0][1]
if (!existsSync(path('.supercov/runs/' + newId))) fail('Merged run does not exist')
const query = JSON.parse(sc('runs', newId, '--json'))
if (query.schemaVersion !== 1 || query.ok !== true ||
    query.data?.valid !== true || query.data?.complete !== true ||
    query.data?.testExitCode !== 0) {
  fail('Merged run is not complete, valid and passed')
}
const affected = JSON.parse(sc('runs', newId, 'tests', 'affected', '--json'))
if (affected.schemaVersion !== 1 || !affected.ok || affected.data?.workingTree?.sourceSetChanged ||
    affected.data?.workingTree?.runWide?.length) fail('Merged seed does not match current dev checkout')
writeFileSync(path('output/supercov-seed.json'),
  JSON.stringify({ version, sha, runId: newId, valid: true, complete: true }, null, 2) + '\n')
console.log('Supercov native Related evidence advanced to ' + newId + ' @ ' + sha)
