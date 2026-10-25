const { test } = require('node:test')
const assert = require('node:assert/strict')
const { dependencyConsumers, classifyChangedInput } = require('../tooling/dependencies.cjs')

const analyze = (entries, inputs) => {
  const sources = new Map(entries), files = new Set([...sources.keys(), ...inputs])
  return dependencyConsumers([{ file: entries[0][0] }], sources, file => files.has(file), { files })
}
test('actual file reads through local wrappers retain caller input evidence across relocation', () => {
  const graph = analyze([
    ['tests/release/contract.test.cjs', `const {test}=require('node:test'); const {readFileSync}=require('node:fs'); const {resolve}=require('node:path');
const directory = resolve(__dirname, '../../.github/workflows');
const read = name => readFileSync(resolve(directory, name), 'utf8');
test('build', () => read('build.yml'));
test('publish', () => read('publish.yml'));`],
  ], ['.github/workflows/build.yml', '.github/workflows/publish.yml'])
  assert.deepEqual(graph['.github/workflows/build.yml'], ['tests/release/contract.test.cjs'])
  const proof = classifyChangedInput('.github/workflows/build.yml', graph)
  assert.equal(proof.edges.length, 1)
  assert.equal(proof.edges[0].expression, "read('build.yml')")
  assert.equal(proof.edges[0].line, 4)
  assert.equal(graph.inputEdges.find(edge => edge.to.endsWith('publish.yml')).expression, "read('publish.yml')")
  assert.equal(graph.inputRisks.length, 0)
  // Both caller environments revisit the same reader AST; only lexical binding,
  // never evaluated input values, may be shared.
  assert.equal(new Set(graph.inputEdges.map(edge => edge.readerStart)).size, 1)
  const next = analyze([...graph.sources].map(([file, source]) => [file, source.replace('build.yml', 'preview.yml')]),
    ['.github/workflows/preview.yml', '.github/workflows/publish.yml'])
  assert.deepEqual(next.inputEdges.map(edge => edge.to), ['.github/workflows/preview.yml', '.github/workflows/publish.yml'])
  assert.deepEqual(graph.inputEdges.map(edge => edge.to), ['.github/workflows/build.yml', '.github/workflows/publish.yml'])
  const { selectBehaviors } = require('../tooling/behavior.cjs')
  const file = 'tests/release/contract.test.cjs'
  const inventory = [{ file, runner: 'node', names: ['build', 'publish'], locations: [{ line: 4, column: 1 }, { line: 5, column: 1 }] }]
  const selected = selectBehaviors(inventory, [{ status: 'M', file: '.github/workflows/build.yml' }], graph, {
    sources: graph.sources, previousSources: graph.sources, previousConsumers: graph, ranges: {}, compilerOptions: { noLib: true, noResolve: true, types: [] },
  })
  assert.deepEqual(selected.selectedCases[file], [0])
})
test('runtime inputs are traced through imported URL helpers while ambiguous manifest values remain explicit', () => {
  const graph = analyze([
    ['tests/owner.test.mjs', "import '../src/owner.mjs'"],
    ['src/owner.mjs', `import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'; const loader = new GLTFLoader(); import { asset } from './url.mjs'; const base=asset('models/unit');
fetch(base + '/manifest.json'); loader.loadAsync(base + '/' + manifest.file);
new URL('./sound.wav', import.meta.url);`],
    ['src/url.mjs', "export function asset(path) { return `${import.meta.env.BASE_URL}${path}` }"],
  ], ['public/models/unit/manifest.json', 'public/models/unit/body.glb', 'src/sound.wav'])
  assert.deepEqual(graph['public/models/unit/manifest.json'], ['tests/owner.test.mjs'])
  assert.deepEqual(graph['src/sound.wav'], ['tests/owner.test.mjs'])
  const risk = classifyChangedInput('public/models/unit/body.glb', graph)
  assert.equal(risk.kind, 'unresolved-input')
  assert.match(risk.risks[0].missingEvidence, /manifest.file/)
  assert.equal(classifyChangedInput('public/unrelated.bin', graph).kind, 'unclassified')
  assert.equal(classifyChangedInput('tools/unread.json', graph).kind, 'unclassified')
})
test('registry enumeration and loaded manifests keep animation payloads as runtime contracts', () => {
  const sources = new Map([
    ['tests/registry.test.cjs', "require('../runtime/registry.cjs')"],
    ['runtime/registry.cjs', `const {GLTFLoader}=require('three/examples/jsm/loaders/GLTFLoader.js'); const loader=new GLTFLoader(); const files = { first: 'left', second: 'right' };
Object.entries(files).map(async ([id, file]) => loader.loadAsync('/models/' + file + '.glb'));
const response = await fetch('/models/manifest.json'); const manifest = await response.json();
loader.loadAsync('/models/' + manifest.animation);
const audio = { hit: new URL('./hit.wav', import.meta.url).href };
const voice = { call: '/voice.wav' };
const selectedUrl = useVoice ? voice[key] : audio[key]; fetch(selectedUrl);`],
  ])
  const texts = new Map([...sources, ['public/models/manifest.json', '{"animation":"attack.glb"}']])
  const files = new Set([...texts.keys(), 'public/models/left.glb', 'public/models/right.glb', 'public/models/attack.glb', 'runtime/hit.wav', 'public/voice.wav'])
  const graph = dependencyConsumers([{ file: 'tests/registry.test.cjs' }], sources, file => files.has(file), { files, texts })
  assert.deepEqual(graph.inputEdges.map(edge => edge.to).sort(), ['public/models/attack.glb', 'public/models/left.glb', 'public/models/manifest.json', 'public/models/right.glb', 'public/voice.wav', 'runtime/hit.wav', 'runtime/hit.wav'])
  assert.equal(classifyChangedInput('public/models/attack.glb', graph).kind, 'runtime-input')
  assert.equal(graph.inputRisks.length, 0)
  const branch = analyze([['tests/branch.test.cjs', `const {readFileSync}=require('node:fs'); function resolve(path) { if (flag) return 'first.json'; return 'second.json' }
readFileSync(resolve('wrong.json'));`]], ['first.json', 'second.json', 'wrong.json'])
  assert.deepEqual(branch.inputEdges.map(edge => edge.to).sort(), ['first.json', 'second.json'])
  assert.equal(branch.inputRisks.length, 0)
  const paths = analyze([['tests/path.test.cjs', `const {readFileSync}=require('node:fs'); const { join, resolve } = require('node:path');
readFileSync(join('config', flag ? 'a.json' : 'b.json'));
readFileSync((flag ? '/left.json' : '/right.json').replace(/^\\/+/, ''));
readFileSync(\`value-\${1 + 2}.json\`);
readFileSync(new URL('./metadata.json', import.meta.url), 'utf8');
require('node:fs').readFileSync('inline.json', 'utf8');
readFileSync(resolve('ignored', '/absolute.json'));`]], ['config/a.json', 'config/b.json', 'left.json', 'right.json', 'value-3.json', 'tests/metadata.json', 'inline.json', '/absolute.json'])
  assert.deepEqual(paths.inputEdges.map(edge => edge.to).sort(), ['/absolute.json', 'config/a.json', 'config/b.json', 'inline.json', 'left.json', 'right.json', 'tests/metadata.json', 'tests/metadata.json', 'value-3.json'])
  assert.equal(paths.inputRisks.length, 0)
  const shadowed = analyze([['tests/shadowed.test.cjs', `function fetch(url) { return otherResponse }
fetch('/config.json');`]], ['public/config.json'])
  assert.deepEqual(shadowed.inputEdges, [])
  assert.match(shadowed.inputRisks[0].reason, /receiver provenance/)
  assert.equal(shadowed.inputRisks[0].pattern, '^.*$')
  const prefixed = analyze([['tests/prefix.test.mjs', `import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
new GLTFLoader().setPath('/models/').loadAsync('body.glb');`]], ['public/models/body.glb'])
  assert.deepEqual(prefixed.inputEdges, [])
  assert.equal(prefixed.inputRisks[0].pattern, '^.*$')

})
test('input evidence selects the reading leaf without unrelated siblings', () => {
  const { selectBehaviors } = require('../tooling/behavior.cjs')
  const file = 'tests/input.test.cjs'
  const sources = new Map([[file, `const {test}=require('node:test'); const {readFileSync}=require('node:fs');
test('read', () => readFileSync('config.json', 'utf8'));
test('unrelated', () => readFileSync('other/' + runtimeName, 'utf8'));`]])
  const inventory = [{ file, runner: 'node', names: ['read', 'unrelated'], locations: [{ line: 2, column: 1 }, { line: 3, column: 1 }] }]
  const consumers = dependencyConsumers(inventory, sources, path => sources.has(path) || path === 'config.json')
  const result = selectBehaviors(inventory, [{ status: 'M', file: 'config.json' }], consumers, {
    sources, previousSources: sources, previousConsumers: consumers, ranges: {}, compilerOptions: { noLib: true, noResolve: true, types: [] },
  })
  assert.deepEqual(result.selectedCases[file], [0])
  assert.ok(result.details[file][0].caseEvidence[0].path.some(step => step.behavior === '<input:config.json>'))
})
test('a reached unresolved reader matching the changed input fails with expression evidence', () => {
  const { selectBehaviors } = require('../tooling/behavior.cjs')
  const file = 'tests/input.test.cjs'
  const sources = new Map([[file, `const {test}=require('node:test'); const {readFileSync}=require('node:fs');
test('read', () => readFileSync('config/' + runtimeName, 'utf8'));`]])
  const inventory = [{ file, runner: 'node', names: ['read'], locations: [{ line: 2, column: 1 }] }]
  const files = new Set([file, 'config/timing.json'])
  const consumers = dependencyConsumers(inventory, sources, path => files.has(path), { files })
  assert.deepEqual(consumers['config/timing.json'], [file])
  assert.ok(!consumers.graph.get(file).includes('config/timing.json'))
  assert.throws(() => selectBehaviors(inventory, [{ status: 'M', file: 'config/timing.json' }], consumers, {
    sources, previousSources: sources, previousConsumers: consumers, ranges: {}, compilerOptions: { noLib: true, noResolve: true, types: [] },
  }), /Unsafe runtime input:.*runtimeName/)
})
test('zero logic coverage requires an inert payload and an exclusive browser presentation contract', () => {
  const sources = new Map()
  const texts = new Map([
    ['index.html', '<link rel="icon" href="/brand.svg">'],
    ['public/brand.svg', '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1z"/></svg>'],
  ])
  const files = new Set(texts.keys())
  const graph = dependencyConsumers([], sources, file => files.has(file), { files, texts })
  assert.equal(classifyChangedInput('public/brand.svg', graph).kind, 'visual-asset')
  assert.equal(classifyChangedInput('public/brand.svg', graph).logicCoverage, false)
  const { selectFiles, validateManifest } = require('../tooling/ci-plan.cjs')
  const evidence = { sources, previousSources: sources, previousConsumers: graph, ranges: {}, files, previousFiles: files, texts, previousTexts: texts }
  const selected = selectFiles([], [{ status: 'A', file: 'public/brand.svg' }], graph, evidence)
  assert.deepEqual(selected.zeroLogicFiles, ['public/brand.svg'])
  assert.equal(selected.inputClassifications[0].logicCoverage, false)
  assert.doesNotThrow(() => validateManifest({ ...selected, inventory: [], shards: [], changedFiles: ['public/brand.svg'] }))
  assert.throws(() => validateManifest({ ...selected, inventory: [], shards: [], changedFiles: ['public/brand.svg'], inputClassifications: selected.inputClassifications.map(input => ({ ...input, previous: { kind: 'unclassified' } })) }), /Empty code selection/)
  const beforeTexts = new Map(texts).set('public/brand.svg', '<svg><script>alert(1)</script></svg>')
  const previous = dependencyConsumers([], sources, file => files.has(file), { files, texts: beforeTexts })
  assert.throws(() => selectFiles([], [{ status: 'M', file: 'public/brand.svg' }], graph, { ...evidence, previousConsumers: previous, previousTexts: beforeTexts }), /Unmapped code\/runtime input/)
  texts.set('public/brand.svg', '<svg><script>alert(1)</script></svg>')
  assert.notEqual(classifyChangedInput('public/brand.svg', graph).kind, 'visual-asset')
  assert.equal(classifyChangedInput('public/unknown.svg', graph).kind, 'unclassified')
})
for (const [name, source] of [
  ['reassigned scalar', "let path = 'old.json'; path = 'new.json'; readFileSync(path)"],
  ['mutated object property', "const config = { path: 'old.json' }; config.path = 'new.json'; readFileSync(config.path)"],
  ['mutating array method', "const registry = ['old.json']; registry.push('new.json'); registry.forEach(path => readFileSync(path))"],
  ['reassigned caller parameter', "function read(path) { path = 'new.json'; readFileSync(path) } read('old.json')"],
  ['mutation through an alias', "const original = { path: 'old.json' }; const alias = original; alias.path = 'new.json'; readFileSync(original.path)"],
  ['unknown container escape', "const escaped = { path: 'old.json' }; mutate(escaped); readFileSync(escaped.path)"],
  ['reassigned callable', "let choose = () => 'old.json'; choose = () => 'new.json'; readFileSync(choose())"],
  ['array callback container escape', "const values = ['old.json']; values.forEach((value, index, all) => { all[0] = 'new.json'; readFileSync(value) })"],
]) test(`never proves stale initializer paths after ${name}`, () => {
  const graph = analyze([['tests/mutable.test.cjs', `const {readFileSync}=require('node:fs');
${source};
const stable = { path: 'stable.json' }; readFileSync(stable.path);
`]], ['old.json', 'new.json', 'stable.json'])
  assert.deepEqual(graph.inputEdges.map(edge => edge.to), ['stable.json'])
  assert.ok(graph.inputRisks.length > 0)
  assert.ok(graph.inputRisks.every(risk => risk.reason === 'Input expression has an unresolved runtime value'))
})

test('imported factories bind finite caller configuration without suppressing escaped boundaries', () => {
  const sources = new Map([
    ['tests/caller.test.mjs', "import { create } from '../runtime/factory.mjs'; create({ base: '/assets' })"],
    ['runtime/factory.mjs', `import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
export function create(config) { async function load() {
const response = await fetch(config.base + '/manifest.json'); const manifest = await response.json();
return new GLTFLoader().loadAsync(config.base + '/' + manifest.file);
} return load }`],
  ])
  const texts = new Map([...sources, ['public/assets/manifest.json', '{"file":"timing.glb"}']])
  const files = new Set([...texts.keys(), 'public/assets/timing.glb'])
  const graph = dependencyConsumers([{ file: 'tests/caller.test.mjs' }], sources, file => files.has(file), { files, texts })
  assert.deepEqual(graph.inputEdges.map(edge => edge.to).sort(), ['public/assets/manifest.json', 'public/assets/timing.glb'])
  assert.equal(graph.inputRisks.length, 0)
  assert.ok(graph.inputEdges.every(edge => edge.from === 'tests/caller.test.mjs' && edge.readerFile === 'runtime/factory.mjs'))
  sources.set('tests/caller.test.mjs', sources.get('tests/caller.test.mjs') + '; register(create)')
  const escaped = dependencyConsumers([], sources, file => files.has(file), { files, texts })
  assert.ok(escaped.inputRisks.some(risk => risk.from === 'runtime/factory.mjs'))
})

test('CommonJS named export and destructured alias preserve actual reader arguments', () => {
  const sources = new Map([
    ['tests/cjs.test.cjs', "const { parse: read } = require('../runtime/read.cjs'); read('/missing/report.json')"],
    ['runtime/read.cjs', "const {readFileSync}=require('node:fs'); function reader(file) { return readFileSync(file, 'utf8') } module.exports = { parse: reader }"],
  ])
  const graph = dependencyConsumers([{ file: 'tests/cjs.test.cjs' }], sources)
  assert.equal(graph.inputRisks.length, 1)
  assert.equal(graph.inputRisks[0].pattern, '^/missing/report\\.json$')
  assert.equal(graph.inputRisks[0].from, 'tests/cjs.test.cjs')
  assert.equal(graph.inputRisks[0].readerFile, 'runtime/read.cjs')
  assert.equal(classifyChangedInput('tests/AGENTS.md', graph).kind, 'unclassified')
  sources.set('runtime/read.cjs', sources.get('runtime/read.cjs') + '; module.exports.parse = otherReader')
  const changed = dependencyConsumers([], sources)
  assert.ok(changed.inputRisks.some(risk => risk.pattern === '^.*$'))
})

for (const [name, predicate] of [
  ['literal suffix', "name => name.endsWith('.cjs')"],
  ['terminal regex literal', 'name => /\\.[cm]?js$/.test(name)'],
]) test(`directory readers retain a conservative open ${name} input domain`, () => {
  const file = 'tests/tooling/digest.cjs'
  const source = `const {readdirSync, readFileSync}=require('node:fs'); const {join}=require('node:path');
for (const name of readdirSync(__dirname).filter(${predicate}).sort()) readFileSync(join(__dirname, name));`
  const sources = new Map([[file, source]])
  const files = new Set([file, 'tests/tooling/other.cjs', 'tests/tooling/README.md', 'tests/tooling/almostjs'])
  const graph = dependencyConsumers([{ file }], sources, path => files.has(path), { files })
  assert.equal(graph.inputRisks.length, 0)
  assert.equal(graph.inputPatterns.length, 1)
  const inputSet = graph.inputPatterns[0]
  assert.equal(inputSet.provider.module, 'node:fs')
  assert.equal(new RegExp(inputSet.pattern).test('tests/tooling/README.md'), false)
  assert.equal(new RegExp(inputSet.pattern).test('tests/tooling/not-yet-listed.cjs'), true)
  assert.deepEqual(graph.inputEdges.filter(edge => edge.kind === 'read').map(edge => edge.to), (name === 'terminal regex literal' ? [file, 'tests/tooling/other.cjs', 'tests/tooling/almostjs'] : [file, 'tests/tooling/other.cjs']).sort())
  assert.deepEqual(graph.inputEdges.filter(edge => edge.kind === 'directory-membership').map(edge => edge.to), [file, 'tests/tooling/other.cjs'])
  assert.deepEqual(inputSet.observedTargets, [file, 'tests/tooling/other.cjs'])
  assert.ok(graph.inputEdges.filter(edge => edge.kind === 'read').every(edge => edge.conservative && edge.possible && edge.resolution === 'possible-directory-input'))
  assert.equal(classifyChangedInput('tests/tooling/README.md', graph).kind, 'unclassified')
  assert.equal(classifyChangedInput('tests/tooling/other.cjs', graph).kind, 'runtime-input')
  files.add('tests/tooling/not-yet-listed.cjs')
  const next = dependencyConsumers([{ file }], sources, path => files.has(path), { files })
  assert.ok(next.inputEdges.some(edge => edge.to === 'tests/tooling/not-yet-listed.cjs'))
  assert.ok(!graph.inputEdges.some(edge => edge.to === 'tests/tooling/not-yet-listed.cjs'))
})

for (const [name, directory, predicate, listing = 'readdirSync', prelude = ''] of [
  ['regex flags', '__dirname', 'name => /\\.cjs$/i.test(name)'],
  ['a dynamic predicate', '__dirname', 'name => runtimeRegex.test(name)'],
  ['an unknown directory', 'runtimeDirectory', "name => name.endsWith('.cjs')"],
  ['a named binding used as a namespace', '__dirname', "name => name.endsWith('.cjs')", 'fakeFs.readdirSync', "const { readdirSync: fakeFs } = require('node:fs');"],
]) test(`directory readers preserve uncertainty for ${name}`, () => {
  const sources = new Map([['tests/tooling/digest.cjs', `const {readdirSync, readFileSync}=require('node:fs'); const {join}=require('node:path');
${prelude}
for (const name of ${listing}(${directory}).filter(${predicate})) readFileSync(join(__dirname, name));`]])
  const graph = dependencyConsumers([], sources)
  assert.equal(graph.inputRisks.length, 1)
  assert.equal(new RegExp(graph.inputRisks[0].pattern).test('tests/tooling/README.md'), true)
})

test('directory read domain stays open when runtime writes create a new listing member', () => {
  const file = 'tests/digest.cjs'
  const sources = new Map([[file, `const {readdirSync, readFileSync, writeFileSync}=require('node:fs'); const {join}=require('node:path');
writeFileSync('registry/unlisted.json', '{}');
for (const name of readdirSync('registry').filter(name => name.endsWith('.json'))) readFileSync(join('payloads', name));`]])
  const files = new Set([file, 'registry/selected.json', 'payloads/selected.json', 'payloads/unlisted.json'])
  const graph = dependencyConsumers([{ file }], sources, path => files.has(path), { files })
  assert.deepEqual(graph.inputEdges.filter(edge => edge.kind === 'read').map(edge => edge.to), ['payloads/selected.json', 'payloads/unlisted.json'])
  assert.deepEqual(graph.inputPatterns[0].observedTargets, ['payloads/selected.json'])
  assert.equal(classifyChangedInput('payloads/unlisted.json', graph).kind, 'runtime-input')
  assert.deepEqual(graph.inputEdges.filter(edge => edge.kind === 'directory-membership').map(edge => edge.to), ['registry/selected.json'])
  assert.equal(graph.inputRisks.length, 0)
  assert.equal(graph.inputPatterns[0].directoryInputs[0].directory, 'registry')
  files.add('registry/unlisted.json')
  const next = dependencyConsumers([{ file }], sources, path => files.has(path), { files })
  assert.ok(next.inputEdges.some(edge => edge.kind === 'read' && edge.to === 'payloads/unlisted.json'))
  const membership = next.inputEdges.find(edge => edge.kind === 'directory-membership' && edge.to === 'registry/unlisted.json')
  assert.deepEqual(membership.changeKinds, ['A', 'D', 'R'])
  assert.equal(membership.inputExpression, "readdirSync('registry')")
  assert.ok(graph.inputEdges.some(edge => edge.to === 'payloads/unlisted.json' && edge.conservative))
})

test('independent directory bindings cross-product while repeated binding references remain correlated', () => {
  const file = 'tests/digest.cjs'
  const sources = new Map([[file, `const {readdirSync, readFileSync}=require('node:fs'); const {join}=require('node:path');
for (const a of readdirSync('names').filter(name => name.endsWith('.json'))) {
  for (const b of readdirSync('names').filter(name => name.endsWith('.json'))) {
    readFileSync(join('pairs', a + '-' + b));
    readFileSync(join('pairs', a + '-' + a));
  }
}`]])
  const pairs = ['a.json-a.json', 'a.json-b.json', 'b.json-a.json', 'b.json-b.json'].map(name => 'pairs/' + name)
  const files = new Set([file, 'names/a.json', 'names/b.json', ...pairs])
  const graph = dependencyConsumers([{ file }], sources, path => files.has(path), { files })
  assert.deepEqual(graph.inputEdges.filter(edge => edge.kind === 'read' && edge.inputExpression.includes("a + '-' + b")).map(edge => edge.to), pairs)
  assert.deepEqual(graph.inputEdges.filter(edge => edge.kind === 'read' && edge.inputExpression.includes("a + '-' + a")).map(edge => edge.to), ['pairs/a.json-a.json', 'pairs/b.json-b.json'])
  assert.equal(graph.inputRisks.length, 0)
})

test('verified child-process launches distinguish Node entry mode from other interpreters', () => {
  const file = 'tests/entry.cjs'
  const sources = new Map([[file, `const {execFileSync: run}=require('node:child_process');
run(process.execPath, ['tools/entry.cjs']);
require('node:child_process').spawnSync('node', ['tools/entry.cjs'], {shell:false});
run('python3', ['tools/report.py']);
const {resolve}=require('node:path');
run(process.execPath, [resolve(__dirname, '../tools/entry.cjs')], {cwd:runtimeRoot});`]])
  const files = new Set([file, 'tools/entry.cjs', 'tools/report.py'])
  const graph = dependencyConsumers([{ file }], sources, path => files.has(path), { files })
  assert.equal(graph.inputRisks.length, 0)
  assert.deepEqual(graph.inputEdges.map(edge => [edge.to, edge.executionKind, edge.provider.export]), [
    ['tools/entry.cjs', 'node-entry', 'execFileSync'],
    ['tools/entry.cjs', 'node-entry', 'spawnSync'],
    ['tools/report.py', 'script-entry', 'execFileSync'],
    ['tools/entry.cjs', 'node-entry', 'execFileSync'],
  ])
  assert.equal(graph.inputEdges.at(-1).pathOrigin, 'module-directory')
})

for (const [scenario, source] of [
  ['a same-named local launcher', "function spawnSync() {}; spawnSync('node', ['tools/entry.cjs'])"],
  ['a conditional executable', "const {spawnSync}=require('node:child_process'); spawnSync(flag ? 'node' : runtimeExecutable, ['tools/entry.cjs'])"],
  ['an unresolved script', "const {spawnSync}=require('node:child_process'); spawnSync('node', [runtimeScript])"],
  ['a shadowed process executable', "const {spawnSync}=require('node:child_process'); const process = {execPath:runtimeExecutable}; spawnSync(process.execPath, ['tools/entry.cjs'])"],
  ['an unproven working directory', "const {spawnSync}=require('node:child_process'); spawnSync('node', ['tools/entry.cjs'], {cwd:runtimeRoot})"],
]) test(`Node entry proof rejects ${scenario}`, () => {
  const graph = analyze([['tests/entry.cjs', source]], ['tools/entry.cjs'])
  assert.equal(graph.inputEdges.length, 0)
  assert.equal(graph.inputRisks.length, 1)
  assert.equal(graph.inputRisks[0].kind, 'execute')
})

test('filesystem import aliases select their reading leaf rather than a real sibling reader', () => {
  const file = 'tests/alias.test.mjs'
  const source = `import {test} from 'node:test'; import {readFileSync, readFileSync as read} from 'node:fs';
test('alias',()=>read('cfg.json'));
test('sibling',()=>readFileSync('other.json'));`
  const graph = analyze([[file, source]], ['cfg.json', 'other.json'])
  assert.equal(graph.inputEdges.find(edge => edge.to === 'cfg.json').provider.export, 'readFileSync')
  assert.equal(graph.inputRisks.length, 0)
  const inventory = [{file, runner:'node', names:['alias','sibling'], locations:[{line:2,column:1},{line:3,column:1}]}]
  const selected = require('../tooling/behavior.cjs').selectBehaviors(inventory, [{status:'M',file:'cfg.json'}], graph,
    {sources:graph.sources,previousSources:graph.sources,previousConsumers:graph,ranges:{},compilerOptions:{noLib:true,noResolve:true,types:[]}})
  assert.deepEqual(selected.selectedCases[file], [0])
})

test('a same-named local reader cannot inherit filesystem provider evidence', () => {
  const graph = analyze([['tests/fake.cjs', "function readFileSync(path) { return path }; readFileSync('cfg.json')"]], ['cfg.json'])
  assert.deepEqual(graph.inputEdges, [])
  assert.equal(graph.inputRisks.length, 1)
  assert.match(graph.inputRisks[0].reason, /lacks verified API receiver provenance/)
})

test('input-free call cycles preserve argument reads and nested reader evidence', () => {
  const graph = analyze([['tests/cycle.cjs', `const {readFileSync}=require('node:fs');
function left(value) { return right(value) }
function right(value) { left(value); return value }
left(readFileSync('argument.json'));
function outer() { const nested = () => readFileSync('nested.json'); return 0 }
outer();`]], ['argument.json', 'nested.json'])
  assert.deepEqual([...new Set(graph.inputEdges.map(edge => edge.to))].sort(), ['argument.json', 'nested.json'])
  assert.ok(graph.inputEdges.some(edge => edge.to === 'nested.json' && edge.expression === 'outer()'))
  assert.equal(graph.inputRisks.length, 0)
})
