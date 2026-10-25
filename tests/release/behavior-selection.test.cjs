const { test } = require('node:test')
const assert = require('node:assert/strict')
const { selectFiles } = require('../tooling/ci-plan.cjs')
const { dependencyConsumers } = require('../tooling/dependencies.cjs')
const { declarationSnapshot, changedDeclarations } = require('../tooling/behavior-changes.cjs')
const ts = require('typescript')

function selection(before, after, body, other = [], ownerFile = 'src/owner.ts', file = 'tests/owner.test.ts') {
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
  ], [], 'src/owner.js', 'tests/owner.test.js')
  assert.deepEqual(plan.selectedCases['tests/owner.test.js'], [0, 1, 2])
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

test('eager initializer changes retain their actual shared module initialization', () => {
  const before = 'export const value = 0; export function read() { return value }; export function unrelated() { return 0 }'
  const after = before.replace('value = 0', 'value = register()')
  const plan = selection(before, after, [
    "import { value, read, unrelated } from '../src/owner'",
    "test('value', () => value)",
    "test('caller', () => read())",
    "test('import only', () => unrelated())",
  ])
  assert.deepEqual(indices(plan), [0, 1, 2])
  assert.deepEqual(plan.changedBehaviors, ['src/owner.ts#value'])
  assert.ok(plan.details['tests/owner.test.ts'][0].initializationCases.includes(2))
  assert.ok(plan.details['tests/owner.test.ts'][0].caseEvidence.some(evidence => evidence.index === 2 && evidence.path.some(step => step.evidence === 'actual module initialization')))
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


test('executed module assignments retain their actual shared initialization reads', () => {
  const before = 'export const TABLE = { value: 1 }; globalThis.saved = TABLE.value; export function unrelated() { return 0 }'
  const plan = selection(before, before.replace('value: 1', 'value: 2'), [
    "import { TABLE, unrelated } from '../src/owner'",
    "test('direct', () => TABLE.value)",
    "test('effect', () => { unrelated(); return globalThis.saved })",
  ])
  assert.deepEqual(indices(plan), [0, 1])
  assert.ok(plan.details['tests/owner.test.ts'][0].initializationCases.includes(1))
})

test('executed static blocks retain their actual shared initialization reads', () => {
  const before = 'export const TABLE = { value: 1 }; class Registrar { static { globalThis.saved = TABLE.value } }; export function other() { return 0 }'
  const plan = selection(before, before.replace('value: 1', 'value: 2'), [
    "import { TABLE, other } from '../src/owner'",
    "test('direct', () => TABLE.value)",
    "test('effect', () => { other(); return globalThis.saved })",
  ])
  assert.deepEqual(indices(plan), [0, 1])
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


test('coercion initializers retain value owners and actual initialization roots', () => {
  const before = 'export const value = +{ valueOf() { globalThis.saved = 1; return 0 } }; export function other() { return 0 }'
  const plan = selection(before, before.replace('saved = 1', 'saved = 2'), [
    "import { value, other } from '../src/owner'",
    "test('direct', () => value)",
    "test('effect', () => { other(); return globalThis.saved })",
  ])
  assert.deepEqual(indices(plan), [0, 1])
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
    ['src/read.ts', "import fs from 'node:fs'; export function read() { return fs.readFileSync('config.json', 'utf8') }"],
    ['tests/real.test.ts', "import { read } from '../src/read'\ntest('real', () => read())"],
    ['tests/replaced.test.ts', "import { read } from '../src/read'\nvi.mock('node:fs', () => ({ default: { readFileSync: () => 'fake' } }))\ntest('replaced', () => read())"],
    ['tests/partial.test.ts', "import { read } from '../src/read'\nvi.mock('node:fs', async importOriginal => ({ ...await importOriginal() }))\ntest('partial', () => read())"],
    ['tests/scoped.test.ts', [
      "import fs from 'node:fs'; import { read } from '../src/read'",
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

for (const scenario of [
  { name:'bounded report output does not block its changed caller', expression:"'output/test-budget/' + globalThis.report + '.json'", changed:'src/owner.cjs', selected:true },
  { name:'unknown reader matching a changed asset fails closed', expression:"'config/' + globalThis.name + '.json'", changed:'config/a.json' },
  { name:'unknown reader matching changed source bytes fails closed', expression:"'src/' + globalThis.name + '.cjs'", changed:'src/input.cjs' },
]) test(`read-risk relevance: ${scenario.name}`, () => {
  const { selectBehaviors } = require('../tooling/behavior.cjs')
  const file = 'tests/reader.test.cjs'
  const before = `const fs = require('node:fs'); function run() { fs.readFileSync(${scenario.expression}, 'utf8'); return 1 }; exports.run = run`
  const sources = new Map([
    ['src/owner.cjs', scenario.selected ? before.replace('return 1','return 2') : before],
    ['src/input.cjs', 'exports.value = 2'],
    [file, "const { run } = require('../src/owner.cjs')\ntest('run', () => run())"],
  ])
  const previousSources = new Map(sources); previousSources.set('src/owner.cjs', before); previousSources.set('src/input.cjs','exports.value = 1')
  const inventory = [{file,names:['run'],locations:[{line:2,column:1}]}]
  const files = new Set([...sources.keys(),'config/a.json'])
  const consumers = dependencyConsumers(inventory,sources,path=>files.has(path),{files})
  const previousConsumers = dependencyConsumers(inventory,previousSources,path=>files.has(path),{files})
  const run = () => selectBehaviors(inventory,[{status:'M',file:scenario.changed}],consumers,{
    sources,previousSources,previousConsumers,ranges:{},compilerOptions:{noLib:true,noResolve:true,types:[]},
  })
  if (scenario.selected) assert.deepEqual(run().selectedCases[file],[0])
  else assert.throws(run,/Unsafe runtime input:.*Input expression has an unresolved runtime value/)
})

for (const [name, factory, cjs] of [
  ['opaque factory return', '() => makeFactory()', false],
  ['partial original with unproven override', 'async original => ({ ...await original(), TABLE: { value: 0 } })', false],
  ['CommonJS require unaffected by literal ESM module replacement', '() => ({ TABLE: { value: 0 } })', true],
]) test(`module mock provenance: ${name}`, () => {
  const owner = cjs ? 'src/owner.cjs' : 'src/owner.ts'
  const before = cjs ? 'const TABLE = { value: 1 }; module.exports = { TABLE }' : 'export const TABLE = { value: 1 }'
  const reference = cjs ? "const { TABLE } = require('../src/owner.cjs')" : "import { TABLE } from '../src/owner'"
  const specifier = cjs ? '../src/owner.cjs' : '../src/owner'
  assert.throws(() => selection(before,before.replace('value: 1','value: 2'),[
    reference, "test('real', () => TABLE.value)",
  ],[['tests/opaque.test.ts', `${reference}\nvi.mock('${specifier}', ${factory})\ntest('opaque boundary', () => TABLE.value)`]],owner),/Unsafe mock boundary/)
})

for (const [name, factory, setup = ''] of [
  ['factory default effects', "(original = globalThis.originalRead('config.json')) => ({ readFileSync: () => 'fake' })"],
  ['reader default effects', "() => ({ readFileSync: (path, encoding = globalThis.originalRead(path)) => 'fake' })"],
  ['reader destructuring effects', "() => ({ readFileSync: ({ path }) => 'fake' })"],
  ['reconfigurable mock function export', "() => ({ readFileSync: vi.fn() })", 'fs.readFileSync.mockImplementation(globalThis.originalRead)'],
  ['spy delegation after literal replacement', "() => ({ readFileSync: () => 'fake' })", "vi.spyOn(fs, 'readFileSync').mockImplementation(globalThis.originalRead)"],
]) test(`module replacement effect proof: ${name}`, () => {
  const { selectBehaviors } = require('../tooling/behavior.cjs')
  const sources = new Map([
    ['src/read.ts', "import { readFileSync } from 'node:fs'; export function read() { return readFileSync('config.json') }"],
    ['tests/plain.test.ts', "import { read } from '../src/read'\ntest('plain', () => read())"],
    ['tests/effect.test.ts', `import * as fs from 'node:fs'; import { read } from '../src/read'\nvi.mock('node:fs', ${factory})\ntest('effect', () => { ${setup}; read() })`],
  ])
  const inventory = [...sources].filter(([file])=>file.startsWith('tests/')).map(([file,source]) => ({file,names:['case'],locations:source.split('\n').flatMap((line,index)=>line.startsWith('test(')?[{line:index+1,column:1}]:[])}))
  const files = new Set([...sources.keys(),'config.json']), consumers = dependencyConsumers(inventory,sources,path=>files.has(path),{files})
  assert.throws(()=>selectBehaviors(inventory,[{status:'M',file:'config.json'}],consumers,{sources,previousSources:sources,previousConsumers:consumers,ranges:{},compilerOptions:{noLib:true,noResolve:true,types:[]}}),/Unsafe runtime input.*ambiguous replacement/)
})

for (const [name, extraMock, setup] of [
  ['namespace export mutation', '', 'owner.TABLE.value = globalThis.originalValue'],
  ['namespace export escape', '', 'globalThis.mutate(owner.TABLE)'],
  ['namespace export constructor escape', '', 'new globalThis.Mutator(owner.TABLE)'],
  ['computed namespace export escape', '', "globalThis.mutate(owner['TABLE'])"],
  ['competing opaque factory', "vi.mock('../src/owner', () => makeFactory())", ''],
  ['competing original factory', "vi.mock('../src/owner', async original => ({ ...await original() }))", ''],
]) test(`module replacement invalidation: ${name}`, () => {
  const before = 'export const TABLE = { value: 1 }'
  assert.throws(()=>selection(before,before.replace('value: 1','value: 2'),[
    "import { TABLE } from '../src/owner'", "test('plain', () => TABLE.value)",
  ],[['tests/mutated.test.ts', `import * as owner from '../src/owner'\nvi.mock('../src/owner', () => ({ TABLE: { value: 0 } }))\n${extraMock}\ntest('boundary', () => { ${setup}; return owner.TABLE.value })`]]),/Unsafe mock boundary/)
})

test('replacement runtime shape cannot inherit original primitive escape assumptions', () => {
  const before = "export const TABLE = 'before'"
  assert.throws(()=>selection(before,before.replace('before','after'),[
    "import { TABLE } from '../src/owner'", "test('plain', () => TABLE)",
  ],[['tests/shape.test.ts', "import * as owner from '../src/owner'\nvi.mock('../src/owner', () => ({ TABLE: { run: () => 0 } }))\ntest('escape', () => { globalThis.mutate(owner.TABLE); return owner.TABLE })"]]),/Unsafe mock boundary/)
})

for (const scenario of [
  {name:'live namespace with literal throw', safe:true},
  {name:'captured CommonJS function', captured:true},
  {name:'opaque callback', callback:'() => globalThis.original()'},
  {name:'callback default effects', callback:"(value = globalThis.original()) => { throw 'blocked' }"},
  {name:'finite restoration options', options:', { times: 1 }'},
  {name:'unresolved tracker', tracker:'globalThis.tracker'},
  {name:'later mock implementation', later:'replacement.mock.mockImplementation(globalThis.original)'},
  {name:'later restoration', later:'replacement.mock.restore()'},
  {name:'escaped mock handle', later:'globalThis.reconfigure(replacement)'},
  {name:'tracker reset', later:'t.mock.reset()'},
  {name:'reassigned tracker', before:"t = { mock: { method() {} } }"},
  {name:'reassigned target', before:"processIO = { spawnSync() {} }"},
  {name:'escaped tracker', before:'globalThis.mutate(t)'},
  {name:'escaped target', before:'globalThis.mutate(processIO)'},
  {name:'aliased escaped tracker', before:'const alias = t; globalThis.mutate(alias)'},
  {name:'mutated tracker method', before:'t.mock.method = () => {}'},
  {name:'mutated imported tracker', tracker:'mock', before:'mock.method = () => {}'},
  {name:'reconfiguration between invocations', later:'try { run() } catch {} replacement.mock.mockImplementation(globalThis.original)'},
  {name:'escaped property tracker alias', before:'const trackerAlias = t.mock; globalThis.mutate(trackerAlias)'},
  {name:'escaped destructured tracker alias', before:'const { mock: trackerAlias } = t; globalThis.mutate(trackerAlias)'},
  {name:'unproven same-name spy escape', before:'const vi = globalThis.unknown; vi.spyOn(processIO)'},
  {name:'wrapped tracker alias escape', before:'const trackerAlias = (t.mock); globalThis.mutate(trackerAlias)'},
  {name:'assigned tracker alias escape', before:'let trackerAlias; trackerAlias = t.mock; globalThis.mutate(trackerAlias)'},
  {name:'destructuring tracker property write', before:'[t.mock.method] = [() => {}]'},
  {name:'unknown conditional tracker extraction', before:'const trackerAlias = globalThis.flag ? t.mock : globalThis.other; globalThis.mutate(trackerAlias)'},
  {name:'unknown conditional argument escape', before:'globalThis.mutate(globalThis.flag ? t.mock : globalThis.other)'},
  {name:'reassigned test registrar', registrationSetup:'test = globalThis.customRegistrar;'},
  {name:'reassigned implicit require', before:"require = () => ({ spawnSync() {} }); const fakeIO = require('node:child_process')", target:'fakeIO', unverified:true},
  {name:'dynamic with scope', dynamicScope:true},


]) test(`native nondelegating boundary: ${scenario.name}`, () => {
  const { selectBehaviors } = require('../tooling/behavior.cjs')
  const file = 'tests/process.test.cjs', owner = 'src/process.cjs'
  const before = `${scenario.captured ? "const { spawnSync } = require('node:child_process')" : "const processIO = require('node:child_process')"}; function run() { ${scenario.captured ? 'spawnSync' : 'processIO.spawnSync'}('node', [globalThis.script]); return 1 }; exports.run = run`
  const body = `let { test, mock } = require('node:test'); let processIO = require('node:child_process'); const { run } = require('../src/process.cjs'); ${scenario.registrationSetup ?? ''}\ntest('boundary', (t) => { ${scenario.dynamicScope ? 'with (globalThis.scope) {' : ''} ${scenario.before ?? ''}; const replacement = ${scenario.tracker ?? 't.mock'}.method(${scenario.target ?? 'processIO'}, 'spawnSync', ${scenario.callback ?? "() => { throw 'blocked' }"}${scenario.options ?? ''}); ${scenario.later ?? ''}; run(); ${scenario.dynamicScope ? '}' : ''} })`
  const sources = new Map([[owner,before.replace('return 1','return 2')],[file,body]])
  const previousSources = new Map(sources); previousSources.set(owner,before)
  const inventory = [{file,names:['boundary'],locations:[{line:2,column:1}]}], files = new Set(sources.keys())
  const consumers = dependencyConsumers(inventory,sources,path=>files.has(path),{files})
  const previousConsumers = dependencyConsumers(inventory,previousSources,path=>files.has(path),{files})
  const plan = () => selectBehaviors(inventory,[{status:'M',file:owner}],consumers,{sources,previousSources,previousConsumers,ranges:{},compilerOptions:{noLib:true,noResolve:true,types:[]}})
  if (scenario.safe) assert.deepEqual(plan().selectedCases[file],[0])
  else assert.throws(plan,scenario.dynamicScope ? /Unsafe runtime dispatch:.*with dynamic scope/ : scenario.unverified ? /Unsafe runtime input/ : /Unsafe runtime input: ambiguous replacement/)
})

function mainEntrySelection({ condition = 'require.main === module', setup = '', processSetup = '', direct = false, ambient = false, importer = true } = {}) {
  const { selectBehaviors } = require('../tooling/behavior.cjs')
  const file = 'tests/entry.test.cjs', owner = 'src/entry.cjs'
  const before = `function run() { return 1 }; exports.run = run; ${setup}; if (${condition}) { run() }`
  const body = `const { test } = require('node:test'); const processIO = require('node:child_process');
 test('${importer ? 'imported' : 'unrelated'}', () => { ${importer ? "require('../src/entry.cjs')" : ''} })
 test('node entry', t => { ${processSetup}; processIO.execFileSync('node', ['src/entry.cjs']) })
${direct ? "test('direct', () => require('../src/entry.cjs').run())" : ''}`
  const sources = new Map([[owner, before.replace('return 1', 'return 2')], [file, body], ...(ambient ? [['ambient.d.ts', 'declare var require: { (id:string):any; main:any; cache:any }; declare var module:any;']] : [])])
  const previousSources = new Map(sources); previousSources.set(owner, before)
  const inventory = [{ file, names: [importer ? 'imported' : 'unrelated', 'node entry', ...(direct ? ['direct'] : [])], locations: [{ line: 2, column: 2 }, { line: 3, column: 2 }, ...(direct ? [{ line: 4, column: 1 }] : [])] }]
  const files = new Set(sources.keys())
  return selectBehaviors(inventory, [{ status: 'M', file: owner }], dependencyConsumers(inventory, sources, path => files.has(path), { files }), {
    sources, previousSources, previousConsumers: dependencyConsumers(inventory, previousSources, path => files.has(path), { files }), ranges: {}, compilerOptions: { noLib: true, noResolve: true, types: [] },
  })
}

test('canonical CommonJS main guard distinguishes import from proven Node entry', () => {
  const plan = mainEntrySelection()
  assert.deepEqual(plan.selectedCases['tests/entry.test.cjs'], [1])
  assert.ok(JSON.stringify(plan).includes('proven Node entry'))
})

test('canonical CommonJS non-main branch retains the actual importer', () => {
  assert.deepEqual(mainEntrySelection({ condition: 'require.main !== module' }).selectedCases['tests/entry.test.cjs'], [0])
})

test('reassigned implicit module cannot establish canonical main identity', () => {
  assert.deepEqual(mainEntrySelection({ setup: 'module = require.main' }).selectedCases['tests/entry.test.cjs'], [0, 1])
})

test('a nondelegating subprocess replacement cannot establish Node entry', () => {
  const plan = mainEntrySelection({ processSetup: "t.mock.method(processIO, 'execFileSync', () => { throw 'blocked' })", direct: true })
  assert.deepEqual(plan.selectedCases['tests/entry.test.cjs'], [2])
})

test('an opaque subprocess replacement cannot establish Node entry', () => {
  assert.throws(() => mainEntrySelection({ processSetup: "t.mock.method(processIO, 'execFileSync', globalThis.delegate)", direct: true }), /Unsafe Node entry/)
})

test('written implicit require.main cannot establish canonical main identity', () => {
  assert.deepEqual(mainEntrySelection({ setup: 'require.main = module' }).selectedCases['tests/entry.test.cjs'], [0, 1])
})

test('a real Node child does not inherit the parent module mock registry', () => {
  const { selectBehaviors } = require('../tooling/behavior.cjs')
  const file = 'tests/child.test.ts', owner = 'src/child-owner.mjs'
  const before = 'export function run() { return 1 }'
  const body = `import { test, vi } from 'vitest'; import { execFileSync } from 'node:child_process';
vi.mock('../src/child-owner.mjs', () => ({ run: () => 0 }));
test('child', () => execFileSync('node', ['src/child-entry.mjs']))`
  const sources = new Map([[file, body], [owner, before.replace('return 1', 'return 2')], ['src/child-entry.mjs', "import { run } from './child-owner.mjs'; run()"]])
  const previousSources = new Map(sources); previousSources.set(owner, before)
  const inventory = [{ file, names: ['child'], locations: [{ line: 3, column: 1 }] }], files = new Set(sources.keys())
  const plan = selectBehaviors(inventory, [{ status: 'M', file: owner }], dependencyConsumers(inventory, sources, path => files.has(path), { files }), {
    sources, previousSources, previousConsumers: dependencyConsumers(inventory, previousSources, path => files.has(path), { files }), ranges: {}, compilerOptions: { noLib: true, noResolve: true, types: [] },
  })
  assert.deepEqual(plan.selectedCases[file], [0])
})

test('ordinary recursive parameter provenance terminates without a mock boundary', () => {
  const { behaviorGraph } = require('../tooling/behavior.cjs')
  const file = 'src/walk.ts'
  const graph = behaviorGraph(new Map([[file, 'export function walk(node) { if (node.parent) walk(node.parent); return node.value }']]), new Map(), { noLib: true, noResolve: true, types: [] })
  const owner = [...graph.nodes.values()].find(node => node.label === 'walk')
  assert.ok(owner)
  assert.equal(owner.unsafe, undefined)
})

test('ordinary cyclic imports retain the actual exported callable', () => {
  const before = 'import { other } from "./other"; export function run() { return 1 }; export function unused() { return other() }'
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { run } from '../src/owner'",
    "test('caller', () => run())",
  ], [['src/other.ts', "import { run } from './owner'; export function other() { return run() }"]])
  assert.deepEqual(indices(plan), [0])
})

test('a reached native mock with cyclic provider provenance fails closed', () => {
  const before = 'export function run() { return 1 }'
  assert.throws(() => selection(before, before.replace('return 1', 'return 2'), [
    "import { test, mock } from 'node:test'; import { run } from '../src/owner'",
    "test('cyclic', () => { const handle = mock.method(handle, 'run', () => { throw 'blocked' }); run() })",
  ]), /Unsafe runtime dispatch:.*cyclic native mock provider provenance/)
})

test('an unused cyclic mock helper does not poison an unrelated case root', () => {
  const before = 'export function run() { return 1 }'
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { test, mock } from 'node:test'; import { run } from '../src/owner'",
    "function unused() { const handle = mock.method(handle, 'run', () => { throw 'blocked' }) }",
    "test('caller', () => run())",
  ])
  assert.deepEqual(indices(plan), [0])
})

function ambientNativeSelection({ namespaceTarget = false, readerSpecifier = 'node:child_process', vitestSpy = false, namespaceReader = false, namedReader = false, readerESM = false, ambient = true, loadCache = false, specifier = 'node:child_process', localSetup = '', pollution = "require.cache['child_process'] = { exports: {} }" } = {}) {
  const { selectBehaviors } = require('../tooling/behavior.cjs')
  const file = readerESM ? 'tests/ambient.test.mjs' : 'tests/ambient.test.cjs', owner = readerESM ? 'src/ambient.mjs' : 'src/ambient.cjs'
  let before = readerESM ? namespaceReader ? "import * as processIO from 'node:child_process'; export function run() { processIO.spawnSync('node', [globalThis.script]); return 1 }" : namedReader ? "import { spawnSync } from 'node:child_process'; export function run() { spawnSync('node', [globalThis.script]); return 1 }" : "import processIO from 'node:child_process'; export function run() { processIO.spawnSync('node', [globalThis.script]); return 1 }" : "const processIO = require('node:child_process'); function run() { processIO.spawnSync('node', [globalThis.script]); return 1 }; exports.run = run"
  if (readerESM) before = before.replace("'node:child_process'", JSON.stringify(readerSpecifier))
  const body = readerESM
    ? `${vitestSpy ? "import { vi } from 'vitest';" : ''} import { test } from 'node:test'; import ${namespaceTarget ? '* as processIO' : 'processIO'} from '${specifier}'; import { run } from '../src/ambient.mjs'; import '../src/cache.cjs';
test('boundary', t => { ${vitestSpy ? "vi.spyOn(processIO, 'spawnSync').mockReturnValue({ status: 0 })" : "t.mock.method(processIO, 'spawnSync', () => { throw 'blocked' })"}; run() })`
    : `const { test } = require('node:test'); ${loadCache ? "require('../src/cache.cjs');" : ''} const { run } = require('../src/ambient.cjs');
test('boundary', t => { ${localSetup}; const processIO = require('${specifier}'); t.mock.method(processIO, 'spawnSync', () => { throw 'blocked' }); run() })`
  const sources = new Map([
    ...(ambient ? [['ambient.d.ts', 'declare var require: { (id: string): any; cache: { [id: string]: any } };']] : []),
    ['src/cache.cjs', `${pollution}; exports.done = true`], [owner, before.replace('return 1', 'return 2')], [file, body],
  ])
  const previousSources = new Map(sources); previousSources.set(owner, before)
  const inventory = [{ file, names: ['boundary'], locations: [{ line: 2, column: 1 }] }], files = new Set(sources.keys())
  return selectBehaviors(inventory, [{ status: 'M', file: owner }], dependencyConsumers(inventory, sources, path => files.has(path), { files }), {
    sources, previousSources, previousConsumers: dependencyConsumers(inventory, previousSources, path => files.has(path), { files }), ranges: {}, compilerOptions: { noLib: true, noResolve: true, types: [] },
  })
}

test('node-prefixed native providers bypass a mutated shared require cache', () => {
  assert.deepEqual(ambientNativeSelection({ readerESM: true }).selectedCases['tests/ambient.test.mjs'], [0])
})

test('bare native-provider specifiers do not bypass a mutated require cache', () => {
  assert.throws(() => ambientNativeSelection({ specifier: 'child_process' }), /Unsafe (?:runtime input|module initialization)/)
})

test('an ambient require reassignment invalidates only its actual CommonJS source', () => {
  assert.deepEqual(ambientNativeSelection({ pollution: 'require = globalThis.fakeRequire' }).selectedCases['tests/ambient.test.cjs'], [0])
})

test('a same-source ambient require reassignment cannot prove a builtin namespace', () => {
  assert.throws(() => ambientNativeSelection({ localSetup: 'require = globalThis.fakeRequire' }), /Unsafe (?:runtime input|module initialization)/)
})

test('an opaque escape of the source-local require callable remains uncertain', () => {
  assert.throws(() => ambientNativeSelection({ localSetup: 'globalThis.mutate(require)' }), /Unsafe (?:runtime input|module initialization)/)
})

test('replacing the source-local require with a Proxy cannot prove a builtin namespace', () => {
  assert.throws(() => ambientNativeSelection({ localSetup: 'require = new Proxy(require, globalThis.handler)' }), /Unsafe (?:runtime input|module initialization)/)
})


test('a require expando declaration cannot hide direct callable reassignment', () => {
  assert.throws(() => ambientNativeSelection({ ambient: false, localSetup: 'require.cache = {}; require = globalThis.fakeRequire' }), /Unsafe (?:runtime input|module initialization)/)
})


test('ambient require cache writes do not change canonical main identity', () => {
  assert.deepEqual(mainEntrySelection({ ambient: true, importer: false, setup: "require.cache['unrelated'] = { exports: {} }" }).selectedCases['tests/entry.test.cjs'], [1])
})

test('opaque require escape prevents canonical main-guard pruning', () => {
  assert.deepEqual(mainEntrySelection({ setup: 'globalThis.mutate(require)' }).selectedCases['tests/entry.test.cjs'], [0, 1])
})

test('assigning module exports does not change CommonJS module identity', () => {
  assert.deepEqual(mainEntrySelection({ setup: 'module.exports = { run }' }).selectedCases['tests/entry.test.cjs'], [1])
})

test('uncertain Node entry cannot silently omit a possible child input reader', () => {
  const { selectBehaviors } = require('../tooling/behavior.cjs')
  const file = 'tests/child-input.test.cjs'
  const source = `const { test } = require('node:test'); const processIO = require('node:child_process'); const fs = require('node:fs');
test('uncertain child', t => { t.mock.method(processIO, 'execFileSync', globalThis.delegate); processIO.execFileSync('node', ['src/read-input.cjs']) })
test('real reader', () => fs.readFileSync('config.json'))`
  const sources = new Map([[file, source], ['src/read-input.cjs', "require('node:fs').readFileSync('config.json')"]])
  const files = new Set([...sources.keys(), 'config.json'])
  const inventory = [{ file, names: ['uncertain child', 'real reader'], locations: [{ line: 2, column: 1 }, { line: 3, column: 1 }] }]
  const consumers = dependencyConsumers(inventory, sources, path => files.has(path), { files })
  assert.throws(() => selectBehaviors(inventory, [{ status: 'M', file: 'config.json' }], consumers, {
    sources, previousSources: sources, previousConsumers: consumers, ranges: {}, compilerOptions: { noLib: true, noResolve: true, types: [] },
  }), /Unsafe Node entry/)
})


test('deleting require.main prevents canonical non-main pruning', () => {
  assert.deepEqual(mainEntrySelection({ condition: 'require.main !== module', setup: 'delete require.main' }).selectedCases['tests/entry.test.cjs'], [0, 1])
})


test('an unproven literal loader cannot disappear behind another real initializer owner', () => {
  const before = 'function run() { return 1 }; run(); exports.run = run'
  assert.throws(() => selection(before, before.replace('return 1', 'return 2'), [
    "test('unknown loader', () => { const require = globalThis.loader; require('../src/owner.cjs') })",
    "test('real loader', () => require('../src/owner.cjs'))",
  ], [], 'src/owner.cjs'), /Unsafe module initialization/)
})


test('a prior imported cache writer keeps a relative reader blocked', () => {
  assert.throws(() => ambientNativeSelection({ readerESM: false, loadCache: true }), /Unsafe module initialization/)
})

test('an unresolved cache-sensitive relative importer remains a blocked main scenario', () => {
  assert.throws(() => mainEntrySelection({ ambient: true, setup: "require.cache['unrelated'] = { exports: {} }" }), /Unsafe module initialization/)
})

for (const binding of ['{ unused }', '{}']) test(`JavaScript ${binding} imports retain actual module initialization`, () => {
  const before = 'export const TABLE = { value: 1 }; export const unused = 0; globalThis.saved = TABLE.value'
  const plan = selection(before, before.replace('value: 1', 'value: 2'), [
    `import ${binding} from '../src/owner.mjs'`,
    "test('initialization', () => globalThis.saved)",
  ], [], 'src/owner.mjs', 'tests/owner.test.mjs')
  assert.deepEqual(plan.selectedCases['tests/owner.test.mjs'], [0])
})


test('native default-object replacement cannot suppress a captured builtin named export', () => {
  assert.throws(() => ambientNativeSelection({ readerESM: true, namedReader: true }), /Unsafe runtime input: ambiguous replacement/)
})


test('native default-object replacement cannot suppress an unsynchronized builtin namespace', () => {
  assert.throws(() => ambientNativeSelection({ readerESM: true, namespaceReader: true }), /Unsafe runtime input: ambiguous replacement/)
})


test('bare builtin named imports remain snapshots under native method replacement', () => {
  assert.throws(() => ambientNativeSelection({ readerESM: true, namedReader: true, readerSpecifier: 'child_process' }), /Unsafe runtime input: ambiguous replacement/)
})

test('a builtin object spy cannot suppress an unsynchronized named export', () => {
  assert.throws(() => ambientNativeSelection({ readerESM: true, namedReader: true, vitestSpy: true }), /Unsafe runtime input: ambiguous replacement/)
})


test('a resolved inert same-name helper is not an unknown module loader', () => {
  const before = 'function run() { return 1 }; run(); exports.run = run'
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "test('local helper', () => { const require = name => 0; require('../src/owner.cjs') })",
    "test('real loader', () => require('../src/owner.cjs'))",
  ], [], 'src/owner.cjs')
  assert.deepEqual(indices(plan), [1])
})

test('a native mock cannot prove mutation of an ESM namespace target', () => {
  assert.throws(() => ambientNativeSelection({ readerESM: true, namespaceTarget: true }), /Unsafe runtime input: ambiguous replacement/)
})


test('a locally shadowed spy name cannot suppress a real default-object reader', () => {
  const { selectBehaviors } = require('../tooling/behavior.cjs')
  const sources = new Map([
    ['src/read.mjs', "import fs from 'node:fs'; export function read() { return fs.readFileSync('config.json') }"],
    ['tests/fake.test.mjs', "import fs from 'node:fs'; import { read } from '../src/read.mjs';\ntest('fake spy', () => { const vi = { spyOn() { return { mockReturnValue() {} } } }; vi.spyOn(fs, 'readFileSync').mockReturnValue('fake'); read() })"],
    ['tests/real.test.mjs', "import { read } from '../src/read.mjs';\ntest('real', () => read())"],
  ])
  const inventory = ['tests/fake.test.mjs', 'tests/real.test.mjs'].map(file => ({ file, names: ['reader'], locations: [{ line: 2, column: 1 }] }))
  const files = new Set([...sources.keys(), 'config.json']), consumers = dependencyConsumers(inventory, sources, path => files.has(path), { files })
  assert.throws(() => selectBehaviors(inventory, [{ status: 'M', file: 'config.json' }], consumers, {
    sources, previousSources: sources, previousConsumers: consumers, ranges: {}, compilerOptions: { noLib: true, noResolve: true, types: [] },
  }), /Unsafe runtime input:.*ambiguous replacement/)
})

for (const { scenario, foreign, active, fresh, importedSetup, expected } of [
  { scenario: 'an unreachable sibling cache callback does not taint an eager capture', expected: 'real' },
  { scenario: 'an unrelated test process cache callback does not taint an eager capture', foreign: true, expected: 'real' },
  { scenario: 'a reached cache alias mutation keeps the captured loader uncertain', active: true, expected: 'uncertain' },
  { scenario: 'a fresh callback require does not acquire a cache restoration proof', fresh: true, expected: 'uncertain' },
  { scenario: 'an eager helper with a local same-name registrar is not an unrelated test callback', importedSetup: true, expected: 'uncertain' },
]) test(scenario, () => {
  const { behaviorGraph } = require('../tooling/behavior.cjs')
  const file = 'tests/capture.test.cjs', owner = 'src/owner.cjs'
  const mutation = "const saved = require.cache['owner']; delete require.cache['owner']; require.cache['owner'] = saved"
  const body = [
    `const { test } = require('node:test'); ${importedSetup ? "require('../src/setup.cjs')" : ''}`,
    fresh ? 'const marker = 0' : "const { value } = require('../src/owner.cjs')",
    `test('reader', () => { ${active ? mutation + ';' : ''} ${fresh ? "require('../src/owner.cjs').value()" : 'value()'} })`,
    ...(!foreign ? [`test('cache maintenance', () => { ${mutation} })`] : []),
  ].join('\n')
  const sources = new Map([
    [owner, 'function value() { return 1 }; module.exports = { value }'], [file, body],
    ['ambient.d.ts', 'declare var require: { (id: string): any; cache: { [id: string]: any } };'],
    ...(importedSetup ? [['src/setup.cjs', `function test(_, callback) { callback() }; test('setup', () => { ${mutation} })`]] : []),
    ...(foreign ? [['tests/independent.test.cjs', `const { test } = require('node:test'); test('cache maintenance', () => { ${mutation} })`]] : []),
  ])
  const graph = behaviorGraph(sources, dependencyConsumers([{ file }], sources).graph, { noLib: true, noResolve: true, types: [] })
  const roots = graph.caseRoots(file, { line: 3 })
  const reached = graph.reachable(roots, file)
  const entries = [...graph.nodes.values()].filter(entry => reached.has(entry.id) && entry.file === file && entry.moduleEntryRisks?.some(risk => risk.target === owner))
  assert.ok(entries.length, 'the uncertain loader must remain represented, not disappear')
  for (const entry of entries) for (const risk of entry.moduleEntryRisks.filter(risk => risk.target === owner)) {
    assert.equal(graph.moduleEntryStatus(risk, reached, entry.id, file), expected)
  }
  assert.ok([...graph.nodes.values()].some(entry => entry.file === owner && entry.label === '<module>' && reached.has(entry.id)), 'retain the actual initialization candidate under its scope guard')
  if (foreign) assert.equal(graph.runtimeReaches(file, 'tests/independent.test.cjs'), false)
})

test('stable empty Vitest factory exports exclude only the mocked module consumer', () => {
  const before = 'export function run() { return 1 }'
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { run } from '../src/owner'",
    "test('real', () => run())",
  ], [['tests/empty.test.ts', "import { vi } from 'vitest'; import { run } from '../src/owner'\nvi.mock('../src/owner', () => ({ run: vi.fn() }))\ntest('empty', () => run())"]])
  assert.deepEqual(indices(plan), [0])
  assert.equal(plan.selectedCases['tests/empty.test.ts'], undefined)
})

for (const [name, setup] of [
  ['sibling implementation persists through clearAllMocks', "test('configure', () => { vi.mocked(run).mockImplementation(globalThis.real) }); afterEach(() => vi.clearAllMocks())"],
  ['export escapes to an opaque helper', "test('configure', () => globalThis.mutate(run))"],
]) test(`empty mock export lifetime: ${name}`, () => {
  const before = 'export function run() { return 1 }'
  const receiver = "import { vi, afterEach } from 'vitest'"
  assert.throws(() => selection(before, before.replace('return 1', 'return 2'), [
    "import { run } from '../src/owner'", "test('real', () => run())",
  ], [['tests/empty.test.ts', `${receiver}; import { run } from '../src/owner'\nvi.mock('../src/owner', () => ({ run: vi.fn() }))\n${setup}\ntest('later', () => run())`]]), /Unsafe mock boundary/)
})


test('a local fake vi factory does not exclude the real module owner', () => {
  const before = 'export function run() { return 1 }'
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { run } from '../src/owner'",
    "const vi = { fn: () => globalThis.real, mock() {} }",
    "vi.mock('../src/owner', () => ({ run: vi.fn() }))",
    "test('actual original', () => run())",
  ])
  assert.deepEqual(indices(plan), [0])
})


test('empty mock export re-exports remain uncertain across mutable aliases', () => {
  const before = 'export function run() { return 1 }'
  assert.throws(() => selection(before, before.replace('return 1', 'return 2'), [
    "import { run } from '../src/owner'", "test('real', () => run())",
  ], [
    ['src/bridge.ts', "export { run } from './owner'"],
    ['tests/empty.test.ts', "import { vi } from 'vitest'; import { run } from '../src/owner'; import { run as alias } from '../src/bridge'\nvi.mock('../src/owner', () => ({ run: vi.fn() }))\ntest('mutate alias', () => { globalThis.mutate(alias); run() })"],
  ]), /Unsafe mock boundary/)
})


for (const acquisition of ["import('../src/owner')", "vi.importMock('../src/owner')", 'import(globalThis.moduleName)']) test(`empty mock export namespace acquisition remains uncertain: ${acquisition}`, () => {
  const before = 'export function run() { return 1 }'
  assert.throws(() => selection(before, before.replace('return 1', 'return 2'), [
    "import { run } from '../src/owner'", "test('real', () => run())",
  ], [['tests/empty.test.ts', `import { vi } from 'vitest'; import { run } from '../src/owner'\nvi.mock('../src/owner', () => ({ run: vi.fn() }))\ntest('configure', async () => { const mod = await ${acquisition}; mod.run.mockImplementation(globalThis.real) })\ntest('later', () => run())`]]), /Unsafe (?:mock boundary|runtime import|runtime input)/)
})

test('finite shared mock callbacks execute on export calls, not on configuration alone', () => {
  const { selectBehaviors } = require('../tooling/behavior.cjs')
  const file = 'tests/configured.test.ts'
  const sources = new Map([
    ['src/owner.ts', 'export function run() { return 1 }'],
    ['src/entry.ts', "import { run } from './owner'; export function enter() { return run() }"],
    [file, [
      "import { vi } from 'vitest'; import fs from 'node:fs'; import { run } from '../src/owner'; import { enter } from '../src/entry'",
      "vi.mock('../src/owner', () => ({ run: vi.fn() }))",
      "test('configure only', () => { vi.mocked(run).mockImplementation(() => fs.readFileSync('config.json', 'utf8')) })",
      "test('invoke shared implementation', () => { enter() })",
    ].join('\n')],
  ])
  const inventory = [{file,names:['configure only','invoke shared implementation'],locations:[{line:3,column:1},{line:4,column:1}]}]
  const files = new Set([...sources.keys(),'config.json'])
  const consumers = dependencyConsumers(inventory,sources,path=>files.has(path),{files})
  const plan = selectBehaviors(inventory,[{status:'M',file:'config.json'}],consumers,{
    sources,previousSources:sources,previousConsumers:consumers,ranges:{},compilerOptions:{noLib:true,noResolve:true,types:[]},
  })
  assert.deepEqual(plan.selectedCases[file],[1])
  assert.ok(JSON.stringify(plan).includes('finite shared mock implementation alternatives'))
})

test('finite mock callback substitution does not execute the unrelated original implementation', () => {
  const before = 'export function run() { return 1 }'
  const plan = selection(before,before.replace('return 1','return 2'),[
    "import { run } from '../src/owner'", "test('real', () => run())",
  ], [['tests/configured.test.ts', "import { vi } from 'vitest'; import { run } from '../src/owner'\nvi.mock('../src/owner', () => ({ run: vi.fn() }))\ntest('configured', () => { vi.mocked(run).mockImplementation(() => 0); run() })"]])
  assert.deepEqual(indices(plan),[0])
  assert.equal(plan.selectedCases['tests/configured.test.ts'],undefined)
})

for (const [name, callback, tail] of [
  ['opaque inline delegate', '() => globalThis.original()', ''],
  ['unbound global value accessor', '() => { dangerous; return 0 }', ''],
  ['unknown returned receiver', 'value => value', ''],
  ['global reset lifetime', '() => 0', 'vi.resetAllMocks()'],
]) test(`finite mock callback union remains blocked: ${name}`, () => {
  const before = 'export function run() { return 1 }'
  assert.throws(() => selection(before,before.replace('return 1','return 2'),[
    "import { run } from '../src/owner'", "test('real', () => run())",
  ], [['tests/configured.test.ts', `import { vi } from 'vitest'; import { run } from '../src/owner'\nvi.mock('../src/owner', () => ({ run: vi.fn() }))\ntest('configured', () => { vi.mocked(run).mockImplementation(${callback}); ${tail}; run() })`]]), /Unsafe mock boundary/)
})

test('Once and default mock implementations remain finite shared alternatives', () => {
  const { selectBehaviors } = require('../tooling/behavior.cjs')
  const file = 'tests/once.test.ts'
  const sources = new Map([
    ['src/owner.ts', 'export function run() { return 1 }'],
    [file, [
      "import { vi } from 'vitest'; import fs from 'node:fs'; import { run } from '../src/owner'",
      "vi.mock('../src/owner', () => ({ run: vi.fn() }))",
      "test('configure', () => { vi.mocked(run).mockImplementationOnce(() => fs.readFileSync('once.json', 'utf8')); vi.mocked(run).mockImplementation(() => 0) })",
      "test('invoke', () => { run() })",
    ].join('\n')],
  ])
  const inventory = [{file,names:['configure','invoke'],locations:[{line:3,column:1},{line:4,column:1}]}]
  const files = new Set([...sources.keys(),'once.json'])
  const consumers = dependencyConsumers(inventory,sources,path=>files.has(path),{files})
  const plan = selectBehaviors(inventory,[{status:'M',file:'once.json'}],consumers,{sources,previousSources:sources,previousConsumers:consumers,ranges:{},compilerOptions:{noLib:true,noResolve:true,types:[]}})
  assert.deepEqual(plan.selectedCases[file],[1])
})

test('shared configuration helpers retain their real execution outside the mocked case process', () => {
  const { selectBehaviors } = require('../tooling/behavior.cjs')
  const sources = new Map([
    ['src/owner.ts', 'export function run() { return 1 }; run.mockImplementation = callback => callback()'],
    ['src/configure.ts', "import { vi } from 'vitest'; import fs from 'node:fs'; import { run } from './owner'; export function configure() { vi.mocked(run).mockImplementation(() => fs.readFileSync('config.json', 'utf8')) }"],
    ['tests/mock.test.ts', "import { vi } from 'vitest'; import { run } from '../src/owner'; import { configure } from '../src/configure'\nvi.mock('../src/owner', () => ({ run: vi.fn() }))\ntest('configure only', () => { configure() })\ntest('invoke', () => { run() })"],
    ['tests/real.test.ts', "import { configure } from '../src/configure'\ntest('actual custom API', () => { configure() })"],
  ])
  const inventory = [...sources].filter(([file])=>file.startsWith('tests/')).map(([file,source])=>{
    const locations = source.split('\n').flatMap((line,index)=>line.startsWith('test(')?[{line:index+1,column:1}]:[])
    return {file,names:locations.map((_,index)=>`case ${index}`),locations}
  })
  const files = new Set([...sources.keys(),'config.json'])
  const consumers = dependencyConsumers(inventory,sources,path=>files.has(path),{files})
  const plan = selectBehaviors(inventory,[{status:'M',file:'config.json'}],consumers,{sources,previousSources:sources,previousConsumers:consumers,ranges:{},compilerOptions:{noLib:true,noResolve:true,types:[]}})
  assert.deepEqual(plan.selectedCases['tests/mock.test.ts'],[1])
  assert.deepEqual(plan.selectedCases['tests/real.test.ts'],[0])
})

for (const [name, dependency, callback] of [
  ['imported opaque helper', 'export function helper() { return globalThis.original() }', '() => { helper(); return 0 }'],
  ['side-effect getter', 'export const helper = { get value() { return globalThis.original() } }', '() => { helper.value; return 0 }'],
  ['destructured getter', 'export const helper = { get value() { return globalThis.original() } }', '() => { const { value } = helper; return 0 }'],
  ['unknown thenable', 'export const helper = globalThis.thenable', 'async () => { await helper; return 0 }'],
  ['computed key coercion', 'export const helper = globalThis.keyObject', '() => { ({ [helper]: 0 }); return 0 }'],
  ['ambient-only global value', 'declare global { const dangerous: unknown }; export {}', '() => { dangerous; return 0 }'],
]) test(`finite mock callback grammar rejects ${name}`, () => {
  const before = 'export function run() { return 1 }'
  assert.throws(() => selection(before,before.replace('return 1','return 2'),[
    "import { run } from '../src/owner'", "test('real', () => run())",
  ], [
    ['src/helper.ts',dependency],
    ['tests/configured.test.ts', `import { vi } from 'vitest'; import { run } from '../src/owner'; import { helper } from '../src/helper'\nvi.mock('../src/owner', () => ({ run: vi.fn() }))\ntest('configured', () => { vi.mocked(run).mockImplementation(${callback}); run() })`],
  ]), /Unsafe mock boundary/)
})


test('mock configuration wrappers require their own stable Vitest receiver', () => {
  const before = 'export function run() { return 1 }'
  assert.throws(() => selection(before,before.replace('return 1','return 2'),[
    "import { run } from '../src/owner'", "test('real', () => run())",
  ], [
    ['src/configure.ts', "import { vi } from 'vitest'; import { run } from './owner'; vi.mocked = globalThis.fake; export function configure() { vi.mocked(run).mockImplementation(() => 0) }"],
    ['tests/configured.test.ts', "import { vi } from 'vitest'; import { run } from '../src/owner'; import { configure } from '../src/configure'\nvi.mock('../src/owner', () => ({ run: vi.fn() }))\ntest('configured', () => { configure(); run() })"],
  ]), /Unsafe mock boundary/)
})
