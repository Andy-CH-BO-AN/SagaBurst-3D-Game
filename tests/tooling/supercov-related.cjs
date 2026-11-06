'use strict'
const { execFileSync } = require('node:child_process')
const { existsSync, readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { requireExactBaseSeed, isGitAncestor } = require('./supercov-evidence-policy.cjs')
const { validSeedMetadata, validateAffectedQuery } = require('./supercov-measured-evidence.cjs')
const ROOT = resolve(__dirname, '../..')
const VERSION = '4.24.2'
const fail = message => { throw new Error('Supercov Related selection unsafe: ' + message) }
const isTest = path => /^tests\/.*\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path)
const isRuntime = path => /^src\/.*\.[cm]?[jt]sx?$/.test(path)
const isSupported = path => isRuntime(path) || isTest(path) ||
  /^(tests\/(?:tooling|helpers|release)\/|\.github\/workflows\/)/.test(path) ||
  /^(package(?:-lock)?\.json|tsconfig(?:\.[-\w]+)?\.json|vite\.config\.[cm]?[jt]s|vitest\.config\.[cm]?[jt]s)$/.test(path)

function decodeAffected(response, inventory, changes, expectedRun, baseline = {}) {
  if (response?.schemaVersion !== 1 || response.ok !== true || response.command !== 'runs.tests.affected') {
    fail('Missing or failed public CLI JSON contract')
  }
  // Supercov's JSON is a ranked preview by default. Its summary remains
  // authoritative even when arrays are truncated. A conservative lower
  // bound already above the 500 runnable-leaf cap must fail before trying
  // to expand or select anything: every recorded setup may be affected,
  // so subtract ALL seed setups to avoid overcounting them as cases.
  const nativeCounts = response?.data?.summary
  if (Number.isSafeInteger(baseline.setups) && baseline.setups >= 0 &&
      Number.isSafeInteger(nativeCounts?.affected) && nativeCounts.affected >= 0 &&
      Number.isSafeInteger(nativeCounts?.undetermined) && nativeCounts.undetermined >= 0) {
    const lowerBound = Math.max(0,
      nativeCounts.affected + nativeCounts.undetermined - baseline.setups)
    if (lowerBound > 500) {
      fail('Native Related aggregate 500-leaf limit exceeded: at least ' +
        lowerBound + ' runnable Vitest leaves affected (native affected=' +
        nativeCounts.affected + ', undetermined=' + nativeCounts.undetermined +
        ', total seed setups=' + baseline.setups +
        '); split the change or seek explicit migration review. No Full fallback')
    }
  }
  const { counts: summary, workingTree, affected, undetermined } =
    validateAffectedQuery(response, expectedRun, baseline)
  // Only the affected and undetermined identities matter. Supercov's public
  // contract omits all 873 unaffected identities at pristine dev, and counts
  // lifecycle setup records as historical identities (763 leaves + 110 setup).
  const total = summary.tests
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
  for (const [bucket, identities] of [['affected', affected], ['undetermined', undetermined]]) {
    for (const t of identities) {
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
        if (indices.length > 1) fail('Ambiguous duplicate current Vitest leaf: ' + id)
        // Supercov also reports setup lifecycle records that don't correspond
        // to runnable Vitest leaves. If the source file is recognized, run
        // every leaf in that file, including any module-init affected cases.
        // An unknown file is already rejected above (no unsafe global guess).
        selectedCases[item.file] = item.names.map((_, index) => index)
        reasons[item.file] = ['Supercov ' + bucket + ' setup/non-leaf identity']
        continue
      }
      add(item, indices[0], 'Supercov native ' + bucket)
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
  // A zero native result is not proof of no impact for any executable input:
  // shared helpers, setupFiles, CI/runtime tooling, config and dependency
  // inputs can fan out far beyond src/**. Node's fixed contract suite must
  // never disguise the absence of trustworthy Vitest native attribution.
  // Directly changed test files are explicitly re-run above and are the only
  // allowed non-doc input with a zero historical affected count.
  const unproven = changes.filter(change => isSupported(change.file) && !isTest(change.file))
  if (!affected.length && !undetermined.length && unproven.length) {
    fail('Native query returned zero for executable/test-impact input: ' +
      unproven.map(change => change.file).join(', '))
  }
  const selected = Object.keys(selectedCases).sort()
  if (!selected.length) fail('Unexpected empty code selection')
  for (const file of selected) selectedCases[file] = [...new Set(selectedCases[file])].sort((a, b) => a - b)
  return { mode: 'related', source: 'Supercov native tests affected',
    supercovRun: expectedRun, selected, selectedCases, reasons, details: {}, fallback: null,
    native: { affected: summary.affected, undetermined: summary.undetermined,
      unaffected: summary.unaffected, total, runWide: workingTree.runWide } }
}
function nativeSelection(inventory, changed, { base } = {}) {
  const path = resolve(ROOT, process.env.SUPERCOV_SEED_FILE || 'output/supercov-seed.json')
  if (!existsSync(path)) fail('exact dev baseline seed pending: no Full seed for PR base SHA')
  let seed
  try { seed = JSON.parse(readFileSync(path, 'utf8')) } catch { fail('Corrupt seed metadata') }
  if (!validSeedMetadata(seed)) {
    fail('Untrusted or invalid seed metadata')
  }
  if (!existsSync(resolve(ROOT, '.supercov/runs', seed.runId))) fail('Seed run data is missing')
  // Never use any earlier ancestor as the PR base's evidence.
  // An in-progress push-dev Full publication must fail closed here.
  requireExactBaseSeed(seed.sha, base)
  const checkout = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()
  if (!isGitAncestor(seed.sha, checkout, ROOT)) {
    fail('Exact PR-base SHA is not in checkout ancestry; refusing unrelated source history')
  }
  let output
  try {
    output = execFileSync('npx', ['--yes', 'supercov@' + VERSION, 'runs', seed.runId, 'tests', 'affected', '--json'],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  } catch (error) { fail('Native query failed: ' + (error.stderr?.toString() || error.message)) }
  let data
  try { data = JSON.parse(output) } catch { fail('Invalid native Supercov JSON') }
  return decodeAffected(data, inventory, changed, seed.runId,
    { tests: seed.tests, setups: seed.setups })
}
module.exports = { decodeAffected, nativeSelection }
