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
// Small map supplements the graph for runtime owners and registry/string lookups.
const globalChange = file => /^(tools\/tests\/|\.github\/workflows\/|tests\/helpers\/logicOnly\.ts$)/.test(file)
  || /(^|\/)(package(-lock)?\.json|[\w.-]*config\.[\w.]+)$/.test(file)
  || /^(src\/(Game|main)\.ts|src\/world\/NPC\.ts|src\/town\/TownScene\.ts|src\/career\/CareerProfile(Store)?\.ts)$/.test(file)
  || /(?:Registry|Catalog|Manifest|CombatAttribution|CombatEventStream|NavigationCoordinator|ArmyCommandController)\.[cm]?[jt]s$/.test(file)
const docsOnly = file => /^(README(?:\.[\w-]+)?\.md|(?:docs|ai_share)\/.*\.md|tests\/AGENTS\.md)$/.test(file)
  // Release notes are inputs to publication, not documentation-only changes.
  && !file.startsWith('docs/releases/')

function selectFiles(inventory, changed, consumers) {
  const all = inventory.map(item => item.file)
  const fallback = reason => ({ mode: 'full', fallback: reason, selected: all,
    reasons: Object.fromEntries(all.map(file => [file, [reason]])) })
  if (!changed.length) return fallback('No trustworthy changed-file evidence')
  if (changed.every(item => docsOnly(item.file) && (!item.oldFile || docsOnly(item.oldFile)))) {
    return { mode: 'related', docsOnly: true, selected: [], reasons: {}, message: 'No related logic tests: documentation-only change' }
  }
  if (consumers.runtimeAmbiguities?.length) return fallback(`Unresolved runtime imports/globs: ${consumers.runtimeAmbiguities.join(', ')}`)
  const unsafe = changed.find(item => item.status !== 'A' && item.status !== 'M' || globalChange(item.file))
  if (unsafe) return fallback(`Global/runtime owner or removed/renamed path: ${unsafe.oldFile ?? unsafe.file}`)
  const reasons = {}
  for (const item of changed) {
    if (docsOnly(item.file)) continue
    const hits = new Set(consumers[item.file] ?? [])
    if (all.includes(item.file)) hits.add(item.file)
    if (/^(electron\/|tools\/release\/|tests\/release\/)/.test(item.file)) {
      inventory.filter(test => test.runner === 'node').forEach(test => hits.add(test.file))
    }
    if (!hits.size) return fallback(`Unmapped code/runtime input: ${item.file}`)
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
function validateManifest(plan) {
  const all = plan.inventory.map(item => item.file)
  if (new Set(all).size !== all.length) throw new Error('Duplicate discovered file')
  const expected = plan.mode === 'full' ? all : plan.selected
  const assigned = plan.shards.flatMap(shard => [...shard.vitestFiles, ...shard.nodeFiles])
  if (new Set(plan.shards.map(s => s.id)).size !== plan.shards.length) throw new Error('Duplicate shard ID')
  if (new Set(assigned).size !== assigned.length || [...expected].sort().join('\n') !== [...assigned].sort().join('\n')) throw new Error('Missing, unexpected or duplicate assigned test files')
  if (!assigned.length && !(plan.docsOnly && plan.mode === 'related' && plan.changedFiles.length && plan.changedFiles.every(docsOnly))) throw new Error('Empty code selection')
  for (const shard of plan.shards) {
    const files = [...shard.vitestFiles, ...shard.nodeFiles]
    const count = files.reduce((sum, file) => sum + plan.inventory.find(item => item.file === file).names.length, 0)
    if (count !== shard.expectedCount || count < 1 || count > MAX_CASES_PER_SHARD) throw new Error('Invalid shard leaf budget')
    for (const file of shard.vitestFiles) if (plan.inventory.find(item => item.file === file).runner !== 'vitest') throw new Error('Wrong Vitest assignment')
    for (const file of shard.nodeFiles) if (plan.inventory.find(item => item.file === file).runner !== 'node') throw new Error('Wrong Node assignment')
  }
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
  // Supplement native Vite runtime selection with CJS and static helper edges.
  // Erase type-only edges to avoid pulling unrelated runtime suites into CI.
  const ts = require('typescript')
  const graph = new Map()
  const runtimeAmbiguities = []
  for (const file of [...walk('src'), ...walk('tests'), ...walk('tools'), ...walk('electron')].filter(file => /\.[cm]?[jt]sx?$/.test(file))) {
    const source = readFileSync(resolve(root, file), 'utf8')
    const runtime = /\.tsx?$/.test(file) ? ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext } }).outputText : source
    const imports = ts.preProcessFile(runtime, true, true).importedFiles
    if (/^(src\/|tests\/helpers\/|electron\/|tools\/release\/)/.test(file)) {
      const parsed = ts.createSourceFile(file, runtime, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
      function inspect(node) {
        if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
          if (node.arguments.length !== 1 || !ts.isStringLiteralLike(node.arguments[0])) runtimeAmbiguities.push(file)
        }
        ts.forEachChild(node, inspect)
      }
      inspect(parsed)
      if (/import\.meta\.glob/.test(runtime)) runtimeAmbiguities.push(file)
    }
    const deps = []
    for (const { fileName } of imports) {
      if (!fileName.startsWith('.')) continue
      const stem = resolve(root, dirname(file), fileName)
      const target = [stem, ...['.ts', '.tsx', '.js', '.mjs', '.cjs', '/index.ts', '/index.js'].map(ext => stem + ext)].find(existsSync)
      if (target) deps.push(local(target))
    }
    graph.set(file, deps)
  }
  const consumers = {}
  for (const test of inventory) {
    const visited = new Set()
    function visit(file) {
      if (visited.has(file)) return
      visited.add(file)
      ;(consumers[file] ??= []).push(test.file)
      for (const dep of graph.get(file) ?? []) visit(dep)
    }
    visit(test.file)
  }
  consumers.runtimeAmbiguities = [...new Set(runtimeAmbiguities)]
  return consumers
}
async function createPlan({ mode = 'full', base = '', head = '', event = 'local' } = {}) {
  if (!['full', 'related'].includes(mode)) throw new Error(`Invalid test mode: ${mode}`)
  let changed = [], failure
  try { changed = changes(base, head, event) } catch (error) { failure = `Git history unavailable: ${error.message}` }
  const globalFallback = changed.some(item => !['A', 'M'].includes(item.status) || globalChange(item.file))
  const documentation = !failure && mode === 'related' && selectFiles([], changed, {}).docsOnly
  if (documentation) return validateManifest({ version: 1, planId: randomUUID(), requestedMode: mode, event, baseSha: base, headSha: head,
    checkoutSha: git('rev-parse', 'HEAD'), changedFiles: [...new Set(changed.flatMap(item => [item.file, ...(item.oldFile ? [item.oldFile] : [])]))].sort(), changes: changed, inventory: [],
    ...selectFiles([], changed, {}), shards: [] })
  // Known Full fallbacks need no dependency transforms. Collection still fails
  // closed; a graph error retries collection without selection and forces Full.
  let found
  try { found = await discover({ relatedPaths: mode === 'related' && !failure && !globalFallback ? changed.map(item => item.file) : [] }) }
  catch (error) { failure = `Dependency selection unavailable: ${error.message}`; found = await discover() }
  let selection = mode === 'full' || failure || globalFallback ? null : selectFiles(found.inventory, changed, dependencyConsumers(found.inventory))
  if (globalFallback && mode !== 'full' && !failure) selection = selectFiles(found.inventory, changed, {})
  if (mode === 'full' || failure) {
    selection = { mode: 'full', fallback: mode === 'related' ? failure : null,
      selected: found.inventory.map(item => item.file), reasons: Object.fromEntries(found.inventory.map(item => [item.file, [mode === 'full' ? 'Explicit full suite' : failure]])) }
  } else if (selection.mode === 'related' && !selection.docsOnly) {
    // Union native Vitest and CJS/static runtime graph results; never remove native hits.
    for (const file of found.related) if (!selection.selected.includes(file)) {
      selection.selected.push(file); selection.reasons[file] = ['Vitest transitive runtime dependency']
    }
    selection.selected.sort()
  }
  const selectedInventory = found.inventory.filter(item => selection.selected.includes(item.file))
  return validateManifest({ version: 1, planId: randomUUID(), requestedMode: mode, event, baseSha: base, headSha: head,
    checkoutSha: git('rev-parse', 'HEAD'), changedFiles: [...new Set(changed.flatMap(item => [item.file, ...(item.oldFile ? [item.oldFile] : [])]))].sort(), changes: changed,
    inventory: found.inventory, ...selection, shards: shardFiles(selectedInventory) })
}
function nodeReleaseCovered(plan) {
  const files = plan.inventory.filter(item => item.runner === 'node')
  return files.length > 0 && files.every(item => plan.selected.includes(item.file))
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
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify({ include: plan.shards.map(shard => ({ shard: shard.id })) })}\nhas-tests=${plan.shards.length > 0}\nnode-release-covered=${nodeReleaseCovered(plan)}\n`)
})().catch(error => { console.error(error); process.exitCode = 1 })
module.exports = { createPlan, shardFiles, validateManifest, selectFiles, changes, options, discover, discoverNode, dependencyConsumers, docsOnly, nodeReleaseCovered }
