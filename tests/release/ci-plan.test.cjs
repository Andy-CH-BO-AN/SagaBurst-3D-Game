const { test } = require('node:test')
const assert = require('node:assert/strict')
const { selectFiles, selectionSummary, shardFiles, planShards, validateManifest, changes } = require('../tooling/ci-plan.cjs')
const { dependencyConsumers, dependencyPlacementOnly, relocationOnly } = require('../tooling/dependencies.cjs')
const { aggregate } = require('../tooling/ci-run.cjs')
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

test('production module selects actual transitive consumers, never implicit filename owners', () => {
  const files = [item('tests/route.test.ts'), item('tests/unrelated.test.ts')]
  const sources = new Map([
    ['src/route.ts', 'export const route = 1'],
    ['src/caller.ts', "export { route } from './route'"],
    ['tests/route.test.ts', "import { route } from '../src/caller'; route"],
    ['tests/unrelated.test.ts', 'export const unrelated = 0'],
  ])
  const graph = dependencyConsumers(files, sources)
  assert.deepEqual(selectFiles(files, [{ status: 'M', file: 'src/route.ts' }], graph).selected, ['tests/route.test.ts'])
  assert.throws(() => selectFiles(files, [{ status: 'M', file: 'src/debug/Preview.ts' }], graph), /Unmapped/)
  assert.throws(() => selectFiles(files, [{ status: 'M', file: 'src/main.ts' }], graph), /Unmapped/)
})
test('high fan-out production owner stays Related instead of forcing repository Full', () => {
  const plan = select('src/Game.ts')
  assert.equal(plan.mode, 'related')
  assert.deepEqual(plan.selected, [inventory[0].file])
})
test('directly modified test is selected even with no dependency edges', () => {
  assert.deepEqual(select(inventory[1].file).selected, [inventory[1].file])
  assert.deepEqual(select('tests/release/ci-plan.test.cjs').selected, ['tests/release/ci-plan.test.cjs'])
  assert.deepEqual(select('tests/release/publish.test.cjs').selected, ['tests/release/publish.test.cjs'])
})
test('shared helper selects consumers across capability directories', () => {
  assert.deepEqual(select('tests/helpers/memoryStorage.ts').selected, [inventory[1].file, inventory[2].file])
})
test('runner imports and actual workflow reads select only their consumers without Full fallback', () => {
  const files = [item('tests/runner.test.cjs', 1, 'node'), item('tests/config.test.cjs', 1, 'node'), item('tests/unrelated.test.cjs', 1, 'node')]
  const sources = new Map([
    ['tests/runner.test.cjs', "require('./tooling/run.cjs')"],
    ['tests/config.test.cjs', "const { readFileSync } = require('node:fs'); readFileSync('.github/workflows/ci.yml', 'utf8')"],
    ['tests/tooling/run.cjs', 'module.exports = 1'],
    ['tests/unrelated.test.cjs', 'module.exports = 0'],
  ])
  const paths = new Set([...sources.keys(), '.github/workflows/ci.yml'])
  const graph = dependencyConsumers(files, sources, file => paths.has(file), { files: paths })
  for (const [changed, expected] of [['tests/tooling/run.cjs', 'tests/runner.test.cjs'], ['.github/workflows/ci.yml', 'tests/config.test.cjs']]) {
    const plan = selectFiles(files, [{ status: 'M', file: changed }], graph)
    assert.equal(plan.mode, 'related')
    assert.deepEqual(plan.selected, [expected])
  }
})
test('documentation has empty evidence unless an actual runtime reader consumes it', () => {
  const plan = select('README.md')
  assert.equal(plan.docsOnly, true)
  assert.deepEqual(plan.selected, [])
  assert.equal(plan.message, 'No related logic tests: documentation-only change')
  assert.equal(select('docs/releases/v1.2.0.md').docsOnly, true)
  const files = [item('tests/notes.test.cjs', 1, 'node'), item('tests/unrelated.test.cjs', 1, 'node')]
  const sources = new Map([['tests/notes.test.cjs', "require('node:fs').readFileSync('docs/releases/v1.2.0.md', 'utf8')"]])
  const paths = new Set([...sources.keys(), 'docs/releases/v1.2.0.md'])
  const graph = dependencyConsumers(files, sources, file => paths.has(file), { files: paths })
  assert.deepEqual(selectFiles(files, [{ status: 'M', file: 'docs/releases/v1.2.0.md' }], graph).selected, ['tests/notes.test.cjs'])
  const dynamicSources = new Map([['tests/notes.test.cjs', "require('node:fs').readFileSync(runtimePath, 'utf8')"]])
  const dynamicGraph = dependencyConsumers(files, dynamicSources, file => paths.has(file), { files: paths })
  assert.throws(() => selectFiles(files, [{ status: 'M', file: 'docs/releases/v1.2.0.md' }], dynamicGraph, {
    sources: dynamicSources, previousSources: dynamicSources, previousConsumers: dynamicGraph,
    files: paths, previousFiles: paths, texts: dynamicSources, previousTexts: dynamicSources, ranges: {},
    compilerOptions: { noLib: true, noResolve: true, types: [] },
  }), error => {
    assert.match(error.message, /Unsafe runtime input:.*runtimePath/)
    assert.ok(error.cause instanceof Error)
    assert.match(error.cause.stack, /behavior\.cjs/)
    assert.equal(error.cause.message.includes('Related selection is unsafe:'), false)
    return true
  })
  const unusedSources = new Map([
    ['src/reader.ts', `import {readFileSync} from 'node:fs'; export const marker=1;
export function read(file: string) { return readFileSync(file, 'utf8') }`],
    ['tests/notes.test.cjs', `const reader=require('../src/reader');
test('marker', () => reader.marker)`],
  ])
  const unusedFiles = new Set([...unusedSources.keys(), 'docs/releases/v1.2.0.md'])
  const unusedGraph = dependencyConsumers(files, unusedSources, file => unusedFiles.has(file), { files: unusedFiles })
  const unused = selectFiles([{ ...files[0], locations: [{ line: 2 }] }], [{ status: 'M', file: 'docs/releases/v1.2.0.md' }], unusedGraph, {
    sources: unusedSources, previousSources: unusedSources, previousConsumers: unusedGraph,
    files: unusedFiles, previousFiles: unusedFiles, texts: unusedSources, previousTexts: unusedSources, ranges: {},
    compilerOptions: { noLib: true, noResolve: true, types: [] },
  })
  assert.equal(unused.docsOnly, true)
  assert.deepEqual(unused.selected, [])
  assert.deepEqual(unused.unobservedInputCandidates, ['docs/releases/v1.2.0.md'])
  const untested = dependencyConsumers([], sources, file => paths.has(file), { files: paths })
  assert.throws(() => selectFiles([], [{ status: 'M', file: 'docs/releases/v1.2.0.md' }], untested), /Unmapped code\/runtime input/)
})
test('unmapped code fails Related planning instead of silently running Full', () => {
  assert.throws(() => select('src/new-owner.ts'), /Related selection is unsafe.*Unmapped/)
})
test('missing or zero base SHA fails closed before diff', () => {
  assert.throws(() => changes('', 'head', 'push'), /Missing base/)
  assert.throws(() => changes('0000000', 'head', 'push'), /Missing base/)
})
test('removed and renamed paths require trustworthy base dependency evidence', () => {
  assert.throws(() => selectFiles(inventory, [{ status: 'R100', oldFile: 'src/old.ts', file: 'src/new.ts' }], consumers), /Missing base dependency graph/)
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
test('release code selects actual Node consumers once and deduplicates shared consumers', () => {
  const files = [item('tests/release/ship.test.cjs', 1, 'node'), item('tests/release/unrelated.test.cjs', 1, 'node')]
  const sources = new Map([
    ['tests/release/ship.test.cjs', "require('../../electron/main.cjs'); require('../../.github/scripts/release/publish.cjs')"],
    ['electron/main.cjs', 'module.exports = 1'],
    ['.github/scripts/release/publish.cjs', 'module.exports = 2'],
  ])
  const graph = dependencyConsumers(files, sources)
  const result = selectFiles(files, [{ status: 'M', file: 'electron/main.cjs' }, { status: 'M', file: '.github/scripts/release/publish.cjs' }], graph)
  assert.deepEqual(result.selected, ['tests/release/ship.test.cjs'])
  assert.equal(result.reasons['tests/release/ship.test.cjs'].length, 2)
  assert.throws(() => selectFiles(files, [{ status: 'M', file: '.github/scripts/release/unread.cjs' }], graph), /Unmapped/)
})
test('aggregate refuses missing, failed and stale shards instead of trusting the last shard', () => {
  const plan = { ...full(inventory), planId: 'current' }
  assert.throws(() => aggregate(plan, []), /shard reports/)
  assert.throws(() => aggregate(plan, [{ shardId: 'logic-1', planId: 'old', result: 'passed' }]), /stale/)
  const { assertPlanCheckout } = require('../tooling/ci-run.cjs')
  const strict = { ...plan, checkoutSha: 'tested', comparison: { afterSha: 'tested' } }
  assert.doesNotThrow(() => assertPlanCheckout(strict, { sha: 'tested', dirty: false }))
  assert.throws(() => assertPlanCheckout(strict, { sha: 'tested', dirty: true }), /Dirty/)
  assert.throws(() => assertPlanCheckout(strict, { sha: 'other', dirty: false }), /Stale/)
  const development = { ...plan, checkoutSha: 'tested' }
  assert.doesNotThrow(() => assertPlanCheckout(development, { sha: 'tested', dirty: true }))
  assert.throws(() => assertPlanCheckout(development, { sha: 'other', dirty: false }), /Stale/)
})
test('unresolved dynamic imports fail Related planning instead of expanding to Full', () => {
  assert.throws(() => selectFiles(inventory, [{ status: 'M', file: 'src/navigation/NavigationGrid.ts' }], { ...consumers, 'src/runtime.ts': [inventory[0].file], runtimeAmbiguities: ['src/runtime.ts'] }), /Unresolved runtime imports/)
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
test('lightweight enum import does not select suites; real runtime import chain is explained', () => {
  const sources = new Map([
    ['src/world/NpcAIType.ts', 'export enum AIType { MELEE = "MELEE" }'],
    ['src/world/NPC.ts', 'import { Route } from "../navigation/Route"\nexport { AIType } from "./NpcAIType"\nexport class NPC { route = Route }'],
    ['src/navigation/Route.ts', 'export const Route = 1'],
    ['src/battle/BattleConfig.ts', 'import { AIType } from "../world/NpcAIType"\nexport const config = AIType'],
    ['tests/missions/BattleConfig.test.ts', 'import { config } from "../../src/battle/BattleConfig"\nconfig'],
    ['tests/actors/Spawner.test.ts', 'import { NPC } from "../../src/world/NPC"\nNPC'],
  ])
  const files = [item('tests/missions/BattleConfig.test.ts', 3), item('tests/actors/Spawner.test.ts', 2)]
  const graph = dependencyConsumers(files, sources)
  const plan = selectFiles(files, [{ status: 'M', file: 'src/navigation/Route.ts' }], graph)
  assert.deepEqual(plan.selected, ['tests/actors/Spawner.test.ts'])
  assert.deepEqual(plan.details['tests/actors/Spawner.test.ts'].map(({ changed, source, chain }) => ({ changed, source, chain })), [{ changed: 'src/navigation/Route.ts', source: 'Static Runtime Dependency',
    chain: ['tests/actors/Spawner.test.ts', 'src/world/NPC.ts', 'src/navigation/Route.ts'] }])
  const text = selectionSummary({ mode: 'related', baseSha: 'b', headSha: 'h', changedFiles: ['src/navigation/Route.ts'], inventory: files, shards: [], ...plan })
  assert.match(text, /Selected: 1 files \/ 2 cases/)
  assert.match(text, /Reasons:/)
  assert.match(text, /Budget: 2 \/ 500/)
})

test('computed imports retain uncertainty without collector filename exemptions', () => {
  const sources = new Map([
    ['tests/tooling/node-collect.cjs', 'require(resolve(file))'],
    ['tests/tooling/unowned.cjs', 'require(resolve(file))'],
    ['tests/ordinary.test.cjs', 'require(resolve(file))'],
    ['.github/scripts/release/publish.cjs', 'require(selectedModule)'],
  ])
  const graph = dependencyConsumers(inventory, sources)
  assert.deepEqual(graph.runtimeAmbiguities, [...sources.keys()])
  sources.set('tests/tooling/node-collect.cjs', 'require(resolve(otherFile))')
  assert.ok(dependencyConsumers(inventory, sources).runtimeAmbiguities.includes('tests/tooling/node-collect.cjs'))
})

// Separate snapshots deliberately avoid resolving old imports against checkout.
function lifecycle(before, after, changes, discovered) {
  const oldSources = new Map(before), sources = new Map(after)
  const files = discovered ?? [...sources.keys()].filter(file => /\.test\.[ct]s$/.test(file)).map(file => item(file))
  const oldTests = [...oldSources.keys()].filter(file => /\.test\.[ct]s$/.test(file)).map(file => item(file))
  const previousConsumers = dependencyConsumers(oldTests, oldSources)
  const evidence = { previousConsumers, previousFiles: new Set(oldSources.keys()), previousTexts: oldSources, files: new Set(sources.keys()),
    sources, previousSources: oldSources, texts: sources, ranges: {} }
  return selectFiles(files, changes, dependencyConsumers(files, sources), evidence)
}
test('rename plus edit unions base and head owners and follows renamed tests, not unrelated suites', () => {
  const before = [
    ['src/old.ts', 'export const value = 1'],
    ['tests/moved.test.ts', "import { value } from '../src/old'; value"],
    ['tests/former.test.ts', "import { value } from '../src/old'; value"],
    ['tests/unrelated.test.ts', 'export const value = 0'],
  ]
  const after = [
    ['src/new.ts', 'export const value = 2'],
    ['tests/renamed.test.ts', "import { value } from '../src/new'; value"],
    ['tests/former.test.ts', 'export const value = 0'],
    ['tests/unrelated.test.ts', 'export const value = 0'],
  ]
  const plan = lifecycle(before, after, [
    { status: 'R080', oldFile: 'src/old.ts', file: 'src/new.ts' },
    { status: 'R090', oldFile: 'tests/moved.test.ts', file: 'tests/renamed.test.ts' },
  ])
  assert.deepEqual(plan.selected, ['tests/former.test.ts', 'tests/renamed.test.ts'])
  assert.deepEqual(plan.details['tests/former.test.ts'][0].chain, ['tests/former.test.ts', 'src/old.ts'])
  assert.equal(plan.details['tests/former.test.ts'][0].source, 'Base Runtime Dependency')
})
test('deletion keeps surviving old consumers but never executes removed test files', () => {
  const before = [
    ['src/removed.ts', 'export const value = 1'],
    ['tests/stays.test.ts', "import { value } from '../src/removed'; value"],
    ['tests/removed.test.ts', "import { value } from '../src/removed'; value"],
  ]
  const after = [['tests/stays.test.ts', 'export const value = 0']]
  const plan = lifecycle(before, after, [{ status: 'D', file: 'src/removed.ts' }, { status: 'D', file: 'tests/removed.test.ts' }])
  assert.deepEqual(plan.selected, ['tests/stays.test.ts'])
  assert.deepEqual(plan.retiredFiles, ['tests/removed.test.ts'])
  assert.throws(() => lifecycle(before, after, [{ status: 'D', file: 'src/removed.ts' }]), /Base test owner is not in current discovery/)
})
test('orphan input retirement is explicit empty evidence; surviving unmapped references fail closed', () => {
  const plan = lifecycle([['scripts/obsolete.py', 'print(1)']], [], [{ status: 'D', file: 'scripts/obsolete.py' }])
  assert.deepEqual(plan.retiredFiles, ['scripts/obsolete.py'])
  validateManifest({ inventory: [], changedFiles: ['scripts/obsolete.py'], shards: [], ...plan })
  const before = [['src/dead.ts', 'export const value = 1'], ['src/caller.ts', "import { value } from './dead'; value"]]
  const after = [['src/caller.ts', 'export const value = 0']]
  assert.throws(() => lifecycle(before, after, [{ status: 'D', file: 'src/dead.ts' }]), /surviving references: src\/caller.ts/)
  assert.throws(() => lifecycle([['tools/target.cjs', 'module.exports = 1']], [['tools/runner.cjs', "const path = './' + 'target' + '.cjs'; require(path)"]], [{ status: 'D', file: 'tools/target.cjs' }]), /surviving references: tools\/runner.cjs/)
  assert.throws(() => lifecycle([['public/old.svg', '<svg/>']], [['index.html', '<img src="/old.svg">']], [{ status: 'D', file: 'public/old.svg' }]), /surviving references: index.html/)
  assert.throws(() => lifecycle([['scripts/dead.py', 'print(1)']], [['Makefile', 'python scripts/dead.py']], [{ status: 'D', file: 'scripts/dead.py' }]), /surviving references: Makefile/)
  assert.throws(() => lifecycle([['scripts/dead.py', 'print(1)']], [['scripts/caller.py', 'import dead']], [{ status: 'D', file: 'scripts/dead.py' }]), /surviving references: scripts\/caller.py/)
  assert.throws(() => lifecycle([['scripts/dead.py', 'print(1)']], [['package.json', '{"scripts":{"check":"python scripts/dead.py"}}']], [{ status: 'D', file: 'scripts/dead.py' }]), /surviving references: package.json/)
})
test('dangling relative imports fail closed while Vite query imports retain their dependency', () => {
  const before = [['src/old.ts', 'export const value = 1'], ['tests/owner.test.ts', "import { value } from '../src/old'; value"]]
  assert.throws(() => lifecycle(before, [before[1]], [{ status: 'D', file: 'src/old.ts' }]), /Unresolved runtime dependencies.*src\/old/)
  const sources = new Map([['src/raw.ts', 'export const value = 1'], ['tests/raw.test.ts', "import text from '../src/raw.ts?raw'; text"]])
  assert.deepEqual(dependencyConsumers([item('tests/raw.test.ts')], sources)['src/raw.ts'], ['tests/raw.test.ts'])
})
test('native candidates omit only proven relocation or dependency placement, never installed graph or config behavior edits', () => {
  const changes = [{ status: 'R100', oldFile: 'scripts/old/run.cjs', file: 'checks/new/run.cjs' }]
  const base = new Set(['scripts/old/run.cjs']), head = new Set(['checks/new/run.cjs'])
  const before = '{"scripts":{"test":"node scripts/old/run.cjs --strict"},"dependencies":{"owner":"1"}}'
  const after = '{"scripts":{"test":"node checks/new/run.cjs --strict"},"dependencies":{"owner":"1"}}'
  const project = (old, next, files = head, input = 'package.json') => relocationOnly(old, next, changes, base, files, input)
  assert.equal(project(before, after), true)
  assert.equal(project(before, after.replace('--strict', '--loose')), false)
  assert.equal(project(before.replace(' --strict', '*'), after.replace(' --strict', '*')), false)
  assert.equal(project(before.replace(' --strict', '${SUFFIX}'), after.replace(' --strict', '${SUFFIX}')), false)
  assert.equal(project(before, after.replace('"owner":"1"', '"owner":"2"')), false)
  const config = "defineConfig({test: {exclude: ['scripts/old/**'], reporters: ['./scripts/old/run.cjs']}})"
  const moved = config.replaceAll('scripts/old', 'checks/new')
  assert.equal(project(config, moved, head, 'vitest.config.ts'), true)
  assert.equal(project(config, moved, new Set([...head, 'checks/new/extra.test.ts']), 'vitest.config.ts'), false)
  assert.equal(project(config, moved, new Set([...head, 'scripts/old/replacement.cjs']), 'vitest.config.ts'), false)
  const behavior = "defineConfig({test: {env: {APP_MODE: 'scripts/old/run.cjs'}}})"
  assert.equal(project(behavior, behavior.replace('scripts/old', 'checks/new'), head, 'vitest.config.ts'), false)
  assert.equal(project(before.replace('node scripts', 'node prefixscripts'), after.replace('node checks', 'node prefixchecks')), false)
  const original = { name: 'fixture', scripts: { test: 'node tests/run.cjs' }, dependencies: { renderer: '1', browser: '2' }, devDependencies: { runner: '3' } }
  const relocated = { ...original, dependencies: { renderer: '1' }, devDependencies: { runner: '3', browser: '2' } }
  const lock = { lockfileVersion: 3, packages: {
    '': { name: 'fixture', dependencies: original.dependencies, devDependencies: original.devDependencies },
    'node_modules/renderer': { version: '1', resolved: 'registry/renderer', integrity: 'renderer' },
    'node_modules/browser': { version: '2', resolved: 'registry/browser', integrity: 'browser', dependencies: { core: '2' } },
    'node_modules/core': { version: '2', resolved: 'registry/core', integrity: 'core', optional: true },
    'node_modules/runner': { version: '3', resolved: 'registry/runner', integrity: 'runner', dev: true },
  } }
  const placedLock = structuredClone(lock)
  Object.assign(placedLock.packages[''], { dependencies: relocated.dependencies, devDependencies: relocated.devDependencies })
  placedLock.packages['node_modules/browser'].dev = true
  placedLock.packages['node_modules/core'].dev = true
  const proof = (pkg = relocated, nextLock = placedLock, prior = original, priorLock = lock) =>
    dependencyPlacementOnly(...[prior, pkg, priorLock, nextLock].map(value => JSON.stringify(value)))
  assert.equal(proof(), true)
  assert.equal(proof(original, lock), false)
  assert.equal(proof(original, lock, relocated, placedLock), false)
  for (const change of [
    pkg => { pkg.devDependencies.browser = '2.1' },
    pkg => { pkg.scripts.test += ' --changed' },
    pkg => { pkg.dependencies.extra = '1' },
    pkg => { delete pkg.devDependencies.runner },
    pkg => { pkg.dependencies.browser = '2' },
    pkg => { pkg.optionalDependencies = { browser: '2' } },
  ]) {
    const changed = structuredClone(relocated); change(changed)
    assert.equal(proof(changed), false)
  }
  for (const change of [
    data => { data.packages['node_modules/browser'].version = '2.1' },
    data => { data.packages['node_modules/browser'].resolved += '/other' },
    data => { data.packages['node_modules/browser'].integrity = 'other' },
    data => { data.packages['node_modules/core'].optional = false },
    data => { data.packages['node_modules/runner'].dev = false },
    data => { data.packages['node_modules/extra'] = { version: '1' } },
    data => { delete data.packages['node_modules/core'] },
    data => { data.packages[''].devDependencies.browser = '2.1' },
    data => { data.requires = true },
  ]) {
    const changed = structuredClone(placedLock); change(changed)
    assert.equal(proof(relocated, changed), false)
  }
  assert.equal(dependencyPlacementOnly('{}', '{', '{}', '{}'), false)
  assert.equal(dependencyPlacementOnly(JSON.stringify(original), JSON.stringify(relocated), JSON.stringify(lock), undefined), false)
})

test('behavior edits retain base ownership when its test is renamed', () => {
  const before = new Map([
    ['src/owner.ts', 'export function value() {\n return 1\n}'],
    ['tests/old.test.ts', "import { value } from '../src/owner'\ntest('value', () => value())"],
  ])
  const after = new Map([
    ['src/owner.ts', 'export function value() {\n return 2\n}'],
    ['tests/new.test.ts', before.get('tests/old.test.ts')],
  ])
  const inventory = [{ ...item('tests/new.test.ts'), locations: [{ line: 2, column: 1 }] }]
  const prior = dependencyConsumers([item('tests/old.test.ts')], before)
  const plan = selectFiles(inventory, [{ status: 'M', file: 'src/owner.ts' },
    { status: 'R100', oldFile: 'tests/old.test.ts', file: 'tests/new.test.ts' }], dependencyConsumers(inventory, after), {
    sources: after, previousSources: before, previousConsumers: prior,
    previousFiles: new Set(before.keys()), previousTexts: before, files: new Set(after.keys()), texts: after,
    ranges: { 'src/owner.ts': [[[2, 1]], [[2, 1]]] }, compilerOptions: { noLib: true, noResolve: true, types: [] },
  })
  assert.deepEqual(plan.selected, ['tests/new.test.ts'])
  assert.ok(plan.changedBehaviors.some(name => name.endsWith('#value')))
})

test('behavior explanations reuse leaf paths without sharing roots or reachability', () => {
  const { behaviorGraph } = require('../tooling/behavior.cjs')
  const sources = new Map([
    ['src/owner.ts', `export function first() { return 1 }
export function second() { return 2 }
export function both() { return first() + second() }`],
    ['tests/owner.test.ts', `import { both, first } from '../src/owner'
test('both', () => both())
test('single', () => first())`],
  ])
  const graph = behaviorGraph(sources, dependencyConsumers([], sources).graph,
    { noLib: true, noResolve: true, types: [] })
  const id = label => [...graph.nodes.values()].find(node => node.label === label).id
  const roots = graph.caseRoots('tests/owner.test.ts', { line: 2 })
  const reached = graph.reachable(roots, 'tests/owner.test.ts')
  let traversals = 0
  for (const node of graph.nodes.values()) {
    const edges = node.edges
    node.edges = { *[Symbol.iterator]() { traversals++; yield* edges } }
  }
  const first = graph.explain(roots, reached, id('first'))
  assert.deepEqual([...first], [
    { file: 'tests/owner.test.ts', behavior: '<callback>', line: 2, root: true },
    { file: 'src/owner.ts', behavior: 'both', line: 3, evidence: 'callable provenance',
      callsite: { file: 'tests/owner.test.ts', start: sources.get('tests/owner.test.ts').indexOf('both()') } },
    { file: 'src/owner.ts', behavior: 'first', line: 1, evidence: 'callable provenance',
      callsite: { file: 'src/owner.ts', start: sources.get('src/owner.ts').indexOf('first() +') } },
  ])
  assert.equal(first.conservative, false)
  const afterFirst = traversals
  assert.deepEqual([...graph.explain(roots, reached, id('second'))],
    [
      { file: 'tests/owner.test.ts', behavior: '<callback>', line: 2, root: true },
      { file: 'src/owner.ts', behavior: 'both', line: 3, evidence: 'callable provenance',
      callsite: { file: 'tests/owner.test.ts', start: sources.get('tests/owner.test.ts').indexOf('both()') } },
      { file: 'src/owner.ts', behavior: 'second', line: 2, evidence: 'callable provenance',
        callsite: { file: 'src/owner.ts', start: sources.get('src/owner.ts').indexOf('second() }') } },
    ])
  assert.equal(traversals, afterFirst, 'sibling targets reuse the same shortest-path tree')
  const limited = new Set(reached)
  limited.delete(id('second'))
  assert.deepEqual(graph.explain(roots, limited, id('second')), [])
  const single = graph.caseRoots('tests/owner.test.ts', { line: 3 })
  assert.deepEqual(graph.explain(single, graph.reachable(single, 'tests/owner.test.ts'), id('second')), [])
})

test('PR comparison uses the verified target parent, excluding target-only behavior but retaining merge resolution', () => {
  const { comparisonLineage } = require('../tooling/git-snapshots.cjs')
  const { declarationSnapshot, changedDeclarations } = require('../tooling/behavior-changes.cjs')
  const ts = require('typescript')
  const scope = comparisonLineage({ event: 'pull_request', base: 'event-base', head: 'pr-head',
    checkout: 'tested-merge', parents: ['target-parent', 'pr-head'], intentBase: 'common-base', targetDescendsFromEventBase: true })
  const trees = {
    'event-base': 'class Owner { A() { return 0 } B() { return 0 } C() { return 0 } }',
    'target-parent': 'class Owner { A() { return 0 } B() { return 1 } C() { return 0 } }',
    'tested-merge': 'class Owner { A() { return 1 } B() { return 1 } C() { return 2 } }',
  }
  const declarations = sha => {
    const sf = ts.createSourceFile('src/owner.ts', trees[sha], ts.ScriptTarget.Latest, true)
    const ids = new Map(sf.statements[0].members.map(member => [member, member.name.text]))
    return declarationSnapshot(sf, ids)
  }
  assert.deepEqual([...changedDeclarations(declarations(scope.afterSha), declarations(scope.beforeSha)).ids].sort(), ['A', 'C'])
  assert.equal(scope.eventBaseMismatch, true)
  assert.equal(scope.eventBaseSha, 'event-base')
  assert.deepEqual(scope.intent, { beforeSha: 'common-base', afterSha: 'pr-head' })
})
test('PR snapshot rejects head-only checkout, unrelated merge, octopus merge and missing intent history', () => {
  const { comparisonLineage } = require('../tooling/git-snapshots.cjs')
  const valid = { event: 'pull_request', base: 'base', head: 'head', checkout: 'merge', parents: ['target', 'head'], intentBase: 'base', targetDescendsFromEventBase: true }
  assert.throws(() => comparisonLineage({ ...valid, checkout: 'head', parents: ['base'] }), /lineage/)
  assert.throws(() => comparisonLineage({ ...valid, parents: ['target', 'other'] }), /lineage/)
  assert.throws(() => comparisonLineage({ ...valid, parents: ['target', 'head', 'other'] }), /lineage/)
  assert.throws(() => comparisonLineage({ ...valid, intentBase: undefined }), /history/)
  assert.throws(() => comparisonLineage({ ...valid, targetDescendsFromEventBase: false }), /Unsupported PR target lineage/)
  assert.throws(() => comparisonLineage({ ...valid, targetDescendsFromEventBase: undefined }), /verified ancestor/)
  assert.equal(comparisonLineage({ ...valid, base: 'target', targetDescendsFromEventBase: undefined }).eventBaseMismatch, false)
})
test('push comparison preserves exact event before and after; local head intent is explicit rather than a fake merge', () => {
  const { comparisonLineage } = require('../tooling/git-snapshots.cjs')
  const input = { event: 'push', base: 'before', head: 'after', checkout: 'after', parents: ['intermediate'] }
  const scope = comparisonLineage(input)
  assert.equal(scope.beforeSha, 'before')
  assert.equal(scope.afterSha, 'after')
  assert.equal(scope.kind, 'push-event')
  assert.throws(() => comparisonLineage({ ...input, checkout: 'newer' }), /Snapshot mismatch/)
  const local = comparisonLineage({ ...input, event: 'local', intentBase: 'common' })
  assert.equal(local.kind, 'local-head-intent')
  assert.equal(local.beforeSha, 'common')
  assert.throws(() => comparisonLineage({ ...input, event: 'unknown' }), /Unsupported/)
})

test('Git transport binds lineage, rename records and diff ranges to the same immutable comparison', t => {
  const childProcess = require('node:child_process')
  const modulePath = require.resolve('../tooling/git-snapshots.cjs')
  const cached = require.cache[modulePath]
  const previousChildren = [...module.children]
  const root = '/virtual/snapshot-repository'
  const base = 'a'.repeat(40), head = 'b'.repeat(40), target = 'c'.repeat(40), checkout = 'd'.repeat(40)
  const calls = []
  let ancestorStatus = 0
  const transport = t.mock.method(childProcess, 'execFileSync', (command, args, options) => {
    assert.equal(command, 'git')
    assert.equal(options.cwd, root)
    calls.push(args)
    if (args[0] === 'rev-parse') {
      const ref = args.at(-1)
      return ({ 'event-base^{commit}': base, 'pr-head^{commit}': head, 'HEAD^{commit}': checkout, HEAD: checkout })[ref]
    }
    if (args[0] === 'show') return `${target} ${head}\n`
    if (args[0] === 'merge-base' && args[1] === '--is-ancestor') {
      assert.deepEqual(args, ['merge-base', '--is-ancestor', base, target])
      if (ancestorStatus) throw Object.assign(new Error('ancestry unavailable'), { status: ancestorStatus })
      return ''
    }
    if (args[0] === 'merge-base') return base
    if (args[0] === 'cat-file') { assert.deepEqual(args, ['cat-file', '-e', `${target}^{commit}`]); return '' }
    if (args[0] === 'status') { assert.deepEqual(args, ['status', '--porcelain', '--untracked-files=all']); return '' }
    if (args.includes('--name-status')) {
      assert.deepEqual(args.slice(-2), [target, checkout])
      return 'R090\0src/old.cjs\0src/new.cjs\0D\0src/removed.cjs\0A\0src/added.cjs\0'
    }
    if (args.includes('--unified=0')) {
      assert.deepEqual(args.slice(-4), [target, checkout, '--', 'src/new.cjs'])
      return '@@ -3,2 +3,1 @@\n-old\n-old\n+new\n'
    }
    throw new Error(`Unexpected Git operation: ${args.join(' ')}`)
  })
  delete require.cache[modulePath]
  try {
    const { comparison, changedFiles, diffRanges } = require('../tooling/git-snapshots.cjs')
    const scope = comparison({ base: 'event-base', head: 'pr-head', event: 'pull_request', repositoryRoot: root })
    assert.equal(scope.beforeSha, target)
    assert.equal(scope.afterSha, checkout)
    assert.equal(scope.eventBaseSha, base)
    assert.equal(scope.targetDescendsFromEventBase, true)
    assert.deepEqual(changedFiles(scope.beforeSha, scope.afterSha, root), [
      { status: 'R090', oldFile: 'src/old.cjs', file: 'src/new.cjs' },
      { status: 'D', file: 'src/removed.cjs' }, { status: 'A', file: 'src/added.cjs' },
    ])
    assert.deepEqual(diffRanges(scope.beforeSha, scope.afterSha, 'src/new.cjs', root), [[[3, 1]], [[3, 2]]])
    assert.ok(calls.some(args => args[0] === 'status'))
    ancestorStatus = 1
    assert.throws(() => comparison({ base: 'event-base', head: 'pr-head', event: 'pull_request', repositoryRoot: root }), /Unsupported PR target lineage/)
    ancestorStatus = 128
    assert.throws(() => comparison({ base: 'event-base', head: 'pr-head', event: 'pull_request', repositoryRoot: root }), /ancestry unavailable/)
  } finally {
    transport.mock.restore()
    delete require.cache[modulePath]
    if (cached) require.cache[modulePath] = cached
    module.children.splice(0, module.children.length, ...previousChildren)
  }
})

for (const { name, collectionFailure } of [
  { name: 'planner collects both runners against fixed Git trees before issuing a documentation-only manifest', collectionFailure: false },
  { name: 'planner preserves verified snapshot context and closes the collector when discovery fails', collectionFailure: true },
]) test(name, async t => {
  const childProcess = require('node:child_process'), fs = require('node:fs')
  const { registerHooks } = require('node:module')
  const { resolve } = require('node:path')
  const { tmpdir } = require('node:os')
  const { pathToFileURL } = require('node:url')
  const plannerPath = require.resolve('../tooling/ci-plan.cjs')
  const snapshotPath = require.resolve('../tooling/git-snapshots.cjs')
  const savedModules = [plannerPath, snapshotPath].map(path => [path, require.cache[path]])
  const previousChildren = [...module.children]
  const analyzerRoot = resolve(__dirname, '../..')
  const before = 'a'.repeat(40), after = 'b'.repeat(40), analyzer = 'e'.repeat(40)
  const nodeFile = 'tests/unit/node.test.cjs', webFile = 'tests/unit/web.test.mjs'
  const sources = new Map([
    ['README.md', 'before'],
    [nodeFile, "const { test } = require('node:test'); test('node leaf', () => {})"],
    [webFile, "import { test } from 'vitest'; test('web leaf', () => {})"],
  ])
  const reads = [], collected = [], factoryCalls = []
  const existingFilter = process.env.LOGIC_TEST_FILES
  const key = Symbol.for('sagaburst.planner.collector-boundary')
  const previousGlobal = Object.getOwnPropertyDescriptor(globalThis, key)
  let root, closed = 0, hooks
  const transport = t.mock.method(childProcess, 'execFileSync', (command, args, options) => {
    if (command === process.execPath) {
      assert.equal(options.cwd, root)
      assert.deepEqual(args, [resolve(analyzerRoot, 'tests/tooling/node-collect.cjs'), nodeFile])
      collected.push(nodeFile)
      return JSON.stringify([{ file: nodeFile, runner: 'node', names: ['node leaf'], nativeNames: ['node leaf'], locations: [{ line: 1, column: 1 }] }])
    }
    assert.equal(command, 'git')
    if (options.cwd === analyzerRoot) {
      assert.deepEqual(args, ['rev-parse', 'HEAD'])
      return analyzer
    }
    assert.equal(options.cwd, root)
    if (args[0] === 'rev-parse') return args.at(-1) === `${before}^{commit}` ? before : after
    if (args[0] === 'show') return before
    if (args[0] === 'status') { assert.ok(args.includes('--untracked-files=all')); return '' }
    if (args[0] === 'cat-file' && args[1] === '-e') { assert.equal(args[2], `${before}^{commit}`); return '' }
    if (args[0] === 'diff') {
      assert.ok(args.includes('--name-status'))
      assert.deepEqual(args.slice(-2), [before, after])
      return 'M\0README.md\0'
    }
    if (args[0] === 'ls-tree') {
      assert.ok([before, after].includes(args.at(-1)))
      return [...sources.keys()].join('\n')
    }
    if (args[0] === 'grep') {
      const ref = args.at(-2)
      assert.ok([before, after].includes(ref))
      return [...sources.keys()].map(file => `${ref}:${file}\0`).join('')
    }
    if (args[0] === 'cat-file' && args[1] === '--batch') {
      const entries = options.input.trim().split('\n')
      reads.push(entries)
      return Buffer.concat(entries.flatMap(entry => {
        const ref = entry.slice(0, 40), file = entry.slice(41)
        assert.ok([before, after].includes(ref))
        const body = Buffer.from(file === 'README.md' && ref === after ? 'after' : sources.get(file))
        return [Buffer.from(`${'f'.repeat(40)} blob ${body.length}\n`), body, Buffer.from('\n')]
      }))
    }
    throw new Error(`Unexpected Git operation: ${args.join(' ')}`)
  })
  try {
    root = fs.mkdtempSync(resolve(tmpdir(), 'planner-collection-'))
    fs.mkdirSync(resolve(root, 'tests/unit'), { recursive: true })
    fs.writeFileSync(resolve(root, nodeFile), sources.get(nodeFile))
    fs.writeFileSync(resolve(root, webFile), sources.get(webFile))
    process.env.LOGIC_TEST_FILES = 'development-filter-must-not-affect-discovery'
    Object.defineProperty(globalThis, key, { configurable: true, value: (...args) => {
      factoryCalls.push(args)
      assert.equal(process.env.LOGIC_TEST_FILES, undefined)
      const moduleId = resolve(root, webFile)
      const spec = { moduleId }
      return {
        globTestSpecifications: async () => [spec],
        getRelevantTestSpecifications: async () => [],
        collectTests: async specs => {
          assert.deepEqual(specs, [spec])
          if (collectionFailure) return { unhandledErrors: [new Error('collector evidence unavailable')], testModules: [] }
          return { unhandledErrors: [], testModules: [{ moduleId, errors: () => [], children: {
            allSuites: () => [], allTests: () => [{ name: 'web leaf', fullName: 'web leaf', parent: { type: 'module' },
              location: { line: 1, column: 1 }, result: () => ({ state: 'pending' }) }],
          } }] }
        },
        close: async () => { closed++ },
      }
    } })
    hooks = registerHooks({ resolve(specifier, context, nextResolve) {
      if (specifier === 'vitest/node' && context.parentURL === pathToFileURL(plannerPath).href) {
        return { url: 'data:text/javascript,export const createVitest=(...args)=>globalThis[Symbol.for("sagaburst.planner.collector-boundary")](...args)', shortCircuit: true }
      }
      return nextResolve(specifier, context)
    } })
    for (const [path] of savedModules) delete require.cache[path]
    const { createPlan, snapshot } = require('../tooling/ci-plan.cjs')
    assert.throws(() => snapshot(), /Missing immutable snapshot ref/)
    if (collectionFailure) {
    await assert.rejects(createPlan({ mode: 'related', event: 'push', base: before, head: after, repositoryRoot: root }), error => {
      assert.match(error.message, /collector evidence unavailable/)
      assert.equal(error.planningContext.stage, 'discovery')
      assert.equal(error.planningContext.checkoutSha, after)
      assert.equal(error.planningContext.comparison.beforeSha, before)
      assert.equal(error.planningContext.comparison.afterSha, after)
      assert.equal(error.planningContext.analyzer.checkoutSha, analyzer)
      return true
    })
    } else {
    const plan = await createPlan({ mode: 'related', event: 'push', base: before, head: after, repositoryRoot: root })
    assert.equal(plan.docsOnly, true)
    assert.deepEqual(plan.changedFiles, ['README.md'])
    assert.deepEqual(plan.selected, [])
    assert.deepEqual(plan.shards, [])
    assert.deepEqual(plan.inventory.map(({ file, runner, names }) => ({ file, runner, names })), [
      { file: nodeFile, runner: 'node', names: ['node leaf'] }, { file: webFile, runner: 'vitest', names: ['web leaf'] },
    ])
    assert.equal(plan.checkoutSha, after)
    assert.equal(plan.comparison.beforeSha, before)
    assert.equal(plan.comparison.afterSha, after)
    assert.equal(plan.analyzer.checkoutSha, analyzer)
    assert.match(plan.analyzer.sourceDigest, /^[a-f0-9]{64}$/)
    assert.deepEqual(reads.map(entries => entries.map(entry => entry.slice(0, 40))), [[after, after, after], [before, before, before]])
    assert.deepEqual(collected, [nodeFile])
    assert.equal(factoryCalls.length, 1)
    assert.equal(factoryCalls[0][0], 'test')
    assert.equal(factoryCalls[0][1].root, root)
    assert.deepEqual(factoryCalls[0][1].related, [resolve(root, 'README.md')])
    assert.equal(closed, 1)
    assert.equal(process.env.LOGIC_TEST_FILES, 'development-filter-must-not-affect-discovery')
    }
    assert.equal(closed, 1)
    assert.equal(process.env.LOGIC_TEST_FILES, 'development-filter-must-not-affect-discovery')
  } finally {
    hooks?.deregister()
    transport.mock.restore()
    for (const [path, cached] of savedModules) { delete require.cache[path]; if (cached) require.cache[path] = cached }
    module.children.splice(0, module.children.length, ...previousChildren)
    if (previousGlobal) Object.defineProperty(globalThis, key, previousGlobal)
    else delete globalThis[key]
    if (existingFilter === undefined) delete process.env.LOGIC_TEST_FILES
    else process.env.LOGIC_TEST_FILES = existingFilter
    if (root) fs.rmSync(root, { recursive: true, force: true })
  }
})

test('blocked diagnostics preserve failure evidence separately and cannot execute or relax workflow gates', t => {
  const { mkdtempSync, writeFileSync, readFileSync, rmSync } = require('node:fs')
  const { tmpdir } = require('node:os')
  const { join, resolve } = require('node:path')
  const { writeBlockedDiagnostics } = require('../tooling/ci-plan.cjs')
  const { executeShard } = require('../tooling/ci-run.cjs')
  const childProcess = require('node:child_process')
  const blockedSpawn = t.mock.method(childProcess, 'spawnSync', () => { throw 'Unexpected subprocess before diagnostic rejection' })
  const blockedExec = t.mock.method(childProcess, 'execFileSync', () => { throw 'Unexpected checkout lookup before diagnostic rejection' })
  const directory = mkdtempSync(join(tmpdir(), 'blocked-plan-'))
  try {
    const manifest = join(directory, 'plan.json')
    writeFileSync(manifest, 'existing manifest must remain untouched')
    const original = new RangeError('Maximum call stack size exceeded')
    original.cause = original // A pathological cause must not make failure reporting recurse.
    const error = Object.assign(new Error('missing receiver provenance', { cause: original }), {
      planningContext: { checkoutSha: 'tested', comparison: { beforeSha: 'target', afterSha: 'tested' }, analyzer: { sourceDigest: 'analyzer' }, stage: 'selection' },
      diagnostics: { changed: 'src/owner.cjs', test: 'tests/owner.test.cjs', caseIndex: 0,
        path: [{ file: 'tests/owner.test.cjs', behavior: 'contract', line: 3, root: true }],
        unresolved: { expression: 'receiver[key]()', missingEvidence: 'receiver provenance', line: 4, column: 2 } },
    })
    const args = { mode: 'related', event: 'pull_request', base: 'event-base', head: 'requested-head', out: manifest }
    const argv = ['--mode', 'related', '--base', 'event-base']
    const written = writeBlockedDiagnostics(error, { args, argv })
    assert.equal(written.file, join(directory, 'plan.blocked.json'))
    const diagnostic = JSON.parse(readFileSync(join(directory, 'plan.blocked.json'), 'utf8'))
    assert.equal(readFileSync(manifest, 'utf8'), 'existing manifest must remain untouched')
    assert.equal(diagnostic.schema, 'logic-plan-blocked/v1')
    assert.equal(diagnostic.executable, false)
    assert.equal(diagnostic.result, 'blocked')
    assert.deepEqual(diagnostic.requested, { args, argv })
    assert.deepEqual(diagnostic.context, error.planningContext)
    assert.deepEqual(diagnostic.diagnostics, error.diagnostics)
    assert.match(diagnostic.error.stack, /missing receiver provenance/)
    assert.deepEqual(diagnostic.error.causes, [{ name: 'RangeError', message: original.message, stack: original.stack }])
    assert.equal(diagnostic.error.causesTruncated, true)
    assert.deepEqual(diagnostic.unavailable, {})
    assert.throws(() => validateManifest(diagnostic), /not an executable test manifest/)
    assert.throws(() => aggregate(diagnostic, []), /not an executable test manifest/)
    assert.throws(() => executeShard(diagnostic, 'logic-related', join(directory, 'report.json')), /not an executable test manifest/)
    assert.equal(blockedSpawn.mock.callCount(), 0)
    assert.equal(blockedExec.mock.callCount(), 0)
    let nested = new Error('root cause')
    for (let depth = 0; depth < 5; depth++) nested = new Error(`transport layer ${depth}`, { cause: nested })
    const early = writeBlockedDiagnostics(new Error('Git history unavailable', { cause: nested }), { args: { out: join(directory, 'early.json') } }).diagnostic
    assert.equal(early.error.causes.length, 4)
    assert.equal(early.error.causesTruncated, true)
    assert.equal(early.context, null)
    assert.match(early.unavailable.checkoutSha, /before the actual checkout SHA was established/)
    assert.equal(early.diagnostics.missingEvidence, 'Git history unavailable')

    const workflow = require('js-yaml').load(readFileSync(resolve(__dirname, '../../.github/workflows/logic-tests.yml'), 'utf8'))
    const upload = workflow.jobs.plan.steps.find(step => step.with?.name === 'logic-plan-blocked')
    assert.equal(upload.if, 'always()')
    assert.equal(upload.with.path, 'output/test-plan.blocked.json')
    assert.equal(upload.with['if-no-files-found'], 'ignore')
    const executableUpload = workflow.jobs.plan.steps.find(step => step.with?.name === 'logic-plan')
    assert.equal(executableUpload.if, undefined)
    assert.equal(executableUpload.with.path, 'output/test-plan.json')
    assert.equal(executableUpload.with['if-no-files-found'], 'error')
    assert.equal(workflow.jobs.shard.needs, 'plan')
    assert.match(workflow.jobs.aggregate.steps[0].run, /test "\$PLAN_RESULT" = success/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
