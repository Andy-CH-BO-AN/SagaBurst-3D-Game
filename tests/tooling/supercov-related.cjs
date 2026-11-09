'use strict'
const { execFileSync } = require('node:child_process')
const { existsSync, readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { requireExactBaseSeed, isGitAncestor } = require('./supercov-evidence-policy.cjs')
const { validSeedMetadata, validateAffectedQuery,
  reconcileAffectedFiles, isPreviewed } = require('./supercov-measured-evidence.cjs')
const ROOT = resolve(__dirname, '../..')
const VERSION = '4.24.2'
const supercovArgs = (...args) => ['--yes', 'supercov@' + VERSION, ...args]
const fail = message => { throw new Error('Supercov Related selection unsafe: ' + message) }
const isTest = path => /^tests\/.*\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path)
const isRuntime = path => /^src\/.*\.[cm]?[jt]sx?$/.test(path)
const isCss = path => /^src\/ui\/[\w/-]+\.css$/.test(path)
const isSupported = path => isRuntime(path) || isTest(path) || isCss(path) ||
  /^(tests\/(?:tooling|helpers|release)\/|\.github\/workflows\/)/.test(path) ||
  /^(package(?:-lock)?\.json|tsconfig(?:\.[-\w]+)?\.json|vite\.config\.[cm]?[jt]s|vitest\.config\.[cm]?[jt]s)$/.test(path)

// Rejects anything the seed cannot speak for. It reads no evidence, so it runs
// before a single Supercov process has been started.
function preflightChanges(changes) {
  if (changes.some(change => !/^(A|M)$/.test(change.status))) fail('Removed/moved source or test has no confirmed native lifecycle policy')
  if (changes.some(change => !isSupported(change.file) && !/\.md$/.test(change.file))) {
    fail('Unsupported asset/offline input: ' + changes.filter(change => !isSupported(change.file)).map(x => x.file).join(', '))
  }
}
const newRuntimeSources = changes => changes.filter(change => change.status === 'A' && isRuntime(change.file)).map(change => change.file)

function requireLowerBoundWithinLimit(nativeCounts, baseline) {
  // Supercov's JSON is a ranked preview by default. Its summary remains
  // authoritative even when arrays are truncated. A conservative lower
  // bound already above the 500 runnable-leaf cap must fail before trying
  // to expand or select anything: every recorded setup may be affected,
  // so subtract ALL seed setups to avoid overcounting them as cases.
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
}

function decodeAffected(response, inventory, changes, expectedRun, baseline = {}) {
  if (response?.schemaVersion !== 1 || response.ok !== true || response.command !== 'runs.tests.affected') {
    fail('Missing or failed public CLI JSON contract')
  }
  requireLowerBoundWithinLimit(response?.data?.summary, baseline)
  const { counts: summary, workingTree, affected, undetermined } =
    validateAffectedQuery(response, expectedRun, baseline)
  // Only the affected and undetermined identities matter. Supercov's public
  // contract omits unaffected identities, and counts lifecycle setup records
  // as historical identities alongside runnable leaves.
  const total = summary.tests
  preflightChanges(changes)
  // Added sources do not raise this flag in 4.24.2; they are invisible to it and
  // are handled below. So when it is raised, the measured scope itself moved.
  if (workingTree.sourceSetChanged) fail('Native query detected a new/unmeasured source scope')
  const current = new Map(inventory.map(item => [item.file, item]))
  const directTests = changes.filter(change => isTest(change.file)).map(change => change.file)
  const contributed = { nativeAffected: [], nativeUndetermined: [], directTests: [], nodeContracts: [] }
  const seen = new Set()
  const moduleSetups = []
  const selectedCases = {}
  const reasons = {}
  const add = (item, indices, why, category) => {
    ;(selectedCases[item.file] ??= []).push(...indices)
    const fileReasons = (reasons[item.file] ??= [])
    if (!fileReasons.includes(why)) fileReasons.push(why)
    contributed[category].push(...indices.map(index => JSON.stringify([item.file, index])))
  }
  const everyCase = item => item.names.map((_, index) => index)
  for (const [bucket, category, identities] of [['affected', 'nativeAffected', affected], ['undetermined', 'nativeUndetermined', undetermined]]) {
    for (const t of identities) {
      if (typeof t?.file !== 'string' || typeof t?.name !== 'string' || !t.file || !t.name) {
        fail('Missing test file or full name')
      }
      const id = JSON.stringify([t.file, t.name])
      if (seen.has(id)) fail('Duplicate Supercov identity: ' + id)
      seen.add(id)
      const item = current.get(t.file)
      if (!item || item.runner !== 'vitest') {
        if (directTests.includes(t.file) && !item) fail('Changed test disappeared from Vitest discovery: ' + t.file)
        fail('Historical test file is absent from Vitest discovery: ' + t.file)
      }
      const indices = item.names.flatMap((name, index) => name === t.name ? [index] : [])
      if (indices.length > 1) fail('Ambiguous duplicate current Vitest leaf: ' + id)
      // Supercov also reports setup lifecycle records that are not runnable
      // leaves, and an unknown file is already rejected above. A module setup
      // record is the loading of the test file: resolved below, once the leaves
      // that load it anyway are known. Any other record (a suite hook, a name a
      // changed test no longer has) can shape every leaf, so all of them run.
      if (indices.length === 1) add(item, indices, 'Supercov native ' + bucket, category)
      else if (t.name === t.file + ' > module setup') moduleSetups.push([item, bucket, category])
      else add(item, everyCase(item), 'Supercov ' + bucket + ' setup/non-leaf identity', category)
    }
  }
  // Loading the file is what re-executes a module setup record, and any one of its
  // leaves does that. A leaf that ran code in a changed file is already affected in
  // its own right: Supercov reports top-level changes against those leaves too.
  for (const [item, bucket, category] of moduleSetups) {
    if (!selectedCases[item.file]) add(item, [0], 'Supercov ' + bucket + ' module setup: loads the file', category)
  }
  // An added or modified test file runs every case it now registers, wherever
  // the seed stands on it: new files are unknown to it and renames look deleted.
  for (const file of directTests) {
    const item = current.get(file)
    if (!item) fail('Changed test missing from discovery: ' + file)
    add(item, everyCase(item), 'Directly changed test', 'directTests')
  }
  // A small fixed set of Node tooling/release contracts, not a second source-to-test selector.
  for (const item of inventory.filter(item => item.runner === 'node')) {
    add(item, everyCase(item), 'Fixed Node tooling/release contracts', 'nodeContracts')
  }
  for (const file of Object.keys(selectedCases)) selectedCases[file] = [...new Set(selectedCases[file])].sort((a, b) => a - b)
  const added = newRuntimeSources(changes)
  let newSources = []
  if (added.length) {
    if (!baseline.newSourceAnalysis) fail('New runtime source has no verified module analysis: ' + added.join(', '))
    const { requireNewSourceProof } = require('./supercov-new-source.cjs')
    const proof = requireNewSourceProof(baseline.newSourceAnalysis, { selectedFiles: Object.keys(selectedCases),
      directTests, baselineTests: baseline.baselineTests })
    if (proof.problems.length) fail('New runtime source has no reliable test association:\n  ' + proof.problems.join('\n  '))
    newSources = proof.sources
  }
  // A zero native result is not proof of no impact for any executable input:
  // shared helpers, setupFiles, CI/runtime tooling, config and dependency
  // inputs can fan out far beyond src/**. Node's fixed contract suite must
  // never disguise the absence of trustworthy Vitest native attribution.
  // Directly changed test files and added sources with a verified module proof
  // are the only allowed non-doc inputs with a zero historical affected count.
  const unproven = changes.filter(change => isSupported(change.file) && !isTest(change.file) && !added.includes(change.file))
  if (!affected.length && !undetermined.length && unproven.length) {
    fail('Native query returned zero for executable/test-impact input: ' +
      unproven.map(change => change.file).join(', '))
  }
  const selected = Object.keys(selectedCases).sort()
  if (!selected.length) fail('Unexpected empty code selection')
  const unique = selected.reduce((sum, file) => sum + selectedCases[file].length, 0)
  const counts = Object.fromEntries(Object.entries(contributed).map(([key, ids]) => [key, ids.length]))
  const contributedTotal = Object.values(counts).reduce((sum, count) => sum + count, 0)
  return { mode: 'related', source: 'Supercov native tests affected',
    supercovRun: expectedRun, selected, selectedCases, reasons, details: {}, fallback: null,
    breakdown: { ...counts, duplicatesRemoved: contributedTotal - unique, total: unique },
    newSources,
    native: { affected: summary.affected, undetermined: summary.undetermined,
      unaffected: summary.unaffected, total, runWide: workingTree.runWide } }
}
// Directory filters answer for many files in one process. A directory with test
// files in subdirectories would overlap them, so those stay on per-file filters.
function affectedFilters(listed, inventory) {
  const vitest = inventory.filter(item => item.runner === 'vitest').map(item => item.file)
  const absent = listed.filter(file => !vitest.includes(file))
  if (absent.length) fail('Historical test file is absent from Vitest discovery: ' + absent.join(', '))
  const dirOf = file => file.slice(0, file.lastIndexOf('/'))
  const groups = Map.groupBy(listed, dirOf)
  return [...groups].flatMap(([dir, files]) => files.length > 1 &&
      !vitest.some(file => file.startsWith(dir + '/') && dirOf(file) !== dir) ? [dir] : files).sort()
}
function queryFilters(runId, filters) {
  let raw
  try {
    raw = execFileSync('node', ['tests/tooling/supercov-affected-expand.cjs'],
      { cwd: ROOT, input: JSON.stringify({ runId, files: filters }),
        encoding: 'utf8', maxBuffer: 48 * 1024 * 1024, timeout: 10 * 60_000 })
  } catch (error) {
    fail('Native filtered identity expansion failed: ' +
      (error.stderr?.toString() || error.message))
  }
  try { return JSON.parse(raw) }
  catch { fail('Native filtered expansion returned invalid JSON') }
}
function expandIdentities(global, runId, baseline, listed, inventory, query = queryFilters) {
  let filters = affectedFilters(listed, inventory)
  let parts = query(runId, filters)
  const previewed = filters.filter((filter, index) => !isTest(filter) && isPreviewed(parts[index]))
  if (previewed.length) {
    const narrower = listed.filter(file => previewed.some(dir => file.startsWith(dir + '/')))
    const kept = filters.map((filter, index) => [filter, parts[index]]).filter(([filter]) => !previewed.includes(filter))
    const extra = query(runId, narrower)
    filters = [...kept.map(([filter]) => filter), ...narrower]
    parts = [...kept.map(([, part]) => part), ...extra]
  }
  console.log('Supercov reconciled affected identities from ' + filters.length +
    ' verified --test-file filters over ' + listed.length + ' affected test files')
  return reconcileAffectedFiles(global, parts, filters, runId, baseline)
}
function analyzeAddedSources(changed, seedRun) {
  const added = newRuntimeSources(changed)
  if (!added.length) return {}
  // Requires TypeScript, which a PR without added sources need not load.
  const { analyzeNewSources, diskHost, structuralProblems } = require('./supercov-new-source.cjs')
  const analysis = analyzeNewSources(added, diskHost(ROOT))
  const problems = structuralProblems(analysis)
  if (problems.length) fail('New runtime source has no reliable test association:\n  ' + problems.join('\n  '))
  const baselineTests = file => {
    try {
      const result = JSON.parse(execFileSync('npx', supercovArgs('runs', seedRun, 'file', file, '--json'),
        { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }))
      return result.ok === true && Number.isSafeInteger(result.data?.totalTests) ? result.data.totalTests : 0
    } catch { return 0 }
  }
  return { newSourceAnalysis: analysis, baselineTests }
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
  // Everything decidable without Supercov comes first, so an unsafe PR fails in
  // seconds instead of after the identity queries.
  preflightChanges(changed)
  const newSourceEvidence = analyzeAddedSources(changed, seed.runId)
  const baseline = { tests: seed.tests, setups: seed.setups, ...newSourceEvidence }
  let output
  try {
    output = execFileSync('npx', supercovArgs('runs', seed.runId, 'tests', 'affected', '--json'),
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  } catch (error) { fail('Native query failed: ' + (error.stderr?.toString() || error.message)) }
  let data
  try { data = JSON.parse(output) } catch { fail('Invalid native Supercov JSON') }
  const counts = data?.data?.summary
  const affected = data?.data?.affected
  const undetermined = data?.data?.undetermined
  // Do not pay for any identity expansion if the native summary already
  // proves >500 runnable leaves. Never split those cases into shards.
  requireLowerBoundWithinLimit(counts, baseline)
  if (Number.isSafeInteger(counts?.affected) &&
      Number.isSafeInteger(counts?.undetermined) &&
      Array.isArray(affected) && Array.isArray(undetermined) &&
      (affected.length < counts.affected ||
       undetermined.length < counts.undetermined)) {
    // Supercov's default JSON output is a ranked preview for large results.
    // The public --names mode cannot combine with --json and lacks file
    // identities. Recover exact (file,name) rows only from its documented
    // --test-file <path> --json filter, over the files --files says are
    // affected; the affected and undetermined totals must reconcile.
    if (!isPreviewed(data)) fail('Native affected identity list incomplete without a documented preview marker')
    let listed
    try {
      listed = execFileSync('npx', supercovArgs('runs', seed.runId, 'tests', 'affected', '--files'),
        { cwd: ROOT, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }).split('\n').filter(Boolean)
    } catch (error) { fail('Native affected file list failed: ' + (error.stderr?.toString() || error.message)) }
    if (!listed.length || new Set(listed).size !== listed.length || !listed.every(isTest)) {
      fail('Native affected file list is empty, duplicated or malformed')
    }
    data = expandIdentities(data, seed.runId, baseline, listed, inventory)
  }
  return decodeAffected(data, inventory, changed, seed.runId, baseline)
}
module.exports = { decodeAffected, nativeSelection, affectedFilters, expandIdentities, preflightChanges, isCss }
