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

test('production module selects transitive consumers without unrelated equipment suites', () => {
  assert.deepEqual(select('src/navigation/NavigationGrid.ts').selected, [inventory[0].file])
  const previewOwners = ['tests/missions/TownSiegePolicy.test.ts', 'tests/missions/SiegeRampPolicy.test.ts',
    'tests/persistence/TownSiegeRosterPersistence.test.ts', 'tests/movement/NavigationWorld.test.ts',
    'tests/combat/ProjectileBallistics.test.ts']
  const preview = selectFiles([...inventory, ...previewOwners.map(file => item(file))],
    [{ status: 'M', file: 'src/debug/TownFourGateSiegePreview.ts' }], consumers)
  assert.equal(preview.mode, 'related')
  assert.deepEqual(preview.selected, previewOwners.sort())
  const retirementOwners = ['tests/progression/CareerRetirementQaProfile.test.ts',
    'tests/progression/CareerRetirementFinale.test.ts', 'tests/town/CareerTownEntry.test.ts']
  const retirement = selectFiles([...inventory, ...retirementOwners.map(file => item(file))],
    [{ status: 'A', file: 'src/debug/CareerRetirementQA.ts' }], consumers)
  assert.equal(retirement.mode, 'related')
  assert.deepEqual(retirement.selected, retirementOwners.sort())
  const entryOwners = ['tests/town/CareerTownEntry.test.ts', 'tests/missions/CareerMissionRecovery.test.ts',
    'tests/integration/MissionModeRouting.test.ts']
  const entry = selectFiles([...inventory, ...entryOwners.map(file => item(file))],
    [{ status: 'M', file: 'src/main.ts' }], consumers)
  assert.equal(entry.mode, 'related')
  assert.deepEqual(entry.selected, entryOwners.sort())
  const shieldOwners = ['tests/combat/CombatAttribution.test.ts', 'tests/combat/CommanderWeaponSwitching.test.ts',
    'tests/equipment/CareerSquadEquipment.test.ts', 'tests/equipment/CareerTownEquipment.test.ts']
  const shield = selectFiles([...inventory, ...shieldOwners.map(file => item(file))],
    [{ status: 'A', file: 'public/models/weapons/t5/shield.glb' }, { status: 'M', file: 'public/models/weapons/t5/sources.json' }], consumers)
  assert.equal(shield.mode, 'related')
  assert.deepEqual(shield.selected, shieldOwners.sort())
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
test('test runner and workflow changes select dedicated CI contracts without Full fallback', () => {
  const expected = ['tests/release/ci-plan.test.cjs', 'tests/release/test-budget.test.cjs']
  assert.deepEqual(select('tests/tooling/run.cjs').selected, expected)
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
test('release code selects Node tests once and deduplicates shared consumers', () => {
  const expected = inventory.filter(item => item.runner === 'node').map(item => item.file).sort()
  assert.deepEqual(select('.github/scripts/release/publish.cjs').selected, expected)
  assert.deepEqual(select('.github/scripts/release/validate-tag.cjs').selected, expected)
  assert.deepEqual(select('electron/asset-path.cjs').selected, expected)
  const result = selectFiles(inventory, [{ status: 'M', file: 'electron/main.cjs' }, { status: 'M', file: '.github/scripts/release/publish.cjs' }], consumers)
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
  assert.deepEqual(plan.details['tests/actors/Spawner.test.ts'], [{ changed: 'src/navigation/Route.ts', source: 'Static Runtime Dependency',
    chain: ['tests/actors/Spawner.test.ts', 'src/world/NPC.ts', 'src/navigation/Route.ts'] }])
  const text = selectionSummary({ mode: 'related', baseSha: 'b', headSha: 'h', changedFiles: ['src/navigation/Route.ts'], inventory: files, shards: [], ...plan })
  assert.match(text, /Selected: 1 files \/ 2 cases/)
  assert.match(text, /Owners:/)
  assert.match(text, /Budget: 2 \/ 500/)
})

test('only the owned Node collector load crosses the computed-import boundary', () => {
  const sources = new Map([
    ['tests/tooling/node-collect.cjs', 'require(resolve(file))'],
    ['tests/tooling/unowned.cjs', 'require(resolve(file))'],
    ['tests/ordinary.test.cjs', 'require(resolve(file))'],
    ['.github/scripts/release/publish.cjs', 'require(selectedModule)'],
  ])
  const graph = dependencyConsumers(inventory, sources)
  assert.deepEqual(graph.runtimeAmbiguities, ['tests/tooling/unowned.cjs', 'tests/ordinary.test.cjs', '.github/scripts/release/publish.cjs'])
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
  assert.deepEqual([...first], [{ file: 'src/owner.ts', behavior: 'both' }, { file: 'src/owner.ts', behavior: 'first' }])
  assert.equal(first.conservative, false)
  const afterFirst = traversals
  assert.deepEqual([...graph.explain(roots, reached, id('second'))],
    [{ file: 'src/owner.ts', behavior: 'both' }, { file: 'src/owner.ts', behavior: 'second' }])
  assert.equal(traversals, afterFirst, 'sibling targets reuse the same shortest-path tree')
  const limited = new Set(reached)
  limited.delete(id('second'))
  assert.deepEqual(graph.explain(roots, limited, id('second')), [])
  const single = graph.caseRoots('tests/owner.test.ts', { line: 3 })
  assert.deepEqual(graph.explain(single, graph.reachable(single, 'tests/owner.test.ts'), id('second')), [])
})
