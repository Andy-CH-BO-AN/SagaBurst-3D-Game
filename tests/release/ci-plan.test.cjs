const { test } = require('node:test')
const assert = require('node:assert/strict')
const { selectFiles, shardFiles, planShards, validateManifest, changes } = require('../../tools/tests/ci-plan.cjs')
const { dependencyConsumers } = require('../../tools/tests/dependencies.cjs')
const { aggregate } = require('../../tools/tests/ci-run.cjs')
const item = (file, count = 1, runner = 'vitest') => ({ file, runner, names: Array.from({ length: count }, (_, i) => `leaf ${i}`) })
const inventory = [
  item('tests/movement/NavigationGrid.test.ts', 2),
  item('tests/career/save.test.ts'),
  item('tests/persistence/store.test.ts'),
  item('tests/release/ci-plan.test.cjs', 2, 'node'),
  item('tests/release/test-budget.test.cjs', 2, 'node'),
  item('tests/release/publish.test.cjs', 2, 'node'),
]
const consumers = {
  'src/navigation/NavigationGrid.ts': [inventory[0].file],
  'src/Game.ts': [inventory[0].file],
  'tests/helpers/memoryStorage.ts': [inventory[1].file, inventory[2].file],
}
const select = file => selectFiles(inventory, [{ status: 'M', file }], consumers)
const full = files => ({ mode: 'full', inventory: files, selected: files.map(item => item.file), changedFiles: [], shards: shardFiles(files) })

test('production module selects transitive consumers without unrelated equipment suites', () => {
  assert.deepEqual(select('src/navigation/NavigationGrid.ts').selected, [inventory[0].file])
  const previewOwners = ['tests/missions/TownSiegePolicy.test.ts', 'tests/missions/SiegeRampPolicy.test.ts',
    'tests/persistence/TownSiegeRosterPersistence.test.ts', 'tests/movement/NavigationWorld.test.ts',
    'tests/combat/ProjectileBallistics.test.ts']
  const preview = selectFiles([...inventory, ...previewOwners.map(file => item(file))],
    [{ status: 'M', file: 'src/debug/TownFourGateSiegePreview.ts' }], consumers)
  assert.equal(preview.mode, 'related')
  assert.deepEqual(preview.selected, previewOwners.sort())
  const entryOwners = ['tests/town/CareerTownEntry.test.ts', 'tests/missions/CareerMissionRecovery.test.ts',
    'tests/integration/MissionModeRouting.test.ts']
  const entry = selectFiles([...inventory, ...entryOwners.map(file => item(file))],
    [{ status: 'M', file: 'src/main.ts' }], consumers)
  assert.equal(entry.mode, 'related')
  assert.deepEqual(entry.selected, entryOwners.sort())


})
test('high fan-out production owner stays Related instead of forcing repository Full', () => {
  const plan = select('src/Game.ts')
  assert.equal(plan.mode, 'related')
  assert.deepEqual(plan.selected, [inventory[0].file])
})
test('directly modified test is selected even with no dependency edges', () => {
  assert.deepEqual(select(inventory[1].file).selected, [inventory[1].file])
})
test('shared helper selects consumers across capability directories', () => {
  assert.deepEqual(select('tests/helpers/memoryStorage.ts').selected, [inventory[1].file, inventory[2].file])
})
test('test runner and workflow changes select dedicated CI contracts without Full fallback', () => {
  const expected = ['tests/release/ci-plan.test.cjs', 'tests/release/test-budget.test.cjs']
  assert.deepEqual(select('tools/tests/run.cjs').selected, expected)
  assert.deepEqual(select('.github/workflows/ci.yml').selected, expected)
})
test('strict docs-only produces explicit empty evidence but release notes select Node publication contracts', () => {
  const plan = select('README.md')
  assert.equal(plan.docsOnly, true)
  assert.deepEqual(plan.selected, [])
  assert.equal(plan.message, 'No related logic tests: documentation-only change')
  assert.deepEqual(select('docs/releases/v1.2.0.md').selected, inventory.filter(item => item.runner === 'node').map(item => item.file).sort())
})
test('unmapped code fails Related planning instead of silently running Full', () => {
  assert.throws(() => select('src/new-owner.ts'), /Related selection is unsafe.*Unmapped/)
})
test('missing or zero base SHA fails closed before diff', () => {
  assert.throws(() => changes('', 'head', 'push'), /Missing base/)
  assert.throws(() => changes('0000000', 'head', 'push'), /Missing base/)
})
test('deleted and renamed paths fail Related planning instead of losing old consumers', () => {
  assert.throws(() => selectFiles(inventory, [{ status: 'R100', oldFile: 'src/old.ts', file: 'src/new.ts' }], consumers), /Removed\/renamed/)
})
test('Full completeness rejects omissions and duplicate file assignments', () => {
  const plan = full(inventory)
  validateManifest(plan)
  const missing = structuredClone(plan)
  missing.shards[0].vitestFiles.pop()
  assert.throws(() => validateManifest(missing), /Missing/)
  const duplicate = structuredClone(plan)
  duplicate.shards[0].vitestFiles.push(inventory[0].file)
  assert.throws(() => validateManifest(duplicate), /duplicate/)
})
test('Full 501-leaf inventory splits deterministically and never truncates', () => {
  const files = [item('tests/a.test.ts', 250), item('tests/b.test.ts', 250), item('tests/c.test.ts', 1)]
  assert.deepEqual(shardFiles(files), shardFiles([...files].reverse()))
  const plan = validateManifest(full(files))
  assert.deepEqual(plan.shards.map(shard => shard.expectedCount), [500, 1])
  assert.equal(plan.shards.flatMap(shard => shard.vitestFiles).length, 3)
})
test('Related selection has one aggregate 500-leaf limit and cannot open a second shard', () => {
  const within = [item('tests/a.test.ts', 250), item('tests/b.test.ts', 250)]
  assert.deepEqual(planShards(within, 'related').map(shard => [shard.id, shard.expectedCount]), [['logic-related', 500]])
  assert.throws(() => planShards([...within, item('tests/c.test.ts', 1)], 'related'), /entire Related CI run is limited to 500/)
})
test('release code selects Node tests once and deduplicates shared consumers', () => {
  const result = selectFiles(inventory, [{ status: 'M', file: 'electron/main.cjs' }, { status: 'M', file: 'tools/release/publish.cjs' }], consumers)
  assert.deepEqual(result.selected, inventory.filter(item => item.runner === 'node').map(item => item.file).sort())
  assert.equal(result.reasons['tests/release/publish.test.cjs'].length, 2)
})
test('aggregate refuses missing, failed and stale shards instead of trusting the last shard', () => {
  const plan = { ...full(inventory), planId: 'current' }
  assert.throws(() => aggregate(plan, []), /shard reports/)
  assert.throws(() => aggregate(plan, [{ shardId: 'logic-1', planId: 'old', result: 'passed' }]), /stale/)
})
test('unresolved dynamic imports fail Related planning instead of expanding to Full', () => {
  assert.throws(() => selectFiles(inventory, [{ status: 'M', file: 'src/navigation/NavigationGrid.ts' }], { ...consumers, runtimeAmbiguities: ['src/runtime.ts'] }), /Unresolved runtime imports/)
})
test('aggregate accepts more than 500 total leaves only for independently valid Full shards', () => {
  const { createHash } = require('node:crypto')
  const files = [item('tests/a.test.ts', 500), item('tests/b.test.ts', 1)]
  const plan = { ...full(files), planId: 'aggregate-boundary' }
  const planDigest = createHash('sha256').update(JSON.stringify(plan)).digest('hex')
  const summaries = plan.shards.map(shard => ({ planId: plan.planId, planDigest, shardId: shard.id, runId: shard.id, result: 'passed', reports: [{
    runner: 'vitest', runId: shard.id, complete: true, errors: [], files: shard.vitestFiles.map(file => ({ file })),
    cases: files.filter(file => shard.vitestFiles.includes(file.file)).flatMap(file => file.names.map((name, index) => ({ id: `${file.file}:${index}`, file: file.file, name, state: 'passed', ms: 1 }))),
  }] }))
  const log = console.log
  console.log = () => {}
  try {
    const result = aggregate(plan, summaries)
    assert.equal(result.count, 501)
    assert.equal(result.shardCount, 2)
  } finally {
    console.log = log
  }
})
test('computed import in an ordinary test blocks Related selection when its owner changes', () => {
  const dynamic = item('tests/foo.test.ts'), staticTest = item('tests/static.test.ts')
  const tests = [dynamic, staticTest]
  const sources = new Map([
    ['tests/foo.test.ts', 'export const load = (owner: string) => import(`../src/${owner}.ts`)'],
    ['tests/static.test.ts', "import { value } from '../src/owner'; export const result = value"],
    ['src/owner.ts', 'export const value = 1'],
  ])
  const graph = dependencyConsumers(tests, sources)
  assert.deepEqual(graph['src/owner.ts'], [staticTest.file])
  assert.throws(() => selectFiles(tests, [{ status: 'M', file: 'src/owner.ts' }], graph), /tests\/foo\.test\.ts/)
})
