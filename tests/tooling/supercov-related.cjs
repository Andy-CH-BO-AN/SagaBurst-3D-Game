'use strict'
const { execFileSync } = require('node:child_process')
const { existsSync, readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const ROOT = resolve(__dirname, '../..')
const VERSION = '4.24.2'
const fail = message => { throw new Error('Supercov Related selection unsafe: ' + message) }
const isTest = path => /^tests\/.*\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path)
const isRuntime = path => /^src\/.*\.[cm]?[jt]sx?$/.test(path)
const isSupported = path => isRuntime(path) || isTest(path) ||
  /^(tests\/(?:tooling|helpers|release)\/|\.github\/workflows\/)/.test(path) ||
  /^(package(?:-lock)?\.json|tsconfig(?:\.[-\w]+)?\.json|vite\.config\.[cm]?[jt]s|vitest\.config\.[cm]?[jt]s)$/.test(path)

function decodeAffected(response, inventory, changes, expectedRun) {
  if (response?.schemaVersion !== 1 || response.ok !== true || response.command !== 'runs.tests.affected') {
    fail('Missing or failed public CLI JSON contract')
  }
  const d = response.data
  if (!d || d.run !== expectedRun || !d.summary || !d.workingTree) fail('Unbound or incomplete native run')
  const { summary, workingTree } = d
  if (!Array.isArray(workingTree.reasons) || !Array.isArray(workingTree.runWide)) fail('Missing working-tree integrity reasons')
  const names = ['affected', 'undetermined', 'unaffected']
  if (!names.every(name => Array.isArray(d[name]) && Number.isInteger(summary[name]) &&
      summary[name] === d[name].length && d[name + 'Count'] === undefined)) {
    fail('Native JSON truncated or missing exact test lists; --json is not safe for this run')
  }
  const total = names.reduce((sum, name) => sum + summary[name], 0)
  if (!Number.isInteger(summary.tests) || summary.tests !== total || !total) {
    fail('Invalid total historical test identities')
  }
  if (changes.some(change => !/^(A|M)$/.test(change.status))) fail('Removed/moved source or test has no confirmed native lifecycle policy')
  if (changes.some(change => !isSupported(change.file) && !/\.md$/.test(change.file))) {
    fail('Unsupported asset/offline input: ' + changes.filter(change => !isSupported(change.file)).map(x => x.file).join(', '))
  }
  if (workingTree.sourceSetChanged) fail('Native query detected a new/unmeasured source scope')
  if (changes.some(change => change.status === 'A' && isRuntime(change.file))) {
    fail('New runtime source has no baseline attribution')
  }
  const current = new Map(inventory.map(item => [item.file, item]))
  const modifiedTestFiles = new Set(changes.filter(change => isTest(change.file)).map(change => change.file))
  const seen = new Set()
  const selectedCases = {}
  const reasons = {}
  const add = (item, index, why) => {
    ;(selectedCases[item.file] ??= []).push(index)
    ;(reasons[item.file] ??= []).push(why)
  }
  for (const bucket of names) {
    for (const t of d[bucket]) {
      if (typeof t?.file !== 'string' || typeof t?.name !== 'string' || !t.file || !t.name) {
        fail('Missing test file or full name')
      }
      const id = JSON.stringify([t.file, t.name])
      if (seen.has(id)) fail('Duplicate Supercov identity: ' + id)
      seen.add(id)
      const item = current.get(t.file)
      if (!item || item.runner !== 'vitest') {
        if (modifiedTestFiles.has(t.file) && !item) fail('Changed test disappeared from Vitest discovery: ' + t.file)
        fail('Historical test file is absent from Vitest discovery: ' + t.file)
      }
      const indices = item.names.flatMap((name, index) => name === t.name ? [index] : [])
      if (indices.length !== 1) {
        // Safe only if this entire test file is directly changed and re-run.
        if (modifiedTestFiles.has(t.file) && indices.length === 0) continue
        fail('Ambiguous or missing leaf in Vitest discovery: ' + id)
      }
      if (bucket !== 'unaffected') add(item, indices[0], 'Supercov native ' + bucket)
    }
  }
  // If a test file changed, run every case, including new or renamed registrations.
  for (const file of modifiedTestFiles) {
    const item = current.get(file)
    if (!item) fail('Changed test missing from Vitest discovery: ' + file)
    selectedCases[file] = item.names.map((_, index) => index)
    reasons[file] = ['Directly changed test']
  }
  // A small fixed set of Node tooling/release contracts, not a second source-to-test selector.
  for (const item of inventory.filter(item => item.runner === 'node')) {
    selectedCases[item.file] = item.names.map((_, index) => index)
    reasons[item.file] = ['Fixed Node tooling/release contracts']
  }
  if (!d.affected.length && !d.undetermined.length && changes.some(change => isRuntime(change.file))) {
    fail('Native query returned zero for a runtime change; no proof it is safe')
  }
  const selected = Object.keys(selectedCases).sort()
  if (!selected.length) fail('Unexpected empty code selection')
  for (const file of selected) selectedCases[file] = [...new Set(selectedCases[file])].sort((a, b) => a - b)
  return { mode: 'related', source: 'Supercov native tests affected',
    supercovRun: expectedRun, selected, selectedCases, reasons, details: {}, fallback: null,
    native: { affected: summary.affected, undetermined: summary.undetermined,
      unaffected: summary.unaffected, total, runWide: workingTree.runWide } }
}
function nativeSelection(inventory, changed) {
  const path = resolve(ROOT, process.env.SUPERCOV_SEED_FILE || 'output/supercov-seed.json')
  if (!existsSync(path)) fail('No authoritative evidence seed: bootstrap explicitly through Full on main/manual')
  let seed
  try { seed = JSON.parse(readFileSync(path, 'utf8')) } catch { fail('Corrupt seed metadata') }
  if (seed.version !== VERSION || seed.valid !== true || seed.complete !== true ||
      !/^run_[a-z0-9]+$/i.test(seed.runId || '') || !/^[a-f0-9]{40}$/.test(seed.sha || '')) {
    fail('Untrusted or invalid seed metadata')
  }
  if (!existsSync(resolve(ROOT, '.supercov/runs', seed.runId))) fail('Seed run data is missing')
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', seed.sha, 'HEAD'], { cwd: ROOT, stdio: 'pipe' })
  } catch { fail('Seed SHA is not in checkout ancestry; cannot mix branches or stale future evidence') }
  let output
  try {
    output = execFileSync('npx', ['--yes', 'supercov@' + VERSION, 'runs', seed.runId, 'tests', 'affected', '--json'],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 })
  } catch (error) { fail('Native query failed: ' + (error.stderr?.toString() || error.message)) }
  let data
  try { data = JSON.parse(output) } catch { fail('Invalid native Supercov JSON') }
  return decodeAffected(data, inventory, changed, seed.runId)
}
module.exports = { decodeAffected, nativeSelection }
