'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { decodeAffected } = require('../tooling/supercov-related.cjs')
const { planShards } = require('../tooling/ci-plan.cjs')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
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
    answer({ affected: [leaf('suite > absent')] }),
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
  assert.match(script, /valid !== true/)
  assert.match(script, /complete !== true/)
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

test('manual dev bootstrap has an explicit opt-in and repository-wide artifact transport', () => {
  const ci = readFileSync(resolve(__dirname, '../../.github/workflows/ci.yml'), 'utf8')
  const workflow = readFileSync(resolve(__dirname, '../../.github/workflows/logic-tests.yml'), 'utf8')
  const bootstrap = readFileSync(resolve(__dirname, '../tooling/supercov-bootstrap-dev.cjs'), 'utf8')
  const artifact = readFileSync(resolve(__dirname, '../tooling/supercov-evidence.cjs'), 'utf8')
  assert.match(ci, /github\.ref == 'refs\/heads\/ci\/supercov-per-test-impact-poc'/)
  assert.match(ci, /bootstrap-dev-seed:/)
  assert.match(ci, /ref: dev/)
  assert.match(ci, /supercov-bootstrap-dev\.cjs source/)
  assert.match(ci, /supercov-seed-.*steps\.dev\.outputs\.sha/)
  assert.match(bootstrap, /refs\/remotes\/origin\/dev/)
  assert.match(bootstrap, /--mode', 'full'/)
  assert.match(bootstrap, /'merge', \.\.\.runs/)
  assert.doesNotMatch(bootstrap, /'merge', '--allow-changed'/)
  assert.match(workflow, /GH_TOKEN:/)
  assert.match(workflow, /supercov-evidence\.cjs restore/)
  assert.match(workflow, /name: supercov-seed-/)
  // Git ancestry is enforced behaviorally by the P1 test below, not by matching an implementation string.
  assert.match(artifact, /workflow\.conclusion !== 'success'/)
  assert.match(artifact, /No PR\/dev TEST_BASE ancestor Full\/strict-Related seed artifact/)
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
    head_branch: 'ci/supercov-per-test-impact-poc' }, sha), true)
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
  assert.match(docs, /Pre-merge acceptance/)
  assert.match(docs, /Post-merge rollout confirmation/)
  assert.match(docs, /isolated worktree\/acceptance/)
  assert.match(docs, /two consecutive actual push→dev/)
})
