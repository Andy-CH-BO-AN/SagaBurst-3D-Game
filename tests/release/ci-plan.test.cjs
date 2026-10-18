const { test } = require('node:test')
const assert = require('node:assert/strict')
const { selectFiles, shardFiles, validateManifest, changes } = require('../../tools/tests/ci-plan.cjs')
const { dependencyConsumers } = require('../../tools/tests/dependencies.cjs')
const { aggregate } = require('../../tools/tests/ci-run.cjs')
const item = (file, count = 1, runner = 'vitest') => ({ file, runner, names: Array.from({ length: count }, (_, i) => `leaf ${i}`) })
const inventory = [item('tests/movement/NavigationGrid.test.ts', 2), item('tests/career/save.test.ts'), item('tests/persistence/store.test.ts'), item('tests/release/publish.test.cjs', 2, 'node')]
const consumers = {
  'src/navigation/NavigationGrid.ts': [inventory[0].file],
  'tests/helpers/memoryStorage.ts': [inventory[1].file, inventory[2].file],
}
const select = file => selectFiles(inventory, [{ status: 'M', file }], consumers)
const full = files => ({ mode: 'full', inventory: files, selected: files.map(item => item.file), changedFiles: [], shards: shardFiles(files) })

test('production module selects transitive consumers without unrelated equipment suites', () => {
  assert.deepEqual(select('src/navigation/NavigationGrid.ts').selected, [inventory[0].file])
})
test('directly modified test is selected even with no dependency edges', () => {
  assert.deepEqual(select(inventory[1].file).selected, [inventory[1].file])
})
test('shared helper selects consumers across capability directories', () => {
  assert.deepEqual(select('tests/helpers/memoryStorage.ts').selected, [inventory[1].file, inventory[2].file])
})
test('runner changes force Full despite a known subset graph', () => {
  assert.equal(select('tools/tests/run.cjs').mode, 'full')
})
test('strict docs-only produces explicit empty evidence but release notes require tests', () => {
  const plan = select('README.md')
  assert.equal(plan.docsOnly, true)
  assert.deepEqual(plan.selected, [])
  assert.equal(plan.message, 'No related logic tests: documentation-only change')
  assert.equal(select('docs/releases/v1.2.0.md').mode, 'full')
})
test('unmapped code cannot silently pass with zero tests', () => {
  assert.equal(select('src/new-owner.ts').mode, 'full')
})
test('missing or zero base SHA fails closed before diff', () => {
  assert.throws(() => changes('', 'head', 'push'), /Missing base/)
  assert.throws(() => changes('0000000', 'head', 'push'), /Missing base/)
})
test('deleted and renamed paths force Full instead of losing old consumers', () => {
  assert.equal(selectFiles(inventory, [{ status: 'R100', oldFile: 'src/old.ts', file: 'src/new.ts' }], consumers).mode, 'full')
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
test('501 selected leaves split deterministically and never truncate', () => {
  const files = [item('tests/a.test.ts', 250), item('tests/b.test.ts', 250), item('tests/c.test.ts', 1)]
  assert.deepEqual(shardFiles(files), shardFiles([...files].reverse()))
  const plan = validateManifest(full(files))
  assert.deepEqual(plan.shards.map(shard => shard.expectedCount), [500, 1])
  assert.equal(plan.shards.flatMap(shard => shard.vitestFiles).length, 3)
})
test('release code selects Node tests and deduplicates shared consumers', () => {
  const result = selectFiles(inventory, [{ status: 'M', file: 'electron/main.cjs' }, { status: 'M', file: 'tools/release/publish.cjs' }], consumers)
  assert.deepEqual(result.selected, [inventory[3].file])
  assert.equal(result.reasons[inventory[3].file].length, 2)
})
test('aggregate refuses missing, failed and stale shards instead of trusting the last shard', () => {
  const plan = { ...full(inventory), planId: 'current' }
  assert.throws(() => aggregate(plan, []), /shard reports/)
  assert.throws(() => aggregate(plan, [{ shardId: 'logic-1', planId: 'old', result: 'passed' }]), /stale/)
})

test('unresolved dynamic imports force Full even if a static consumer is known', () => {
  assert.equal(selectFiles(inventory, [{ status: 'M', file: 'src/navigation/NavigationGrid.ts' }], { ...consumers, runtimeAmbiguities: ['src/runtime.ts'] }).mode, 'full')
})

test('aggregate accepts more than 500 total leaves across independently valid shards', () => {
  const { createHash } = require('node:crypto')
  const files = [item('tests/a.test.ts', 500), item('tests/b.test.ts', 1)]
  const plan = { ...full(files), planId: 'aggregate-boundary' }
  const planDigest = createHash('sha256').update(JSON.stringify(plan)).digest('hex')
  const summaries = plan.shards.map(shard => ({ planId: plan.planId, planDigest, shardId: shard.id, runId: shard.id, result: 'passed', reports: [{
    runner: 'vitest', runId: shard.id, complete: true, errors: [], files: shard.vitestFiles.map(file => ({ file })),
    cases: files.filter(file => shard.vitestFiles.includes(file.file)).flatMap(file => file.names.map((name, index) => ({ id: `${file.file}:${index}`, file: file.file, name, state: 'passed', ms: 1 }))),
  }] }))
  const result = aggregate(plan, summaries)
  assert.equal(result.count, 501)
  assert.equal(result.shardCount, 2)
})


test('computed import in an ordinary test forces Full when its dynamic owner changes', () => {
  const dynamic = item('tests/foo.test.ts'), staticTest = item('tests/static.test.ts')
  const tests = [dynamic, staticTest]
  const sources = new Map([
    ['tests/foo.test.ts', 'export const load = (owner: string) => import(`../src/${owner}.ts`)'],
    ['tests/static.test.ts', "import { value } from '../src/owner'; export const result = value"],
    ['src/owner.ts', 'export const value = 1'],
  ])
  const graph = dependencyConsumers(tests, sources)
  assert.deepEqual(graph['src/owner.ts'], [staticTest.file])
  const plan = selectFiles(tests, [{ status: 'M', file: 'src/owner.ts' }], graph)
  assert.equal(plan.mode, 'full')
  assert.match(plan.fallback, /tests\/foo\.test\.ts/)
  assert.deepEqual(plan.selected, tests.map(test => test.file))
})
