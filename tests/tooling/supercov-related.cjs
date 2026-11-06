'use strict'
const { execFileSync } = require('node:child_process')
const { readFileSync, existsSync } = require('node:fs')
const { resolve } = require('node:path')

const ROOT = resolve(__dirname, '../..')
const VERSION = '4.24.2'
const fail = message => { throw new Error('Supercov Related selection unsafe: ' + message) }
const testPath = path => /^tests\/.*\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path)
const nodeInput = path => path.startsWith('tests/tooling/') || path.startsWith('tests/release/')
  || path.startsWith('.github/workflows/')
const validInput = path => /^src\/.*\.[cm]?[jt]sx?$/.test(path) || testPath(path)
  || nodeInput(path) || /^(package(?:-lock)?\.json|tsconfig.*\.json|vite\.config\..*|vitest\.config\..*)$/.test(path)

function decodeAffected(envelope, inventory, changes, expectedRun) {
  if (envelope?.schemaVersion !== 1 || envelope.ok !== true || envelope.command !== 'runs.tests.affected') fail('Invalid public CLI JSON envelope')
  const data = envelope.data
  if (!data || data.run !== expectedRun || !data.summary || !data.workingTree) fail('Missing run identity, summary or working-tree evidence')
  const { affected, undetermined, unaffected, summary, workingTree } = data
  if (![affected, undetermined, unaffected].every(Array.isArray)) fail('Incomplete affected/undetermined/unaffected lists')
  if (!Number.isInteger(summary.tests) || summary.tests < 1 || summary.tests !== affected.length + undetermined.length + unaffected.length) {
    fail('Truncated or incomplete native test listing; cannot silently drop leaves')
  }
  for (const key of ['affected', 'undetermined', 'unaffected']) {
    if (summary[key] !== data[key].length || data[key + 'Count'] !== undefined) fail('Native ' + key + ' result is truncated')
  }
  if (!Array.isArray(workingTree.runWide) || !Array.isArray(workingTree.reasons)) fail('Missing run-wide change classification')
  // New source cannot be inferred from old coverage. New test files are explicitly selected below.
  const added = changes.filter(change => change.status === 'A')
  if (workingTree.sourceSetChanged && (added.length === 0 || added.some(change => !testPath(change.file)))) {
    fail('New source or test scope not covered by historical evidence')
  }
  if (changes.some(change => !/^(A|M)$/.test(change.status))) fail('Deleted/renamed paths require separate native lifecycle proof')
  if (changes.some(change => !validInput(change.file) && !/\.md$/.test(change.file))) {
    fail('Non-code/asset change has no verified native impact policy')
  }
  const inventoryByFile = new Map(inventory.map(item => [item.file, item]))
  const selectedCases = {}
  const reasons = {}
  const seen = new Set()
  const add = (file, index, why) => {
    ;(selectedCases[file] ??= []).push(index)
    ;(reasons[file] ??= []).push(why)
  }
  // The three buckets together must uniquely account for every recorded Vitest leaf.
  for (const bucket of ['affected', 'undetermined', 'unaffected']) {
    for (const t of data[bucket]) {
      if (typeof t?.file !== 'string' || typeof t?.name !== 'string') fail('Missing exact test identity')
      const id = JSON.stringify([t.file, t.name])
      if (seen.has(id)) fail('Duplicate Supercov test identity: ' + id)
      seen.add(id)
      const item = inventoryByFile.get(t.file)
      if (!item || item.runner !== 'vitest') fail('Historical test no longer in Vitest discovery: ' + id)
      const indices = item.names.flatMap((name, i) => name === t.name ? [i] : [])
      if (indices.length !== 1) fail('Ambiguous or missing full Vitest name: ' + id)
      if (bucket !== 'unaffected') add(t.file, indices[0], 'Supercov native: ' + bucket)
    }
  }
  // New tests and changed test bodies must execute even with no old execution record.
  for (const change of changes.filter(change => testPath(change.file))) {
    const item = inventoryByFile.get(change.file)
    if (!item) fail('Changed test is not discoverable: ' + change.file)
    selectedCases[change.file] = item.names.map((_, i) => i)
    reasons[change.file] = ['Directly changed test (including new cases)']
  }
  // Keep the small Node tooling/release suite, not a second homegrown impact graph.
  for (const item of inventory.filter(item => item.runner === 'node')) {
    selectedCases[item.file] = item.names.map((_, i) => i)
    reasons[item.file] = ['Fixed Node tooling contract suite']
  }
  for (const change of changes) {
    if (change.status === 'A' && /^src\//.test(change.file)) fail('New source lacks historical coverage: ' + change.file)
    if (/^public\/|^tools\/.*(?:\.glb|\.py|\.mjs)$/.test(change.file)) fail('No verified asset/tool impact: ' + change.file)
  }
  if (!Object.keys(selectedCases).length || (!affected.length && !undetermined.length
    && changes.some(change => /^src\//.test(change.file)))) {
    fail('Unexplained zero source impact; do not claim an empty Related plan')
  }
  const selected = Object.keys(selectedCases).sort()
  for (const file of selected) selectedCases[file] = [...new Set(selectedCases[file])].sort((a, b) => a - b)
  return { mode: 'related', source: 'Supercov native tests affected', supercovRun: expectedRun,
    selected, selectedCases, reasons, details: {}, fallback: null,
    native: { affected: affected.length, undetermined: undetermined.length, unaffected: unaffected.length,
      total: summary.tests, runWide: workingTree.runWide } }
}

function nativeSelection(inventory, changes) {
  const location = resolve(ROOT, process.env.SUPERCOV_SEED_FILE || 'output/supercov-seed.json')
  if (!existsSync(location)) fail('Missing authoritative seed; run approved manual Full bootstrap or main Full')
  const seed = JSON.parse(readFileSync(location, 'utf8'))
  if (seed.version !== VERSION || !/^run_[a-z0-9]+$/i.test(seed.runId || '')
    || !/^[a-f0-9]{40}$/.test(seed.sha || '')) fail('Invalid seed metadata')
  if (!existsSync(resolve(ROOT, '.supercov/runs', seed.runId))) fail('Seed run data is missing')
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', seed.sha, 'HEAD'], { cwd: ROOT, stdio: 'pipe' })
  } catch { fail('Seed SHA is not an ancestor of checkout (cannot reuse unrelated history)') }
  let output
  try {
    output = execFileSync('npx', ['--yes', 'supercov@' + VERSION, 'runs', seed.runId, 'tests', 'affected', '--json'],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 })
  } catch (error) { fail('Native tests affected query failed: ' + (error.stderr?.toString() || error.message)) }
  let response
  try { response = JSON.parse(output) } catch { fail('Invalid native Supercov JSON') }
  return decodeAffected(response, inventory, changes, seed.runId)
}

module.exports = { decodeAffected, nativeSelection }
