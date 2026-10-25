const { test } = require('node:test')
const assert = require('node:assert/strict')
const { selectFiles } = require('../tooling/ci-plan.cjs')
const { dependencyConsumers } = require('../tooling/dependencies.cjs')

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
  const plan = selection(before, after, [
    "import { TABLE, unrelated } from '../src/owner'",
    "test('data', () => TABLE['old'])",
    "test('import only', () => unrelated())",
  ])
  assert.deepEqual(indices(plan), [0])
  assert.deepEqual(plan.changedBehaviors, ['src/owner.ts#TABLE'])
})

test('shared data follows dynamic keys and nested destructuring aliases without selecting sibling imports', () => {
  const before = `export const TABLE = { nested: { values: [1] } }
export function read() { const { nested: { values: [first] } } = TABLE; return first }
export function wrapped() { return { TABLE } }
export function unrelated() { return 0 }`
  const plan = selection(before, before.replace('[1]', '[2]'), [
    "import { TABLE, read, wrapped, unrelated } from '../src/owner'",
    "test('dynamic', () => { const key = globalThis.key; return TABLE[key] })",
    "test('alias', () => read())",
    "test('shorthand', () => wrapped())",
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

test('side-effect-only import edits without an addressable behavior owner fail closed', () => {
  const before = "import './registration'; export const value = 0"
  assert.throws(() => selection(before, 'export const value = 0', [
    "import { value } from '../src/owner'",
    "test('value', () => value)",
  ], [['src/registration.ts', 'globalThis.registered = true']]), /Unsafe\/unmapped behavior/)
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

test('scoped hook data reads select only leaves in their actual registration scope', () => {
  const before = 'export const TABLE = { value: 1 }; export function other() { return 0 }'
  const plan = selection(before, before.replace('value: 1', 'value: 2'), [
    "import { TABLE, other } from '../src/owner'",
    "describe('scope', () => {",
    "beforeEach(() => TABLE.value)",
    "test('hook', () => other())",
    "})",
    "test('outside', () => other())",
  ])
  assert.deepEqual(indices(plan), [0])
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
    "test('reflection', () => Object.getOwnPropertyNames(Owner.prototype))",
    "test('caller', () => read())",
    "test('import only', () => unrelated())",
  ])
  assert.deepEqual(indices(plan), [0, 1, 2])
  assert.ok(plan.changedBehaviors.includes('src/owner.ts#Owner'))
  assert.ok(!plan.changedBehaviors.includes('src/owner.ts#<module>'))
})
