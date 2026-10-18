const { execFileSync } = require('node:child_process')
const { readFileSync, writeFileSync, readdirSync, appendFileSync, mkdirSync, existsSync } = require('node:fs')
const { resolve, relative, dirname, join } = require('node:path')
const { randomUUID } = require('node:crypto')
const { MAX_CASES_PER_SHARD } = require('./budget.cjs')
const root = resolve(__dirname, '../..')
const slash = file => file.replaceAll('\\', '/')
const local = file => slash(relative(root, resolve(root, file)))
function walk(dir) {
  return readdirSync(resolve(root, dir), { withFileTypes: true }).flatMap(item =>
    item.isDirectory() ? walk(`${dir}/${item.name}`) : [`${dir}/${item.name}`]).sort()
}
function git(...args) { return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim() }
function changes(base, head, event) {
  if (!base || !head || /^0+$/.test(base)) throw new Error('Missing base/head SHA or initial push')
  git('cat-file', '-e', `${base}^{commit}`)
  git('cat-file', '-e', `${head}^{commit}`)
  // PRs use merge-base; pushes use exactly before..after, including multi-commit pushes.
  const start = event === 'pull_request' ? git('merge-base', base, head) : base
  const entries = execFileSync('git', ['diff', '--name-status', '-z', '--find-renames', start, head], { cwd: root, encoding: 'utf8' }).split('\0')
  const result = []
  for (let i = 0; i < entries.length && entries[i];) {
    const status = entries[i++], file = entries[i++]
    if (/^[RC]/.test(status)) result.push({ status, oldFile: file, file: entries[i++] })
    else result.push({ status, file })
  }
  return result
}
const docsOnly = file => /^(README(?:\.[\w-]+)?\.md|(?:docs|ai_share)\/.*\.md|tests\/AGENTS\.md)$/.test(file)
  // Release notes are inputs to publication, not documentation-only changes.
  && !file.startsWith('docs/releases/')
// All publication/release changes select the Node contract inventory in the
// Linux Related shard. Only host-sensitive path/bundle/package inputs also need
// the same component repeated on Windows and macOS.
const nodePublicationInput = file => /^(electron\/|tools\/release\/|tests\/release\/|docs\/releases\/)/.test(file)
  || /^(package(?:-lock)?\.json|electron-builder\.|\.github\/workflows\/release\.yml$)/.test(file)
const platformNodeInput = file => /^(electron\/|tests\/release\/asset-path\.test\.cjs$|tests\/release\/smoke\.mjs$)/.test(file)
  || /^(package(?:-lock)?\.json|electron-builder\.|\.github\/workflows\/release\.yml$)/.test(file)

function policyConsumers(file, inventory) {
  const available = new Set(inventory.map(item => item.file))
  const hits = new Set()
  const add = fileName => { if (available.has(fileName)) hits.add(fileName) }
  if (/^(tools\/tests\/|\.github\/workflows\/|vitest\.config\.ts$|package(?:-lock)?\.json$|tsconfig(?:\.[\w-]+)?\.json$|tests\/helpers\/logicOnly\.ts$)/.test(file)) {
    add('tests/release/ci-plan.test.cjs')
    add('tests/release/test-budget.test.cjs')
  }
  if (nodePublicationInput(file)) {
    for (const item of inventory) if (item.runner === 'node') hits.add(item.file)
  }
  return hits
}
function relatedSelectionError(reason) {
  throw new Error(`Related selection is unsafe: ${reason}. Add an explicit dependency/owner mapping or split the change; Full is reserved for main/release.`)
}
function selectFiles(inventory, changed, consumers) {
  const all = inventory.map(item => item.file)
  if (!changed.length) relatedSelectionError('No trustworthy changed-file evidence')
  if (changed.every(item => docsOnly(item.file) && (!item.oldFile || docsOnly(item.oldFile)))) {
    return { mode: 'related', docsOnly: true, selected: [], reasons: {}, message: 'No related logic tests: documentation-only change' }
  }
  if (consumers.runtimeAmbiguities?.length) relatedSelectionError(`Unresolved runtime imports/globs: ${consumers.runtimeAmbiguities.join(', ')}`)
  const unsupported = changed.find(item => !['A', 'M'].includes(item.status))
  if (unsupported) relatedSelectionError(`Removed/renamed path: ${unsupported.oldFile ?? unsupported.file}`)
  const reasons = {}
  for (const item of changed) {
    if (docsOnly(item.file)) continue
    const hits = new Set(consumers[item.file] ?? [])
    for (const file of policyConsumers(item.file, inventory)) hits.add(file)
    if (all.includes(item.file)) hits.add(item.file)
    if (!hits.size) relatedSelectionError(`Unmapped code/runtime input: ${item.file}`)
    for (const file of hits) (reasons[file] ??= []).push(`Depends on or directly modified: ${item.file}`)
  }
  return { mode: 'related', selected: Object.keys(reasons).sort(), reasons }
}
function shardFiles(files) {
  const shards = []
  for (const file of [...files].sort((a, b) => a.file.localeCompare(b.file, 'en'))) {
    if (!file.names?.length || file.names.length > MAX_CASES_PER_SHARD) throw new Error(`File must collect 1–500 leaves; split its independent suites: ${file.file}`)
    let shard = shards.at(-1)
    if (!shard || shard.expectedCount + file.names.length > MAX_CASES_PER_SHARD) {
      shard = { id: `logic-${shards.length + 1}`, vitestFiles: [], nodeFiles: [], expectedCount: 0 }
      shards.push(shard)
    }
    shard[file.runner === 'node' ? 'nodeFiles' : 'vitestFiles'].push(file.file)
    shard.expectedCount += file.names.length
  }
  return shards
}
function planShards(files, mode) {
  if (mode === 'full') return shardFiles(files)
  const sorted = [...files].sort((a, b) => a.file.localeCompare(b.file, 'en'))
  const count = sorted.reduce((sum, file) => sum + (file.names?.length ?? 0), 0)
  if (!sorted.length) return []
  if (count > MAX_CASES_PER_SHARD) {
    throw new Error(`Related selection contains ${count} leaves; the entire Related CI run is limited to ${MAX_CASES_PER_SHARD}. Refine dependency/owner mappings or split the change; do not create another shard.`)
  }
  for (const file of sorted) if (!file.names?.length) throw new Error(`Empty related test file: ${file.file}`)
  return [{
    id: 'logic-related',
    vitestFiles: sorted.filter(file => file.runner === 'vitest').map(file => file.file),
    nodeFiles: sorted.filter(file => file.runner === 'node').map(file => file.file),
    expectedCount: count,
  }]
}
function validateManifest(plan) {
  const all = plan.inventory.map(item => item.file)
  if (!['full', 'related'].includes(plan.mode)) throw new Error('Invalid manifest mode')
  if (new Set(all).size !== all.length) throw new Error('Duplicate discovered file')
  const expected = plan.mode === 'full' ? all : plan.selected
  const assigned = plan.shards.flatMap(shard => [...shard.vitestFiles, ...shard.nodeFiles])
  if (new Set(plan.shards.map(s => s.id)).size !== plan.shards.length) throw new Error('Duplicate shard ID')
  if (new Set(assigned).size !== assigned.length || [...expected].sort().join('\n') !== [...assigned].sort().join('\n')) throw new Error('Missing, unexpected or duplicate assigned test files')
  if (!assigned.length && !(plan.docsOnly && plan.mode === 'related' && plan.changedFiles.length && plan.changedFiles.every(docsOnly))) throw new Error('Empty code selection')
  if (plan.mode === 'related' && plan.shards.length > 1) throw new Error('Related mode must use one aggregate-limited shard')
  let total = 0
  for (const shard of plan.shards) {
    const files = [...shard.vitestFiles, ...shard.nodeFiles]
    const count = files.reduce((sum, file) => sum + plan.inventory.find(item => item.file === file).names.length, 0)
    total += count
    if (count !== shard.expectedCount || count < 1 || count > MAX_CASES_PER_SHARD) throw new Error('Invalid shard leaf budget')
    for (const file of shard.vitestFiles) if (plan.inventory.find(item => item.file === file).runner !== 'vitest') throw new Error('Wrong Vitest assignment')
    for (const file of shard.nodeFiles) if (plan.inventory.find(item => item.file === file).runner !== 'node') throw new Error('Wrong Node assignment')
  }
  if (plan.mode === 'related' && total > MAX_CASES_PER_SHARD) throw new Error('Related aggregate exceeds 500 leaves')
  return plan
}
function discoverNode() {
  const files = walk('tests').filter(file => /\.test\.cjs$/.test(file))
  if (!files.length) throw new Error('Empty Node discovery')
  return JSON.parse(execFileSync(process.execPath, ['tools/tests/node-collect.cjs', ...files], { cwd: root, encoding: 'utf8' }))
}
async function discover({ relatedPaths = [] } = {}) {
  // Public Vitest 4.1 API, matching `vitest related` and `vitest list --json`.
  const { createVitest } = await import('vitest/node')
  const priorFiles = process.env.LOGIC_TEST_FILES
  delete process.env.LOGIC_TEST_FILES
  const ctx = await createVitest('test', { root, watch: false, reporters: [], related: relatedPaths.map(file => resolve(root, file)) })
  try {
    const specs = await ctx.globTestSpecifications()
    const related = relatedPaths.length ? await ctx.getRelevantTestSpecifications() : []
    const { testModules, unhandledErrors } = await ctx.collectTests(specs)
    if (unhandledErrors.length) throw new Error(unhandledErrors.map(error => error.message).join('\n'))
    const inventory = testModules.map(module => {
      if (module.errors().length || [...module.children.allSuites()].some(s => s.errors().length)) throw new Error(`Collection error: ${module.moduleId}: ${JSON.stringify(module.errors())}`)
      const names = [...module.children.allTests()].map(test => test.fullName)
      if (!names.length) throw new Error(`Empty test file: ${module.moduleId}`)
      return { runner: 'vitest', file: local(module.moduleId), names }
    })
    if (inventory.length !== specs.length) throw new Error('Incomplete Vitest discovery')
    const node = discoverNode()
    return { inventory: [...inventory, ...node].sort((a, b) => a.file.localeCompare(b.file, 'en')), related: related.map(spec => local(spec.moduleId)) }
  } finally {
    await ctx.close()
    if (priorFiles !== undefined) process.env.LOGIC_TEST_FILES = priorFiles
  }
}
function dependencyConsumers(inventory) {
  const sources = new Map([...walk('src'), ...walk('tests'), ...walk('tools'), ...walk('electron')]
    .filter(file => /\.[cm]?[jt]sx?$/.test(file))
    .map(file => [file, readFileSync(resolve(root, file), 'utf8')]))
  // Lazy parser import keeps the dependency-free aggregate job lightweight.
  return require('./dependencies.cjs').dependencyConsumers(inventory, sources, file => existsSync(resolve(root, file)))
}
async function createPlan({ mode = 'full', base = '', head = '', event = 'local' } = {}) {
  if (!['full', 'related'].includes(mode)) throw new Error(`Invalid test mode: ${mode}`)
  const checkoutSha = git('rev-parse', 'HEAD')
  if (mode === 'full') {
    const found = await discover()
    const selected = found.inventory.map(item => item.file)
    return validateManifest({
      version: 1, planId: randomUUID(), requestedMode: mode, mode: 'full', event,
      baseSha: base, headSha: head, checkoutSha, changedFiles: [], changes: [], inventory: found.inventory,
      fallback: null, selected, reasons: Object.fromEntries(selected.map(file => [file, ['Explicit full suite']])),
      shards: planShards(found.inventory, 'full'),
    })
  }
  let changed
  try { changed = changes(base, head, event) }
  catch (error) { throw new Error(`Related Git history unavailable: ${error.message}. Full is reserved for main/release.`) }
  const unsupported = changed.find(item => !['A', 'M'].includes(item.status))
  if (unsupported) relatedSelectionError(`Removed/renamed path: ${unsupported.oldFile ?? unsupported.file}`)
  const documentation = changed.length > 0 && changed.every(item => docsOnly(item.file) && (!item.oldFile || docsOnly(item.oldFile)))
  if (documentation) return validateManifest({
    version: 1, planId: randomUUID(), requestedMode: mode, event, baseSha: base, headSha: head,
    checkoutSha, changedFiles: [...new Set(changed.flatMap(item => [item.file, ...(item.oldFile ? [item.oldFile] : [])]))].sort(), changes: changed, inventory: [],
    ...selectFiles([], changed, {}), shards: [],
  })
  let found
  try { found = await discover({ relatedPaths: changed.map(item => item.file) }) }
  catch (error) { throw new Error(`Related dependency selection unavailable: ${error.message}. Full is reserved for main/release.`) }
  const selection = selectFiles(found.inventory, changed, dependencyConsumers(found.inventory))
  // Union native Vitest and CJS/static runtime graph results; never remove native hits.
  for (const file of found.related) if (!selection.selected.includes(file)) {
    selection.selected.push(file)
    selection.reasons[file] = ['Vitest transitive runtime dependency']
  }
  selection.selected.sort()
  const selectedInventory = found.inventory.filter(item => selection.selected.includes(item.file))
  return validateManifest({
    version: 1, planId: randomUUID(), requestedMode: mode, event, baseSha: base, headSha: head,
    checkoutSha, changedFiles: [...new Set(changed.flatMap(item => [item.file, ...(item.oldFile ? [item.oldFile] : [])]))].sort(), changes: changed,
    inventory: found.inventory, ...selection, shards: planShards(selectedInventory, 'related'),
  })
}
function platformNodeRequired(plan) {
  if (plan.mode === 'full') return true
  return plan.changes.some(item => [item.file, item.oldFile].filter(Boolean).some(platformNodeInput))
}
function options(args) {
  const result = {}
  for (let i = 0; i < args.length; i += 2) {
    if (!/^--[a-z-]+$/.test(args[i]) || args[i + 1] === undefined) throw new Error(`Invalid option: ${args[i]}`)
    result[args[i].slice(2)] = args[i + 1]
  }
  return result
}
if (require.main === module) (async () => {
  const args = options(process.argv.slice(2))
  const plan = await createPlan(args)
  const out = args.out ?? 'output/test-plan.json'
  mkdirSync(dirname(resolve(root, out)), { recursive: true })
  writeFileSync(out, JSON.stringify(plan, null, 2))
  const evidence = `Mode: ${plan.mode}; base: ${plan.baseSha}; head: ${plan.headSha}\nChanged: ${plan.changedFiles.join(', ')}\nFallback: ${plan.fallback ?? 'none'}\n${plan.message ?? ''}\n${plan.selected.map(file => `${file}: ${plan.reasons[file].join('; ')}`).join('\n')}\nShards: ${JSON.stringify(plan.shards)}\n`
  console.log(evidence)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n\`\`\`text\n${evidence}\`\`\`\n`)
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT,
    `matrix=${JSON.stringify({ include: plan.shards.map(shard => ({ shard: shard.id })) })}\nhas-tests=${plan.shards.length > 0}\nplatform-node-required=${platformNodeRequired(plan)}\n`)
})().catch(error => { console.error(error); process.exitCode = 1 })
module.exports = { createPlan, shardFiles, planShards, validateManifest, selectFiles, changes, options, discover, discoverNode, dependencyConsumers, docsOnly, platformNodeRequired }
