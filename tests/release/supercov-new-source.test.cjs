'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const ts = require('typescript')
const { analyzeNewSources, requireNewSourceProof, structuralProblems } = require('../tooling/supercov-new-source.cjs')
const { decodeAffected } = require('../tooling/supercov-related.cjs')

// A small repository in memory: real TypeScript parsing and module resolution,
// no game modules and no filesystem.
function repository(files) {
  const root = '/repo'
  const absolute = new Map(Object.entries(files).map(([file, text]) => [root + '/' + file, text]))
  const fileExists = path => absolute.has(path)
  return {
    root,
    options: { moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext,
      baseUrl: root, paths: { '@/*': ['src/*'] } },
    files: () => Object.keys(files),
    readFile: file => files[file],
    moduleHost: { fileExists, readFile: path => absolute.get(path), directoryExists: () => true },
    assetExists: path => fileExists(path) || path === root + '/node_modules/three',
  }
}
const NEW = 'src/new.ts'
const newModule = { [NEW]: 'export const created = () => 1' }
const analyze = files => analyzeNewSources([NEW], repository({ ...newModule, ...files }))
const loaders = files => analyze(files).sources[0].testFiles
const problems = files => structuralProblems(analyze(files))

test('barrels, path aliases and indirect imports prove a test loads the module', () => {
  assert.deepEqual(loaders({
    'src/barrel.ts': "export * from '@/new'",
    'src/user.ts': "import { created } from './barrel'\nexport const use = () => created()",
    'tests/user.test.ts': "import { use } from '../src/user'\nuse()",
  }), ['tests/user.test.ts'])
})
test('type-only imports, including ones without the keyword, do not load the module', () => {
  for (const line of ["import type { Shape } from '../src/new'", "import { type Shape } from '../src/new'",
    "export type { Shape } from '../src/new'", "import { Shape } from '../src/new'"]) {
    assert.deepEqual(loaders({ 'tests/t.test.ts': line + '\nconst value: Shape | null = null\nexport { value as other }' }), [], line)
  }
  assert.deepEqual(loaders({ 'tests/t.test.ts': "import { created } from '../src/new'\ncreated()" }), ['tests/t.test.ts'])
})
test('an import shadowed by a local name or parameter does not load the module', () => {
  const imported = "import { created } from '../src/new'\n"
  for (const body of ["it('dummy', () => { const created = 1; expect(created).toBe(1) })",
    'export const use = (created: number) => created']) {
    assert.deepEqual(loaders({ 'tests/t.test.ts': imported + body }), [], body)
  }
  for (const body of ['export const use = () => created()', 'export { created }', 'export const held = { created }']) {
    assert.deepEqual(loaders({ 'tests/t.test.ts': imported + body }), ['tests/t.test.ts'], body)
  }
})
test('a test dynamic import counts only when running the test certainly reaches it', () => {
  const load = "await import('../src/new')"
  for (const body of ['if (false) { ' + load + ' }', 'const never = async () => { ' + load + ' }\nexport { never }',
    "for (const name of []) { void name; " + load + " }", 'flag && ' + load, 'flag ? ' + load + ' : null',
    "it('dummy', async () => { if (flag) { " + load + " } })", "vi.mock('../src/other', async () => " + load + ')']) {
    assert.deepEqual(loaders({ 'tests/t.test.ts': body }), [], body)
  }
  for (const body of [load, "it('dummy', async () => { " + load + " })", "beforeEach(async () => { " + load + " })",
    "it.each([1])('dummy %i', async () => { try { " + load + " } finally { done() } })"]) {
    assert.deepEqual(loaders({ 'tests/t.test.ts': body }), ['tests/t.test.ts'], body)
  }
})
test('a module that declares only types needs no test; one with code does', () => {
  const types = { [NEW]: "import type { A } from './a'\nexport interface B extends A {}\nexport type C = B\ndeclare const d: C\nexport { type d }" }
  const analysis = analyzeNewSources([NEW], repository({ ...types, 'src/a.ts': 'export interface A {}' }))
  assert.equal(analysis.sources[0].typeOnly, true)
  assert.deepEqual(structuralProblems(analysis), [])
  assert.equal(analyze({}).sources[0].typeOnly, false)
})
test('production dynamic imports are no proof, a test importing the module itself is', () => {
  const lazy = { 'src/lazy.ts': "export const load = () => import('./new')", 'tests/l.test.ts': "import { load } from '../src/lazy'\nload()" }
  assert.deepEqual(loaders(lazy), [])
  assert.deepEqual(loaders({ 'tests/d.test.ts': "await import('../src/new')" }), ['tests/d.test.ts'])
})
test('computed loaders and unresolved specifiers make the graph unprovable', () => {
  for (const source of ['export const load = (name: string) => import(name)',
    "export const all = import.meta.glob('./*.ts')", "import { gone } from './missing'\ngone()"]) {
    const found = problems({ 'src/loader.ts': source, 'tests/t.test.ts': "import { created } from '../src/new'\ncreated()" })
    assert.equal(found.length, 1, source)
    assert.match(found[0], /module graph cannot be proven complete: src\/loader\.ts/)
  }
  assert.deepEqual(problems({ 'src/asset.ts': "import 'three'\nimport { x } from '@/new'\nexport const y = x",
    'tests/t.test.ts': "import { y } from '../src/asset'\ny()" }), [])
})
test('a module replaced with vi.mock is not loaded, nor anything behind it', () => {
  const mocked = { 'src/user.ts': "import { created } from './new'\nexport const use = created",
    'tests/m.test.ts': "import { vi } from 'vitest'\nvi.mock('../src/user', () => ({}))\nimport { use } from '../src/user'\nuse()" }
  assert.deepEqual(loaders(mocked), [])
  assert.match(problems(mocked)[0], /src\/new\.ts: no test file loads it \(imported by src\/user\.ts\)/)
})
test('a new test file that never loads the module proves nothing', () => {
  const found = problems({ 'tests/new.test.ts': "import { other } from '../src/other'\nother()", 'src/other.ts': 'export const other = () => 2' })
  assert.match(found[0], /src\/new\.ts: no test file loads it \(nothing imports it\)/)
})
function proof(selectedFiles, directTests, baseline = 1) {
  const analysis = analyze({
    'src/user.ts': "import { created } from './new'\nexport const use = created",
    'tests/a.test.ts': "import { use } from '../src/user'\nuse()",
    'tests/b.test.ts': "import { created } from '../src/new'\ncreated()",
  })
  return requireNewSourceProof(analysis, { selectedFiles, directTests, baselineTests: () => baseline })
}
test('verified only when every loader is selected and each importer has test evidence', () => {
  const both = ['tests/a.test.ts', 'tests/b.test.ts']
  assert.deepEqual(proof(both, ['tests/b.test.ts']).problems, [])
  assert.match(proof(['tests/b.test.ts'], ['tests/b.test.ts']).problems[0], /did not select test files that load it: tests\/a\.test\.ts/)
  // A zero-attribution importer needs an added or modified test that loads it now.
  assert.match(proof(both, ['tests/b.test.ts'], 0).problems[0], /existing importer src\/user\.ts has no baseline test attribution/)
  assert.deepEqual(proof(both, ['tests/a.test.ts'], 0).problems, [])
})

const run = 'run_abcdef0123'
const leaf = name => ({ file: 'tests/a.test.ts', name })
function native(affected) {
  return { schemaVersion: 1, ok: true, command: 'runs.tests.affected', data: { run, affected, undetermined: [], unaffected: [leaf('B')],
    summary: { tests: affected.length + 1, affected: affected.length, undetermined: 0, unaffected: 1 },
    workingTree: { stale: true, reasons: [], runWide: [], sourceSetChanged: false } } }
}
const inventory = [
  { runner: 'vitest', file: 'tests/a.test.ts', names: ['A', 'B'] },
  { runner: 'vitest', file: 'tests/new.test.ts', names: ['N1', 'N2'] },
  { runner: 'node', file: 'tests/release/gate.test.cjs', names: ['contract'] },
]
const analysisFor = source => ({ blocking: [], sources: [{ file: NEW, typeOnly: false, importers: [], ...source }] })
const added = [{ status: 'A', file: NEW }, { status: 'A', file: 'tests/new.test.ts' }, { status: 'M', file: 'src/user.ts' }]
test('new runtime and new test select their union with a reconciling breakdown', () => {
  const selection = decodeAffected(native([leaf('A')]), inventory, added, run, {
    newSourceAnalysis: analysisFor({ testFiles: ['tests/a.test.ts', 'tests/new.test.ts'] }) })
  assert.deepEqual(selection.selectedCases['tests/a.test.ts'], [0])
  assert.deepEqual(selection.selectedCases['tests/new.test.ts'], [0, 1])
  assert.deepEqual(selection.breakdown, { nativeAffected: 1, nativeUndetermined: 0, directTests: 2,
    nodeContracts: 1, duplicatesRemoved: 0, total: 4 })
  assert.match(selection.newSources[0].verdict, /loaded by 2 selected test files \(1 added\/modified\)/)
})
test('a new source and test alone may have zero native attribution, a modified source may not', () => {
  const changes = added.filter(change => change.status === 'A')
  const baseline = { newSourceAnalysis: analysisFor({ testFiles: ['tests/new.test.ts'] }) }
  assert.equal(decodeAffected(native([]), inventory, changes, run, baseline).breakdown.total, 3)
  assert.throws(() => decodeAffected(native([]), inventory, added, run, baseline), /returned zero.*src\/user\.ts/)
})
test('an added runtime source without a verified analysis or test relation fails closed', () => {
  assert.throws(() => decodeAffected(native([leaf('A')]), inventory, added, run), /no verified module analysis: src\/new\.ts/)
  assert.throws(() => decodeAffected(native([leaf('A')]), inventory, added, run, {
    newSourceAnalysis: analysisFor({ testFiles: [] }) }), /src\/new\.ts: no test file loads it/)
  assert.throws(() => decodeAffected(native([leaf('A')]), inventory, added, run, {
    newSourceAnalysis: analysisFor({ testFiles: ['tests/unselected.test.ts'] }) }), /did not select test files/)
})
