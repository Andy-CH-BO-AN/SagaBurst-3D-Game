'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { decodeAffected } = require('../tooling/supercov-related.cjs')
const { planShards } = require('../tooling/ci-plan.cjs')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { validateRunSummary, buildSeed, validSeedMetadata, validateAffectedQuery } = require('../tooling/supercov-measured-evidence.cjs')
const { requireBaseAncestor, trustedPublication, requireRefreshAllowed,
  MAX_REFRESH_GENERATIONS, generation } = require('../tooling/supercov-evidence-policy.cjs')
const run = 'run_abcdef0123'
const inventory = [
  { runner: 'vitest', file: 'tests/example.test.ts', names: ['suite > A', 'suite > B', 'suite > C'],
    nativeNames: ['suite A', 'suite B', 'suite C'] },
  { runner: 'node', file: 'tests/release/gate.test.cjs', names: ['Node test'] },
]
const leaf = name => ({ file: 'tests/example.test.ts', name, reasons: ['executed changed source'] })
function answer({ affected = [leaf('suite > A')], undetermined = [leaf('suite > B')],
    unaffected = [leaf('suite > C')], workingTree = {}, overrides = {} } = {}) {
  return { schemaVersion: 1, ok: true, command: 'runs.tests.affected', data: {
    run, affected, undetermined, unaffected,
    summary: { tests: affected.length + undetermined.length + unaffected.length,
      affected: affected.length, undetermined: undetermined.length, unaffected: unaffected.length },
    workingTree: { stale: true, reasons: ['instrumented source changed'],
      runWide: [], sourceSetChanged: false, ...workingTree }, ...overrides } }
}
const source = [{ status: 'M', file: 'src/example.ts' }]
test('native exact individual identities select only affected and undetermined siblings', () => {
  const selected = decodeAffected(answer(), inventory, source, run)
  assert.deepEqual(selected.selectedCases['tests/example.test.ts'], [0, 1])
  assert.deepEqual(selected.selectedCases['tests/release/gate.test.cjs'], [0])
  assert.equal(selected.source, 'Supercov native tests affected')
  assert.equal(selected.fallback, null)
  assert.equal(selected.native.total, 3)
})
test('direct changed test runs all current leaves including newly registered cases', () => {
  const selected = decodeAffected(answer(), inventory, [{ status: 'M', file: 'tests/example.test.ts' }], run)
  assert.deepEqual(selected.selectedCases['tests/example.test.ts'], [0, 1, 2])
})
test('renamed direct-test identity uses newly collected names, no guesswork', () => {
  const renamed = inventory.map(item => item.file === 'tests/example.test.ts'
    ? { ...item, names: ['suite > renamed', 'suite > B', 'suite > C'] } : item)
  const selected = decodeAffected(answer(), renamed, [{ status: 'M', file: 'tests/example.test.ts' }], run)
  assert.deepEqual(selected.selectedCases['tests/example.test.ts'], [0, 1, 2])
})
test('missing, duplicate, corrupt or truncated CLI JSON fails closed', () => {
  const cases = [
    answer({ affected: [{ file: 'tests/missing.test.ts', name: 'unowned setup' }] }),
    answer({ affected: [leaf('suite > A'), leaf('suite > A')], unaffected: [] }),
    answer({ overrides: { affectedCount: 3 } }),
    answer({ overrides: { summary: { tests: 999, affected: 1, undetermined: 1, unaffected: 1 } } }),
    { schemaVersion: 1, ok: false, command: 'runs.tests.affected' },
  ]
  for (const item of cases) assert.throws(() => decodeAffected(item, inventory, source, run), /unsafe/)
})
test('unmeasured source and unsupported asset/rename/delete fail closed', () => {
  const cases = [
    [answer({ workingTree: { sourceSetChanged: true } }), source],
    [answer(), [{ status: 'A', file: 'src/new.ts' }]],
    [answer(), [{ status: 'D', file: 'src/removed.ts' }]],
    [answer(), [{ status: 'R100', oldFile: 'src/x.ts', file: 'src/y.ts' }]],
    [answer(), [{ status: 'M', file: 'public/weapon.glb' }]],
  ]
  for (const [result, diff] of cases) assert.throws(() => decodeAffected(result, inventory, diff, run), /unsafe/)
})
test('source changes with no native coverage fail rather than Node-only success', () => {
  const result = answer({ affected: [], undetermined: [],
    unaffected: [leaf('suite > A'), leaf('suite > B'), leaf('suite > C')] })
  assert.throws(() => decodeAffected(result, inventory, source, run), /unsafe/)
})
test('native run identity and workingTree integrity are mandatory', () => {
  assert.throws(() => decodeAffected(answer(), inventory, source, 'run_wrong'), /unsafe/)
  assert.throws(() => decodeAffected(answer({ overrides: { workingTree: null } }), inventory, source, run), /unsafe/)
})
test('500 aggregate leaves passes, 501 fails without Full fallback or shard bypass', () => {
  const files = count => [{ file: 'tests/a.test.ts', runner: 'vitest',
    names: Array.from({ length: count }, (_, i) => 'leaf ' + i) }]
  assert.equal(planShards(files(500), 'related')[0].expectedCount, 500)
  assert.throws(() => planShards(files(501), 'related'), /500-leaf limit: 501/)
  assert.throws(() => planShards(files(501), 'full'), /File exceeds 500/)
})

test('incremental refresh calls only strict public Supercov merge (no unsafe override)', () => {
  const script = readFileSync(resolve(__dirname, '../tooling/supercov-refresh.cjs'), 'utf8')
  assert.match(script, /sc\('merge', seed\.runId, \.\.\.candidateRuns\)/)
  // Check the executable args, not comments explaining why overrides are unsafe.
  assert.doesNotMatch(script, /sc\('merge',\s*'--allow-changed'/)
  assert.match(script, /const newId = matches\[0\]\[1\]/)
  assert.match(script, /validSeedMetadata\(seed\)/)
  assert.match(script, /validateRunSummary\(query, vitestCount\)/)
})

test('Full seed instruments verified manifest shards, never a hidden unsharded 500+ run', () => {
  const script = readFileSync(resolve(__dirname, '../tooling/supercov-seed.cjs'), 'utf8')
  const workflow = readFileSync(resolve(__dirname, '../../.github/workflows/logic-tests.yml'), 'utf8')
  assert.match(script, /aggregate\.result !== 'passed'/)
  assert.match(script, /shard\.vitestFiles/)
  assert.match(script, /LOGIC_TEST_FILES: JSON\.stringify\(shard\.vitestFiles\)/)
  assert.match(script, /run\(\['merge', \.\.\.runs\]\)/)
  assert.doesNotMatch(script, /run\(\['merge', '--allow-changed'/)
  assert.match(workflow, /Record strict Full seed from already-verified Full shards/)
  assert.match(workflow, /name: logic-aggregate/)
})

test('only canonical dev/main Full workflow can publish reusable evidence', () => {
  const ci = readFileSync(resolve(__dirname, '../../.github/workflows/ci.yml'), 'utf8')
  const workflow = readFileSync(resolve(__dirname, '../../.github/workflows/logic-tests.yml'), 'utf8')
  const artifact = readFileSync(resolve(__dirname, '../tooling/supercov-evidence.cjs'), 'utf8')
  assert.doesNotMatch(ci, /bootstrap-dev-seed:|refs\/heads\/ci\/supercov-per-test-impact-poc/)
  assert.match(workflow, /supercov-full-seed:/)
  assert.match(workflow, /github\.event_name == 'workflow_dispatch'/)
  assert.match(workflow, /refs\/heads\/dev/)
  assert.match(workflow, /refs\/heads\/main/)
  assert.match(workflow, /name: supercov-seed-/)
  assert.match(workflow, /GH_TOKEN:/)
  assert.match(workflow, /supercov-evidence\.cjs restore/)
  assert.match(artifact, /No PR\/dev TEST_BASE ancestor Full\/strict-Related seed artifact/)
  assert.match(ci, /github\.event_name == 'workflow_dispatch' && 'full'/)
})

test('P1 feature Full seed cannot bypass PR base even when ancestor of feature HEAD', () => {
  const base = 'a'.repeat(40), feature = 'b'.repeat(40)
  assert.doesNotThrow(() => requireBaseAncestor(base, base, (candidate, target) =>
    candidate === base && target === base))
  assert.throws(() => requireBaseAncestor(feature, base, (candidate, target) =>
    candidate === feature && target === feature),
    /TEST_BASE: feature-seed bypass forbidden/)
  assert.throws(() => requireBaseAncestor(feature, '', () => true), /TEST_BASE SHA/)
  const adapter = readFileSync(resolve(__dirname, '../tooling/supercov-related.cjs'), 'utf8')
  const plan = readFileSync(resolve(__dirname, '../tooling/ci-plan.cjs'), 'utf8')
  const restore = readFileSync(resolve(__dirname, '../tooling/supercov-evidence.cjs'), 'utf8')
  const workflow = readFileSync(resolve(__dirname, '../../.github/workflows/logic-tests.yml'), 'utf8')
  assert.match(adapter, /requireBaseAncestor\(seed\.sha, base/)
  assert.match(plan, /nativeSelection\(inventory, changed, \{ base, event \}\)/)
  assert.match(restore, /SUPERCOV_EVIDENCE_BASE/)
  assert.match(restore, /ancestor\(seed\.sha\)/)
  assert.match(workflow, /SUPERCOV_EVIDENCE_BASE: \$\{\{ inputs\.base \}\}/)
})

test('P1 published seeds cannot originate from arbitrary feature manual Full', () => {
  const sha = 'a'.repeat(40)
  const valid = { status: 'completed', conclusion: 'success',
    path: '.github/workflows/ci.yml', head_sha: sha }
  assert.equal(trustedPublication({ ...valid, event: 'push', head_branch: 'dev' }, sha), true)
  assert.equal(trustedPublication({ ...valid, event: 'workflow_dispatch', head_branch: 'main' }, sha), true)
  assert.equal(trustedPublication({ ...valid, event: 'workflow_dispatch',
    head_branch: 'ci/supercov-per-test-impact-poc' }, sha), false)
  assert.equal(trustedPublication({ ...valid, event: 'workflow_dispatch',
    head_branch: 'feature/manual-full' }, sha), false)
  assert.equal(trustedPublication({ ...valid, event: 'pull_request', head_branch: 'dev' }, sha), false)
  assert.equal(trustedPublication({ ...valid, event: 'push', head_branch: 'dev',
    head_sha: 'b'.repeat(40) }, sha), false)
  assert.equal(trustedPublication({ ...valid, event: 'workflow_dispatch',
    head_branch: 'dev', conclusion: 'failure' }, sha), false)
})

test('P2 bounded evidence lineage requires explicit clean Full after threshold', () => {
  assert.equal(generation({ generation: 0 }), 0)
  assert.equal(requireRefreshAllowed({ generation: 0 }), 1)
  assert.equal(requireRefreshAllowed({ generation: MAX_REFRESH_GENERATIONS - 1 }),
    MAX_REFRESH_GENERATIONS)
  assert.throws(() => requireRefreshAllowed({ generation: MAX_REFRESH_GENERATIONS }),
    /explicitly bootstrap/)
  assert.throws(() => generation({ generation: -1 }), /Invalid evidence/)
  const script = readFileSync(resolve(__dirname, '../tooling/supercov-refresh.cjs'), 'utf8')
  const workflow = readFileSync(resolve(__dirname, '../../.github/workflows/logic-tests.yml'), 'utf8')
  assert.match(script, /requireRefreshAllowed\(seed\)/)
  assert.match(workflow, /node tests\/tooling\/supercov-evidence-policy\.cjs/)
  assert.match(workflow, /retention-days: 45/)
})

test('rollout keeps true dev-push-only production refresh and distinct pre/post-merge acceptance', () => {
  const refresh = readFileSync(resolve(__dirname, '../tooling/supercov-refresh.cjs'), 'utf8')
  const docs = readFileSync(resolve(__dirname, '../tooling/README.md'), 'utf8')
  assert.match(refresh, /GITHUB_EVENT_NAME !== 'push'/)
  assert.match(refresh, /GITHUB_REF !== 'refs\/heads\/dev'/)
  assert.match(docs, /#430 migration acceptance/)
  assert.match(docs, /Post-merge rollout confirmation/)
  assert.match(docs, /isolated[\s\S]*worktree\/acceptance/)
  assert.match(docs, /two consecutive real push→dev/)
})

test('fully measured 763-leaf baseline permits honest uncovered branches, not invalid evidence', () => {
  const summary = {
    schemaVersion: 1, ok: true, command: 'coverage.summary',
    data: {
      run: 'run_f772560eaadcc58c', valid: true, testExitCode: 0,
      stale: false, staleReasons: [], complete: false,
      structurallyComplete: false, tests: 763, setups: 110,
      coverage: { coverageComplete: false },
      measurement: { complete: true, limitations: 0, evidenceCorruptions: 0,
        blocking: 0, declared: 0 },
      filesWithMeasurementLimitations: 0,
      transport: { corruptFiles: 0, corruptRecords: 0 },
      testAttribution: { exact: 763, byTime: 0, partial: 0, runWide: 0 },
      testOutcomes: { passed: 763, failed: 0, flaky: 0, skipped: 0,
        timedOut: 0, interrupted: 0, unknown: 0, unstarted: 0, todo: 0 },
      sourceScope: { mode: 'explicit', roots: ['src', 'tests/helpers'], ambiguous: 0 },
    },
  }
  const measured = validateRunSummary(summary, 763)
  assert.equal(measured.coverageComplete, false)
  const seed = buildSeed({ sha: 'a'.repeat(40), ...measured }, 0)
  assert.equal(seed.tests, 763)
  assert.equal(seed.setups, 110)
  assert.equal(seed.coverageComplete, false)
  assert.equal(seed.executionComplete, true)
  assert.equal(seed.measurementComplete, true)
  assert.equal(seed.attributionComplete, true)
  assert.equal(validSeedMetadata(seed), true)
  assert.equal(Object.hasOwn(seed, 'complete'), false)
  for (const [key, value] of [
    ['valid', false], ['testExitCode', 1], ['stale', true], ['tests', 762],
    ['filesWithMeasurementLimitations', 1],
  ]) {
    const bad = structuredClone(summary); bad.data[key] = value
    assert.throws(() => validateRunSummary(bad, 763), /unsafe/, key)
  }
  const failed = structuredClone(summary); failed.data.testOutcomes.failed = 1
  assert.throws(() => validateRunSummary(failed, 763), /unsafe/)
  const partial = structuredClone(summary); partial.data.testAttribution.exact = 762
  assert.throws(() => validateRunSummary(partial, 763), /unsafe/)
  const incomplete = structuredClone(summary); incomplete.data.measurement.complete = false
  assert.throws(() => validateRunSummary(incomplete, 763), /unsafe/)
  const corrupt = structuredClone(summary); corrupt.data.transport.corruptFiles = 1
  assert.throws(() => validateRunSummary(corrupt, 763), /unsafe/)
  const scope = structuredClone(summary); scope.data.sourceScope.roots = ['src']
  assert.throws(() => validateRunSummary(scope, 763), /unsafe/)
  assert.equal(validSeedMetadata({ ...seed, measurementComplete: false }), false)
  assert.equal(validSeedMetadata({ ...seed, attributionComplete: false }), false)
  assert.equal(validSeedMetadata({ ...seed, schemaVersion: 1 }), false)
})

test('Full and Related seed publishers validate actual measurement, not 100-percent coverage', () => {
  for (const name of ['supercov-seed.cjs', 'supercov-refresh.cjs']) {
    const script = readFileSync(resolve(__dirname, '../tooling/' + name), 'utf8')
    assert.match(script, /validateRunSummary\(/)
    assert.match(script, /buildSeed\(/)
    assert.doesNotMatch(script, /\.data\?\.complete !== true/)
  }
  for (const name of ['supercov-evidence.cjs', 'supercov-related.cjs', 'supercov-evidence-policy.cjs']) {
    const script = readFileSync(resolve(__dirname, '../tooling/' + name), 'utf8')
    assert.match(script, /validSeedMetadata\(/)
  }
})

test('real merged Supercov public JSON counts setup records and truncates only unaffected names', () => {
  const pristine = {
    schemaVersion: 1, ok: true, command: 'runs.tests.affected',
    data: {
      run: 'run_832c98c5b3149714',
      mergedFrom: ['run_71bc72c34894e3bd', 'run_c4bdf9344075322b'],
      summary: { tests: 873, affected: 0, undetermined: 0, unaffected: 873,
        changedFiles: 0 },
      affected: [], undetermined: [], unaffected: [],
      unaffectedCount: 873,
      truncated: ['unaffected tests are counted, not listed'],
      changedFiles: [],
      workingTree: { stale: false, reasons: [], runWide: [], sourceSetChanged: false },
    },
  }
  // Supercov also emits redundant affectedCount and undeterminedCount
  // even when both identity arrays are present and exact.
  pristine.data.affectedCount = 0
  pristine.data.undeterminedCount = 0
  const sourceRun = pristine.data.run
  const clean = validateAffectedQuery(pristine, sourceRun,
    { tests: 763, setups: 110, pristine: true })
  assert.equal(clean.counts.tests, 873)
  assert.equal(clean.truncatedUnaffected, true)
  assert.equal(clean.affected.length, 0)
  const selected = decodeAffected(pristine, inventory, [], sourceRun,
    { tests: 763, setups: 110 })
  assert.deepEqual(selected.selectedCases['tests/release/gate.test.cjs'], [0])
  assert.equal(selected.native.total, 873)
  // Never mistake 873 historical records for 873 runnable Vitest leaves.
  assert.throws(() => validateAffectedQuery(pristine, sourceRun,
    { tests: 763, setups: 0, pristine: true }), /unsafe/)
  const unreadable = structuredClone(pristine)
  unreadable.data.unaffectedCount = 872
  assert.throws(() => validateAffectedQuery(unreadable, sourceRun,
    { tests: 763, setups: 110, pristine: true }), /unsafe/)
  const mismatchAffectedCounter = structuredClone(pristine)
  mismatchAffectedCounter.data.affectedCount = 1
  assert.throws(() => validateAffectedQuery(mismatchAffectedCounter, sourceRun,
    { tests: 763, setups: 110 }), /unsafe/)
  const mismatchUndeterminedCounter = structuredClone(pristine)
  mismatchUndeterminedCounter.data.undeterminedCount = 1
  assert.throws(() => validateAffectedQuery(mismatchUndeterminedCounter, sourceRun,
    { tests: 763, setups: 110 }), /unsafe/)
  const truncatedAffected = structuredClone(pristine)
  truncatedAffected.data.summary.affected = 1
  truncatedAffected.data.summary.unaffected = 872
  truncatedAffected.data.unaffectedCount = 872
  assert.throws(() => validateAffectedQuery(truncatedAffected, sourceRun,
    { tests: 763, setups: 110 }), /unsafe/)
  const stale = structuredClone(pristine)
  stale.data.workingTree.stale = true
  assert.throws(() => validateAffectedQuery(stale, sourceRun,
    { tests: 763, setups: 110, pristine: true }), /unsafe/)
  const hiddenUnknown = structuredClone(pristine)
  hiddenUnknown.data.truncated.push('affected test names omitted')
  assert.throws(() => validateAffectedQuery(hiddenUnknown, sourceRun,
    { tests: 763, setups: 110 }), /unsafe/)
})

test('affected setup lifecycle record widens to all leaves of its own file, not a skipped pseudo-test', () => {
  const result = answer({
    affected: [
      leaf('suite > A'),
      { file: 'tests/example.test.ts', name: 'beforeEach: suite setup' },
    ],
    unaffected: [leaf('suite > C')],
  })
  const selection = decodeAffected(result, inventory, source, run)
  assert.deepEqual(selection.selectedCases['tests/example.test.ts'], [0, 1, 2])
  assert.deepEqual(selection.selectedCases['tests/release/gate.test.cjs'], [0])
  assert.match(selection.reasons['tests/example.test.ts'].join(' '), /setup\/non-leaf/)
  const unknown = answer({ affected: [
    { file: 'tests/foreign-setup.ts', name: 'setup' },
  ] })
  assert.throws(() => decodeAffected(unknown, inventory, source, run), /unsafe/)
})

test('real 873 affected records cannot bypass the strict 500 runnable-leaf gate', () => {
  const wide = answer({
    affected: Array.from({ length: 54 }, (_, i) => ({
      file: 'tests/example.test.ts', name: 'preview ' + i,
    })),
    undetermined: [], unaffected: [],
    overrides: {
      affectedCount: 873, unaffectedCount: 0,
      summary: { tests: 873, affected: 873, undetermined: 0,
        unaffected: 0, changedFiles: 12 },
      truncated: ['unaffected tests are counted, not listed',
        'each test keeps its first three reasons',
        'the lists keep their first, highest-ranked tests; `--names` lists every one'],
    },
  })
  assert.throws(
    () => decodeAffected(wide, inventory, source, run, { tests: 763, setups: 110 }),
    /500-leaf limit exceeded: at least 763 runnable Vitest leaves/)
  assert.throws(
    () => decodeAffected(wide, inventory, source, run, { tests: 763, setups: 0 }),
    /500-leaf limit exceeded/)
  const adapter = readFileSync(resolve(__dirname, '../tooling/supercov-related.cjs'), 'utf8')
  assert.match(adapter, /Native Related aggregate 500-leaf limit exceeded/)
  assert.doesNotMatch(adapter, /'--limit'/)
})

test('non-lossy native affected identity list accepts reasons-only truncation, rejects count-only selections', () => {
  const complete = answer({ overrides: {
    affectedCount: 1, undeterminedCount: 1, unaffectedCount: 1,
    truncated: ['each test keeps its first three reasons',
      'the lists keep their first, highest-ranked tests; `--names` lists every one'],
  } })
  assert.deepEqual(
    decodeAffected(complete, inventory, source, run).selectedCases['tests/example.test.ts'],
    [0, 1])
  const truncated = structuredClone(complete)
  truncated.data.affected = []
  assert.throws(() => decodeAffected(truncated, inventory, source, run), /unsafe/)
  const omitted = structuredClone(complete)
  omitted.data.truncated.push('affected names omitted')
  assert.throws(() => decodeAffected(omitted, inventory, source, run), /unsafe/)
})
