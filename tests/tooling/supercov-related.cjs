'use strict'
const { execFileSync, spawnSync } = require('node:child_process')
const { existsSync, readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { requireExactBaseSeed, isGitAncestor } = require('./supercov-evidence-policy.cjs')
const { validSeedMetadata, validateAffectedQuery,
  reconcileAffectedFiles } = require('./supercov-measured-evidence.cjs')
const ROOT = resolve(__dirname, '../..')
const VERSION = '4.24.2'
const fail = message => { throw new Error('Supercov Related selection unsafe: ' + message) }
const isTest = path => /^tests\/.*\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path)
const isRuntime = path => /^src\/.*\.[cm]?[jt]sx?$/.test(path)
const isStyle = path => /^src\/.*\.css$/.test(path)
const isSupplemental = path => path === 'CLAUDE.md' || path === '.gitignore' ||
  /^\.claude\/skills\/[^/]+$/.test(path)
const isSupported = path => isRuntime(path) || isTest(path) || isStyle(path) || isSupplemental(path) ||
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
  const currentTestFiles = new Set(changes.filter(change =>
    (/^(A|M)$/.test(change.status) || /^R\d+$/.test(change.status)) && isTest(change.file))
    .map(change => change.file))
  const removedTestFiles = new Set(changes.flatMap(change =>
    change.status === 'D' && isTest(change.file) ? [change.file]
      : /^R\d+$/.test(change.status) && isTest(change.oldFile ?? '') ? [change.oldFile] : []))
  const unsupportedLifecycle = changes.filter(change => {
    if (/^(A|M)$/.test(change.status)) return false
    if (change.status === 'D' && isTest(change.file)) return false
    if (/^R\d+$/.test(change.status) && isTest(change.oldFile ?? '') && isTest(change.file)) return false
    return true
  })
  if (unsupportedLifecycle.length) {
    fail('Removed/moved source has no confirmed native lifecycle policy: ' +
      unsupportedLifecycle.map(change => change.oldFile ? change.oldFile + ' -> ' + change.file : change.file).join(', '))
  }
  const paths = [...new Set(changes.flatMap(change => [change.file, ...(change.oldFile ? [change.oldFile] : [])]))]
  const unsupported = paths.filter(path => !isSupported(path) && !/\.md$/.test(path))
  if (unsupported.length) fail('Unsupported asset/offline input: ' + unsupported.join(', '))
  if (workingTree.sourceSetChanged) fail('Native query detected a new/unmeasured source scope')
  if (changes.some(change => change.status === 'A' && isRuntime(change.file))) {
    fail('New runtime source has no baseline attribution')
  }
  const current = new Map(inventory.map(item => [item.file, item]))
  const modifiedTestFiles = currentTestFiles
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
        if (removedTestFiles.has(t.file)) continue
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
  const unproven = changes.filter(change =>
    isSupported(change.file) && !isTest(change.file) && !isStyle(change.file) && !isSupplemental(change.file))
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
function cliFailure(result, label, runId) {
  const stderr = String(result.stderr || result.error?.message || '').trim()
    .replace(/\s+/g, ' ').slice(0, 1200) || '(empty)'
  const timedOut = result.error?.code === 'ETIMEDOUT'
  return label + ' failed: seedRun=' + runId +
    '; exitCode=' + (result.status ?? result.error?.code ?? 'null') +
    '; signal=' + (result.signal ?? 'none') +
    '; timeout=' + timedOut + '; stderr=' + stderr
}
function runSupercov(runId, args, label, timeout = 90_000) {
  const result = spawnSync('npx', ['--yes', 'supercov@' + VERSION, 'runs', runId, ...args],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout })
  if (result.error || result.signal || result.status !== 0) fail(cliFailure(result, label, runId))
  return result.stdout
}
function affectedHistoricalFiles(output, seed) {
  const lines = output.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  if (new Set(lines).size !== lines.length ||
      lines.some(file => !/^tests\/.*\.(test|spec)\.[cm]?[jt]sx?$/.test(file))) {
    fail('Native affected file inventory is malformed: ' + JSON.stringify(lines.slice(0, 20)))
  }
  const historical = new Set(seed.testFiles)
  const foreign = lines.filter(file => !historical.has(file))
  if (foreign.length) {
    fail('Native affected file inventory contains identities absent from the Full seed: ' +
      foreign.join(', '))
  }
  return lines.sort()
}
function nativeSelection(inventory, changed, { base } = {}) {
  const path = resolve(ROOT, process.env.SUPERCOV_SEED_FILE || 'output/supercov-seed.json')
  if (!existsSync(path)) fail('exact dev baseline seed pending: no Full seed for PR base SHA')
  let seed
  try { seed = JSON.parse(readFileSync(path, 'utf8')) } catch { fail('Corrupt seed metadata') }
  if (!validSeedMetadata(seed)) fail('Untrusted or invalid seed metadata')
  if (!existsSync(resolve(ROOT, '.supercov/runs', seed.runId))) fail('Seed run data is missing')
  requireExactBaseSeed(seed.sha, base)
  const checkout = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()
  if (!isGitAncestor(seed.sha, checkout, ROOT)) {
    fail('Exact PR-base SHA is not in checkout ancestry; refusing unrelated source history')
  }
  let data
  try {
    data = JSON.parse(runSupercov(seed.runId, ['tests', 'affected', '--json'], 'Native affected query'))
  } catch (error) {
    if (/Supercov Related selection unsafe:/.test(error.message)) throw error
    fail('Invalid native Supercov JSON: ' + error.message)
  }
  const counts = data?.data?.summary
  const affected = data?.data?.affected
  const undetermined = data?.data?.undetermined
  const minimumLeaves = Math.max(0,
    (counts?.affected ?? 0) + (counts?.undetermined ?? 0) - seed.setups)
  if (Number.isSafeInteger(counts?.affected) &&
      Number.isSafeInteger(counts?.undetermined) && minimumLeaves <= 500 &&
      Array.isArray(affected) && Array.isArray(undetermined) &&
      (affected.length < counts.affected || undetermined.length < counts.undetermined)) {
    const listTruncated = (data?.data?.truncated || []).some(reason =>
      reason === 'the lists keep their first, highest-ranked tests; `--names` lists every one')
    if (!listTruncated) fail('Native affected identity list incomplete without a documented preview marker')
    const files = affectedHistoricalFiles(
      runSupercov(seed.runId, ['tests', 'affected', '--files'],
        'Native affected historical-file query'), seed)
    if (!files.length && counts.affected + counts.undetermined > 0) {
      fail('Native affected identities are present but historical-file inventory is empty')
    }
    let raw
    try {
      raw = execFileSync('node', ['tests/tooling/supercov-affected-expand.cjs'],
        { cwd: ROOT, input: JSON.stringify({ runId: seed.runId, files }),
          encoding: 'utf8', maxBuffer: 48 * 1024 * 1024, timeout: 10 * 60_000 })
    } catch (error) {
      fail('Native per-file identity expansion failed: ' +
        (error.stderr?.toString() || error.message))
    }
    let parts
    try { parts = JSON.parse(raw) }
    catch { fail('Native per-file expansion returned invalid JSON') }
    data = reconcileAffectedFiles(data, parts, files, seed.runId,
      { tests: seed.tests, setups: seed.setups })
    console.log('Supercov reconstructed ' + data.data.affected.length +
      ' affected and ' + data.data.undetermined.length +
      ' undetermined exact identities from ' + files.length +
      ' affected historical test files recorded by the Full seed')
  }
  return decodeAffected(data, inventory, changed, seed.runId,
    { tests: seed.tests, setups: seed.setups })
}

module.exports = { decodeAffected, nativeSelection }
