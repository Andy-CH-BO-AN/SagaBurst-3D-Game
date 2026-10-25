const { test } = require('node:test')
const assert = require('node:assert/strict')
const { selectFiles } = require('../tooling/ci-plan.cjs')
const { dependencyConsumers } = require('../tooling/dependencies.cjs')
const { declarationSnapshot, changedDeclarations } = require('../tooling/behavior-changes.cjs')
const ts = require('typescript')

function selection(before, after, body, other = [], ownerFile = 'src/owner.ts') {
  const file = 'tests/owner.test.ts'
  const source = body.join('\n')
  const sources = new Map([[ownerFile, after], [file, source], ...other])
  const previousSources = new Map([[ownerFile, before], [file, source], ...other])
  const inventory = [...sources].filter(([path]) => path.startsWith('tests/')).map(([file, source]) => {
    const locations = source.split('\n').flatMap((line, index) => /^test\(/.test(line) ? [{ line: index + 1, column: 1 }] : [])
    return { file, runner: 'vitest', names: locations.map((_, index) => `case ${index}`), locations }
  })
  return selectFiles(inventory, [{ status: 'M', file: ownerFile }], dependencyConsumers(inventory, sources), {
    sources, previousSources, ranges: { [ownerFile]: [[[1, after.split('\n').length]], [[1, before.split('\n').length]]] },
    compilerOptions: { noLib: true, noResolve: true, types: [] },
  })
}
const indices = plan => plan.selectedCases['tests/owner.test.ts']

test('mixed comments and erased types do not widen a changed data declaration', () => {
  const before = `// old description
export type ID = 'old'
export const TABLE = { old: 1 }
export function unrelated() { return 0 }`
  const after = before.replace('old description', 'new description').replace("= 'old'", "= 'old' | 'new'")
    .replace('{ old: 1 }', '{ old: 1, added: 2 }')
  // This regression belongs to declaration diffing. The following selection
  // cases separately cover routing data owners without sibling import leaves.
  const snapshot = source => {
    const sf = ts.createSourceFile('src/owner.ts', source, ts.ScriptTarget.Latest, true)
    const byAst = new Map()
    for (const statement of sf.statements) {
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) byAst.set(declaration, declaration.name.text)
      } else if (ts.isFunctionDeclaration(statement)) byAst.set(statement, statement.name.text)
    }
    return declarationSnapshot(sf, byAst)
  }
  const current = snapshot(after), previous = snapshot(before)
  const forward = changedDeclarations(current, previous)
  const backward = changedDeclarations(previous, current)
  assert.deepEqual([...forward.ids], ['TABLE'])
  assert.deepEqual([...backward.ids], ['TABLE'])
  assert.equal(forward.moduleEffect, false)
  assert.equal(backward.moduleEffect, false)
})

test('shared data follows dynamic keys and nested destructuring aliases without selecting sibling imports', () => {
  const before = `export const TABLE = { nested: { values: [1] } }
export function unrelated() { return 0 }`
  const plan = selection(before, before.replace('[1]', '[2]'), [
    "import { TABLE, unrelated } from '../src/owner'",
    "test('dynamic', () => { const key = globalThis.key; return TABLE[key] })",
    "test('alias', () => { const { nested: { values: [first] } } = TABLE; return first })",
    "test('shorthand', () => ({ TABLE }))",
    "test('unrelated', () => unrelated())",
  ])
  assert.deepEqual(indices(plan), [0, 1, 2])
})

test('namespace dynamic reads and enumeration retain export owners while concrete siblings stay separate', () => {
  const before = 'export const TABLE = { value: 1 }; export const OTHER = 0'
  const plan = selection(before, before.replace('value: 1', 'value: 2'), [
    "import * as owner from '../src/owner'",
    "test('dynamic', () => owner[globalThis.key])",
    "test('enumeration', () => Object.keys(owner))",
    "test('literal', () => owner['TABLE'])",
    "test('other', () => owner.OTHER)",
  ])
  assert.deepEqual(indices(plan), [0, 1, 2])
})

test('eager initializer changes retain value consumers without selecting import-only siblings', () => {
  const before = 'export const value = 0; export function read() { return value }; export function unrelated() { return 0 }'
  const after = before.replace('value = 0', 'value = register()')
  const plan = selection(before, after, [
    "import { value, read, unrelated } from '../src/owner'",
    "test('value', () => value)",
    "test('caller', () => read())",
    "test('import only', () => unrelated())",
  ])
  assert.deepEqual(indices(plan), [0, 1])
  assert.deepEqual(plan.changedBehaviors, ['src/owner.ts#value'])
  assert.deepEqual(plan.details['tests/owner.test.ts'][0].initializationCases, [])
})

test('opaque import effects fail closed even alongside a covered value change', () => {
  const before = "import './registration'; export const value = 0"
  assert.throws(() => selection(before, 'export const value = 1', [
    "import { value } from '../src/owner'",
    "test('value', () => value)",
  ], [['src/registration.ts', 'globalThis.registered = true']]), /Unsafe\/unmapped behavior/)
})

test('new imported behavior is covered by its actual caller without manual initialization owners', () => {
  const before = 'export function unchanged() { return 0 }'
  const after = "import { value } from './values'; " + before + '; export function added() { return value }'
  const plan = selection(before, after, [
    "import { added, unchanged } from '../src/owner'",
    "test('affected caller', () => added())",
    "test('unrelated placement', () => unchanged())",
  ], [['src/values.ts', 'export const value = 1']])
  assert.deepEqual(indices(plan), [0])
  assert.ok(plan.details['tests/owner.test.ts'][0].caseEvidence.every(e => e.path[0].root))
})

test('retargeting an existing named import selects its unchanged caller but not unrelated exports', () => {
  const before = "import { first as chosen } from './values'; export { chosen }; export function read() { return chosen }; export function wrapped() { return { chosen } }; export function other() { return 0 }"
  const plan = selection(before, before.replace('first as', 'second as'), [
    "import { chosen, read, wrapped, other } from '../src/owner'",
    "test('binding', () => read())",
    "test('reexport', () => chosen)",
    "test('shorthand', () => wrapped())",
    "test('unrelated', () => other())",
  ], [['src/values.ts', 'export const first = 1; export const second = 2']])
  assert.deepEqual(indices(plan), [0, 1, 2])
  assert.deepEqual(plan.changedBehaviors, ['src/owner.ts#<import:chosen>'])
})

test('literal enum edits retain runtime enum users without expanding the module', () => {
  const before = 'export enum Mode { First = 1 }; export function other() { return 0 }'
  const plan = selection(before, before.replace('First = 1', 'First = 2'), [
    "import { Mode, other } from '../src/owner'",
    "test('enum', () => Mode.First)",
    "test('other', () => other())",
  ])
  assert.deepEqual(indices(plan), [0])
  assert.deepEqual(plan.changedBehaviors, ['src/owner.ts#Mode'])
})

test('a covered initialization effect cannot hide a different unmapped callable change', () => {
  const before = 'export const value = register(); export function untested() { return 1 }'
  assert.throws(() => selection(before, before.replace('register()', 'register(2)').replace('return 1', 'return 2'), [
    "import { value } from '../src/owner'",
    "test('registration', () => value)",
  ]), /Unsafe\/unmapped behavior: src\/owner.ts#untested/)
})


test('unreferenced module assignments do not expand data changes to import-only leaves', () => {
  const before = 'export const TABLE = { value: 1 }; globalThis.saved = TABLE.value; export function unrelated() { return 0 }'
  const plan = selection(before, before.replace('value: 1', 'value: 2'), [
    "import { TABLE, unrelated } from '../src/owner'",
    "test('direct', () => TABLE.value)",
    "test('effect', () => { unrelated(); return globalThis.saved })",
  ])
  assert.deepEqual(indices(plan), [0])
  assert.deepEqual(plan.details['tests/owner.test.ts'][0].initializationCases, [])
})

test('unreferenced static blocks do not expand data changes to every importer', () => {
  const before = 'export const TABLE = { value: 1 }; class Registrar { static { globalThis.saved = TABLE.value } }; export function other() { return 0 }'
  const plan = selection(before, before.replace('value: 1', 'value: 2'), [
    "import { TABLE, other } from '../src/owner'",
    "test('direct', () => TABLE.value)",
    "test('effect', () => { other(); return globalThis.saved })",
  ])
  assert.deepEqual(indices(plan), [0])
})

test('class extends imports remain runtime bindings and retain possible definition-time effects', () => {
  const before = "import { First as Base } from './values'; export class Child extends Base {}; export function other() { return 1 }"
  const plan = selection(before, before.replace('First as', 'Second as').replace('return 1', 'return 2'), [
    "import { Child, other } from '../src/owner'",
    "test('heritage', () => new Child().kind)",
    "test('other', () => other())",
  ], [['src/values.ts', 'export class First { kind = 1 }; export class Second { kind = 2 }']])
  assert.deepEqual(indices(plan), [0, 1])
  assert.ok(plan.changedBehaviors.includes('src/owner.ts#<import:Base>'))
})


test('coercion initializers remain value owners instead of blanket import owners', () => {
  const before = 'export const value = +{ valueOf() { globalThis.saved = 1; return 0 } }; export function other() { return 0 }'
  const plan = selection(before, before.replace('saved = 1', 'saved = 2'), [
    "import { value, other } from '../src/owner'",
    "test('direct', () => value)",
    "test('effect', () => { other(); return globalThis.saved })",
  ])
  assert.deepEqual(indices(plan), [0])
  assert.deepEqual(plan.changedBehaviors, ['src/owner.ts#value'])
})

test('scoped hooks and consumed callbacks exclude sibling unused closure definitions', () => {
  const before = 'export const TABLE = { value: 1 }; export function other() { return 0 }'
  const plan = selection(before, before.replace('value: 1', 'value: 2'), [
    "import { TABLE, other } from '../src/owner'",
    "function factory() { return () => TABLE.value }",
    "describe('scope', () => {",
    "beforeEach(() => TABLE.value)",
    "test('hook', () => other())",
    "})",
    "test('outside', () => { function unused() { return TABLE.value }; const unusedArrow = () => TABLE.value; return other() })",
    "test('callback', () => [0].map(() => TABLE.value))",
    "test('creation only', () => { factory(); return other() })",
    "test('returned callback invoked', () => { const callback = factory(); return callback() })",
  ])
  assert.deepEqual(indices(plan), [0, 2, 4])
})

test('replacement mocks remain boundaries while partial mocks retain precise data dependencies', () => {
  const before = 'export const TABLE = { value: 1 }'
  const plan = selection(before, before.replace('value: 1', 'value: 2'), [
    "import { TABLE } from '../src/owner'",
    "test('real', () => TABLE.value)",
  ], [
    ['tests/replaced.test.ts', "import { TABLE } from '../src/owner'\nvi.mock('../src/owner', () => ({ TABLE: { value: 0 } }))\ntest('mocked', () => TABLE.value)"],
    ['tests/partial.test.ts', "import { TABLE } from '../src/owner'\nvi.mock('../src/owner', async importOriginal => ({ ...await importOriginal() }))\ntest('partial', () => TABLE.value)"],
  ])
  assert.deepEqual(plan.selected, ['tests/owner.test.ts', 'tests/partial.test.ts'])
})

test('TSX runtime edits are not erased into an identical type-only fingerprint', () => {
  const before = "import { First, Second } from './components'; export function render() { return <First /> }; export function other() { return 0 }"
  const after = before.replace('<First />', '<Second />')
  const { runtimeEquivalent } = require('../tooling/dependencies.cjs')
  assert.equal(runtimeEquivalent(before, after, 'src/owner.tsx'), false)
  const plan = selection(before, after, [
    "import { render, other } from '../src/owner'",
    "test('render', () => render())",
    "test('other', () => other())",
  ], [['src/components.ts', 'export function First() { return null }; export function Second() { return null }']], 'src/owner.tsx')
  assert.deepEqual(indices(plan), [0])
})

test('class-expression heritage keeps retargeted import bindings in the runtime graph', () => {
  const before = "import { First as Base } from './values'; export const Child = class extends Base {}; export function other() { return 1 }"
  const plan = selection(before, before.replace('First as', 'Second as').replace('return 1', 'return 2'), [
    "import { Child, other } from '../src/owner'",
    "test('heritage', () => new Child().kind)",
    "test('other', () => other())",
  ], [['src/values.ts', 'export class First { kind = 1 }; export class Second { kind = 2 }']])
  assert.deepEqual(indices(plan), [0, 1])
  assert.ok(plan.changedBehaviors.includes('src/owner.ts#<import:Base>'))
})


test('JSX-only imports remain runtime dependencies when the rendered owner changes', () => {
  const before = 'export function First() { return 1 }'
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { First } from '../src/components'",
    "import { render } from '../src/view'",
    "test('direct', () => First())",
    "test('view', () => render())",
  ], [['src/view.tsx', "import { First } from './components'; export function render() { return <First /> }"]], 'src/components.ts')
  assert.deepEqual(indices(plan), [0, 1])
})


test('declaration-only source filenames contribute no runtime imports or emit failures', () => {
  const { runtimeEquivalent } = require('../tooling/dependencies.cjs')
  const file = 'src/environment.d.ts'
  const source = "import type { Value } from './types'; declare global { interface Window { value: Value } }"
  const graph = dependencyConsumers([], new Map([[file, source]]))
  assert.deepEqual(graph.graph.get(file), [])
  assert.deepEqual(graph.unresolvedImports, [])
  assert.equal(runtimeEquivalent(source, source.replace('value: Value', 'value: string'), file), true)
})


test('class field shape changes retain construction and reflection owners without sibling imports', () => {
  const before = `export class Owner { old = 1 }
export function read() { return new Owner() }
export function unrelated() { return 0 }`
  const plan = selection(before, before.replace('old =', 'current ='), [
    "import { Owner, read, unrelated } from '../src/owner'",
    "test('construction', () => new Owner())",
    "test('reflection', () => Object.getOwnPropertyNames(new Owner()))",
    "test('caller', () => read())",
    "test('import only', () => unrelated())",
  ])
  assert.deepEqual(indices(plan), [0, 1, 2])
  assert.ok(plan.changedBehaviors.includes('src/owner.ts#Owner.<instance shape>'))
  assert.ok(!plan.changedBehaviors.includes('src/owner.ts#<module>'))
})

test('receiver provenance and finite keys exclude same-name methods and mere class references', () => {
  const before = 'export class Owner { update() { return 1 } other() { return 0 } }; export class Unrelated { update() { return 9 } apply() { return 0 } }'
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { Owner, Unrelated } from '../src/owner'",
    "test('direct', () => Owner.prototype.update.call({}))",
    "test('finite alias', () => { const receiver = Owner.prototype; const key = 'update'; const callback = receiver[key]; return callback.call({}) })",
    "test('same name', () => { const values: { [key: string]: Unrelated } = {}; values[globalThis.key].apply(); return Unrelated.prototype.update.call({}) })",
    "test('reference', () => Owner)",
    "test('sibling', () => Owner.prototype.other.call({}))",
    "test('type-only receiver', () => { const invoke = (actor: Owner) => actor.update(); globalThis.consume(invoke) })",
  ], [['tests/unrelated.test.ts', [
    "const bindings = globalThis.bindings",
    "function unusedImport(name) { return import(name) }",
    "test('unrelated same name', () => bindings.update())",
  ].join('\n')]])
  assert.deepEqual(plan.selected, ['tests/owner.test.ts'])
  assert.deepEqual(indices(plan), [0, 1, 5])
  assert.ok(plan.details['tests/owner.test.ts'][0].caseEvidence.some(e => e.path.some(p => p.key === 'update')))
  assert.ok(plan.details['tests/owner.test.ts'][0].caseEvidence.some(e => e.index === 5 && e.reason === 'finite receiver dependency' && e.path.some(p => p.evidence === 'receiver type; runtime allocation unproven')))
})

test('unknown receiver dispatch fails with expression evidence rather than expanding member names', () => {
  const before = 'export class Owner { update() { return 1 } }'
  assert.throws(() => selection(before, before.replace('return 1', 'return 2'), [
    "import { Owner } from '../src/owner'",
    "test('opaque', () => { const receiver = Owner.prototype; return receiver[globalThis.key]() })",
  ]), /Unsafe runtime dispatch:.*receiver Owner.prototype; missing finite property keys/)
})

test('CommonJS export identities preserve exact callers without module-wide consumer union', () => {
  const before = 'function first() { return 1 }; function second() { return 2 }; module.exports = { chosen: first, second }'
  const plan = selection(before, before.replace('chosen: first', 'chosen: second'), [
    "const { chosen, second } = require('../src/owner.cjs')",
    "test('retargeted export', () => chosen())",
    "test('unchanged export', () => second())",
  ], [], 'src/owner.cjs')
  assert.deepEqual(indices(plan), [0])
  assert.ok(plan.details['tests/owner.test.ts'][0].caseEvidence.some(e => e.path.some(p => p.evidence === 'CommonJS export binding')))
})

test('actual input readers exclude full provider replacements but retain partial and restored reads', () => {
  const { selectBehaviors } = require('../tooling/behavior.cjs')
  const sources = new Map([
    ['src/read.ts', "import { readFileSync } from 'node:fs'; export function read() { return readFileSync('config.json', 'utf8') }"],
    ['tests/real.test.ts', "import { read } from '../src/read'\ntest('real', () => read())"],
    ['tests/replaced.test.ts', "import { read } from '../src/read'\nvi.mock('node:fs', () => ({ readFileSync: () => 'fake' }))\ntest('replaced', () => read())"],
    ['tests/partial.test.ts', "import { read } from '../src/read'\nvi.mock('node:fs', async importOriginal => ({ ...await importOriginal() }))\ntest('partial', () => read())"],
    ['tests/scoped.test.ts', [
      "import * as fs from 'node:fs'; import { read } from '../src/read'",
      "afterEach(() => vi.restoreAllMocks())",
      "test('replaced', () => { const replacement = vi.spyOn(fs, 'readFileSync').mockReturnValue('fake'); return read() })",
      "test('restored', () => { const replacement = vi.spyOn(fs, 'readFileSync').mockReturnValue('fake'); replacement.mockRestore(); return read() })",
    ].join('\n')],
  ])
  const inventory = [...sources].filter(([file]) => file.startsWith('tests/')).map(([file, source]) => {
    const locations = source.split('\n').flatMap((line,index) => line.startsWith('test(') ? [{line:index+1,column:1}] : [])
    return {file, names:locations.map((_,index)=>`case ${index}`), locations}
  })
  const files = new Set([...sources.keys(), 'config.json'])
  const consumers = dependencyConsumers(inventory, sources, file=>files.has(file), {files})
  const plan = selectBehaviors(inventory, [{status:'M',file:'config.json'}], consumers, {
    sources,previousSources:sources,previousConsumers:consumers,ranges:{},compilerOptions:{noLib:true,noResolve:true,types:[]},
  })
  assert.deepEqual(plan.selected, ['tests/partial.test.ts','tests/real.test.ts','tests/scoped.test.ts'])
  assert.deepEqual(plan.selectedCases['tests/scoped.test.ts'], [1])
})

test('null defaults short-circuit constructor getters without losing real or mixed call contexts', () => {
  const before = `export class Inventory { get value() { return 1 } }
class Reader { value: number; constructor(inventory: Inventory | null = null) { this.value = inventory?.value ?? 0 } }
export function make(inventory: Inventory | null = null) { return new Reader(inventory) }
export function mutated(inventory: Inventory | null = null) { ({ inventory } = { inventory: new Inventory() }); return new Reader(inventory) }
export function loop(inventory: Inventory | null = null) { for (inventory of [new Inventory()]) return new Reader(inventory) }`
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { Inventory, make, mutated, loop } from '../src/owner'",
    "test('omitted', () => make())",
    "test('undefined default', () => make(undefined))",
    "test('explicit null', () => make(null))",
    "test('real getter', () => make(new Inventory()))",
    "test('mixed calls', () => { make(); return make(new Inventory()) })",
    "test('unknown input', () => make(globalThis.inventory))",
    "test('mutated default', () => mutated())",
    "test('loop assignment', () => loop())",
    "test('escaped arrow', () => { const read = (inventory: Inventory | null = null) => inventory?.value; read(); globalThis.consume(read) })",
  ])
  assert.deepEqual(indices(plan), [3, 4, 5, 6, 7, 8])
  const mixed = plan.details['tests/owner.test.ts'][0].caseEvidence.find(evidence => evidence.index === 4 && evidence.snapshot === 'after')
  assert.equal(mixed.path.find(step => step.behavior === 'make').parameters[0].value, 'present')
  assert.ok(mixed.path.some(step => step.optionalGuard?.some(guard => guard.value === 'present')))
})


test('source-byte readers remain input owners alongside executed declarations', () => {
  const { selectBehaviors } = require('../tooling/behavior.cjs')
  const sourceFile = 'src/value.cjs', file = 'tests/bytes.test.cjs'
  const before = 'exports.value = () => 1', after = 'exports.value = () => 2'
  const testSource = [
    "const { readFileSync } = require('node:fs'); const { value } = require('../src/value.cjs')",
    "test('executes', () => value())",
    "test('source bytes', () => readFileSync('src/value.cjs', 'utf8'))",
    "test('unrelated bytes', () => readFileSync('src/other.cjs', 'utf8'))",
  ].join('\n')
  const sources = new Map([[sourceFile, after], ['src/other.cjs', 'exports.other = 0'], [file, testSource]])
  const previousSources = new Map(sources); previousSources.set(sourceFile, before)
  const inventory = [{ file, names: ['executes', 'source bytes', 'unrelated bytes'], locations: [2,3,4].map(line => ({ line, column: 1 })) }]
  const files = new Set(sources.keys())
  const consumers = dependencyConsumers(inventory, sources, path => files.has(path), { files })
  const previousConsumers = dependencyConsumers(inventory, previousSources, path => files.has(path), { files })
  const plan = selectBehaviors(inventory, [{ status: 'M', file: sourceFile }], consumers, {
    sources, previousSources, previousConsumers, ranges: {}, compilerOptions: { noLib: true, noResolve: true, types: [] },
  })
  assert.deepEqual(plan.selectedCases[file], [0, 1])
  assert.ok(plan.details[file][0].caseEvidence.some(evidence => evidence.index === 1 && evidence.path.some(step => step.behavior === '<input:src/value.cjs>')))
  const commentSources = new Map(previousSources); commentSources.set(sourceFile, `${before} // bytes changed`)
  const bytesOnly = selectFiles(inventory, [{ status: 'M', file: sourceFile }], previousConsumers, {
    sources: commentSources, previousSources, previousConsumers, ranges: {}, compilerOptions: { noLib: true, noResolve: true, types: [] },
  })
  assert.deepEqual(bytesOnly.selectedCases[file], [1])
  assert.deepEqual(bytesOnly.typeOnlyFiles, [])
})

function directoryPlan(setup, entries, changed = {status:'M',file:'payload/a.txt'}, planner = false) {
  const { selectBehaviors } = require('../tooling/behavior.cjs')
  const reader = 'src/read.cjs', file = 'tests/list.test.cjs'
  const readSource = "const fs = require('node:fs'); exports.read = () => { for (const name of fs.readdirSync('registry').filter(name => name.endsWith('.txt'))) fs.readFileSync('payload/' + name, 'utf8') }"
    const testSource = "const { test, mock } = require('node:test'); const fs = require('node:fs'); const { read } = require('../src/read.cjs')\n" +
      `test('read', (t) => { ${setup}; read() })`
    const sources = new Map([[reader, readSource], [file, testSource], ['src/comment.cjs', 'exports.value = 1 // changed bytes']])
    const previousSources = changed.file === 'src/comment.cjs' ? new Map(sources) : sources
    if (previousSources !== sources) previousSources.set('src/comment.cjs', 'exports.value = 1')
    const inventory = [{file, names:['read'], locations:[{line:2,column:1}]}]
    const previousFiles = new Set([...sources.keys(), ...entries]), files = new Set(previousFiles)
    if (changed.status === 'D') files.delete(changed.file)
    if (changed.status.startsWith('R')) { files.delete(changed.oldFile); files.add(changed.file) }
    const consumers = dependencyConsumers(inventory, sources, path => files.has(path), {files})
    const previousConsumers = previousSources === sources && !['D','R'].includes(changed.status[0]) ? consumers : dependencyConsumers(inventory, previousSources, path => previousFiles.has(path), {files:previousFiles})
    return (planner ? selectFiles : selectBehaviors)(inventory, [changed], consumers, {
      sources, previousSources, previousConsumers, files, previousFiles, ranges:{}, compilerOptions:{noLib:true,noResolve:true,types:[]},
    })
  }

const directoryCases = [
  { name: 'real listing retains its possible payload reader', setup: '', entries: ['registry/a.txt','payload/a.txt'], selectedCases: [0] },
  { name: 'shadowed require cannot impersonate a mocked provider', setup: "{ const require = () => ({}); const fake = require('node:fs'); t.mock.method(fake, 'readdirSync', () => []) }", entries: ['registry/a.txt','payload/a.txt'], selectedCases: [0] },
  { name: 'Node TestContext listing replacement is uncertain', setup: "t.mock.method(fs, 'readdirSync', () => ['a.txt'])", entries: ['registry/a.txt','payload/a.txt'], unsafe: true },
  { name: 'imported native mock cannot justify an empty listing set', setup: "mock.method(fs, 'readdirSync', () => ['a.txt'])", entries: ['registry/ignored.bin','payload/a.txt'], unsafe: true },
  { name: 'unresolved tracker cannot justify an empty listing set', setup: "globalThis.tracker.method(fs, 'readdirSync', () => ['a.txt'])", entries: ['registry/ignored.bin','payload/a.txt'], unsafe: true },
  { name: 'member content changes do not change listed names', setup: '', entries: ['registry/a.txt','payload/a.txt'], changed: {status:'M',file:'registry/a.txt'}, unobserved: ['registry/a.txt'] },
  { name: 'added directory member retains the listing consumer', setup: '', entries: ['registry/a.txt','payload/a.txt'], changed: {status:'A',file:'registry/a.txt'}, selectedCases: [0] },
  { name: 'deleted directory member retains conservative lifecycle owner', setup: '', entries: ['registry/a.txt','payload/a.txt'], changed: {status:'D',file:'registry/a.txt'}, planner: true, selected: ['tests/list.test.cjs'] },
  { name: 'renamed directory member retains conservative lifecycle owner', setup: '', entries: ['registry/a.txt','payload/a.txt'], changed: {status:'R100',oldFile:'registry/a.txt',file:'registry/b.txt'}, planner: true, selected: ['tests/list.test.cjs'] },
  { name: 'unread source comment qualifies only after listing proof', setup: '', entries: ['registry/ignored.bin','payload/a.txt'], changed: {status:'M',file:'src/comment.cjs'}, planner: true, typeOnly: ['src/comment.cjs'] },
  { name: 'source comment cannot bypass unknown listing replacement', setup: "globalThis.tracker.method(fs, 'readdirSync', () => ['a.txt'])", entries: ['registry/ignored.bin','payload/a.txt'], changed: {status:'M',file:'src/comment.cjs'}, planner: true, unsafe: true },
  { name: 'documentation cannot bypass unknown listing replacement', setup: "globalThis.tracker.method(fs, 'readdirSync', () => ['a.txt'])", entries: ['registry/ignored.bin','payload/a.txt'], changed: {status:'M',file:'README.md'}, planner: true, unsafe: true },
]
for (const scenario of directoryCases) test(`directory provenance: ${scenario.name}`, () => {
  const run = () => directoryPlan(scenario.setup, scenario.entries, scenario.changed, scenario.planner)
  if (scenario.unsafe) { assert.throws(run, /Unsafe runtime directory membership/); return }
  const result = run()
  if (scenario.selectedCases) assert.deepEqual(result.selectedCases['tests/list.test.cjs'], scenario.selectedCases)
  if (scenario.selected) assert.deepEqual(result.selected, scenario.selected)
  if (scenario.typeOnly) assert.deepEqual(result.typeOnlyFiles, scenario.typeOnly)
  if (scenario.unobserved) { assert.deepEqual(result.selected, []); assert.deepEqual(result.unobservedInputCandidates, scenario.unobserved) }
})

for (const [name, setup] of [
  ['spy', "vi.spyOn(fs, 'readFileSync').mockReturnValue('fake')"],
  ['module mock', "vi.mock('node:fs', () => ({ readFileSync: () => 'fake' }))"],
]) test(`captured CommonJS reader cannot be excluded by a later ${name}`, () => {
  const { selectBehaviors } = require('../tooling/behavior.cjs')
  const file = 'tests/captured.test.ts'
  const sources = new Map([
    ['src/read.cjs', "const { readFileSync } = require('node:fs'); exports.read = () => readFileSync('config.json', 'utf8')"],
    [file, ["import * as fs from 'node:fs'; const { read } = require('../src/read.cjs')", `test('replacement', () => { ${setup}; read() })`, "test('plain', () => read())"].join('\n')],
  ])
  const inventory = [{ file, names:['replacement','plain'], locations:[{line:2,column:1},{line:3,column:1}] }]
  const files = new Set([...sources.keys(), 'config.json'])
  const consumers = dependencyConsumers(inventory, sources, path => files.has(path), {files})
  assert.throws(() => selectBehaviors(inventory, [{status:'M',file:'config.json'}], consumers, {
    sources, previousSources:sources, previousConsumers:consumers, ranges:{}, compilerOptions:{noLib:true,noResolve:true,types:[]},
  }), error => /Unsafe runtime input.*ambiguous replacement/.test(error.message) && error.diagnostics.caseIndex === 0)
})
