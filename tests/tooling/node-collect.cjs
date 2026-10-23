// Registration-only collection in an isolated process: never invoke leaf bodies.
const Module = require('node:module')
const { resolve } = require('node:path')
const original = Module._load
const files = []
let current
const parents = []
function register(name, options, callback) {
  if (typeof options === 'function') callback = options
  if (options?.skip || options?.todo || options?.only) throw new Error('Hidden/focused Node registration')
  current.names.push([...parents, name].join(' > '))
  current.nativeNames.push([...parents, name].join(' '))
  const frame = new Error().stack.split('\n').find(line => line.includes(resolve(current.file) + ':'))
  const match = frame?.match(/:(\d+):(\d+)\)?$/)
  current.locations.push(match ? { line: +match[1], column: +match[2] } : null)
  return Promise.resolve()
}
function suite(name, options, callback) {
  if (typeof options === 'function') callback = options
  if (options?.skip || options?.todo || options?.only) throw new Error('Hidden/focused Node suite')
  parents.push(name)
  const result = callback()
  parents.pop()
  if (result?.then) throw new Error('Async Node suite collection is unsupported; fail closed')
}
const forbidden = () => { throw new Error('Hidden/focused Node registration') }
Object.assign(register, { test: register, it: register, describe: suite, suite,
  before() {}, after() {}, beforeEach() {}, afterEach() {}, skip: forbidden, todo: forbidden, only: forbidden })
Object.assign(suite, { skip: forbidden, todo: forbidden, only: forbidden })
Module._load = function (id, ...args) { return id === 'node:test' || id === 'test' ? register : original.call(this, id, ...args) }
for (const file of process.argv.slice(2)) {
  current = { file, runner: 'node', names: [], nativeNames: [], locations: [] }
  require(resolve(file))
  if (!current.names.length) throw new Error(`Empty Node collection: ${file}`)
  files.push(current)
}
process.stdout.write(JSON.stringify(files))
