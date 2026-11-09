'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { decodeAffected, affectedFilters, expandIdentities, preflightChanges, isCss } = require('../tooling/supercov-related.cjs')
const { noSeedPolicy, safeNewAgentLink } = require('../tooling/ci-plan.cjs')
const { diagnose } = require('../tooling/supercov-affected-expand.cjs')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { validateRunSummary, buildSeed, validSeedMetadata, validateAffectedQuery,
  reconcileAffectedFiles, validateRoster, requireVerifiedFullPlan } = require('../tooling/supercov-measured-evidence.cjs')
const { requireExactBaseSeed, trustedPublication,
  MAX_UNPACKED_BYTES, MAX_ARCHIVE_BYTES } = require('../tooling/supercov-evidence-policy.cjs')
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
test('new test files absent from exact-base history are selected without unsupported historic CLI lookup', () => {
  const next = { runner: 'vitest', file: 'tests/added.test.ts',
    names: ['new > 1', 'new > 2'], nativeNames: ['new 1', 'new 2'] }
  const nextInventory = [...inventory, next]
  const changed = [{ status: 'A', file: next.file }]
  assert.deepEqual(affectedFilters(['tests/example.test.ts'], nextInventory), ['tests/example.test.ts'])
  const selection = decodeAffected(answer(), nextInventory, changed, run)
  assert.deepEqual(selection.selectedCases[next.file], [0, 1])
  assert.deepEqual(selection.selectedCases['tests/example.test.ts'], [0, 1])
})
test('new test plus changed runtime retains all new leaves AND native affected/undetermined identities', () => {
  const next = { runner: 'vitest', file: 'tests/added.test.ts',
    names: ['new > 1'], nativeNames: ['new 1'] }
  const changed = [{ status: 'A', file: next.file }, ...source]
  const selection = decodeAffected(answer(), [...inventory, next], changed, run)
  assert.deepEqual(selection.selectedCases[next.file], [0])
  assert.deepEqual(selection.selectedCases['tests/example.test.ts'], [0, 1])
  assert.throws(() => preflightChanges([{ status: 'D', file: 'tests/example.test.ts' }]), /unsafe/)
  assert.throws(() => affectedFilters(['tests/gone.test.ts'], inventory), /absent from Vitest discovery/)
})
test('filtered CLI failures distinguish timeout, maxBuffer, signal, exit and stderr', () => {
  const timeout = diagnose('tests/new.test.ts', run, {
    code: null, signal: 'SIGTERM', killed: true, stderr: 'query timed out', message: 'killed',
  })
  for (const field of ['testFile=tests/new.test.ts', 'seedRunId=' + run,
    'failureType=timeout', 'exitCode=none', 'signal=SIGTERM', 'timeout=true',
    'maxBufferExceeded=false', 'stderr=query timed out']) {
    assert.ok(timeout.includes(field), field)
  }
  assert.match(diagnose('tests/new.test.ts', run, { code: 'ETIMEDOUT' }),
    /failureType=timeout; exitCode=none; errorCode=ETIMEDOUT/)
  const maxBuffer = diagnose('tests/big.test.ts', run, {
    code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', signal: 'SIGTERM', killed: true,
    message: 'stdout maxBuffer length exceeded', stderr: 'truncated',
  })
  for (const field of ['failureType=maxBuffer', 'exitCode=none',
    'errorCode=ERR_CHILD_PROCESS_STDIO_MAXBUFFER', 'timeout=false',
    'maxBufferExceeded=true', 'stderr=truncated']) {
    assert.ok(maxBuffer.includes(field), field)
  }
  const signal = diagnose('tests/a.test.ts', run, {
    code: null, signal: 'SIGTERM', killed: false,
  })
  assert.match(signal, /failureType=signal/)
  assert.match(signal, /timeout=false/)
  const failure = diagnose('tests/a.test.ts', run, { code: 7, stderr: 'unknown test file' })
  assert.match(failure, /failureType=nonzero-exit; exitCode=7/)
  assert.match(failure, /timeout=false/)
  assert.match(failure, /unknown test file/)
})
test('CSS alone is safe for Web build, while CSS plus TypeScript keeps native Related selection', () => {
  const regular = () => true
  const css = { status: 'M', file: 'src/ui/battle-setup.css' }
  assert.equal(isCss(css.file), true)
  assert.equal(noSeedPolicy([css], 'a', 'b', { regular }), 'css-only')
  assert.equal(noSeedPolicy([css, ...source], 'a', 'b', { regular }), null)
  const selected = decodeAffected(answer(), inventory, [css, ...source], run)
  assert.deepEqual(selected.selectedCases['tests/example.test.ts'], [0, 1])
  assert.equal(noSeedPolicy([{ status: 'M', file: 'public/foo.glb' }], 'a', 'b', { regular }), null)
})
test('docs-only whitelist never accepts unknown files, symlinks, deletes or changed agent scripts', () => {
  const regular = () => true
  const doc = { status: 'A', file: 'CLAUDE.md' }
  const agentDoc = { status: 'M', file: '.claude/guidance.md' }
  assert.equal(noSeedPolicy([doc, agentDoc], 'a', 'b', { regular }), 'docs-only')
  assert.equal(noSeedPolicy([doc], 'a', 'b', { regular: () => false }), null)
  assert.equal(noSeedPolicy([{ status: 'D', file: 'CLAUDE.md' }], 'a', 'b', { regular }), null)
  assert.equal(noSeedPolicy([{ status: 'A', file: '.claude/skills/mount' }], 'a', 'b', { regular }), null)
  assert.equal(noSeedPolicy([{ status: 'M', file: 'tests/tooling/ci-plan.cjs' }], 'a', 'b', { regular }), null)
  assert.equal(noSeedPolicy([{ status: 'A', file: '.gitignore' }], 'a', 'b',
    { regular, gitignore: () => true }), 'docs-only')
  assert.equal(noSeedPolicy([{ status: 'M', file: '.gitignore' }], 'a', 'b',
    { regular, gitignore: () => false }), null)
})
test('new Claude skill links require byte-exact pointers and unchanged target trees', () => {
  const file = '.claude/skills/mount-from-reference'
  const target = 'ai_share/skills/mount-from-reference'
  const base = 'a'.repeat(40), head = 'b'.repeat(40)
  const good = (command, sha, separator, path) => {
    if (path === file) return '120000 blob ' + 'c'.repeat(40) + '\\t' + file
    if (path === target) return '040000 tree ' + 'd'.repeat(40) + '\\t' + target
    return ''
  }
  const git = (...args) => good(...args).replaceAll('\\t', '\t')
  const pointer = '../../' + target
  const link = () => Buffer.from(pointer, 'utf8')
  assert.equal(safeNewAgentLink(base, head, file, git, link), true)
  assert.equal(safeNewAgentLink(base, head, '.claude/skills/../escape', git, link), false)
  for (const changed of [pointer + ' ', pointer + '\n', pointer + '\r\n',
    ' ' + pointer, '../../src', pointer + '\0']) {
    assert.equal(safeNewAgentLink(base, head, file, git, () => Buffer.from(changed)), false,
      'reject non-byte-exact pointer ' + JSON.stringify(changed))
  }
  assert.equal(safeNewAgentLink(base, head, file, git, () => pointer), false,
    'a lossy decoded string must not be accepted')
  assert.equal(safeNewAgentLink(base, head, file,
    (...args) => args[0] === 'ls-tree' && args[1] === head && args[3] === target
      ? '040000 tree ' + 'e'.repeat(40) + '\t' + target : git(...args), link), false)
  assert.equal(noSeedPolicy([{ status: 'A', file }], base, head,
    { regular: () => false, agentLink: (b,h,f) => safeNewAgentLink(b,h,f,git,link) }), 'docs-only')
  assert.equal(noSeedPolicy([{ status: 'M', file }], base, head,
    { regular: () => false, agentLink: () => true }), null)
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
test('production uses fresh immutable SHA-exact Full on every dev push, never old Related strict refresh', () => {
  const ci = readFileSync(resolve(__dirname, '../../.github/workflows/ci.yml'), 'utf8')
  const workflow = readFileSync(resolve(__dirname, '../../.github/workflows/logic-tests.yml'), 'utf8')
  const seed = readFileSync(resolve(__dirname, '../tooling/supercov-seed.cjs'), 'utf8')
  assert.match(ci, /github\.event_name == 'push' && \(github\.ref == 'refs\/heads\/dev' \|\| github\.ref == 'refs\/heads\/main'\)\) && 'full'/)
  assert.match(ci, /github\.event_name == 'pull_request' && github\.event\.pull_request\.base\.sha/)
  assert.match(ci, /github\.sha \|\| github\.ref/)
  assert.match(workflow, /Record strict Full seed from one complete instrumented run/)
  assert.match(workflow, /github\.event_name == 'push' \|\| github\.event_name == 'workflow_dispatch'/)
  assert.match(workflow, /name: supercov-seed-\$\{\{ github\.sha \}\}/)
  assert.doesNotMatch(workflow, /supercov-dev-refresh:|supercov-refresh\.cjs|supercov-evidence-dev-|actions\/cache\/(?:restore|save)/)
  assert.match(seed, /requireVerifiedFullPlan\(plan, aggregate, sha\)/)
  assert.match(seed, /buildSeed\(\{ sha, \.\.\.measured \}\)/)
  assert.doesNotMatch(seed, /'merge', '--allow-changed'/)
})

test('Full seed is one complete instrumented run of the verified inventory, never merged', () => {
  const script = readFileSync(resolve(__dirname, '../tooling/supercov-seed.cjs'), 'utf8')
  assert.match(script, /LOGIC_TEST_FILES: JSON\.stringify\(inventory\.map\(item => item\.file\)\)/)
  assert.match(script, /validateRoster\(read\(rosterFile\), inventory\)/)
  assert.doesNotMatch(script, /'merge'|--allow-changed/)
})

test('seed requires a passing Full plan of the exact commit', () => {
  const sha = 'a'.repeat(40)
  const plan = { planId: 'p', mode: 'full', checkoutSha: sha, headSha: sha,
    inventory: [{ runner: 'vitest', file: 'tests/a.test.ts', names: ['x'] }, { runner: 'node', file: 'tests/n.test.cjs', names: ['y'] }] }
  const passed = { planId: 'p', mode: 'full', result: 'passed', count: 2 }
  assert.deepEqual(requireVerifiedFullPlan(plan, passed, sha).map(item => item.file), ['tests/a.test.ts'])
  assert.throws(() => requireVerifiedFullPlan(plan, passed, 'b'.repeat(40)), /exact-SHA/)
  assert.throws(() => requireVerifiedFullPlan({ ...plan, mode: 'related' }, passed, sha), /exact-SHA/)
  for (const change of [{ result: 'failed' }, { planId: 'other' }, { count: 1 }]) {
    assert.throws(() => requireVerifiedFullPlan(plan, { ...passed, ...change }, sha), /passing/)
  }
})

test('instrumented roster must equal the planned Vitest identities, all passed', () => {
  const planned = [{ runner: 'vitest', file: 'tests/a.test.ts', names: ['s > x', 's > y'], nativeNames: ['s x', 's y'] }]
  const test = (title, status = 'passed') => ({ ancestorTitles: ['s'], title, status })
  const roster = tests => ({ success: true, testResults: [{ name: '/tmp/copy/tests/a.test.ts', assertionResults: tests }] })
  assert.equal(validateRoster(roster([test('x'), test('y')]), planned), 2)
  assert.throws(() => validateRoster(roster([test('x')]), planned), /identities differ/)
  assert.throws(() => validateRoster(roster([test('x'), test('y'), test('y')]), planned), /identities differ/)
  assert.throws(() => validateRoster(roster([test('x'), test('z')]), planned), /identities differ/)
  assert.throws(() => validateRoster(roster([test('x'), test('y', 'skipped')]), planned), /failed, skipped/)
  assert.throws(() => validateRoster({ ...roster([test('x'), test('y')]), success: false }, planned), /failed, skipped/)
})

test('canonical dev/main publisher and artifact-only exact PR-base restore', () => {
  const ci = readFileSync(resolve(__dirname, '../../.github/workflows/ci.yml'), 'utf8')
  const workflow = readFileSync(resolve(__dirname, '../../.github/workflows/logic-tests.yml'), 'utf8')
  const restore = readFileSync(resolve(__dirname, '../tooling/supercov-evidence.cjs'), 'utf8')
  const adapter = readFileSync(resolve(__dirname, '../tooling/supercov-related.cjs'), 'utf8')
  const plan = readFileSync(resolve(__dirname, '../tooling/ci-plan.cjs'), 'utf8')
  assert.doesNotMatch(ci, /bootstrap-dev-seed:|refs\/heads\/ci\/supercov-per-test-impact-poc/)
  assert.match(workflow, /Record strict Full seed from one complete instrumented run/)
  assert.match(workflow, /GH_TOKEN:/)
  assert.match(workflow, /SUPERCOV_EVIDENCE_BASE: \$\{\{ inputs\.base \}\}/)
  assert.match(workflow, /supercov-evidence\.cjs restore/)
  assert.match(restore, /requireExactBaseSeed\(extracted\.sha, comparisonBase\)/)
  assert.match(restore, /candidate === comparisonBase/)
  assert.match(restore, /trustedPublication\(workflow, candidate\.sha\)/)
  assert.match(restore, /exact dev baseline seed pending/)
  assert.doesNotMatch(workflow, /actions\/cache\/restore@|supercov-dev-refresh:/)
  assert.match(adapter, /requireExactBaseSeed\(seed\.sha, base\)/)
  assert.match(plan, /nativeSelection\(inventory, changed, \{ base, event \}\)/)
  assert.match(ci, /github\.event_name == 'workflow_dispatch' && 'full'/)
})

test('P1 exact base SHA rejects older ancestor seed or feature-created Full seed', () => {
  const devA = 'a'.repeat(40), devB = 'b'.repeat(40)
  assert.doesNotThrow(() => requireExactBaseSeed(devB, devB))
  assert.throws(() => requireExactBaseSeed(devA, devB), /exact dev baseline seed pending/)
  assert.throws(() => requireExactBaseSeed(devB, devA), /exact dev baseline seed pending/)
  assert.throws(() => requireExactBaseSeed('', devB), /exact PR base SHA/)
  assert.throws(() => requireExactBaseSeed(devB, ''), /exact PR base SHA/)
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

test('evidence limits remain but incremental refresh/generation lineage are deleted', () => {
  const policy = readFileSync(resolve(__dirname, '../tooling/supercov-evidence-policy.cjs'), 'utf8')
  const full = readFileSync(resolve(__dirname, '../tooling/supercov-measured-evidence.cjs'), 'utf8')
  const workflow = readFileSync(resolve(__dirname, '../../.github/workflows/logic-tests.yml'), 'utf8')
  assert.equal(MAX_ARCHIVE_BYTES, 500 * 1024 * 1024)
  assert.equal(MAX_UNPACKED_BYTES, 1024 * 1024 * 1024)
  assert.match(policy, /validateArchive/)
  assert.doesNotMatch(policy, /MAX_REFRESH_GENERATIONS|requireRefreshAllowed|function generation/)
  // The word appears only to reject old schema-v2 lineage metadata.
  assert.match(full, /!Object\.hasOwn\(s, 'generation'\)/)
  assert.doesNotMatch(workflow, /supercov-dev-refresh:/)
  assert.match(workflow, /node tests\/tooling\/supercov-evidence-policy\.cjs/)
  assert.match(workflow, /retention-days: 45/)
  assert.equal(validSeedMetadata({ schemaVersion: 2 }), false)
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
  const seed = buildSeed({ sha: 'a'.repeat(40), ...measured })
  assert.equal(seed.schemaVersion, 3)
  assert.equal(seed.tests, 763)
  assert.equal(seed.setups, 110)
  assert.equal(Object.hasOwn(seed, 'generation'), false)
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
  assert.equal(validSeedMetadata({ ...seed, schemaVersion: 2 }), false)
  assert.equal(validSeedMetadata({ ...seed, generation: 0 }), false)
})

test('Full-only seed publisher validates actual measurement, not 100-percent coverage', () => {
  for (const name of ['supercov-seed.cjs']) {
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

test('module setup means loading the file: one leaf when nothing else loads it, never counted as a case', () => {
  const setup = { file: 'tests/example.test.ts', name: 'tests/example.test.ts > module setup' }
  const alone = decodeAffected(answer({ affected: [setup], undetermined: [], unaffected: [] }), inventory, source, run)
  assert.deepEqual(alone.selectedCases['tests/example.test.ts'], [0])
  assert.match(alone.reasons['tests/example.test.ts'][0], /module setup: loads the file/)
  const beside = decodeAffected(answer({ affected: [setup, leaf('suite > C')], undetermined: [], unaffected: [] }), inventory, source, run)
  assert.deepEqual(beside.selectedCases['tests/example.test.ts'], [2])
  assert.equal(beside.breakdown.nativeAffected, 1)
  const direct = decodeAffected(answer({ affected: [setup], undetermined: [], unaffected: [] }), inventory,
    [{ status: 'M', file: 'tests/example.test.ts' }], run)
  assert.deepEqual(direct.selectedCases['tests/example.test.ts'], [0, 1, 2])
})

test('other setup lifecycle records widen to all leaves of their own file, not a skipped pseudo-test', () => {
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


test('public --test-file --json reconstructs a truncated 3-leaf preview with exact identities', () => {
  const id = 'run_abcdef0123'
  const files = ['tests/a.test.ts', 'tests/b.test.ts']
  const workingTree = { stale: true, reasons: ['instrumented source changed'],
    runWide: [], sourceSetChanged: false }
  const global = { schemaVersion: 1, ok: true, command: 'runs.tests.affected',
    data: { run: id, summary: { tests: 4, affected: 3, undetermined: 0,
      unaffected: 1, changedFiles: 1 },
      affected: [{ file: files[0], name: 'suite > one' }],
      affectedCount: 3, undetermined: [], undeterminedCount: 0,
      unaffected: [], unaffectedCount: 1,
      truncated: ['unaffected tests are counted, not listed',
        'the lists keep their first, highest-ranked tests; `--names` lists every one'],
      workingTree } }
  const mk = (file, names, unaffected = []) => ({ schemaVersion: 1, ok: true,
    command: 'runs.tests.affected', data: {
      run: id, filter: '--test-file ' + file,
      summary: { tests: names.length + unaffected.length,
        affected: names.length, undetermined: 0, unaffected: unaffected.length,
        changedFiles: 1 },
      affected: names.map(name => ({file, name})), undetermined: [],
      unaffected: unaffected.map(name => ({file, name})),
      workingTree, truncated: [] } })
  const parts = [
    mk(files[0], ['suite > one', 'suite > two']),
    mk(files[1], ['suite > three'], ['suite > four']),
  ]
  const complete = reconcileAffectedFiles(global, parts, files, id,
    { tests: 4, setups: 0 })
  assert.equal(complete.data.affected.length, 3)
  assert.deepEqual(complete.data.affected.map(x => [x.file,x.name]), [
    [files[0], 'suite > one'], [files[0], 'suite > two'],
    [files[1], 'suite > three']])
  const badFilter = structuredClone(parts)
  badFilter[1].data.filter = '--test-file tests/other.test.ts'
  assert.throws(() => reconcileAffectedFiles(global, badFilter, files, id,
    { tests: 4, setups: 0 }), /unsafe/)
  const crossFile = structuredClone(parts)
  crossFile[1].data.affected[0].file = files[0]
  assert.throws(() => reconcileAffectedFiles(global, crossFile, files, id,
    { tests: 4, setups: 0 }), /unsafe/)
  const missing = parts.slice(0, 1)
  assert.throws(() => reconcileAffectedFiles(global, missing, files, id,
    { tests: 4, setups: 0 }), /unsafe/)
  const understated = structuredClone(parts)
  understated[0].data.summary.affected = 1
  assert.throws(() => reconcileAffectedFiles(global, understated, files, id,
    { tests: 4, setups: 0 }), /unsafe/)
  const hidden = structuredClone(parts)
  hidden[0].data.affected.splice(0, 1)
  assert.throws(() => reconcileAffectedFiles(global, hidden, files, id,
    { tests: 4, setups: 0 }), /unsafe/)
  const stale = structuredClone(parts)
  stale[1].data.workingTree.sourceSetChanged = true
  assert.throws(() => reconcileAffectedFiles(global, stale, files, id,
    { tests: 4, setups: 0 }), /unsafe/)
  const wrongRun = structuredClone(parts)
  wrongRun[0].data.run = 'run_invalid'
  assert.throws(() => reconcileAffectedFiles(global, wrongRun, files, id,
    { tests: 4, setups: 0 }), /unsafe/)
})

test('expansion queries only affected files, by directory, narrowing any previewed directory', () => {
  const file = (dir, name) => 'tests/' + dir + '/' + name + '.test.ts'
  const files = [file('a', '1'), file('a', '2'), file('b', '1'), file('c', '1')]
  const nested = 'tests/c/deep/d.test.ts'
  const all = [...files, nested, file('unrelated', '1')].map(item => ({ runner: 'vitest', file: item, names: ['n'] }))
  assert.deepEqual(affectedFilters(files, all), ['tests/a', file('b', '1'), file('c', '1')])
  const workingTree = { stale: true, reasons: [], runWide: [], sourceSetChanged: false }
  const rows = names => names.map(item => ({ file: item, name: 'leaf' }))
  const global = { schemaVersion: 1, ok: true, command: 'runs.tests.affected', data: { run,
    summary: { tests: 5, affected: 4, undetermined: 0, unaffected: 1 }, affected: rows(files.slice(0, 1)), undetermined: [],
    unaffected: [], unaffectedCount: 1, truncated: ['unaffected tests are counted, not listed',
      'the lists keep their first, highest-ranked tests; `--names` lists every one'], workingTree } }
  const response = (filter, names, truncated = []) => ({ schemaVersion: 1, ok: true, command: 'runs.tests.affected', data: {
    run, filter: '--test-file ' + filter, affected: truncated.length ? [] : rows(names), undetermined: [], unaffected: [],
    summary: { tests: names.length, affected: names.length, undetermined: 0, unaffected: 0 }, truncated, workingTree } })
  const query = (id, filters) => filters.map(filter => filter === 'tests/a'
    ? response(filter, files.slice(0, 2), ['the lists keep their first, highest-ranked tests; `--names` lists every one'])
    : response(filter, files.filter(item => item === filter)))
  const expanded = expandIdentities(global, run, { tests: 5, setups: 0 }, files, all, query)
  assert.deepEqual(expanded.data.affected.map(row => row.file).sort(), files)
  // An affected file outside the list surfaces as a count difference, not as less to test.
  const short = structuredClone(global); short.data.summary = { tests: 6, affected: 5, undetermined: 0, unaffected: 1 }
  assert.throws(() => expandIdentities(short, run, { tests: 6, setups: 0 }, files, all, query), /does not reconcile/)
})

test('unsafe changes fail in preflight, before any Supercov process starts', () => {
  const adapter = readFileSync(resolve(__dirname, '../tooling/supercov-related.cjs'), 'utf8')
  const nativeQuery = adapter.indexOf("supercovArgs('runs', seed.runId, 'tests', 'affected', '--json')")
  assert.ok(adapter.indexOf('preflightChanges(changed)') < nativeQuery)
  assert.ok(adapter.indexOf('analyzeAddedSources(changed, seed.runId)') < nativeQuery)
  assert.throws(() => preflightChanges([{ status: 'R100', oldFile: 'src/x.ts', file: 'src/y.ts' }]), /unsafe/)
  assert.throws(() => preflightChanges([{ status: 'M', file: 'public/weapon.glb' }]), /Unsupported asset/)
  assert.doesNotThrow(() => preflightChanges([{ status: 'A', file: 'src/new.ts' }, { status: 'M', file: 'README.md' }]))
  assert.doesNotMatch(adapter, /'--names', '--json'|'--limit'/)
})
