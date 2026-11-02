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
    "test('stored callback is dormant', () => { const callbacks = []; callbacks.push(() => TABLE.value); return other() })",
    "test('stored callback invoked later', () => { const callbacks = []; callbacks.push(() => TABLE.value); return callbacks[0]() })",
    "test('same-name custom method invokes callback', () => { const receiver = { push(callback) { return callback() } }; return receiver.push(() => TABLE.value) })",
  ])
  assert.deepEqual(indices(plan), [0, 2, 4, 6, 7])
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
  {name:'opaque callback', callback:'() => globalThis.original()', frontier:true},
  {name:'callback default effects', callback:"(command, args, value = globalThis.original()) => { throw 'blocked' }", frontier:true},
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
  {name:'mutated imported tracker', tracker:'mock', before:'mock.method = () => {}', persistent:true},
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
  else assert.throws(plan, scenario.dynamicScope ? /Unsafe runtime dispatch:.*with dynamic scope/ : scenario.unverified ? /Unsafe module initialization/ : scenario.frontier ? /Unsafe Node entry:.*(?:getter|effects)/ : scenario.persistent ? /Unsafe native callback: Persistent global native mock lifetime/ : /Unsafe runtime input: ambiguous replacement/)
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
  assert.throws(() => mainEntrySelection({ processSetup: "t.mock.method(processIO, 'execFileSync', globalThis.delegate)", direct: true }), error => {
    assert.match(error.message, /Unsafe Node entry/)
    assert.equal(error.diagnostics.test, 'tests/entry.test.cjs')
    assert.equal(error.diagnostics.caseIndex, 1)
    const [boundary] = error.diagnostics.unresolved.replacementBoundaries
    assert.equal(boundary.registrationIdentity, 'unproven')
    assert.equal(boundary.effectCompleteness, 'not-evaluated')
    assert.equal(boundary.invocationReplacement, 'unproven')
    assert.match(boundary.missingEvidence, /callback identity/)
    return true
  })
})

for (const scenario of [
  { name: 'invoked callback retains its real parent input reader', invoke: true },
  { name: 'structured callback data operations retain the actual read with an unknown return', invoke: true, structured: true },
  { name: 'registration alone does not execute a callback input reader', invoke: false },
  { name: 'captured native function cannot claim callback substitution', invoke: true, captured: true, unsafe: true },
  { name: 'unsupported namespace capture alias retains provider uncertainty', invoke: true, captured: true, alias: true, unsafe: true },
  { name: 'native original handle delegation remains unresolved', invoke: true, original: true, unsafe: true },
  { name: 'proven replacement of an unresolved launch retains its callback reader', invoke: true, unresolved: true },
  { name: 'helper replacement between invocations cannot drop the later reader', invoke: true, later: true, unsafe: true },
  { name: 'unordered hook callbacks cannot choose one reader arbitrarily', invoke: true, tied: true, unsafe: true },
  { name: 'ambiguous callbacks do not own unrelated same-file inputs', invoke: true, tied: true, irrelevant: true },
  { name: 'ambiguous callbacks retain nested native replacement effects', invoke: true, tied: true, irrelevant: true, nested: true, unsafe: true },
  { name: 'a sibling global tracker retains its finite callback input scope', invoke: true, persistent: true, unsafe: true },
  { name: 'a sibling opaque global tracker cannot lose unknown effects', invoke: true, persistent: true, opaque: true, unsafe: true },
]) test(`native callback execution: ${scenario.name}`, () => {
  const { selectBehaviors, behaviorGraph } = require('../tooling/behavior.cjs')
  const file = 'tests/native-callback.test.cjs'
  const callbackInput = scenario.irrelevant ? 'other.json' : 'config.json'
  const implementation = scenario.structured ? `(command, args) => { if (command === 'node') { const values = new Map([['label', 'value']]); assert.deepEqual(args, ['src/child.cjs']); const bytes = Buffer.from(JSON.stringify({ value: values.get('label') })); return readConfig() } return '' }` : '() => readConfig()'
  const source = `const { test, mock, beforeEach } = require('node:test'); const assert = require('node:assert/strict'); const processIO = require('node:child_process'); const fs = require('node:fs'); const { readFileSync: originalRead } = require('node:fs'); ${scenario.tied ? `beforeEach(() => { mock.method(processIO, 'execFileSync', () => 'done') }); beforeEach(() => { mock.method(processIO, 'execFileSync', () => fs.readFileSync('${callbackInput}')) });` : ''} ${scenario.persistent ? `test('install', () => { mock.method(processIO, 'execFileSync', ${scenario.opaque ? 'globalThis.delegate' : "() => readConfig()"}) });` : ''}
function readConfig() { return fs.readFileSync('config.json') } ${scenario.captured ? scenario.alias ? 'const { execFileSync } = processIO;' : "const { execFileSync } = require('node:child_process');" : ''} function launch() { ${scenario.captured ? 'execFileSync' : 'processIO.execFileSync'}('node', [${scenario.unresolved ? 'globalThis.entry' : "'src/child.cjs'"}]) } ${scenario.later ? "function installLater() { mock.method(processIO, 'execFileSync', () => readConfig()) }" : ''}
test('boundary', t => { ${scenario.nested ? "t.mock.method(fs, 'readFileSync', () => originalRead('config.json'));" : ''} ${scenario.tied || scenario.persistent ? '' : `const replacement = t.mock.method(processIO, 'execFileSync', ${scenario.original ? '() => replacement.mock.original()' : scenario.later ? "() => 'done'" : implementation});`} ${scenario.invoke ? 'launch();' : ''} ${scenario.later ? 'installLater(); launch()' : ''} })
test('direct', () => readConfig())`
  const sources = new Map([[file, source], ['src/child.cjs', scenario.original ? "require('node:fs').readFileSync('config.json')" : "require('node:fs').readFileSync('other.json')"]])
  const files = new Set([...sources.keys(), 'config.json', 'other.json'])
  const inventory = [{ file, names: [...(scenario.persistent ? ['install'] : []), 'boundary', 'direct'], locations: [...(scenario.persistent ? [{ line: 1, column: 1 }] : []), { line: 3, column: 1 }, { line: 4, column: 1 }] }]
  const consumers = dependencyConsumers(inventory, sources, path => files.has(path), { files })
  if (!scenario.invoke) {
    const graph = behaviorGraph(sources, consumers.graph, { noLib: true, noResolve: true, types: [] }, process.cwd(), consumers.inputEdges, consumers.inputRisks)
    const reached = graph.reachable(graph.caseRoots(file, { line: 3, column: 1 }), file)
    assert.equal([...reached].some(id => graph.nodes.get(id).label === '<input:config.json>'), false)
    const direct = graph.reachable(graph.caseRoots(file, { line: 4, column: 1 }), file)
    assert.equal([...direct].some(id => graph.nodes.get(id).label === '<input:config.json>'), true)
    return
  }
  const select = () => selectBehaviors(inventory, [{ status: 'M', file: 'config.json' }], consumers, {
    sources, previousSources: sources, previousConsumers: consumers, ranges: {}, compilerOptions: { noLib: true, noResolve: true, types: [] },
  })
  if (scenario.unsafe) {
    assert.throws(select, error => {
      assert.match(error.message, scenario.unresolved || scenario.alias || scenario.nested ? /Unsafe runtime input/ : /Unsafe (?:Node entry|native callback)/)
      assert.equal(error.diagnostics.test, file)
      assert.equal(error.diagnostics.caseIndex, scenario.persistent ? 1 : 0)
      if (scenario.original) {
        const boundary = error.diagnostics.unresolved
        assert.equal(boundary.kind, 'callback-effect')
        assert.equal(boundary.replacementIdentity, 'proven')
        assert.equal(boundary.effectCompleteness, 'unproven')
        assert.equal(boundary.invocationReplacement, 'proven')
        assert.equal(boundary.frontier.file, file)
        assert.equal(boundary.frontier.syntax, 'PropertyAccessExpression')
        assert.equal(boundary.frontier.expression, 'replacement.mock')
        assert.equal(boundary.frontier.start, source.indexOf('replacement.mock.original()'))
        assert.equal(boundary.frontier.line, 3)
        assert.equal(boundary.frontier.column, source.split('\n')[2].indexOf('replacement.mock.original()') + 1)
        assert.match(boundary.frontier.reason, /unknown getter or proxy/)
      }
      return true
    })
    return
  }
  const plan = select()
  assert.deepEqual(plan.selectedCases[file], scenario.invoke && !scenario.irrelevant ? [0, 1] : [1])
  if (scenario.invoke && !scenario.irrelevant) {
    const evidence = JSON.stringify(plan)
    assert.ok(evidence.includes('finite native replacement callback'))
    assert.ok(evidence.includes(`"start":${source.indexOf('processIO.execFileSync')}`))
    assert.ok(!evidence.includes('proven Node entry'))
    assert.ok(evidence.includes('"processContext":"test"'))
  }
})

for (const intervening of [false, true]) test(`fresh CommonJS acquisition ${intervening ? 'rejects an intervening cache-repopulation opportunity' : 'distinguishes a new replacement capture from the earlier original'}`, () => {
  const { selectBehaviors } = require('../tooling/behavior.cjs')
  const file = 'tests/acquisition.test.cjs'
  const sources = new Map([
    ['src/entry.cjs', "const { execFileSync } = require('node:child_process'); function run() { execFileSync('node', ['src/child.cjs']) }; module.exports = { run }"],
    ['src/child.cjs', "require('node:fs').readFileSync('config.json')"],
    [file, `const { test } = require('node:test'); const cp = require('node:child_process'); const { run: original } = require('../src/entry.cjs')
test('fresh', t => { t.mock.method(cp, 'execFileSync', (command, args) => command === 'node' ? JSON.stringify(args) : ''); delete require.cache[require.resolve('../src/entry.cjs')]; ${intervening ? 'globalThis.repopulate();' : ''} const { run } = require('../src/entry.cjs'); run() })
test('original', () => original())`],
  ])
  const files = new Set([...sources.keys(), 'config.json'])
  const inventory = [{ file, names: ['fresh', 'original'], locations: [{ line: 2, column: 1 }, { line: 3, column: 1 }] }]
  const consumers = dependencyConsumers(inventory, sources, path => files.has(path), { files })
  const select = () => selectBehaviors(inventory, [{ status: 'M', file: 'config.json' }], consumers, {
    sources, previousSources: sources, previousConsumers: consumers, ranges: {}, compilerOptions: { noLib: true, noResolve: true, types: [] },
  })
  if (intervening) assert.throws(select, error => {
    assert.match(error.message, /Unsafe (?:Node entry|module initialization|native callback)/)
    assert.ok(error.diagnostics)
    return true
  })
  else assert.deepEqual(select().selectedCases[file], [1])
})

test('a proven native replacement retains unknown effects before serialization', () => {
  const { selectBehaviors } = require('../tooling/behavior.cjs')
  const file = 'tests/acquisition.test.cjs'
  const sources = new Map([
    ['src/entry.cjs', "const { execFileSync } = require('node:child_process'); function run() { execFileSync('node', ['src/child.cjs']) }; module.exports = { run }"],
    ['src/child.cjs', "require('node:fs').readFileSync('config.json')"],
    [file, `const { test } = require('node:test'); const cp = require('node:child_process')
test('replacement', t => { t.mock.method(cp, 'execFileSync', (command, args) => { globalThis.mutate(args); return JSON.stringify(args) }); delete require.cache[require.resolve('../src/entry.cjs')]; const { run } = require('../src/entry.cjs'); run() })`],
  ])
  const files = new Set([...sources.keys(), 'config.json'])
  const inventory = [{ file, names: ['replacement'], locations: [{ line: 2, column: 1 }] }]
  const consumers = dependencyConsumers(inventory, sources, path => files.has(path), { files })
  assert.throws(() => selectBehaviors(inventory, [{ status: 'M', file: 'config.json' }], consumers, {
    sources, previousSources: sources, previousConsumers: consumers, ranges: {}, compilerOptions: { noLib: true, noResolve: true, types: [] },
  }), error => {
    assert.match(error.message, /Unsafe Node entry.*getter or proxy/)
    assert.equal(error.diagnostics.unresolved.replacementIdentity, 'proven')
    assert.equal(error.diagnostics.unresolved.invocationReplacement, 'proven')
    return true
  })
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

test('ambiguous owner roots retain registered leaves without invoking dormant helpers', () => {
  const before = 'export function changed() { return 1 }; export function unrelated() { return 0 }'
  const owner = 'src/owner.ts', file = 'tests/ambiguous.test.ts', real = 'tests/real.test.ts'
  const sources = new Map([[owner, before.replace('return 1', 'return 2')], [file, `import { changed, unrelated } from '../src/owner'
function dormant() { changed() }
test('same', () => unrelated())
test('same', () => unrelated())`], [real, `import { changed } from '../src/owner'
test('actual owner', () => changed())`]])
  const previousSources = new Map(sources); previousSources.set(owner, before)
  const inventory = [{ file, names: ['same', 'same'], locations: [{ line: 3, column: 1 }, { line: 4, column: 1 }] },
    { file: real, names: ['actual owner'], locations: [{ line: 2, column: 1 }] }]
  const plan = selectFiles(inventory, [{ status: 'M', file: owner }], dependencyConsumers(inventory, sources), {
    sources, previousSources, ranges: {}, compilerOptions: { noLib: true, noResolve: true, types: [] },
  })
  assert.deepEqual(plan.selectedCases[file], undefined)
  assert.deepEqual(plan.selectedCases[real], [0])
  const oneAffected = new Map(sources)
  oneAffected.set(file, sources.get(file).replace("test('same', () => unrelated())", "test('same', () => changed())"))
  const beforeOne = new Map(oneAffected); beforeOne.set(owner, before)
  const whole = selectFiles(inventory, [{ status: 'M', file: owner }], dependencyConsumers(inventory, oneAffected), {
    sources: oneAffected, previousSources: beforeOne, ranges: {}, compilerOptions: { noLib: true, noResolve: true, types: [] },
  })
  assert.deepEqual(whole.selectedCases[file], [0, 1])
  const generated = `import { changed } from '../src/owner'
test.each([1, 2])('generated', value => value === 1 && changed())`
  const generatedSources = new Map([[owner, sources.get(owner)], [file, generated]])
  const generatedPrevious = new Map(generatedSources); generatedPrevious.set(owner, before)
  const rows = [{ file, names: ['generated', 'generated'], locations: [{ line: 2, column: 1 }, { line: 2, column: 1 }] }]
  const generatedPlan = selectFiles(rows, [{ status: 'M', file: owner }], dependencyConsumers(rows, generatedSources), {
    sources: generatedSources, previousSources: generatedPrevious, ranges: {}, compilerOptions: { noLib: true, noResolve: true, types: [] },
  })
  assert.deepEqual(generatedPlan.selectedCases[file], [0, 1])
})

test('ordinary recursive parameter provenance terminates without a mock boundary', () => {
  const before = `export class Owner { get value() { return 1 } }
export function walk(owner: Owner | null = null, remaining = true) { if (remaining) return relay(new Owner(), false); return () => owner?.value }
function relay(owner: Owner, remaining: boolean) { return walk(owner, remaining) }`
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { walk } from '../src/owner'",
    "test('recursive forwarding reaches the later receiver', () => walk()())",
    "test('returning the recursive callback does not invoke it', () => walk())",
  ])
  assert.deepEqual(indices(plan), [0])
})

test('known optional inputs gate a local empty branch without losing the supplied-input owner', () => {
  const before = `export function changed() { return 1 }
export function run(evidence) { const changes = evidence ? [1] : []; if (changes.length) return changed(); return 0 }`
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { run } from '../src/owner'",
    "test('omitted input', () => run())",
    "test('supplied input', () => run({}))",
  ])
  assert.deepEqual(indices(plan), [1])
})

test('finite record conditions guard short circuits and continuations without losing later writes', () => {
  const before = `export function changed() { return 1 }
export function run(options) { if (options.mode === undefined || options.mode === 'idle' || options.disabled === true) return; return options.enabled && changed() }
export function activate(options) { options.mode = 'active' }`
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { run, activate } from '../src/owner'",
    "test('early return', () => run({ mode: 'idle', enabled: true }))",
    "test('disabled', () => run({ mode: 'active', disabled: true, enabled: true }))",
    "test('actual invocation', () => run({ mode: 'active', enabled: true }))",
    "test('short circuit', () => run({ mode: 'active', enabled: false }))",
    "test('unknown fields remain possible', () => run(globalThis.options))",
    "test('later helper mutation', () => { const options = { mode: 'idle', enabled: true }; activate(options); run(options) })",
    "test('getter return remains unknown', () => run({ get mode() { return globalThis.mode }, enabled: true }))",
    "test('missing own field', () => run({ enabled: true }))",
  ])
  assert.deepEqual(indices(plan), [2, 4, 5, 6])
})

test('a throwing null receiver does not contaminate the surviving array value', () => {
  const before = `export function changed() { return 1 }
function maybe(entries, fail) { if (fail) return null; return { entries } }
export function run(entries) { return maybe(entries, false).entries.filter(entry => entry.enabled) }`
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { run, changed } from '../src/owner'",
    "test('surviving array', () => run([{ enabled: true }]))",
    "test('direct owner', () => changed())",
  ])
  assert.deepEqual(indices(plan), [1])
})

test('plain object spreads preserve key precedence and unknown values remain possible', () => {
  const before = `export function changed() { return 1 }
export function run(config) { if (config.mode === 'skip') return; return changed() }`
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { run } from '../src/owner'",
    "test('later spread may override', () => run({ mode: 'skip', ...{ mode: 'run' } }))",
    "test('later own field wins', () => run({ ...{ mode: 'run' }, mode: 'skip' }))",
    "test('spread supplies active value', () => run({ ...{ mode: 'run' } }))",
    "test('spread supplies inactive value', () => run({ ...{ mode: 'skip' } }))",
  ])
  assert.deepEqual(indices(plan), [0, 2])
})

test('object spread invokes a known enumerable getter before later keys overwrite', () => {
  const before = `export function changed() { return 1 }
export function run(config) { return config.mode }`
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { run, changed } from '../src/owner'",
    "test('spread getter', () => run({ ...{ get value() { return changed() } }, mode: 'skip' }))",
    "test('nested spread getter', () => run({ ...{ ...{ get value() { return changed() } } }, mode: 'skip' }))",
    "test('prototype-named getter', () => run({ ...{ get __proto__() { return changed() } }, mode: 'skip' }))",
    "test('overwritten getter stays dormant', () => run({ ...{ get value() { return changed() }, ...{ value: 0 } }, mode: 'skip' }))",
    "test('direct owner', () => changed())",
  ])
  assert.deepEqual(indices(plan), [0, 1, 2, 4])
})

test('object spread keeps unknown getter and proxy effects explicit', () => {
  const before = `export function changed() { return 1 }
export function run(config) { return config.mode }`
  assert.throws(() => selection(before, before.replace('return 1', 'return 2'), [
    "import { run, changed } from '../src/owner'",
    "test('unknown spread', () => run({ ...{ ...globalThis.options }, mode: 'skip' }))",
    "test('direct owner', () => changed())",
  ]), /Unsafe object spread/)
})

test('a hoisted closure can populate a local array before its branch is tested', () => {
  const before = `export function changed() { return 1 }
export function run() { const changes = []; populate(); if (changes.length) return changed(); return 0; function populate() { changes.push(1) } }`
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { run } from '../src/owner'",
    "test('closure writes before the condition', () => run())",
  ])
  assert.deepEqual(indices(plan), [0])
})

test('shared data contexts retain the captured condition across actual activations', () => {
  const before = `export function changed() { return 1 }
export function run(enabled, unrelated) { function check() { if (enabled) return changed(); return 0 }; return check() }`
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { run } from '../src/owner'",
    "test('inactive activations', () => { run(false, {}); run(false, {}) })",
    "test('later active activation', () => { run(false, {}); run(true, {}) })",
  ])
  assert.deepEqual(indices(plan), [1])
})

test('iterated record fields distinguish absent optional registration from collection storage', () => {
  const before = `export function changed() { return 1 }
function unused() { Object.prototype.callbacks = { push(callback) { callback() } } }
class Bucket { constructor(private readonly entries) { for (const entry of this.entries) entry.callbacks?.push(() => changed()) } }
export function run(entries) { return new Bucket(entries) }
export function mapped() { return run(Array.from({ length: 3 }, (_, index) => ({ id: index }))) }`
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { run, changed, mapped } from '../src/owner'",
    "test('absent field', () => run([{ id: 1 }, { callbacks: undefined }, { callbacks: null }]))",
    "test('callback stored', () => run([{ callbacks: [] }]))",
    "test('actual owner', () => changed())",
    "test('empty iteration', () => run([]))",
    "test('mapped records', () => mapped())",
    "test('array truncation does not insert a numeric actor', () => { const entries = [{ id: 1 }]; run(entries); entries.length = 0 })",
  ])
  assert.deepEqual(indices(plan), [2])
  const populated = `export function changed() { return 1 }
export function run() { const entries = []; populate(); for (const entry of entries) entry(); function populate() { entries.push(() => changed()) } }`
  const filled = selection(populated, populated.replace('return 1', 'return 2'), [
    "import { run } from '../src/owner'",
    "test('helper fills before iteration', () => run())",
  ])
  assert.deepEqual(indices(filled), [0])
})

test('filtered arrays preserve actual element callbacks without introducing sibling owners', () => {
  const before = `export function changed() { return 1 }
export function run(entries) { const selected = entries.filter(entry => entry.enabled); for (const entry of selected) entry.invoke() }
export function combine(first, second) { return run([...first, ...second]) }
export function append(first, second) { const entries = []; entries.push(...first, ...second); return run(entries) }`
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { run, combine, append, changed } from '../src/owner'",
    "test('actual callback', () => run([{ enabled: true, invoke: () => changed() }]))",
    "test('other callback', () => run([{ enabled: true, invoke: () => 0 }]))",
    "test('spread preserves the second callback', () => combine([{ enabled: true, invoke: () => 0 }], [{ enabled: true, invoke: () => changed() }]))",
    "test('push spread retains its callback', () => append([], [{ enabled: true, invoke: () => changed() }]))",
  ])
  assert.deepEqual(indices(plan), [0, 2, 3])
})

test('array mapping preserves returned callback identity without executing it early', () => {
  const before = `export function changed() { return 1 }
export function mapped(entries) { return entries.map(entry => entry.invoke) }
export function run(entries) { for (const invoke of mapped(entries)) invoke() }
export function mapEffect(entries) { return entries.map(entry => changed()) }`
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { run, mapped, mapEffect, changed } from '../src/owner'",
    "test('mapped callback invoked', () => run([{ invoke: () => changed() }]))",
    "test('mapped callback returned only', () => mapped([{ invoke: () => changed() }]))",
    "test('different callback', () => run([{ invoke: () => 0 }]))",
    "test('mapper actually runs', () => mapEffect([1]))",
    "test('empty mapping does not run the callback', () => mapEffect([]))",
  ])
  assert.deepEqual(indices(plan), [0, 3])
})

test('Function.call forwards the actual receiver into source method guards', () => {
  const before = `export function changed() { return 1 }
class Original { run() { if (this.port) this.port.invoke() } give(callback) { return callback } }
export function run(receiver) { Original.prototype.run.call(receiver) }
export function apply(receiver) { Original.prototype.run.apply(receiver, []) }
export function bind(receiver, invoke) { const bound = Original.prototype.run.bind(receiver); if (invoke) bound() }
export function give(callback) { return Original.prototype.give.call({}, callback) }`
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { run, apply, bind, give, changed } from '../src/owner'",
    "test('actual receiver', () => run({ port: { invoke: () => changed() } }))",
    "test('empty receiver', () => run({ port: null }))",
    "test('other receiver', () => run({ port: { invoke: () => 0 } }))",
    "test('applied receiver', () => apply({ port: { invoke: () => changed() } }))",
    "test('empty applied receiver', () => apply({ port: null }))",
    "test('bound invocation', () => bind({ port: { invoke: () => changed() } }, true))",
    "test('bound only', () => bind({ port: { invoke: () => changed() } }, false))",
    "test('returned callback invoked', () => give(() => changed())())",
    "test('returned callback stays dormant', () => give(() => changed()))",
  ])
  assert.deepEqual(indices(plan), [0, 3, 5, 7])
})

test('borrowed methods do not dispatch absent members through their declared class', () => {
  const before = `export function changed() { return 1 }
class Owner { invoke() { changed() } run() { this.invoke() } }
export function run(receiver) { Owner.prototype.run.call(receiver) }`
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { run, changed } from '../src/owner'",
    "test('missing member', () => run({}))",
    "test('actual callback', () => run({ invoke: () => changed() }))",
    "test('other callback', () => run({ invoke: () => 0 }))",
  ])
  assert.deepEqual(indices(plan), [1])
})

test('optional method guards use the actual receiver passed through Function.call', () => {
  const before = `export function changed() { return 1 }
export class Port { invoke() { changed() } }
class Owner { port: Port | null; run() { this.port?.invoke() } }
export function run(receiver) { Owner.prototype.run.call(receiver) }`
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { run, Port } from '../src/owner'",
    "test('empty port', () => run({ port: null }))", "test('live port', () => run({ port: new Port() }))",
  ])
  assert.deepEqual(indices(plan), [1])
})

test('source enum values prune branches over the actual Function.call receiver', () => {
  const before = `export function changed() { return 1 }
export enum Mode { Done = 'done', Live = 'live' }
function update() { if (this.mode === Mode.Done) return; this.invoke() }
export function run(port) { update.call(port) }`
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { run, Mode, changed } from '../src/owner'",
    "test('completed', () => run({ mode: Mode.Done, invoke: () => changed() }))",
    "test('living', () => run({ mode: Mode.Live, invoke: () => changed() }))",
    "test('other', () => run({ mode: Mode.Live, invoke: () => 0 }))",
  ])
  assert.deepEqual(indices(plan), [1])
})

test('mutating an enum member prevents a stale constant branch proof', () => {
  const before = `export function changed() { return 1 }
export enum Mode { Done = 'done', Live = 'live' }
export function run() { Mode.Done = Mode.Live; if (Mode.Live !== Mode.Done) return; changed() }`
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { run } from '../src/owner'", "test('replaced member', () => run())",
  ])
  assert.deepEqual(indices(plan), [0])
})

test('forwarded empty arrays retain their length before native mutations', () => {
  const before = `export function changed() { return 1 }
function inner(entries) { if (entries.length === 0) return; changed() }
export function run(entries) { inner(entries) }`
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { run } from '../src/owner'",
    "test('empty', () => run([]))", "test('nonempty', () => run([1]))",
  ])
  assert.deepEqual(indices(plan), [1])
})

test('an absent borrowed member cannot escape its array argument before throwing', () => {
  const before = `export function changed() { return 1 }
class Owner { missing(entries) {} run(entries) { this.missing(entries) } }
export function run(entries) { try { Owner.prototype.run.call({}, entries) } catch {} if (entries.length === 0) return; changed() }`
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { run } from '../src/owner'", "test('empty', () => run([]))", "test('nonempty', () => run([1]))",
  ])
  assert.deepEqual(indices(plan), [1])
})

test('native mutations and unresolved escape prevent stale array length proofs', () => {
  const before = `export function changed() { return 1 }
export function run(entries, edit) { edit(entries); if (entries.length === 0) return; changed() }
export function nested(entries) { globalThis.edit({ entries }); if (entries.length === 0) return; changed() }
export function truncate(entries) { entries.length = 0; if (entries.length !== 0) return; changed() }`
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { run, nested, truncate } from '../src/owner'",
    "test('native push', () => run([], entries => entries.push(1)))",
    "test('unknown edit', () => run([], globalThis.edit))",
    "test('truncated', () => truncate([1]))",
    "test('nested escape', () => nested([]))",
  ])
  assert.deepEqual(indices(plan), [0, 1, 2, 3])
})

test('custom Function.call properties do not invoke the original function', () => {
  const before = `export function changed() { return 1 }
export function run() { function original() { changed() }; original.call = () => 0; original.call(null) }`
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { run, changed } from '../src/owner'", "test('custom adapter', () => run())", "test('owner', () => changed())",
  ])
  assert.deepEqual(indices(plan), [1])
})

test('Function.apply rejects an unresolved argument-list protocol', () => {
  const before = `export function changed() { return 1 }; export function run(callback, args) { callback.apply({}, args) }`
  assert.throws(() => selection(before, before.replace('return 1', 'return 2'), [
    "import { run, changed } from '../src/owner'", "test('unknown arguments', () => run(() => changed(), globalThis.unknown))",
  ]), /Unsafe collection callback.*Function adapter/)
})

const HAS_OWN_ADAPTER_SOURCE = `export function changed() { return 1 }
export function check(object, key) { return Object.prototype.hasOwnProperty.call(object, key) }`
function selectHasOwnAdapter(body) {
  return selection(HAS_OWN_ADAPTER_SOURCE, HAS_OWN_ADAPTER_SOURCE.replace('return 1', 'return 2'), [
    "import { check, changed } from '../src/owner'", ...body, "test('owner', () => changed())",
  ])
}

test('own-property adapter distinguishes the native method from a shadowed object', () => {
  const plan = selectHasOwnAdapter([
    "test('plain object', () => check({ item: 1 }, 'item'))",
    "test('unread getter', () => check({ get item() { changed(); return 1 } }, 'item'))",
    "test('shadowed Object', () => { const Object = { prototype: { hasOwnProperty: { call() { changed(); return true } } } }; return Object.prototype.hasOwnProperty.call({}, 'item') })",
  ])
  assert.deepEqual(indices(plan), [2, 3])
})

test('own-property adapter retains unknown receiver and property-key effects', () => {
  assert.throws(() => selectHasOwnAdapter(["test('proxy', () => check(globalThis.unknown, 'item'))"]), /Unsafe collection callback.*getter or proxy/)
  assert.throws(() => selectHasOwnAdapter(["test('key coercion', () => check({}, { toString() { changed(); return 'item' } }))"]), /Unsafe collection callback/)
})

test('own-property adapter cannot assume altered Object or Function intrinsics', () => {
  assert.throws(() => selectHasOwnAdapter(["test('Object mutated', () => { Object.prototype.hasOwnProperty = globalThis.unknown; check({}, 'item') })"]), /Unsafe collection callback.*Object/)
  assert.throws(() => selectHasOwnAdapter(["test('Function mutated', () => { Function.prototype.call = globalThis.unknown; check({}, 'item') })"]), /Unsafe collection callback.*Function/)
})

test('a proven own-property adapter preserves subsequent enumeration of its receiver', () => {
  const before = `export function changed() { return 1 }
export function run(key, callback) { const table = { item: 1 }; Object.prototype.hasOwnProperty.call(table, key); Object.values(table).map(() => callback()) }`
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { run, changed } from '../src/owner'",
    "test('changed callback', () => run('item', () => changed()))",
    "test('other callback', () => run('item', () => 0))",
    "test('owner', () => changed())",
  ])
  assert.deepEqual(indices(plan), [0, 2])
})

test('an own-property adapter cannot discard key coercion before enumeration', () => {
  const before = `export function changed() { return 1 }
export function run(key) { const table = { item: 1 }; Object.prototype.hasOwnProperty.call(table, key); return Object.values(table) }`
  assert.throws(() => selection(before, before.replace('return 1', 'return 2'), [
    "import { run, changed } from '../src/owner'",
    "test('unknown key', () => run(globalThis.key))",
    "test('owner', () => changed())",
  ]), /Unsafe (?:collection callback|native data operation)/)
})

test('a source adapter retains unknown mutation of an argument before serialization', () => {
  const before = `export function changed() { return 1 }
function mutate(data) { globalThis.mutate(data) }
export function run() { const data = { item: 1 }; mutate.call(null, data); JSON.stringify(data) }`
  assert.throws(() => selection(before, before.replace('return 1', 'return 2'), [
    "import { run, changed } from '../src/owner'",
    "test('unknown mutation', () => run())",
    "test('owner', () => changed())",
  ]), /Unsafe (?:collection callback|native data operation).*escaped/)
})

const NAMED_ARRAY_CALLBACK_SOURCE = `export function changed() { return 1 }
const table = { item: 1 }
function check(id) { return Object.prototype.hasOwnProperty.call(table, id) }
function effect(id) { changed(); return !!id }
function pure(id) { return !!id }
function mutate(item, index, array) { if (index === 0) array[1] = { valueOf() { changed(); return 1 } }; return Number(item) }
export function run(items) { return items.filter(check) }
export function mapper(items) { return items.map(id => id).filter(check) }
export function effects(items) { return items.filter(effect) }
export function mixed(items, invoke) { items.filter(effect); invoke(effect) }
export function customUnused() { return { filter(callback) { return [] } }.filter(effect) }
export function customCalls() { return { filter(callback) { return callback('item') } }.filter(effect) }
export function unknownReceiver(items) { return items.filter(pure) }
export function mutateItems(items) { items.forEach(mutate) }`
function selectNamedArrayCallbacks(body) {
  return selection(NAMED_ARRAY_CALLBACK_SOURCE, NAMED_ARRAY_CALLBACK_SOURCE.replace('return 1', 'return 2'), [
    "import { run, mapper, effects, mixed, customUnused, customCalls, unknownReceiver, mutateItems, changed } from '../src/owner'", ...body, "test('owner', () => changed())",
  ])
}

test('named array callbacks receive actual values and do not run for empty arrays', () => {
  const plan = selectNamedArrayCallbacks([
    "test('filter', () => run(['item']))",
    "test('mapped filter', () => mapper(['item']))",
    "test('empty', () => effects([]))",
  ])
  assert.deepEqual(indices(plan), [3])
})

test('named array callbacks preserve actual and separate custom invocations', () => {
  const plan = selectNamedArrayCallbacks([
    "test('filter callback', () => effects(['item']))",
    "test('separate callback', () => mixed([], cb => cb('item')))",
    "test('custom does not call', () => customUnused())",
    "test('custom invokes', () => customCalls())",
  ])
  assert.deepEqual(indices(plan), [0, 1, 3, 4])
})

test('named array callbacks retain unknown elements and key coercion', () => {
  assert.throws(() => selectNamedArrayCallbacks(["test('unknown', () => run([globalThis.unknown]))"]), /Unsafe collection callback/)
  assert.throws(() => selectNamedArrayCallbacks(["test('key coercion', () => run([{ toString() { changed(); return 'item' } }]))"]), /Unsafe collection callback/)
})

test('named array callback mutations through the receiver argument remain unresolved', () => {
  assert.throws(() => selectNamedArrayCallbacks(["test('mutated receiver', () => mutateItems([0, 1]))"]), /Unsafe collection callback.*iteration/)
})

test('named callbacks cannot assume a modified array iteration method', () => {
  assert.throws(() => selectNamedArrayCallbacks(["test('modified filter', () => { Array.prototype.filter = globalThis.unknown; run(['item']) })"]), /Unsafe collection callback.*iteration/)
})

test('a pure named callback cannot certify an unknown iteration receiver', () => {
  assert.throws(() => selectNamedArrayCallbacks(["test('unknown receiver', () => unknownReceiver(globalThis.unknown))"]), /Unsafe collection callback.*receiver identity/)
})

const SET_FOR_OF_SOURCE = `export function changed() { return 1 }
const table = { item: 1 }
function check(id) { return Object.prototype.hasOwnProperty.call(table, id) }
export function run(values) { for (const id of new Set(values)) check(id) }
export function effects(values) { for (const id of new Set(values)) changed() }`
function selectSetForOf(body) {
  return selection(SET_FOR_OF_SOURCE, SET_FOR_OF_SOURCE.replace('return 1', 'return 2'), [
    "import { run, effects, changed } from '../src/owner'", ...body, "test('owner', () => changed())",
  ])
}

test('inline Set iteration forwards finite values and skips an empty body', () => {
  const plan = selectSetForOf([
    "test('duplicates', () => run(['item', 'other', 'item']))",
    "test('empty', () => run([]))",
    "test('reached effect', () => effects(['item']))",
    "test('unreached effect', () => effects([]))",
  ])
  assert.deepEqual(indices(plan), [2, 4])
})

test('inline Set iteration retains unknown values and property-key coercion', () => {
  assert.throws(() => selectSetForOf(["test('unknown element', () => run([globalThis.unknown]))"]), /Unsafe collection callback/)
  assert.throws(() => selectSetForOf(["test('coercion', () => run([{ toString() { changed(); return 'item' } }]))"]), /Unsafe collection callback/)
})

test('inline Set iteration retains changed native iterator protocols', () => {
  assert.throws(() => selectSetForOf(["test('array iterator', () => { Array.prototype[Symbol.iterator] = globalThis.unknown; run(['item']) })"]), /Unsafe collection callback.*Set/)
  assert.throws(() => selectSetForOf(["test('set iterator', () => { Set.prototype[Symbol.iterator] = globalThis.unknown; run(['item']) })"]), /Unsafe collection callback.*Set/)
})

test('inline Set construction cannot assume an escaped or overridden input iterator', () => {
  assert.throws(() => selectSetForOf(["test('own iterator', () => { const values = ['item']; values[Symbol.iterator] = globalThis.unknown; run(values) })"]), error => {
    assert.match(error.message, /Unsafe collection callback/)
    assert.match(error.diagnostics.unresolved.expression, /values\[Symbol\.iterator\]/)
    assert.equal(error.diagnostics.unresolved.frontier.expression, 'Symbol')
    return true
  })
  assert.throws(() => selectSetForOf(["test('escaped input', () => { const values = ['item']; globalThis.mutate(values); run(values) })"]), /Unsafe collection callback.*Set/)
})

test('inline Set construction rejects an explicitly redefined iterator', () => {
  assert.throws(() => selectSetForOf(["test('defined iterator', () => { const values = ['item']; Object.defineProperty(values, Symbol.iterator, { value: globalThis.unknown }); run(values) })"]), /Unsafe collection callback.*Set/)
})

function selectAsyncSetForOf(body) {
  const before = `export function changed() { return 1 }
export async function run(values) { for await (const value of (new Set(values))) {} }`
  return selection(before, before.replace('return 1', 'return 2'), [
    "import { run, changed } from '../src/owner'", ...body, "test('owner', () => changed())",
  ])
}

test('async Set iteration accepts finite primitive elements', () => {
  const plan = selectAsyncSetForOf(["test('values', () => run(['item']))", "test('empty', () => run([]))"])
  assert.deepEqual(indices(plan), [2])
})

test('async Set iteration cannot ignore a possible thenable', () => {
  assert.throws(() => selectAsyncSetForOf(["test('thenable', () => run([{ then(resolve) { changed(); resolve() } }]))"]), /Unsafe collection callback.*thenable/)
  assert.throws(() => selectAsyncSetForOf(["test('unknown', () => run([globalThis.unknown]))"]), /Unsafe collection callback.*thenable/)
})

const REDUCE_SOURCE = `export function changed() { return 1 }
export function nested(profile) { return Object.values(profile ?? {}).reduce((count, state) => count + Object.values(state?.actors ?? {}).reduce((sum, refs) => sum + Object.values(refs).filter(ref => ref?.source === 'inventory' && ref.itemId === 'item').length, 0), 0) }
export function effects(values) { return values.reduce((sum, value) => { changed(); return sum + value }, 0) }
export function repeats(values) { let seen = false; return values.reduce((sum, value) => { if (seen) changed(); seen = true; return sum + value }, 0) }
export function uncalledInitial() { return [].reduce((acc, value) => acc, () => changed()) }
export function calledInitial() { return [].reduce((acc, value) => acc, () => changed())() }
export function evolve(values) { return values.reduce((sum, value) => { Number(sum); return sum === 0 ? 1 : { valueOf() { changed(); return 2 } } }, 0) }
export function mutate(values) { return values.reduce((sum, value, index, array) => { if (index === 0) array[1] = { valueOf() { changed(); return 1 } }; return sum + Number(value) }, 0) }
export function customUnused() { return { reduce(callback, initial) { return initial } }.reduce(() => changed(), 0) }
export function customCalls() { return { reduce(callback, initial) { return callback(initial, 1) } }.reduce(() => changed(), 0) }`
function selectReductions(body) {
  return selection(REDUCE_SOURCE, REDUCE_SOURCE.replace('return 1', 'return 2'), [
    "import { nested, effects, repeats, uncalledInitial, calledInitial, evolve, mutate, customUnused, customCalls, changed } from '../src/owner'", ...body, "test('owner', () => changed())",
  ])
}

test('nested numeric reductions pass actual object values to each callback', () => {
  const plan = selectReductions([
    "test('nested', () => nested({ faction: { actors: { member: { melee: { source: 'inventory', itemId: 'item' }, ranged: null } } } }))",
    "test('empty', () => nested({ faction: { actors: {} } }))",
  ])
  assert.deepEqual(indices(plan), [2])
})

test('reductions preserve reached callbacks and distinguish custom methods', () => {
  const plan = selectReductions([
    "test('reached', () => effects([1, 2]))", "test('empty', () => effects([]))",
    "test('custom unused', () => customUnused())", "test('custom invoked', () => customCalls())",
  ])
  assert.deepEqual(indices(plan), [0, 3, 4])
})

test('nested reductions retain unresolved object and getter effects', () => {
  assert.throws(() => selectReductions(["test('unknown', () => nested({ faction: { actors: { member: globalThis.unknown } } }))"]), /Unsafe (?:collection callback|native data operation)/)
  assert.throws(() => selectReductions(["test('getter', () => nested({ faction: { actors: { member: { get melee() { changed(); return null } } } } }))"]), /Unsafe (?:collection callback|native data operation)/)
})

test('a later reduction callback observes earlier captured writes', () => {
  const plan = selectReductions(["test('repeated', () => repeats([1, 2]))", "test('empty', () => repeats([]))"])
  assert.deepEqual(indices(plan), [0, 2])
})

test('an empty reduction returns its initial callable without invoking it', () => {
  const plan = selectReductions(["test('uncalled', () => uncalledInitial())", "test('called', () => calledInitial())"])
  assert.deepEqual(indices(plan), [1, 2])
})

test('reductions cannot assume a stable accumulator or ignore receiver mutation', () => {
  assert.throws(() => selectReductions(["test('changing accumulator', () => evolve([1, 2, 3]))"]), /Unsafe collection callback.*[Rr]eduction/)
  assert.throws(() => selectReductions(["test('changed receiver', () => mutate([1, 2]))"]), /Unsafe collection callback.*[Rr]eduction/)
})

test('escaped empty arrays cannot suppress later callbacks or loop bodies', () => {
  const before = `export function changed() { return 1 }
export function mapped(values) { globalThis.mutate(values); values.map(() => changed()) }
export function looped(values) { globalThis.mutate(values); for (const value of values) changed() }`
  for (const method of ['mapped', 'looped']) assert.throws(() => selection(before, before.replace('return 1', 'return 2'), [
    "import { mapped, looped } from '../src/owner'", `test('escaped', () => ${method}([]))`,
  ]), /Unsafe collection callback/)
})

const ARRAY_MUTATION_SOURCE = `export function changed() { return 1 }
export function spliceInto(values, extra) { values.splice(0, 0, ...extra); values.forEach(callback => callback()) }
export function located(values, extra) { const index = values.findIndex(() => true); values.splice(index, 0, ...extra); values.forEach(callback => callback()) }
export function dormant() { const values = []; values.splice(0, 0, () => changed()) }
export function fill(values, callback) { values.fill(callback); values.forEach(item => item()) }
export function unsafeIndex(values, index) { values.splice(index, 0, () => 0); values.forEach(callback => callback()) }
export function customUnused() { return { splice(a, b, callback) { return 0 } }.splice(0, 0, () => changed()) }
export function customCalled() { return { splice(a, b, callback) { return callback() } }.splice(0, 0, () => changed()) }`
function selectArrayMutations(body) {
  return selection(ARRAY_MUTATION_SOURCE, ARRAY_MUTATION_SOURCE.replace('return 1', 'return 2'), [
    "import { spliceInto, located, dormant, fill, unsafeIndex, customUnused, customCalled, changed } from '../src/owner'", ...body, "test('owner', () => changed())",
  ])
}

test('array mutations retain inserted values without invoking dormant callbacks', () => {
  const plan = selectArrayMutations([
    "test('inserted', () => spliceInto([], [() => changed()]))", "test('other', () => spliceInto([], [() => 0]))",
    "test('empty', () => spliceInto([], []))", "test('stored only', () => dormant())",
  ])
  assert.deepEqual(indices(plan), [0, 4])
})

test('array fill and computed splice bounds retain actual inserted callbacks', () => {
  const plan = selectArrayMutations([
    "test('filled', () => fill([() => 0], () => changed()))",
    "test('computed index', () => located([() => 0], [() => changed()]))",
  ])
  assert.deepEqual(indices(plan), [0, 1, 2])
})

test('array mutations retain unknown iterator and index coercion effects', () => {
  assert.throws(() => selectArrayMutations(["test('unknown iterator', () => spliceInto([], globalThis.unknown))"]), /Unsafe collection callback.*mutation/)
  assert.throws(() => selectArrayMutations(["test('coercion', () => unsafeIndex([], { valueOf() { changed(); return 0 } }))"]), /Unsafe collection callback.*mutation/)
})

test('array mutation identity stays separate from custom same-name methods', () => {
  assert.throws(() => selectArrayMutations(["test('changed intrinsic', () => { Array.prototype.splice = globalThis.unknown; spliceInto([], []) })"]), /Unsafe collection callback/)
  const plan = selectArrayMutations(["test('custom unused', () => customUnused())", "test('custom called', () => customCalled())"])
  assert.deepEqual(indices(plan), [1, 2])
})

const ARRAY_INDEX_WRITE_SOURCE = `export function changed() { return 1 }
export function shuffle(values) { const candidates = [...values]; for (let i = candidates.length - 1; i > 0; i--) { const j = Math.floor(i / 2); const tmp = candidates[i]; candidates[i] = candidates[j]; candidates[j] = tmp }; candidates.forEach(callback => callback()) }
export function tail(values) { let remaining = values.length; while (remaining > 0) { remaining--; values[remaining] = values[0] }; values.forEach(callback => callback()) }
export function cached(callback) { const cache = new Map(); let values = cache.get('a'); if (!values) { values = [callback]; cache.set('a', values) }; let remaining = values.length; while (remaining > 0) { remaining--; values[remaining] = values[0] }; values.forEach(fn => fn()) }
export function empty(callback) { const values = globalThis.flag ? null : []; values.forEach(callback) }
export function update(values, start) { let index = start; index--; values[index] = () => 0 }
export function dynamic(values, key) { values[key] = () => 0; values.forEach(callback => callback()) }
export function unknownStart(values) { for (let i = globalThis.unknown - 1; i > 0; i--) values[i] = () => 0 }`
function selectArrayIndexWrites(body) {
  return selection(ARRAY_INDEX_WRITE_SOURCE, ARRAY_INDEX_WRITE_SOURCE.replace('return 1', 'return 2'), [
    "import { shuffle, tail, cached, empty, update, dynamic, unknownStart, changed } from '../src/owner'", ...body, "test('owner', () => changed())",
  ])
}

test('numeric array writes preserve values across shuffles and cached counters', () => {
  const plan = selectArrayIndexWrites([
    "test('changed callback', () => shuffle([() => changed(), () => 0]))",
    "test('other callbacks', () => shuffle([() => 0, () => 0]))",
    "test('updated counter', () => tail([() => changed(), () => 0]))",
    "test('other updated counter', () => tail([() => 0, () => 0]))",
    "test('cached callback', () => cached(() => changed()))",
    "test('other cached callback', () => cached(() => 0))",
    "test('throwing or empty receiver', () => empty(() => changed()))",
  ])
  assert.deepEqual(indices(plan), [0, 2, 4, 7])
})

test('array index writes retain unknown key and coercion effects', () => {
  assert.throws(() => selectArrayIndexWrites(["test('unknown', () => dynamic([], globalThis.unknown))"]), /Unsafe collection callback/)
  assert.throws(() => selectArrayIndexWrites(["test('coercion', () => dynamic([], { toString() { changed(); return '0' } }))"]), /Unsafe collection callback.*index/)
  assert.throws(() => selectArrayIndexWrites(["test('update coercion', () => update([], { valueOf() { changed(); return 1 } }))"]), /Unsafe collection callback/)
})

test('numeric index proof cannot ignore prototype or initializer effects', () => {
  assert.throws(() => selectArrayIndexWrites(["test('prototype', () => { Object.prototype[0] = globalThis.unknown; shuffle([() => 0, () => 0]) })"]), /Unsafe collection callback.*index/)
  assert.throws(() => selectArrayIndexWrites(["test('initializer', () => unknownStart([]))"]), /Unsafe collection callback/)
})

test('closed native Map scalar updates retain actual key values across a loop', () => {
  const before = 'export function changed() { return 1 }'
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { vi } from 'vitest'; import { changed } from '../src/owner'",
    "test('counter', () => { const key = { id: 'a' }; const counts = new Map([['a', 0]]); for (const actor of [1, 2]) { const n = counts.get(key.id); counts.set(key.id, n + 1); const read = vi.fn(() => Number(n) + [...counts.keys()].join(',').length); read() } })",
    "test('owner', () => changed())",
  ])
  assert.deepEqual(indices(plan), [1])
})

test('closed Map updates keep separate function activations distinct', () => {
  const before = `import { vi } from 'vitest'
export function changed() { return 1 }
function run(initial) { const counts = new Map([['a', initial]]); for (const key of ['a']) { const n = counts.get(key); counts.set(key, n + 1); const read = vi.fn(() => Number(n)); read() } }
export function safe() { run(0); run(1) }
export function unsafe() { run(0); run({ valueOf() { changed(); return 1 } }) }`
  const after = before.replace('return 1', 'return 2')
  const plan = selection(before, after, [
    "import { safe, changed } from '../src/owner'",
    "test('separate counters', () => safe())",
    "test('owner', () => changed())",
  ])
  assert.deepEqual(indices(plan), [1])
  assert.throws(() => selection(before, after, [
    "import { unsafe, changed } from '../src/owner'",
    "test('second counter can invoke coercion', () => unsafe())",
    "test('owner', () => changed())",
  ]), /Unsafe mock boundary.*coercion/)
})

test('Map updates retain key getters and unknown value coercions', () => {
  const before = 'export function changed() { return 1 }'
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { vi } from 'vitest'; import { changed } from '../src/owner'",
    "test('key getter', () => { const key = { get id() { changed(); return 'a' } }; const counts = new Map([['a', 0]]); for (const actor of [1, 2]) { const n = counts.get('a'); counts.set(key.id, n + 1); const read = vi.fn(() => Number(n)); read() } })",
    "test('owner', () => changed())",
  ])
  assert.deepEqual(indices(plan), [0, 1])
  assert.throws(() => selection(before, before.replace('return 1', 'return 2'), [
    "import { vi } from 'vitest'; import { changed } from '../src/owner'",
    "test('unknown key', () => { const counts = new Map([['a', 0]]); for (const actor of [1, 2]) { const n = counts.get('a'); counts.set(globalThis.unknown.id, n + 1); const read = vi.fn(() => Number(n)); read() } })",
    "test('owner', () => changed())",
  ]), /Unsafe mock boundary/)
  assert.throws(() => selection(before, before.replace('return 1', 'return 2'), [
    "import { vi } from 'vitest'; import { changed } from '../src/owner'",
    "test('unknown coercion', () => { const counts = new Map([['a', { valueOf() { changed(); return 1 } }]]); for (const actor of [1, 2]) { const n = counts.get('a'); counts.set('a', n + 1); const read = vi.fn(() => Number(n)); read() } })",
    "test('owner', () => changed())",
  ]), /Unsafe mock boundary/)
})

test('an exported Map can be mutated by an importing module', () => {
  const before = 'export function changed() { return 1 }'
  for (const exported of ["export const counts = new Map([['a', 0]])", "const counts = new Map([['a', 0]]); export { counts }"]) {
    assert.throws(() => selection(before, before.replace('return 1', 'return 2'), [
      "import { vi } from 'vitest'; import { changed } from '../src/owner'; import { counts } from '../src/store'; import { update } from '../src/change'",
      "test('imported mutation', () => { update(); const read = vi.fn(() => Number(counts.get('a'))); read() })",
      "test('owner', () => changed())",
    ], [
      ['src/store.ts', exported],
      ['src/change.ts', "import { counts } from './store'; import { changed } from './owner'; export function update() { counts.set('a', { valueOf() { changed(); return 1 } }) }"],
    ]), /Unsafe mock boundary.*coercion/)
  }
})

test('Map iterators retain updated values when their order is observed', () => {
  const before = 'export function changed() { return 1 }'
  for (const expression of ["[...counts.values()][0]", "[...counts.entries()][0][1]"]) assert.throws(() => selection(before, before.replace('return 1', 'return 2'), [
    "import { vi } from 'vitest'; import { changed } from '../src/owner'",
    `test('updated entry', () => { const counts = new Map([['a', 0]]); counts.set('a', { valueOf() { changed(); return 1 } }); const read = vi.fn(() => Number(${expression})); read() })`,
    "test('owner', () => changed())",
  ]), /Unsafe mock boundary.*coercion/)
})

test('Map iterators retain externally mutated entries', () => {
  const before = 'export function changed() { return 1 }'
  for (const expression of ["[...counts.values()][0]", "[...counts.entries()][0][1]"]) assert.throws(() => selection(before, before.replace('return 1', 'return 2'), [
    "import { vi } from 'vitest'; import { changed } from '../src/owner'; import { counts } from '../src/store'; import { update } from '../src/change'",
    `test('imported mutation', () => { update(); const read = vi.fn(() => Number(${expression})); read() })`,
    "test('owner', () => changed())",
  ], [
    ['src/store.ts', "export const counts = new Map([['a', 0]])"],
    ['src/change.ts', "import { counts } from './store'; import { changed } from './owner'; export function update() { counts.set('a', { valueOf() { changed(); return 1 } }) }"],
  ]), /Unsafe mock boundary.*coercion/)
})

test('array copies retain uncertainty about updated Map value order', () => {
  const before = 'export function changed() { return 1 }'
  for (const expression of ["Array.from(counts.values())[0]", "[...counts.values()].concat([])[0]"]) assert.throws(() => selection(before, before.replace('return 1', 'return 2'), [
    "import { vi } from 'vitest'; import { changed } from '../src/owner'",
    `test('copied entry', () => { const counts = new Map([['a', 0]]); counts.set('a', { valueOf() { changed(); return 1 } }); const read = vi.fn(() => Number(${expression})); read() })`,
    "test('owner', () => changed())",
  ]), /Unsafe mock boundary.*coercion/)
})

test('Set iteration retains members after additions, deletions and external changes', () => {
  const before = 'export function changed() { return 1 }'
  assert.throws(() => selection(before, before.replace('return 1', 'return 2'), [
    "import { vi } from 'vitest'; import { changed } from '../src/owner'",
    "test('changed set', () => { const counts = new Set([0]); counts.add({ valueOf() { changed(); return 1 } }); counts.delete(0); const read = vi.fn(() => Number([...counts.values()][0])); read() })",
    "test('owner', () => changed())",
  ]), /Unsafe mock boundary.*coercion/)
  assert.throws(() => selection(before, before.replace('return 1', 'return 2'), [
    "import { vi } from 'vitest'; import { changed } from '../src/owner'; import { counts } from '../src/store'; import { update } from '../src/change'",
    "test('imported set', () => { update(); const read = vi.fn(() => Number([...counts][0])); read() })",
    "test('owner', () => changed())",
  ], [
    ['src/store.ts', 'export const counts = new Set([0])'],
    ['src/change.ts', "import { counts } from './store'; import { changed } from './owner'; export function update() { counts.clear(); counts.add({ valueOf() { changed(); return 1 } }) }"],
  ]), /Unsafe mock boundary.*coercion/)
})

test('Map storage preserves keyed callback values without invoking them early', () => {
  const before = `export function changed() { return 1 }
export function run(selected, other) { const entries = new Map(); entries.set('selected', selected); entries.set('other', other); entries.get('selected')?.() }
export function store(callback) { const entries = new Map(); entries.set('selected', callback) }
export function initial(selected, other) { new Map([['selected', selected], ['other', other]]).get('selected')?.() }`
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { run, store, initial, changed } from '../src/owner'",
    "test('selected', () => run(() => changed(), () => 0))",
    "test('other key', () => run(() => 0, () => changed()))",
    "test('stored only', () => store(() => changed()))",
    "test('constructor selected', () => initial(() => changed(), () => 0))",
    "test('constructor other', () => initial(() => 0, () => changed()))",
  ])
  assert.deepEqual(indices(plan), [0, 3])
})

test('a reached module cache assignment preserves its Map and callback receiver', () => {
  const before = `export function changed() { return 1 }
let cache;
function cached(callback) { if (cache) return cache; cache = { entries: new Map([['run', callback]]) }; return cache }
export function run(callback) { cached(callback).entries.get('run')?.() }`
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { run, changed } from '../src/owner'",
    "test('changed', () => run(() => changed()))",
    "test('other', () => run(() => 0))",
  ])
  assert.deepEqual(indices(plan), [0])
})

test('Map method replacement retains a scoped identity frontier', () => {
  const before = `export function changed() { return 1 }; export function run() { const entries = new Map(); entries.get = globalThis.unknown; entries.get('value'); changed() }`
  assert.throws(() => selection(before, before.replace('return 1', 'return 2'), [
    "import { run } from '../src/owner'", "test('modified method', () => run())",
  ]), /Unsafe collection callback.*Map/)
  const escaped = `export function changed() { return 1 }; export function run() { const entries = new Map(); globalThis.unknown(entries); entries.get('value'); changed() }`
  assert.throws(() => selection(escaped, escaped.replace('return 1', 'return 2'), [
    "import { run } from '../src/owner'", "test('escaped receiver', () => run())",
  ]), /Unsafe native data operation|Unsafe collection callback/)
})

test('array sort preserves callback values and invokes comparators only when possible', () => {
  const before = `export function changed() { return 1 }
export function run(entries) { for (const callback of entries.sort((a, b) => 0)) callback() }
export function compare(entries) { entries.sort((a, b) => changed()) }`
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { run, compare, changed } from '../src/owner'",
    "test('changed value', () => run([() => changed()]))",
    "test('other value', () => run([() => 0]))",
    "test('empty comparator', () => compare([]))",
    "test('one comparator', () => compare([1]))",
    "test('comparator runs', () => compare([1, 2]))",
  ])
  assert.deepEqual(indices(plan), [0, 4])
})

test('sorting an array updates later indexed callback provenance', () => {
  const before = `export function changed() { return 1 }
export function run(first, second) { const values = [first, second]; values.sort(() => -1); values[1]() }`
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { run, changed } from '../src/owner'",
    "test('reordered callback', () => run(() => changed(), () => 0))",
    "test('other callbacks', () => run(() => 0, () => 0))",
  ])
  assert.deepEqual(indices(plan), [0])
})

test('native map indices remain numbers through a numeric sort comparator', () => {
  const before = `export function changed() { return 1 }
export function run(values, callback) { values.map((value, index) => index + 1).sort((a, b) => a - b); callback() }`
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { run, changed } from '../src/owner'",
    "test('changed', () => run([1, 2], () => changed()))",
    "test('other', () => run([1, 2], () => 0))",
  ])
  assert.deepEqual(indices(plan), [0])
})

test('array sort compares the actual finite record fields', () => {
  const before = `export function changed() { return 1 }
export function run(callback) { [{ entries: [1] }, { entries: [1, 2] }].sort((a, b) => a.entries.length - b.entries.length); callback() }
export function sort(entries) { entries.sort((a, b) => a.entries.length - b.entries.length) }
export function populated(callback, useThis = false) { const entries = []; entries.push(useThis ? { callback, get value() { this.callback(); return 1 } } : { get value() { callback(); return 1 } }); sort([{ entries }, { entries: [] }]); return entries[0].value }`
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { run, sort, populated, changed } from '../src/owner'",
    "test('changed', () => run(() => changed()))",
    "test('other', () => run(() => 0))",
    "test('getter effect', () => sort([{ get entries() { changed(); return [1] } }, { entries: [] }]))",
    "test('unread element getter', () => sort([{ entries: [{ get value() { changed(); return 1 } }] }, { entries: [] }]))",
    "test('later element read', () => populated(() => changed()))",
    "test('getter receiver', () => populated(() => changed(), true))",
  ])
  assert.deepEqual(indices(plan), [0, 2, 4, 5])
})

test('array sort comparator retains unknown coercion effects', () => {
  const before = `export function changed() { return 1 }; export function run(entries) { entries.sort((a, b) => a - b); changed() }`
  assert.throws(() => selection(before, before.replace('return 1', 'return 2'), [
    "import { run } from '../src/owner'", "test('unknown values', () => run([globalThis.a, globalThis.b]))",
  ]), /Unsafe collection callback/)
})

const SORT_REVISIT_SOURCE = `export function changed() { return 1 }
export function run(items) {
  const pairs = items.flatMap(p => [...p.left, ...p.right].map(id => { p.hook(); return [id, p.rank] }))
  const index = new Map(pairs)
  const values = items.map(item => ({ score: index.get(item.id) }))
  values.sort((a, b) => a.score - b.score)
}`
function selectSortRevisit(body) {
  return selection(SORT_REVISIT_SOURCE, SORT_REVISIT_SOURCE.replace('return 1', 'return 2'), [
    "import { run, changed } from '../src/owner'", ...body, "test('owner', () => changed())",
  ])
}

test('sort value queries reuse actual array callback activations', () => {
  const plan = selectSortRevisit([
    "test('changed hook', () => run([{ id: 'a', left: ['a'], right: [], rank: 1, hook: () => changed() }, { id: 'b', left: ['b'], right: [], rank: 2, hook: () => 0 }]))",
    "test('other hooks', () => run([{ id: 'a', left: ['a'], right: [], rank: 1, hook: () => 0 }, { id: 'b', left: ['b'], right: [], rank: 2, hook: () => 0 }]))",
  ])
  assert.deepEqual(indices(plan), [0, 2])
})

test('sort value queries retain unknown getter and callback effects', () => {
  assert.throws(() => selectSortRevisit(["test('getter', () => run([{ id: 'a', get left() { changed(); return ['a'] }, right: [], rank: 1, hook: () => 0 }]))"]), /Unsafe collection callback/)
  assert.throws(() => selectSortRevisit(["test('unknown callback', () => run([{ id: 'a', left: ['a'], right: [], rank: 1, hook: globalThis.unknown }]))"]), /Unsafe collection callback/)
})

test('flatMap and inline Set spread retain only possible callback values', () => {
  const before = `export function changed() { return 1 }
export function run(entries) { for (const callback of [...new Set(entries.flatMap(entry => [entry]))]) callback() }`
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { run, changed } from '../src/owner'",
    "test('changed', () => run([() => changed()]))",
    "test('other', () => run([() => 0]))",
  ])
  assert.deepEqual(indices(plan), [0])
})

test('inline Set spread does not assume an unknown iterator is pure', () => {
  const before = `export function changed() { return 1 }; export function run(value) { [...new Set(value)]; changed() }`
  assert.throws(() => selection(before, before.replace('return 1', 'return 2'), [
    "import { run } from '../src/owner'", "test('unknown', () => run(globalThis.unknown))",
  ]), /Unsafe collection callback.*Set/)
  assert.throws(() => selection(before, before.replace('return 1', 'return 2'), [
    "import { run } from '../src/owner'", "test('modified protocol', () => { Set.prototype[Symbol.iterator] = globalThis.unknown; run([]) })",
  ]), /Unsafe collection callback.*Set/)
})

test('Array.from preserves callbacks for finite computed lengths', () => {
  const before = `export function changed() { return 1 }
export function run(enabled, callback) { const entries = Array.from({ length: enabled ? 2 : 0 }, () => { const result = callback; return result }); for (const entry of entries) entry() }
export function mapperRuns(enabled) { return Array.from({ length: enabled ? 2 : 0 }, () => changed()) }`
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { run, changed, mapperRuns } from '../src/owner'",
    "test('nonempty', () => run(true, () => changed()))",
    "test('empty', () => run(false, () => changed()))",
    "test('other', () => run(true, () => 0))",
    "test('mapper runs', () => mapperRuns(true))",
    "test('mapper does not run', () => mapperRuns(false))",
  ])
  assert.deepEqual(indices(plan), [0, 3])
})

test('Array.from uses bounded numeric effects while keeping returned callback identity', () => {
  const before = `export function changed() { return 1 }
export function run(count, callback) { const entries = Array.from({ length: Math.ceil(count) }, (_, index) => { const result = callback; return result }); const more = Array.from({ length: Math.ceil(count) }, () => callback); for (const entry of [...entries, ...more]) entry() }`
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { run, changed } from '../src/owner'",
    "test('changed', () => run(1, () => changed()))",
    "test('other', () => run(1, () => 0))",
  ])
  assert.deepEqual(indices(plan), [0])
})

test('Array.from rejects unresolved numeric coercion', () => {
  const before = `export function changed() { return 1 }
export function run(count) { Array.from({ length: Math.ceil(count) }, () => changed()) }`
  assert.throws(() => selection(before, before.replace('return 1', 'return 2'), [
    "import { run } from '../src/owner'",
    "test('unknown count', () => run(globalThis.unknown))",
  ]), /Unsafe collection callback.*(coercion|getter|proxy)/)
})

test('Array.from rechecks a dynamic length when captured data changes', () => {
  const before = `export function changed() { return 1 }
export function run() { const config = { count: 1 }; [0, 1].forEach(i => { if (i) config.count = globalThis.unknown; Array.from({ length: Math.ceil(config.count) }, () => changed()) }) }`
  assert.throws(() => selection(before, before.replace('return 1', 'return 2'), [
    "import { run, changed } from '../src/owner'", "test('changed data', () => run())", "test('owner', () => changed())",
  ]), /Unsafe collection callback.*coercion/)
})

test('Array.from unknown iterator retains its scoped effect frontier', () => {
  const before = `export function changed() { return 1 }
export function run(input) { Array.from(input, () => changed()) }`
  assert.throws(() => selection(before, before.replace('return 1', 'return 2'), [
    "import { run } from '../src/owner'",
    "test('unknown iterator', () => run(globalThis.unknown))",
  ]), /Unsafe collection callback.*Array.from/)
})

const FOREACH_FROM_SOURCE = `export function changed() { return 1 }
export function run(groups) { groups.forEach(group => { Array.from({ length: Math.ceil(group.count) }, (_, index) => Math.min(3, group.count - index)) }) }
export function called(groups) { groups.forEach(group => { Array.from({ length: Math.ceil(group.count) }, () => changed()) }) }
export function mutate(groups) { groups.forEach((group, index) => { if (index === 0) groups[1] = { get count() { changed(); return 2 } }; Array.from({ length: Math.ceil(group.count) }, () => 1) }) }`
function selectForEachFrom(body) {
  return selection(FOREACH_FROM_SOURCE, FOREACH_FROM_SOURCE.replace('return 1', 'return 2'), [
    "import { run, called, mutate, changed } from '../src/owner'", ...body, "test('owner', () => changed())",
  ])
}

test('forEach passes actual array elements to nested Array.from and skips an empty array', () => {
  const plan = selectForEachFrom([
    "test('finite groups', () => run([{ count: 2 }, { count: 3 }]))",
    "test('empty groups', () => called([]))",
  ])
  assert.deepEqual(indices(plan), [2])
})

test('forEach retains callbacks, getters and custom receiver effects', () => {
  const plan = selectForEachFrom([
    "test('mapper', () => called([{ count: 2 }]))",
    "test('getter', () => run([{ get count() { changed(); return 2 } }]))",
    "test('custom method', () => run({ forEach(cb) { cb({ get count() { changed(); return 2 } }) } }))",
  ])
  assert.deepEqual(indices(plan), [0, 1, 2, 3])
})

test('forEach leaves unknown inputs and mutations during iteration unresolved', () => {
  assert.throws(() => selectForEachFrom(["test('unknown receiver', () => run(globalThis.unknown))"]), /Unsafe collection callback/)
  assert.throws(() => selectForEachFrom(["test('changed receiver', () => mutate([{ count: 1 }, { count: 2 }]))"]), /Unsafe collection callback/)
})

test('destructured for-of entries retain their collection and callback values', () => {
  const before = `export function changed() { return 1 }
export function run(first, second) { for (const [name, entries] of [['first', first], ['second', second]]) entries.map(callback => callback()) }`
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { run, changed } from '../src/owner'",
    "test('first', () => run([() => changed()], [() => 0]))",
    "test('second', () => run([() => 0], [() => changed()]))",
    "test('neither', () => run([() => 0], [() => 0]))",
  ])
  assert.deepEqual(indices(plan), [0, 1])
})

test('for-of destructuring executes a default callback for a missing array entry', () => {
  const before = `export function changed() { return 1 }
export function run(fallback) { for (const [callback = fallback] of [[]]) callback() }`
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { run, changed } from '../src/owner'",
    "test('changed default', () => run(() => changed()))",
    "test('other default', () => run(() => 0))",
  ])
  assert.deepEqual(indices(plan), [0])
})

test('array slice preserves possible callback values and bounds coercion', () => {
  const before = `export function changed() { return 1 }
export function run(items) { items.slice(0, 1).map(callback => callback()) }`
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { run, changed } from '../src/owner'",
    "test('changed', () => run([() => changed()]))",
    "test('other', () => run([() => 0]))",
  ])
  assert.deepEqual(indices(plan), [0])
  const unsafe = `export function changed() { return 1 }; export function run(bound) { [1].slice(bound); changed() }`
  assert.throws(() => selection(unsafe, unsafe.replace('return 1', 'return 2'), [
    "import { run } from '../src/owner'",
    "test('unknown bound', () => run(globalThis.unknown))",
  ]), /Unsafe native data operation.*slice/)
})

test('multiple finite spreads preserve field precedence and callback ownership', () => {
  const before = `export function changed() { return 1 }
export function run(base, extra) { const value = { ...base, ...extra }; value.callback() }`
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { run, changed } from '../src/owner'",
    "test('preserved', () => run({ callback: () => changed() }, { other: 1 }))",
    "test('overwritten', () => run({ callback: () => changed() }, { callback: () => 0 }))",
    "test('last spread', () => run({ callback: () => 0 }, { callback: () => changed() }))",
  ])
  assert.deepEqual(indices(plan), [0, 2])
})

test('a self-referential spread assignment terminates without losing its callback', () => {
  const before = `export function changed() { return 1 }
export function run(callback) { let state = { callback }; if (globalThis.more) state = { ...state }; state.callback() }`
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { run, changed } from '../src/owner'",
    "test('changed', () => run(() => changed()))",
    "test('other', () => run(() => 0))",
  ])
  assert.deepEqual(indices(plan), [0])
})

test('mutable local array assignments preserve all possible callback owners', () => {
  const before = `export function changed() { return 1 }
export function run(condition, first, second) { let items = []; if (condition) items = [first]; else items = [second]; items.map(callback => callback()) }`
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { run, changed } from '../src/owner'",
    "test('first', () => run(globalThis.condition, () => changed(), () => 0))",
    "test('second', () => run(globalThis.condition, () => 0, () => changed()))",
    "test('other', () => run(globalThis.condition, () => 0, () => 0))",
  ])
  assert.deepEqual(indices(plan), [0, 1])
})

test('custom map methods execute only callbacks they actually invoke', () => {
  const before = `export function changed() { return 1 }
export function run(collection) { collection.map(() => changed()) }`
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { run } from '../src/owner'",
    "test('executes', () => run({ map(callback) { callback() } }))",
    "test('ignores', () => run({ map(callback) { return [] } }))",
  ])
  assert.deepEqual(indices(plan), [0])
})

test('Object.values keeps the callback identities of finite own data properties', () => {
  const before = `export function changed() { return 1 }
export function run(record) { for (const callback of Object.values(record)) callback() }`
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { run, changed } from '../src/owner'",
    "test('changed callback', () => run({ ['first']: () => changed() }))",
    "test('other callback', () => run({ first: () => 0 }))",
  ])
  assert.deepEqual(indices(plan), [0])
})

test('Object.values on an unresolved object retains the getter effect frontier', () => {
  const before = `export function changed() { return 1 }
export function run(value) { Object.values(value); return changed() }`
  assert.throws(() => selection(before, before.replace('return 1', 'return 2'), [
    "import { run } from '../src/owner'",
    "test('unknown', () => run(globalThis.unknown))",
  ]), /Unsafe native data operation.*values/)
})

const NATIVE_DATA_ARRAY_SOURCE = `export function changed() { return 1 }
export function frozen(values) { const copy = Object.freeze(values); return copy.map(() => changed()) }
export function enumerated(values) { const box = { values }; Object.values(box); return values.map(() => changed()) }`
function selectNativeDataArrays(body) {
  return selection(NATIVE_DATA_ARRAY_SOURCE, NATIVE_DATA_ARRAY_SOURCE.replace('return 1', 'return 2'), [
    "import { frozen, enumerated, changed } from '../src/owner'", ...body, "test('owner', () => changed())",
  ])
}

test('proven native freeze and enumeration do not escape nested arrays', () => {
  const plan = selectNativeDataArrays([
    "test('frozen empty', () => frozen([]))", "test('frozen value', () => frozen([1]))",
    "test('enumerated empty', () => enumerated([]))", "test('enumerated value', () => enumerated([1]))",
  ])
  assert.deepEqual(indices(plan), [1, 3, 4])
})

test('changed native freeze and enumeration cannot establish read-only effects', () => {
  assert.throws(() => selectNativeDataArrays(["test('changed freeze', () => { Object.freeze = globalThis.unknown; frozen([]) })"]), /Unsafe native data operation.*freeze/)
  assert.throws(() => selectNativeDataArrays(["test('changed values', () => { Object.values = globalThis.unknown; Object.values({}) })"]), /Unsafe native data operation.*values/)
})

test('changed enumeration cannot certify an array passed through it', () => {
  assert.throws(() => selectNativeDataArrays(["test('changed values', () => { Object.values = globalThis.unknown; enumerated([]) })"]), /Unsafe collection callback.*iteration/)
})

test('Object.freeze retains a proven plain record callback', () => {
  const before = `export function changed() { return 1 }
export function run(callback) { Object.freeze({ callback }).callback() }`
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { run, changed } from '../src/owner'",
    "test('changed callback', () => run(() => changed()))",
    "test('other callback', () => run(() => 0))",
  ])
  assert.deepEqual(indices(plan), [0])
})

test('freezing a predicate receiver preserves its later getter effects', () => {
  const before = `export function changed() { return 1 }
export function run(value) { return [value].find(item => Object.freeze(item).value) }`
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { run, changed } from '../src/owner'",
    "test('plain data', () => run({ value: 1 }))",
    "test('actual getter', () => run({ get value() { changed(); return 1 } }))",
    "test('owner', () => changed())",
  ])
  assert.deepEqual(indices(plan), [1, 2])
})

test('freezing an unknown predicate receiver retains its proxy frontier', () => {
  const before = `export function changed() { return 1 }
export function run(value) { return [value].find(item => Object.freeze(item)) }`
  assert.throws(() => selection(before, before.replace('return 1', 'return 2'), [
    "import { run, changed } from '../src/owner'",
    "test('unknown receiver', () => run(globalThis.value))",
    "test('owner', () => changed())",
  ]), /Unsafe (?:collection callback|native data operation)/)
})

test('native descriptor lookup preserves unbound accessors until their actual invocation', () => {
  const before = `export function changed() { return 1 }
export class Owner { get value() { return this.notify() } }
export function run(notify) { const get = Object.getOwnPropertyDescriptor(Owner.prototype, 'value').get; return get.call({ notify }) }`
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { Owner, run, changed } from '../src/owner'",
    "test('actual callback', () => run(() => changed()))",
    "test('other callback', () => run(() => 0))",
    "test('descriptor only', () => Object.getOwnPropertyDescriptor(Owner.prototype, 'value'))",
    "test('owner', () => changed())",
  ])
  assert.deepEqual(indices(plan), [0, 3])
})

test('changed descriptor intrinsics cannot establish an accessor identity', () => {
  const before = `export function changed() { return 1 }
class Owner { get value() { return 1 } }
export function run() { Object.getOwnPropertyDescriptor = globalThis.unknown; Object.getOwnPropertyDescriptor(Owner.prototype, 'value').get.call({}) }`
  assert.throws(() => selection(before, before.replace('return 1', 'return 2'), [
    "import { run, changed } from '../src/owner'",
    "test('changed intrinsic', () => run())",
    "test('owner', () => changed())",
  ]), /Unsafe collection callback/)
})

test('Object.freeze on an unknown receiver retains the proxy effect frontier', () => {
  const before = `export function changed() { return 1 }
export function run(value) { Object.freeze(value); return changed() }`
  assert.throws(() => selection(before, before.replace('return 1', 'return 2'), [
    "import { run } from '../src/owner'",
    "test('unknown', () => run(globalThis.unknown))",
  ]), /Unsafe native data operation.*freeze/)
})

test('mock call logs retain each factory allocation', () => {
  const before = `export function changed() { return 1 }`
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { vi } from 'vitest'; import { changed } from '../src/owner'",
    "function make() { return vi.fn() }",
    "test('first allocation', () => { const first = make(), second = make(); first(() => changed()); second(() => 0); first.mock.calls[0][0]() })",
    "test('second allocation', () => { const first = make(), second = make(); first(() => changed()); second(() => 0); second.mock.calls[0][0]() })",
    "test('implementation calls argument', () => { const fn = vi.fn(callback => callback()); fn(() => changed()) })",
  ])
  assert.deepEqual(indices(plan), [0, 2])
})

test('mock call log index preserves the argument from the selected call', () => {
  const before = `export function changed() { return 1 }`
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { vi } from 'vitest'; import { changed } from '../src/owner'",
    "test('first call', () => { const fn = vi.fn(); fn(() => changed()); fn(() => 0); fn.mock.calls[0][0]() })",
    "test('second call', () => { const fn = vi.fn(); fn(() => changed()); fn(() => 0); fn.mock.calls[1][0]() })",
  ])
  assert.deepEqual(indices(plan), [0])
})

test('static methods retain the class receiver when forwarding a filtered callback', () => {
  const before = `export function changed() { return 1 }
class Pipeline { static pass(entries) { return this.forward(entries) } static forward(entries) { return entries } }
export function run(entries) { for (const entry of Pipeline.pass([...Pipeline.forward(entries)]).filter(item => item.enabled)) entry.invoke() }`
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { run, changed } from '../src/owner'",
    "test('actual callback', () => run([{ enabled: true, invoke: () => changed() }]))",
    "test('other callback', () => run([{ enabled: true, invoke: () => 0 }]))",
  ])
  assert.deepEqual(indices(plan), [0])
})

test('local mock identity excludes the typed original while invoked callbacks retain effects', () => {
  const before = `export function changed() { return 1 }
export class Actor { run() { return changed() } }
export function execute(actor: Actor) { return actor.run() }`
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { vi } from 'vitest'",
    "import { Actor, execute, changed } from '../src/owner'",
    "test('empty replacement', () => execute({ run: vi.fn() } as unknown as Actor))",
    "test('effectful replacement', () => execute({ run: vi.fn(() => changed()) } as unknown as Actor))",
    "test('captured original', () => Actor.prototype.run.call({}))",
    "test('real actor', () => execute(new Actor()))",
    "test('configured before call', () => { const fn = vi.fn(); fn.mockImplementation(() => changed()); execute({ run: fn } as unknown as Actor) })",
    "test('configured after call', () => { const fn = vi.fn(); execute({ run: fn } as unknown as Actor); fn.mockImplementation(() => changed()) })",
  ])
  assert.deepEqual(indices(plan), [1, 2, 3, 4])
})

test('an invoked mock with an unknown configured implementation fails closed', () => {
  const before = `export function changed() { return 1 }
export class Actor { run() { return changed() } }
export function execute(actor: Actor) { return actor.run() }`
  assert.throws(() => selection(before, before.replace('return 1', 'return 2'), [
    "import { vi } from 'vitest'",
    "import { Actor, execute, changed } from '../src/owner'",
    "test('unknown implementation', () => { const fn = vi.fn(); fn.mockImplementation(globalThis.external); execute({ run: fn } as unknown as Actor) })",
    "test('direct owner', () => changed())",
  ]), /Unsafe mock boundary.*implementation identity/)
})

test('local mock return values retain only callbacks actually invoked', () => {
  const before = 'export function changed() { return 1 }'
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { vi } from 'vitest'",
    "import { changed } from '../src/owner'",
    "test('returned callback invoked', () => { const fn = vi.fn(); fn.mockReturnValue(() => changed()); return fn()() })",
    "test('returned callback stays dormant', () => { const fn = vi.fn(); fn.mockReturnValue(() => changed()); return fn() })",
    "test('direct owner', () => changed())",
  ])
  assert.deepEqual(indices(plan), [0, 2])
})

test('after-each restore does not precede the current local mock call', () => {
  const before = `export function changed() { return 1 }
export class Actor { run() { return changed() } }
export function execute(actor: Actor) { return actor.run() }`
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { vi, afterEach } from 'vitest'",
    "import { Actor, execute, changed } from '../src/owner'",
    "afterEach(() => vi.restoreAllMocks())",
    "test('empty replacement', () => execute({ run: vi.fn() } as unknown as Actor))",
    "test('direct owner', () => changed())",
  ])
  assert.deepEqual(indices(plan), [1])
})

test('global mock reset before an invocation retains lifetime uncertainty', () => {
  const before = `export function changed() { return 1 }
export class Actor { run() { return changed() } }
export function execute(actor: Actor) { return actor.run() }`
  assert.throws(() => selection(before, before.replace('return 1', 'return 2'), [
    "import { vi } from 'vitest'",
    "import { Actor, execute, changed } from '../src/owner'",
    "test('reset before', () => { const fn = vi.fn(() => changed()); vi.resetAllMocks(); execute({ run: fn } as unknown as Actor) })",
    "test('direct owner', () => changed())",
  ]), /Unsafe mock boundary.*reset or restore lifetime/)
})

test('an externally exposed class retains an unknown static dispatch frontier', () => {
  const before = `export function changed() { return 1 }
class Pipeline { static pass(entries) { return entries } }
export function run(entries) { globalThis.mutate(Pipeline); return Pipeline.pass(entries).filter(entry => entry.enabled) }`
  assert.throws(() => selection(before, before.replace('return 1', 'return 2'), [
    "import { run, changed } from '../src/owner'",
    "test('class escapes', () => run([{ enabled: true }]))",
    "test('direct owner', () => changed())",
  ]), /Unsafe native data operation.*class/)
})

test('a replacement callback cannot assume a modified JSON intrinsic is pure', () => {
  const before = 'export function changed() { return 1 }'
  assert.throws(() => selection(before, before.replace('return 1', 'return 2'), [
    "import { vi } from 'vitest'",
    "import { changed } from '../src/owner'",
    "import { run } from '../src/other'",
    "vi.mock('../src/other', () => ({ run: vi.fn() }))",
    "test('mutated intrinsic', () => { JSON.stringify = () => { changed(); return '' }; vi.mocked(run).mockImplementation(() => JSON.stringify({ value: 1 })); run() })",
    "test('direct owner', () => changed())",
  ], [['src/other.ts', 'export function run() { return 0 }']]), /Unsafe mock boundary.*identity/)
})

test('an uncalled helper assignment does not contaminate an invoked mock callback', () => {
  const before = 'export function changed() { return 1 }'
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { vi } from 'vitest'",
    "import { changed } from '../src/owner'",
    "import { run } from '../src/other'; import { read } from '../src/helper'",
    "vi.mock('../src/other', () => ({ run: vi.fn() }))",
    "test('read', () => { vi.mocked(run).mockImplementation(() => read()); run() })",
    "test('owner', () => changed())",
  ], [
    ['src/other.ts', 'export function run() { return 0 }'],
    ['src/helper.ts', 'let state = { value: 1 }; export function read() { return state.value }; export function unused() { state = { get value() { return globalThis.unknown() } } }'],
  ])
  assert.deepEqual(indices(plan), [1])
})

test('a reached helper assignment keeps its unknown getter effect', () => {
  const before = 'export function changed() { return 1 }'
  assert.throws(() => selection(before, before.replace('return 1', 'return 2'), [
    "import { vi } from 'vitest'",
    "import { changed } from '../src/owner'",
    "import { run } from '../src/other'; import { read, update } from '../src/helper'",
    "vi.mock('../src/other', () => ({ run: vi.fn() }))",
    "test('read', () => { update(); vi.mocked(run).mockImplementation(() => read()); run() })",
    "test('owner', () => changed())",
  ], [
    ['src/other.ts', 'export function run() { return 0 }'],
    ['src/helper.ts', 'let state = { value: 1 }; export function read() { return state.value }; export function update() { state = { get value() { return globalThis.unknown() } } }'],
  ]), /Unsafe mock boundary/)
})

const NESTED_WRITE_ORDER_SOURCE = `export function changed() { return 1 }
function compare(items) { [...items].sort((a, b) => a.value - b.value) }
export function once() { const item = { value: 1 }; compare([item, item]); item.value = { valueOf() { changed(); return 1 } } }
export function dormant() { const item = { value: 1 }; const unused = () => { item.value = { valueOf() { changed(); return 1 } } }; compare([item, item]) }
export function earlier() { const item = { value: 1 }; item.value = { valueOf() { changed(); return 1 } }; compare([item, item]) }
export function repeat() { const item = { value: 1 }; for (const i of [1, 2]) { compare([item, item]); item.value = { valueOf() { changed(); return 1 } } } }
export function viaCallback() { const item = { value: 1 }; [1, 2].forEach(() => { compare([item, item]); item.value = { valueOf() { changed(); return 1 } } }) }
export function later() { const item = { value: 1 }; asyncCompare([item, item]); item.value = { valueOf() { changed(); return 1 } } }
async function asyncCompare(items) { await 0; [...items].sort((a, b) => a.value - b.value) }`

test('synchronous nested comparisons exclude later and dormant writes', () => {
  const before = NESTED_WRITE_ORDER_SOURCE
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { once, dormant, changed } from '../src/owner'",
    "test('later write', () => once())", "test('unused callback', () => dormant())", "test('owner', () => changed())",
  ])
  assert.deepEqual(indices(plan), [2])
})

function assertNestedWritePreserved(method) {
  const before = NESTED_WRITE_ORDER_SOURCE
  let plan
  try {
    plan = selection(before, before.replace('return 1', 'return 2'), [
      "import { earlier, repeat, viaCallback, later, changed } from '../src/owner'", `test('subject', () => ${method}())`, "test('owner', () => changed())",
    ])
  } catch (error) {
    assert.match(error.message, /Unsafe collection callback: Binary operation may invoke user coercion/)
    return
  }
  assert.ok(indices(plan).includes(0))
}

test('an earlier caller write remains visible to a nested comparator', () => assertNestedWritePreserved('earlier'))
test('a preceding loop iteration can affect a nested comparator', () => assertNestedWritePreserved('repeat'))
test('repeated callback invocations can affect a later nested comparison', () => assertNestedWritePreserved('viaCallback'))
test('an asynchronous caller can write before a nested comparator runs', () => assertNestedWritePreserved('later'))

const COMPOUND_CAPTURE_SOURCE = `export function changed() { return 1 }
function point(side) { return { x: side } }
export function safe() { for (const i of [1, 2]) { let side; side = 1; side += 2; side = -side; let p = point(side); const candidates = [{ x: 1 }, { x: 2 }]; candidates.sort((a, b) => a.x - p.x); p = candidates[0] } }
export function unsafe() { for (const i of [1, 2]) { let side = { valueOf() { changed(); return 1 } }; side += 2; let p = point(side); const candidates = [{ x: 1 }, { x: 2 }]; candidates.sort((a, b) => a.x - p.x); p = candidates[0] } }
export function reassigned() { let side = 1; side = { valueOf() { changed(); return 1 } }; side += 2; [1, 2].sort(() => Boolean(side)) }
export function getter() { let side = 1; side += ({ get value() { changed(); return 1 } }).value; [1, 2].sort(() => Boolean(side)) }`
function selectCompoundCapture(method) {
  return selection(COMPOUND_CAPTURE_SOURCE, COMPOUND_CAPTURE_SOURCE.replace('return 1', 'return 2'), [
    `import { ${method}, changed } from '../src/owner'`, `test('subject', () => ${method}())`, "test('owner', () => changed())",
  ])
}

test('captured primitive compound updates retain actual getter effects', () => {
  assert.deepEqual(indices(selectCompoundCapture('safe')), [1])
  assert.deepEqual(indices(selectCompoundCapture('getter')), [0, 1])
})

test('captured compound updates retain user coercion frontiers', () => {
  assert.throws(() => selectCompoundCapture('unsafe'), /Unsafe collection callback.*coercion/)
  assert.throws(() => selectCompoundCapture('reassigned'), /Unsafe collection callback.*coercion/)
})

const FIND_RECURSIVE_SOURCE = `export function changed() { return 1 }
let cache = { value: 0 }
function names() { return cache.value ? ['one'] : ['two'] }
function point(gate) { return { x: gate.x } }
export function safe() { const gate = [{ id: 'one', x: 1 }, { id: 'two', x: 2 }].find(g => names().includes(g.id)); const p = point(gate); const values = [{ x: gate.x }, { x: gate.x + 1 }]; values.sort((a, b) => a.x - p.x); cache = { value: p.x } }
export function callback() { const gate = [{ id: 'one', x: 1 }, { id: 'two', x: 2 }].find(g => { changed(); return names().includes(g.id) }); const p = point(gate); const values = [{ x: gate.x }, { x: gate.x + 1 }]; values.sort((a, b) => a.x - p.x); cache = { value: p.x } }
export function getter() { const gate = [{ id: 'one', get x() { changed(); return 1 } }, { id: 'two', x: 2 }].find(g => names().includes(g.id)); const p = point(gate); const values = [{ x: gate.x }, { x: gate.x + 1 }]; values.sort((a, b) => a.x - p.x); cache = { value: p.x } }
export function prior() { let earlier; for (const value of [{ valueOf() { changed(); return 1 } }, 1]) { const gate = [{ x: value }].find(() => { if (earlier) Number(earlier.x); return true }); const p = point(gate); const values = [{ x: gate.x }, { x: gate.x + 1 }]; values.sort((a, b) => a.x - p.x); earlier = gate } }
export function unsafe() { const gate = [{ id: 'one', x: { valueOf() { changed(); return 1 } } }, { id: 'two', x: 2 }].find(g => names().includes(g.id)); const p = point(gate); const values = [{ x: gate.x }, { x: gate.x + 1 }]; values.sort((a, b) => a.x - p.x); cache = { value: p.x } }
export function mutated() { const gates = [{ id: 'one', x: 1 }, { id: 'two', x: 2 }]; const gate = gates.find((g, i) => { gates[1] = { id: 'two', x: { valueOf() { changed(); return 1 } } }; return i === 1 && names().includes(g.id) }); const p = point(gate); const values = [{ x: gate.x }, { x: gate.x + 1 }]; values.sort((a, b) => a.x - p.x); cache = { value: p.x } }`
function selectRecursiveFind(method) {
  return selection(FIND_RECURSIVE_SOURCE, FIND_RECURSIVE_SOURCE.replace('return 1', 'return 2'), [
    `import { ${method}, changed } from '../src/owner'`, `test('subject', () => ${method}())`, "test('owner', () => changed())",
  ])
}

test('completed calls reused as later arguments do not become recursive callback effects', () => {
  const before = `export function changed() { return 1 }
const definitions = [{ id: 'one' }, { id: 'two' }]
function lookup(id) { return definitions.find(item => item.id === id) }
function build(id) { return lookup(id) }
export function run(id) { const definition = lookup(id); return build(definition.id) }`
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { run, changed } from '../src/owner'",
    "test('completed call', () => run('one'))",
    "test('getter argument', () => run(({ get id() { changed(); return 'one' } }).id))",
    "test('owner', () => changed())",
  ])
  assert.deepEqual(indices(plan), [1, 2])
})

test('an actually reentered predicate retains its recursive effect frontier', () => {
  const before = `export function changed() { return 1 }
const definitions = [{ id: 'one' }]
export function run(id) { return definitions.find(item => { if (id) run(item.id); return globalThis.unknown() }) }`
  assert.throws(() => selection(before, before.replace('return 1', 'return 2'), [
    "import { run, changed } from '../src/owner'",
    "test('recursive call', () => run('one'))",
    "test('owner', () => changed())",
  ]), /Unsafe collection callback.*(?:Recursive|getter or proxy)/)
})

test('native find retains its element domain across recursive queries', () => {
  assert.deepEqual(indices(selectRecursiveFind('safe')), [1])
})

test('native find retains invoked callback effects across recursive queries', () => {
  assert.deepEqual(indices(selectRecursiveFind('callback')), [0, 1])
})

test('native find cannot hide coercion while resolving recursive values', () => {
  assert.throws(() => selectRecursiveFind('unsafe'), /Unsafe collection callback.*coercion/)
})

test('native find leaves receiver mutations unresolved during recursive queries', () => {
  assert.throws(() => selectRecursiveFind('mutated'), /Unsafe collection callback.*coercion/)
})

test('native find retains actual getter effects in recursive values', () => {
  assert.deepEqual(indices(selectRecursiveFind('getter')), [0, 1])
})

test('native find preserves returned element allocation for later array mutation', () => {
  const before = `export function changed() { return 1 }
export function run(callback) { const plans = [{ id: 1, actions: [] }, { id: 2, actions: [] }]; plans.find(plan => plan.id === 1).actions.push(callback); plans[0].actions.forEach(action => action()) }`
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { run, changed } from '../src/owner'",
    "test('changed callback', () => run(() => changed()))",
    "test('other callback', () => run(() => 0))",
    "test('owner', () => changed())",
  ])
  assert.deepEqual(indices(plan), [0, 2])
})

test('native find retains an unknown getter in its actual predicate', () => {
  const before = `export function changed() { return 1 }
export function run() { const plans = [{ get id() { return globalThis.unknown() }, actions: [] }]; plans.find(plan => plan.id === 1).actions.push(changed) }`
  assert.throws(() => selection(before, before.replace('return 1', 'return 2'), [
    "import { run, changed } from '../src/owner'",
    "test('unknown getter', () => run())",
    "test('owner', () => changed())",
  ]), /Unsafe collection callback/)
})

test('native find does not assume a mutated array method is still native', () => {
  const before = `export function changed() { return 1 }
export function run() { const plans = [{ id: 1, actions: [] }]; plans.find(plan => plan.id === 1).actions.push(changed) }`
  assert.throws(() => selection(before, before.replace('return 1', 'return 2'), [
    "import { run, changed } from '../src/owner'",
    "test('changed method', () => { Array.prototype.find = globalThis.unknown; run() })",
    "test('owner', () => changed())",
  ]), /Unsafe collection callback/)
})

test('native find cannot assume a later iteration has the previous value', () => {
  assert.throws(() => selectRecursiveFind('prior'), error => {
    assert.match(error.message, /Unsafe collection callback.*getter or proxy/)
    assert.equal(error.diagnostics.unresolved.frontier.evidence.receiver, 'unknown')
    return true
  })
})

test('synchronous comparators exclude future writes without losing prior loop iterations', () => {
  const before = `export function changed() { return 1 }
export function once() { let point = { x: 0 }; [1, 2].sort((a, b) => a - point.x); point = { get x() { changed(); return 0 } } }
export function repeat() { let point = { x: 0 }; for (let i = 0; i < 2; i++) { [1, 2].sort((a, b) => a - point.x); point = { get x() { changed(); return 0 } } } }
export function delayed() { let point = { x: 0 }; [1, 2].sort(async (a, b) => { await 0; return a - point.x }); point = { get x() { changed(); return 0 } } }`
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { once, repeat, delayed, changed } from '../src/owner'",
    "test('later allocation stays dormant', () => once())",
    "test('prior iteration remains possible', () => repeat())",
    "test('suspended comparators keep subsequent writes', () => delayed())",
    "test('owner', () => changed())",
  ])
  assert.deepEqual(indices(plan), [1, 2, 3])
})

test('captured destructured loop rows retain native array effect provenance', () => {
  const before = 'export function changed() { return 1 }'
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { vi } from 'vitest'; import { changed } from '../src/owner'",
    "test('known rows', () => { for (const [kind, entries] of [['row', [1, 2]]]) { const read = vi.fn(() => entries.filter(item => item > 0).length); read() } })",
    "test('owner', () => changed())",
  ])
  assert.deepEqual(indices(plan), [1])
  assert.throws(() => selection(before, before.replace('return 1', 'return 2'), [
    "import { vi } from 'vitest'; import { changed } from '../src/owner'",
    "test('unknown rows', () => { for (const [kind, entries] of globalThis.rows) { const read = vi.fn(() => entries.filter(item => item > 0).length); read() } })",
    "test('owner', () => changed())",
  ]), /Unsafe mock boundary/)
})

test('numeric induction captures indices with a dynamic bound in invoked mock callbacks', () => {
  const before = 'export function changed() { return 1 }'
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { vi } from 'vitest'; import { changed } from '../src/owner'",
    "test('numeric index', () => { const count = Math.ceil(2); for (let i = 0; i < count; i++) { const fn = vi.fn(() => Number(i)); fn() } })",
    "test('owner', () => changed())",
  ])
  assert.deepEqual(indices(plan), [1])
  assert.throws(() => selection(before, before.replace('return 1', 'return 2'), [
    "import { vi } from 'vitest'; import { changed } from '../src/owner'",
    "test('changed index', () => { for (let i = 0; i < 2; i++) { i = globalThis.unknown; const fn = vi.fn(() => Number(i)); fn() } })",
    "test('owner', () => changed())",
  ]), /Unsafe mock boundary/)
})

test('a replacement callback cannot assume a modified library prototype is pure', () => {
  const before = 'export function changed() { return 1 }'
  assert.throws(() => selection(before, before.replace('return 1', 'return 2'), [
    "import { vi } from 'vitest'; import { Vector3 } from 'three'",
    "import { changed } from '../src/owner'; import { run } from '../src/other'",
    "vi.mock('../src/other', () => ({ run: vi.fn() }))",
    "test('modified prototype', () => { Object.defineProperty(Vector3.prototype, 'x', { get() { changed(); return 0 } }); vi.mocked(run).mockImplementation(() => new Vector3().x); run() })",
    "test('owner', () => changed())",
  ], [['src/other.ts', 'export function run() { return 0 }']]), /Unsafe mock boundary|Unsafe native data operation/)
})

test('a library instance escaping to an unknown operation retains its effect frontier', () => {
  const before = 'export function changed() { return 1 }'
  assert.throws(() => selection(before, before.replace('return 1', 'return 2'), [
    "import { vi } from 'vitest'; import { Vector3 } from 'three'",
    "import { changed } from '../src/owner'; import { run } from '../src/other'",
    "vi.mock('../src/other', () => ({ run: vi.fn() }))",
    "test('escaped vector', () => { const v = new Vector3(); globalThis.unknown(v); vi.mocked(run).mockImplementation(() => v.length()); run() })",
    "test('owner', () => changed())",
  ], [['src/other.ts', 'export function run() { return 0 }']]), /Unsafe mock boundary|Unsafe native data operation/)
})

test('an unmodified library data operation retains its own effect boundary', () => {
  const before = 'export function changed() { return 1 }'
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { vi } from 'vitest'; import { Vector3 } from 'three'",
    "import { changed } from '../src/owner'; import { run } from '../src/other'",
    "vi.mock('../src/other', () => ({ run: vi.fn() }))",
    "test('vector data', () => { vi.mocked(run).mockImplementation(() => new Vector3(1, 2, 3).length()); run() })",
    "test('owner', () => changed())",
  ], [['src/other.ts', 'export function run() { return 0 }']])
  assert.deepEqual(indices(plan), [1])
})

test('a replacement callback cannot ignore inherited object coercion', () => {
  const before = 'export function changed() { return 1 }'
  assert.throws(() => selection(before, before.replace('return 1', 'return 2'), [
    "import { vi } from 'vitest'",
    "import { changed } from '../src/owner'",
    "import { run } from '../src/other'",
    "vi.mock('../src/other', () => ({ run: vi.fn() }))",
    "test('inherited coercion', () => { Object.prototype.valueOf = () => { changed(); return 1 }; vi.mocked(run).mockImplementation(() => Number({})); run() })",
    "test('direct owner', () => changed())",
  ], [['src/other.ts', 'export function run() { return 0 }']]), /Unsafe mock boundary/)
})

test('a replacement callback cannot ignore inherited array coercion', () => {
  const before = 'export function changed() { return 1 }'
  assert.throws(() => selection(before, before.replace('return 1', 'return 2'), [
    "import { vi } from 'vitest'",
    "import { changed } from '../src/owner'",
    "import { run } from '../src/other'",
    "vi.mock('../src/other', () => ({ run: vi.fn() }))",
    "test('inherited coercion', () => { Array.prototype.toString = () => { changed(); return '1' }; vi.mocked(run).mockImplementation(() => Number([1])); run() })",
    "test('direct owner', () => changed())",
  ], [['src/other.ts', 'export function run() { return 0 }']]), /Unsafe mock boundary/)
})

test('serialization retains an unknown frontier for inherited toJSON mutations', () => {
  const before = 'export function changed() { return 1 }'
  assert.throws(() => selection(before, before.replace('return 1', 'return 2'), [
    "import { vi } from 'vitest'",
    "import { changed } from '../src/owner'",
    "import { run } from '../src/other'",
    "vi.mock('../src/other', () => ({ run: vi.fn() }))",
    "test('inherited hook', () => { Object.prototype.toJSON = () => { changed(); return {} }; vi.mocked(run).mockImplementation(() => JSON.stringify({ value: 1 })); run() })",
    "test('direct owner', () => changed())",
  ], [['src/other.ts', 'export function run() { return 0 }']]), /Unsafe mock boundary.*Object prototype identity/)
})

test('serializing proven local data preserves the actual array callback selection', () => {
  const before = `export function changed() { return 1 }
export function run(callback) { const entries = []; entries.push(1); JSON.stringify([{ entries }]); entries.map(callback) }`
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { run, changed } from '../src/owner'",
    "test('changed callback', () => run(() => changed()))",
    "test('other callback', () => run(() => 0))",
    "test('owner', () => changed())",
  ])
  assert.deepEqual(indices(plan), [0, 2])
})

test('serializing a record exposed to an unknown mutator retains its getter frontier', () => {
  const before = `export function changed() { return 1 }
export function run() { const data = { value: 1 }; globalThis.mutate(data); JSON.stringify(data) }`
  assert.throws(() => selection(before, before.replace('return 1', 'return 2'), [
    "import { run, changed } from '../src/owner'",
    "test('escaped data', () => run())",
    "test('owner', () => changed())",
  ]), /Unsafe native data operation.*escaped/)
})

for (const hook of ['getter', 'toJSON']) test(`serialization retains the effects of an actual ${hook}`, () => {
  const property = hook === 'getter' ? 'get value() { changed(); return 1 }' : 'toJSON() { changed(); return 1 }'
  const before = `export function changed() { return 1 }
export function run() { JSON.stringify({ ${property} }) }`
  assert.throws(() => selection(before, before.replace('return 1', 'return 2'), [
    "import { run, changed } from '../src/owner'",
    "test('serialization hook', () => run())",
    "test('owner', () => changed())",
  ]), /Unsafe native data operation.*(?:getter|toJSON)/)
})

test('serialization does not assume an unknown replacer is pure', () => {
  const before = `export function changed() { return 1 }
export function run(replacer) { JSON.stringify({ value: 1 }, replacer) }`
  assert.throws(() => selection(before, before.replace('return 1', 'return 2'), [
    "import { run, changed } from '../src/owner'",
    "test('unknown replacer', () => run(globalThis.replace))",
    "test('owner', () => changed())",
  ]), /Unsafe native data operation/)
})

test('an undefined serialization result retains the fallback callback effects', () => {
  const before = 'export function changed() { return 1 }'
  assert.throws(() => selection(before, before.replace('return 1', 'return 2'), [
    "import { vi } from 'vitest'; import { changed } from '../src/owner'; import { run } from '../src/other'",
    "vi.mock('../src/other', () => ({ run: vi.fn() }))",
    "test('undefined result', () => { vi.mocked(run).mockImplementation(() => JSON.stringify(undefined) ?? globalThis.unknown()); run() })",
    "test('owner', () => changed())",
  ], [['src/other.ts', 'export function run() {}']]), /Unsafe mock boundary.*getter or proxy/)
})

test('a definite serialization string does not execute a nullish fallback', () => {
  const before = 'export function changed() { return 1 }'
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { vi } from 'vitest'; import { changed } from '../src/owner'; import { run } from '../src/other'",
    "vi.mock('../src/other', () => ({ run: vi.fn() }))",
    "test('string result', () => { vi.mocked(run).mockImplementation(() => JSON.stringify(1) ?? globalThis.unknown()); run() })",
    "test('owner', () => changed())",
  ], [['src/other.ts', 'export function run() {}']])
  assert.deepEqual(indices(plan), [1])
})

test('serialization retains effects from a modified library prototype', () => {
  const before = 'export function changed() { return 1 }'
  assert.throws(() => selection(before, before.replace('return 1', 'return 2'), [
    "import { Vector3 } from 'three'; import { changed } from '../src/owner'",
    "test('modified prototype', () => { Vector3.prototype.toJSON = () => { changed(); return 1 }; JSON.stringify(new Vector3(1, 2, 3)) })",
    "test('owner', () => changed())",
  ]), /Unsafe native data operation.*prototype/)
})

test('replacing an array iteration method retains an unknown-effect frontier', () => {
  const before = `export function changed() { return 1 }
export function run(entries) { entries.filter(entry => entry.enabled) }`
  assert.throws(() => selection(before, before.replace('return 1', 'return 2'), [
    "import { run, changed } from '../src/owner'",
    "test('changed protocol', () => { Array.prototype.filter = function () { changed(); return [] }; run([{ enabled: true }]) })",
  ]), /Unsafe collection callback/)
})

test('the native Boolean predicate preserves filtered callback identity', () => {
  const before = `export function changed() { return 1 }
export function run(callback) { const entries = [callback]; return entries.filter(Boolean)[0]() }`
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { run, changed } from '../src/owner'",
    "test('actual callback', () => run(() => changed()))",
    "test('other callback', () => run(() => 0))",
  ])
  assert.deepEqual(indices(plan), [0])
})

test('a changed Boolean predicate keeps its effects unresolved', () => {
  const before = `export function changed() { return 1 }
export function run(entries) { entries.filter(Boolean) }`
  assert.throws(() => selection(before, before.replace('return 1', 'return 2'), [
    "import { run, changed } from '../src/owner'",
    "test('changed Boolean', () => { Boolean = () => { changed(); return true }; run([1]) })",
    "test('direct owner', () => changed())",
  ]), /Unsafe collection callback/)
})

test('an unknown array predicate keeps its possible effects unresolved', () => {
  const before = `export function changed() { return 1 }
export function run(entries, predicate) { entries.filter(predicate) }`
  assert.throws(() => selection(before, before.replace('return 1', 'return 2'), [
    "import { run, changed } from '../src/owner'",
    "test('unknown predicate', () => run([{ enabled: true }], globalThis.predicate))",
    "test('direct owner', () => changed())",
  ]), /Unsafe collection callback.*callback effects are unresolved/)
})

test('same-name source methods remain distinct from native array iteration', () => {
  const before = `export function changed() { return 1 }
export function run(value) { value.filter() }`
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { run, changed } from '../src/owner'",
    "test('source method', () => run({ filter() { changed() } }))",
    "test('different source method', () => run({ filter() {} }))",
  ])
  assert.deepEqual(indices(plan), [0])
})

test('reflective mutation prevents an absent-field proof for collection callbacks', () => {
  const before = `export function changed() { return 1 }
export function run(entry) { Object.setPrototypeOf(entry, externalPrototype); for (const item of [entry]) item.callbacks?.push(() => changed()) }`
  assert.throws(() => selection(before, before.replace('return 1', 'return 2'), [
    "import { run, changed } from '../src/owner'",
    "test('unresolved inherited collection', () => run({ id: 1 }))",
    "test('actual owner', () => changed())",
  ]), /Unsafe collection callback/)
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
  ], [
    ['src/data.ts', "export const DATA = { value: 1 }; export function label(actor) { const kind = typeof actor === 'string' ? actor : actor.kind; return `${kind}` }"],
    ['tests/configured.test.ts', "import { vi } from 'vitest'; import { run } from '../src/owner'; import { DATA, label } from '../src/data'\nvi.mock('../src/owner', () => ({ run: vi.fn() }))\ntest('configured', () => { vi.mocked(run).mockImplementation(() => { false && globalThis.original(); true || globalThis.original(); 1 ?? globalThis.original(); undefined?.[globalThis.original()]; if (Math.random() > 0.5) DATA.value; return label(Math.random() > 0.5 ? 'text' : { kind: 'record' }) + DATA.value }); run() })"],
  ])
  assert.deepEqual(indices(plan),[0])
  assert.equal(plan.selectedCases['tests/configured.test.ts'],undefined)
})

for (const [name, callback, tail] of [
  ['opaque inline delegate', '() => globalThis.original()', ''],
  ['unbound global value accessor', '() => { dangerous; return 0 }', ''],
  ['unknown returned receiver', 'value => value.hidden', ''],
  ['optional condition preserves later effects', '() => { const value = undefined; if (value?.field) return 0; return globalThis.original() }', ''],
  ['implicit helper return preserves later effects', '() => { function missing() {} if (missing()) return 0; return globalThis.original() }', ''],
  ['global reset lifetime', '() => 0', 'vi.resetAllMocks()'],
]) test(`finite mock callback union remains blocked: ${name}`, () => {
  const before = 'export function run() { return 1 }'
  assert.throws(() => selection(before,before.replace('return 1','return 2'),[
    "import { run } from '../src/owner'", "test('real', () => run())",
  ], [['tests/configured.test.ts', `import { vi } from 'vitest'; import { run } from '../src/owner'\nvi.mock('../src/owner', () => ({ run: vi.fn() }))\ntest('configured', () => { vi.mocked(run).mockImplementation(${callback}); ${tail}; ${name === 'unknown returned receiver' ? 'run(globalThis.receiver)' : 'run()'} })`]]), /Unsafe mock boundary/)
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

test('mock return records and recorded callback arguments retain only actual invocation effects', () => {
  const { selectBehaviors } = require('../tooling/behavior.cjs')
  const file = 'tests/mock-values.test.ts'
  const sources = new Map([
    ['src/owner.ts', "export async function create(callback) { require('node:fs').readFileSync('original.json'); return { start() {} } }"],
    ['src/caller.ts', "import { create } from './owner'; export async function run(callback) { const value = await create(callback); value.start() }"],
    ['tests/real-values.test.ts', "import { create } from '../src/owner'; test('real', () => create(() => {}))"],
    [file, [
      "import { vi, expect, test, afterEach } from 'vitest'; import fs from 'node:fs'; import { create } from '../src/owner'; import { run } from '../src/caller'",
      "vi.mock('../src/owner', () => ({ create: vi.fn() })); afterEach(() => vi.clearAllMocks())",
      "test('invoke', async () => { const start = vi.fn(() => fs.readFileSync('returned.json', 'utf8')); vi.mocked(create).mockImplementation(() => globalThis.original()); vi.mocked(create).mockResolvedValue({ start }); await run(() => fs.readFileSync('argument.json', 'utf8')); expect(create).toHaveBeenCalled(); vi.mocked(create).mock.calls[0][0]() })",
      "test('allocate', () => { vi.fn(() => fs.readFileSync('returned.json', 'utf8')) })",
    ].join('\n')],
  ])
  const inventory = [{ file, names: ['invoke', 'allocate'], locations: [3, 4].map(line => ({ line, column: 1 })) }, { file: 'tests/real-values.test.ts', names: ['real'], locations: [{ line: 1, column: 1 }] }]
  const files = new Set([...sources.keys(), 'original.json', 'returned.json', 'argument.json', 'returned.json'])
  const consumers = dependencyConsumers(inventory, sources, path => files.has(path), { files })
  const select = changed => selectBehaviors(inventory, [{ status: 'M', file: changed }], consumers, {
    sources, previousSources: sources, previousConsumers: consumers, ranges: {}, compilerOptions: { noLib: true, noResolve: true, types: [] },
  })
  assert.deepEqual(select('returned.json').selectedCases[file], [0])
  assert.deepEqual(select('argument.json').selectedCases[file], [0])
  assert.deepEqual(select('original.json').selected, ['tests/real-values.test.ts'])
})

test('factory wrappers keep callback allocations on their actual receiver', () => {
  const { selectBehaviors } = require('../tooling/behavior.cjs')
  const file = 'tests/receivers.test.ts'
  const sources = new Map([
    ['src/ports.ts', 'export function make(run) { return { run() { return run() } } }; export function wrap(run) { return make(run) }'],
    [file, [
      "import fs from 'node:fs'; import { wrap } from '../src/ports'",
      "const first = wrap(() => fs.readFileSync('first.json', 'utf8')), second = wrap(() => fs.readFileSync('second.json', 'utf8'))",
      "test('first receiver', () => first.run())",
      "test('second receiver', () => second.run())",
    ].join('\n')],
  ])
  const inventory = [{ file, names: ['first receiver', 'second receiver'], locations: [3, 4].map(line => ({ line, column: 1 })) }]
  const files = new Set([...sources.keys(), 'first.json', 'second.json'])
  const consumers = dependencyConsumers(inventory, sources, path => files.has(path), { files })
  const select = changed => selectBehaviors(inventory, [{ status: 'M', file: changed }], consumers, {
    sources, previousSources: sources, previousConsumers: consumers, ranges: {}, compilerOptions: { noLib: true, noResolve: true, types: [] },
  })
  assert.deepEqual(select('first.json').selectedCases[file], [0])
  assert.deepEqual(select('second.json').selectedCases[file], [1])
})

test('constructor callback fields retain their instance through a returned wrapper', () => {
  const { selectBehaviors } = require('../tooling/behavior.cjs')
  const file = 'tests/instances.test.ts'
  const sources = new Map([
    ['src/ports.ts', 'export class Port { ready = false; constructor(private operation: () => unknown) { this.ready = true } run() { return this.operation() } }; export function wrap(operation) { return new Port(operation) }'],
    [file, [
      "import fs from 'node:fs'; import { wrap } from '../src/ports'",
      "const first = wrap(() => fs.readFileSync('first.json', 'utf8')), second = wrap(() => fs.readFileSync('second.json', 'utf8'))",
      "test('first instance', () => first.run())",
      "test('second instance', () => second.run())",
    ].join('\n')],
  ])
  const inventory = [{ file, names: ['first instance', 'second instance'], locations: [3, 4].map(line => ({ line, column: 1 })) }]
  const files = new Set([...sources.keys(), 'first.json', 'second.json'])
  const consumers = dependencyConsumers(inventory, sources, path => files.has(path), { files })
  const select = changed => selectBehaviors(inventory, (Array.isArray(changed) ? changed : [changed]).map(file => ({ status: 'M', file })), consumers, {
    sources, previousSources: sources, previousConsumers: consumers, ranges: {}, compilerOptions: { noLib: true, noResolve: true, types: [] },
  })
  assert.deepEqual(select('first.json').selectedCases[file], [0])
  assert.deepEqual(select('second.json').selectedCases[file], [1])
  const together = select(['first.json', 'second.json'])
  assert.deepEqual(together.selectedCases[file], [0, 1])
  assert.deepEqual(together.details[file].map(detail => [detail.changed, [...new Set(detail.caseEvidence.map(item => item.index))]]), [
    ['first.json', [0]], ['second.json', [1]],
  ])
})

test('prototype allocations retain copied callbacks without running constructors or instance initializers', () => {
  const { selectBehaviors } = require('../tooling/behavior.cjs')
  const file = 'tests/prototypes.test.ts'
  const sources = new Map([
    ['src/ports.ts', `import fs from 'node:fs';
export class Port { callbacks = []; constructor() { fs.readFileSync('constructor.json') }
run() { this.callbacks?.push(() => fs.readFileSync('deferred.json')); this.configure(this.pending); this.operation?.() } }
export function wrap(operation) { return Object.assign(Object.create(Port.prototype), { pending: operation,
configure(this: Port, callback) { this.operation = callback } }) }`],
    [file, [
      "import fs from 'node:fs'; import { wrap } from '../src/ports'",
      "const first = wrap(() => fs.readFileSync('first.json')), second = wrap(() => fs.readFileSync('second.json'))",
      "test('first', () => first.run())",
      "test('second', () => second.run())",
      "test('constructor input owner', () => fs.readFileSync('constructor.json'))",
      "test('deferred input owner', () => fs.readFileSync('deferred.json'))",
    ].join('\n')],
  ])
  const inventory = [{ file, names: ['first', 'second', 'constructor input owner', 'deferred input owner'], locations: [3, 4, 5, 6].map(line => ({ line, column: 1 })) }]
  const inputs = ['first.json', 'second.json', 'constructor.json', 'deferred.json'], files = new Set([...sources.keys(), ...inputs])
  const consumers = dependencyConsumers(inventory, sources, path => files.has(path), { files })
  const plan = selectBehaviors(inventory, inputs.map(file => ({ status: 'M', file })), consumers, {
    sources, previousSources: sources, previousConsumers: consumers, ranges: {}, compilerOptions: { noLib: true, noResolve: true, types: [] },
  })
  assert.deepEqual(plan.selectedCases[file], [0, 1, 2, 3])
  assert.deepEqual(plan.details[file].map(detail => [detail.changed, [...new Set(detail.caseEvidence.map(item => item.index))]]), inputs.map((input, index) => [input, [index]]))
})

test('copying into a source prototype with a setter keeps an unknown-effect frontier', () => {
  const before = `export function changed() { return 1 }
class Port { set operation(value) { externalWrite(value) } }
export function run() { return Object.assign(Object.create(Port.prototype), { operation: () => changed() }) }`
  assert.throws(() => selection(before, before.replace('return 1', 'return 2'), [
    "import { run, changed } from '../src/owner'",
    "test('copy has setter effects even when its return is ignored', () => { run() })",
    "test('actual owner', () => changed())",
  ]), /Unsafe native data operation/)
})

test('later own-property definitions do not retroactively invalidate a fresh copy effect proof', () => {
  const before = `export function changed() { return 1 }
class Port {}
export function run() { const port = Object.assign(Object.create(Port.prototype), { value: 1 }); Object.defineProperties(port, { flag: { value: true } }); return 0 }`
  const plan = selection(before, before.replace('return 1', 'return 2'), [
    "import { run, changed } from '../src/owner'",
    "test('copy then define', () => run())",
    "test('actual owner', () => changed())",
  ])
  assert.deepEqual(indices(plan), [1])
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
  ['computed getter', 'export const helper = { get value() { return globalThis.original() } }', "() => { helper['value'.slice()]; return 0 }"],
  ['captured binding updated by a helper', 'export function helper() { let value; const read = () => value.hidden; function write() { value = { get hidden() { return globalThis.original() } } }; write(); return read() }', '() => helper()'],
  ['captured collection with an earlier write', 'export const helper = { items: [] }; helper.items.push({ get value() { return globalThis.original() } })', '() => helper.items[0]?.value'],
  ['returned allocation changed through its original alias', 'export function helper() { const original = {}; function get() { return original }; const returned = get(); original.toString = () => globalThis.original(); return String(returned) }', '() => helper()'],
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
