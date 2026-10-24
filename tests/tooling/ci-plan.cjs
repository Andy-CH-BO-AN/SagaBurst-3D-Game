const { execFileSync } = require('node:child_process')
const { readFileSync, writeFileSync, readdirSync, appendFileSync, mkdirSync, existsSync } = require('node:fs')
const { resolve, relative, dirname, join, posix } = require('node:path')
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
const docsOnly = file => /^(README(?:\.[\w-]+)?\.md|(?:docs|ai_share)\/.*\.md|tests\/(?:AGENTS|tooling\/README)\.md|tools\/horse\/README\.md)$/.test(file)
  // Release notes are inputs to publication, not documentation-only changes.
  && !file.startsWith('docs/releases/')
// Test files select themselves and their actual consumers, regardless of folder.
// Only publication runtime/config inputs require the broad Node owner contract.
const nodePublicationInput = file => /^(electron\/|\.github\/scripts\/release\/|docs\/releases\/)/.test(file)
  || /^(package(?:-lock)?\.json|electron-builder\.|\.github\/workflows\/release\.yml$)/.test(file)

function policyConsumers(file, inventory) {
  const available = new Set(inventory.map(item => item.file))
  const hits = new Set()
  const add = fileName => { if (available.has(fileName)) hits.add(fileName) }
  if (/^(tests\/tooling\/|\.github\/workflows\/|vitest\.config\.ts$|package(?:-lock)?\.json$|tsconfig(?:\.[\w-]+)?\.json$|tests\/helpers\/logicOnly\.ts$)/.test(file)) {
    add('tests/release/ci-plan.test.cjs')
    add('tests/release/test-budget.test.cjs')
    add('tests/release/workflow-contract.test.cjs')
  }
  // The DEV-only WebGL entry cannot be imported by logic tests. Its formal
  // siege/navigation/checkpoint owners and rejected-projectile contract are
  // exercised without constructing the preview's renderer or scene.
  if (file === 'src/debug/TownFourGateSiegePreview.ts') {
    for (const owner of ['tests/missions/TownSiegePolicy.test.ts', 'tests/missions/SiegeRampPolicy.test.ts',
      'tests/persistence/TownSiegeRosterPersistence.test.ts', 'tests/movement/NavigationWorld.test.ts',
      'tests/combat/ProjectileBallistics.test.ts']) add(owner)
  }
  // The DEV-only QA panel dispatches to the production preset, final-stand
  // transaction and single-save entry owners without constructing a test scene.
  if (file === 'src/debug/CareerRetirementQA.ts') {
    for (const owner of ['tests/progression/CareerRetirementQaProfile.test.ts',
      'tests/progression/CareerRetirementFinale.test.ts', 'tests/town/CareerTownEntry.test.ts']) add(owner)
  }
  // Browser bootstrap dispatches to these real entry/recovery/mode owners;
  // importing main.ts itself would instantiate the page and render runtime.
  if (file === 'src/main.ts') {
    for (const owner of ['tests/town/CareerTownEntry.test.ts', 'tests/missions/CareerMissionRecovery.test.ts',
      'tests/integration/MissionModeRouting.test.ts']) add(owner)
  }
  // Setup screens pass their selection to the production configuration and
  // spawn-plan boundaries; campaign stage access has its own progress owner.
  if (file === 'src/ui/BattleSetupUI.ts' || file === 'src/ui/CampaignSetupUI.ts') {
    for (const owner of ['tests/missions/BattleConfig.test.ts', 'tests/actors/BattleSpawner.test.ts']) add(owner)
    if (file === 'src/ui/CampaignSetupUI.ts') add('tests/progression/CampaignProgress.test.ts')
  }
  // Offline mount authoring and DEV viewers are verified with the actual GLB
  // in Blender/Chrome. Their pure preload, playback-state and seat-cache owners
  // remain the logic gate; tests must never load a mesh or construct a skeleton.
  if (/^public\/models\/mounts\/v2\/snow-leopard\//.test(file)
    || ['tools/blender/build_snow_leopard.py', 'tools/blender/snow_leopard_package.mjs',
      'tools/blender/snow_leopard_skin_regions.json',
      'src/debug/VikingHeroPreview.ts'].includes(file)) {
    for (const owner of ['tests/assets/QuadrupedAssetPreload.test.ts',
      'tests/actors/RiderSeatContactCache.test.ts', 'tests/actors/MountDeathPresentation.test.ts']) add(owner)
  }
  // The offline eagle envelope and fetched metadata share the runtime's pure
  // validity/fallback contract; exercising it requires no GLB or render scene.
  if (file === 'tools/build-xongkoro-bounds.mjs'
    || /^src\/(?:world\/Xongkoro(?:Visual|GroundPose)|movement\/XongkoroConfig)\.ts$/.test(file)
    || /^public\/models\/mounts\/v2\/xongkoro\/(?:manifest|render-bounds)\.json$/.test(file)) {
    add('tests/world/XongkoroRenderBounds.test.ts')
  }
  if (nodePublicationInput(file)) {
    for (const item of inventory) if (item.runner === 'node') hits.add(item.file)
  }
  return hits
}
function relatedSelectionError(reason) {
  throw new Error(`Related selection is unsafe: ${reason}. Add an explicit dependency/owner mapping or split the change; Full is reserved for main/release.`)
}
function selectFiles(inventory, changed, consumers, evidence) {
  const all = inventory.map(item => item.file)
  if (!changed.length) relatedSelectionError('No trustworthy changed-file evidence')
  const unsupported = changed.find(item => !/^(?:A|M|D|R\d+)$/.test(item.status))
  if (unsupported) relatedSelectionError(`Unsupported Git change: ${unsupported.status} ${unsupported.file}`)
  if (changed.every(item => docsOnly(item.file) && (!item.oldFile || docsOnly(item.oldFile)))) {
    return { mode: 'related', docsOnly: true, selected: [], reasons: {}, message: 'No related logic tests: documentation-only change' }
  }
  if (consumers.runtimeAmbiguities?.length) relatedSelectionError(`Unresolved runtime imports/globs: ${consumers.runtimeAmbiguities.join(', ')}`)
  if (consumers.unresolvedImports?.length) relatedSelectionError(`Unresolved runtime dependencies: ${consumers.unresolvedImports.join(', ')}`)
  const lifecycle = changed.filter(item => item.status === 'D' || item.status.startsWith('R'))
  const previous = evidence?.previousConsumers
  if (lifecycle.length && (!previous?.graph || !evidence.previousFiles || !evidence.files)) relatedSelectionError('Missing base dependency graph for removed/renamed paths')
  if (previous?.runtimeAmbiguities?.length || previous?.unresolvedImports?.length) relatedSelectionError(`Unresolved base dependencies: ${[...(previous.runtimeAmbiguities ?? []), ...(previous.unresolvedImports ?? [])].join(', ')}`)
  const renamed = new Map(changed.filter(item => item.status.startsWith('R')).map(item => [item.oldFile, item.file]))
  const surviving = file => renamed.get(file) ?? file
  const retiredFiles = []
  const typeOnlyFiles = evidence ? changed.filter(item => ['A', 'M'].includes(item.status) && item.file.startsWith('src/') && /\.tsx?$/.test(item.file) && !policyConsumers(item.file, inventory).size && evidence.sources.has(item.file) && evidence.previousSources.has(item.file)
    && require('./dependencies.cjs').runtimeEquivalent(evidence.previousSources.get(item.file), evidence.sources.get(item.file))).map(item => item.file) : []
  const behaviorChanges = evidence ? changed.filter(item => ['A', 'M'].includes(item.status) && item.file.startsWith('src/') && /\.tsx?$/.test(item.file)
    && !policyConsumers(item.file, inventory).size && !typeOnlyFiles.includes(item.file)) : []
  let behavior = { selected: [], selectedCases: {}, reasons: {}, details: {} }
  if (behaviorChanges.length) {
    try { behavior = require('./behavior.cjs').selectBehaviors(inventory, behaviorChanges, consumers, { ...evidence, testRenames: renamed }) }
    catch (error) { relatedSelectionError(error.message) }
  }
  const reasons = behavior.reasons
  const details = behavior.details
  const selectedCases = behavior.selectedCases
  const { dependencyChain } = require('./dependencies.cjs')
  for (const item of changed) {
    if ((docsOnly(item.file) && (!item.oldFile || docsOnly(item.oldFile))) || behaviorChanges.includes(item) || typeOnlyFiles.includes(item.file)) continue
    const oldFile = item.oldFile ?? item.file
    const removed = item.status === 'D'
    const historical = lifecycle.includes(item)
    if (historical && (!evidence.previousFiles.has(oldFile) || (removed ? evidence.files.has(item.file) : !evidence.files.has(item.file)))) {
      relatedSelectionError(`Git lifecycle does not match base/checkout: ${oldFile} -> ${item.file}`)
    }
    const runtime = new Set(removed ? [] : consumers[item.file] ?? [])
    const baseRuntime = new Map(historical ? (previous[oldFile] ?? []).map(file => [surviving(file), file]) : [])
    for (const [file, oldTest] of baseRuntime) if (!all.includes(file) && !changed.some(change => change.status === 'D' && change.file === oldTest)) {
      relatedSelectionError(`Base test owner is not in current discovery: ${oldTest} -> ${file}`)
    }
    const policy = new Set([...policyConsumers(item.file, inventory), ...(historical ? policyConsumers(oldFile, inventory) : [])])
    const hits = new Set([...runtime, ...policy, ...baseRuntime.keys()].filter(file => all.includes(file)))
    if (!removed && all.includes(item.file)) hits.add(item.file)
    if (!hits.size) {
      // A removed standalone input/test can be retired only after proving that
      // no surviving runtime source or configured entry still refers to it.
      const liveDependents = historical ? [...previous.graph.keys()].filter(file => file !== oldFile
        && evidence.files.has(surviving(file)) && dependencyChain(previous.graph, file, oldFile)) : []
      const name = posix.basename(oldFile), stem = name.slice(0, name.length - posix.extname(name).length)
      const references = removed ? [...evidence.texts].filter(([file, source]) => file !== oldFile
        && (source.includes(name) || source.includes(stem))).map(([file]) => file) : []
      if (removed && evidence.previousTexts?.has(oldFile) && !liveDependents.length && !references.length) { retiredFiles.push(item.file); continue }
      relatedSelectionError(`Unmapped code/runtime input: ${oldFile}${item.oldFile ? ` -> ${item.file}` : ''}${liveDependents.length || references.length ? `; surviving references: ${[...new Set([...liveDependents, ...references])].join(', ')}` : ''}`)
    }
    for (const file of hits) {
      selectedCases[file] = inventory.find(item => item.file === file).names.map((_, i) => i)
      ;(reasons[file] ??= []).push(`Depends on or directly modified: ${oldFile}${item.oldFile ? ` -> ${item.file}` : ''}`)
      // Base chains retain original paths; only their executable test identity
      // is mapped through the actual Git rename records into head discovery.
      const source = !removed && file === item.file ? 'Direct modification'
        : runtime.has(file) ? 'Static Runtime Dependency'
        : baseRuntime.has(file) ? 'Base Runtime Dependency' : 'Explicit owner policy'
      const chain = source === 'Static Runtime Dependency' && consumers.graph ? dependencyChain(consumers.graph, file, item.file)
        : source === 'Base Runtime Dependency' ? dependencyChain(previous.graph, baseRuntime.get(file), oldFile) : null
      ;(details[file] ??= []).push({ changed: item.file, source, chain })
    }
  }
  return { ...behavior, mode: 'related', selected: Object.keys(reasons).sort(), selectedCases, reasons, details, typeOnlyFiles, retiredFiles,
    excludedCandidates: behavior.excludedCandidates?.filter(file => !Object.hasOwn(reasons, file)) }
}
// Human-readable selection evidence, derived only from the manifest (no test re-run).
function selectedNames(plan, file) {
  const names = plan.inventory.find(item => item.file === file)?.names ?? []
  return plan.mode === 'related' && plan.selectedCases?.[file]
    ? plan.selectedCases[file].map(index => names[index]) : names
}
function selectionSummary(plan) {
  const selected = plan.selected ?? []
  const total = selected.reduce((sum, file) => sum + selectedNames(plan, file).length, 0)
  return [
    `Mode: ${plan.mode === 'full' ? 'Full' : 'Related'}`,
    `Base SHA: ${plan.baseSha || '-'}; Head SHA: ${plan.headSha || '-'}`,
    `Changed Behavior: ${(plan.changedBehaviors ?? plan.changedFiles).slice(0, 8).join(', ') || (plan.typeOnlyFiles?.length ? 'Typecheck only (identical runtime)' : '-')}${(plan.changedBehaviors?.length ?? 0) > 8 ? ' (shared module behavior)' : ''}`,
    `Selected: ${selected.length} files / ${total} cases`,
    'Owners:', ...[...new Set(Object.values(plan.details ?? {}).flatMap(entries => entries.flatMap(entry => entry.owners ?? [])))].map(owner => `  ${owner}`),
    ...(plan.changedBehaviors?.length ? [] : selected.map(file => `  ${file}: ${selectedNames(plan, file).length} cases`)),
    `Excluded: ${plan.excludedCandidates?.length ?? 0} import-only candidate files`,
    ...(plan.retiredFiles?.length ? [`Retired (no surviving consumers): ${plan.retiredFiles.join(', ')}`] : []),
    `Conservative caller cases: ${Object.values(plan.details ?? {}).reduce((sum, entries) => sum + new Set(entries.flatMap(entry => entry.conservativeCases ?? [])).size, 0)}`,
    `Unmapped / Unsafe: ${plan.unsafe?.length ?? 0}`,
    `Budget: ${total} / ${plan.mode === 'related' ? MAX_CASES_PER_SHARD : 'Full per-shard 500'}`,
    `Shards: ${plan.shards.length}`, ...(plan.message ? [plan.message] : []),
  ].join('\n')
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
  if (plan.mode === 'full' && plan.selectedCases) throw new Error('Full must not use behavior filters')
  if (plan.selectedCases) {
    if (Object.keys(plan.selectedCases).sort().join('\n') !== [...plan.selected].sort().join('\n')) throw new Error('Missing or unexpected case selection')
    for (const [file, indices] of Object.entries(plan.selectedCases)) {
      const item = plan.inventory.find(item => item.file === file)
      if (!item || !Array.isArray(indices) || !indices.length || new Set(indices).size !== indices.length
        || indices.some(i => !Number.isInteger(i) || i < 0 || i >= item.names.length)) throw new Error('Invalid/duplicate selected leaf identity')
      if (indices.length !== item.names.length && (new Set(item.names).size !== item.names.length || item.nativeNames && new Set(item.nativeNames).size !== item.nativeNames.length)) throw new Error('Ambiguous partial leaf identity; select complete owner suite')
    }
  }
  if (!['full', 'related'].includes(plan.mode)) throw new Error('Invalid manifest mode')
  if (new Set(all).size !== all.length) throw new Error('Duplicate discovered file')
  const expected = plan.mode === 'full' ? all : plan.selected
  const assigned = plan.shards.flatMap(shard => [...shard.vitestFiles, ...shard.nodeFiles])
  if (new Set(plan.shards.map(s => s.id)).size !== plan.shards.length) throw new Error('Duplicate shard ID')
  if (new Set(assigned).size !== assigned.length || [...expected].sort().join('\n') !== [...assigned].sort().join('\n')) throw new Error('Missing, unexpected or duplicate assigned test files')
  if (!assigned.length && !(plan.mode === 'related' && plan.changedFiles.length && plan.changedFiles.every(file => docsOnly(file) || plan.typeOnlyFiles?.includes(file) || plan.retiredFiles?.includes(file)))) throw new Error('Empty code selection')
  if (plan.mode === 'related' && plan.shards.length > 1) throw new Error('Related mode must use one aggregate-limited shard')
  let total = 0
  for (const shard of plan.shards) {
    const files = [...shard.vitestFiles, ...shard.nodeFiles]
    const count = files.reduce((sum, file) => sum + selectedNames(plan, file).length, 0)
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
  return JSON.parse(execFileSync(process.execPath, ['tests/tooling/node-collect.cjs', ...files], { cwd: root, encoding: 'utf8' }))
}
async function discover({ relatedPaths = [] } = {}) {
  // Public Vitest 4.1 API, matching `vitest related` and `vitest list --json`.
  const { createVitest } = await import('vitest/node')
  const priorFiles = process.env.LOGIC_TEST_FILES
  delete process.env.LOGIC_TEST_FILES
  const ctx = await createVitest('test', { root, watch: false, includeTaskLocation: true, reporters: [], related: relatedPaths.map(file => resolve(root, file)) })
  try {
    const specs = await ctx.globTestSpecifications()
    const related = relatedPaths.length ? await ctx.getRelevantTestSpecifications() : []
    const { testModules, unhandledErrors } = await ctx.collectTests(specs)
    if (unhandledErrors.length) throw new Error(unhandledErrors.map(error => error.message).join('\n'))
    const inventory = testModules.map(module => {
      if (module.errors().length || [...module.children.allSuites()].some(s => s.errors().length)) throw new Error(`Collection error: ${module.moduleId}: ${JSON.stringify(module.errors())}`)
      const tests = [...module.children.allTests()]
      if (tests.some(test => test.result().state === 'skipped')) throw new Error(`Hidden Vitest registration: ${module.moduleId}`)
      const names = tests.map(test => test.fullName)
      const nativeNames = tests.map(test => {
        const parts = [test.name]
        for (let parent = test.parent; parent.type !== 'module'; parent = parent.parent) parts.unshift(parent.name)
        return parts.join(' ')
      })
      if (!names.length) throw new Error(`Empty test file: ${module.moduleId}`)
      return { runner: 'vitest', file: local(module.moduleId), names, nativeNames, locations: tests.map(test => test.location) }
    })
    if (inventory.length !== specs.length) throw new Error('Incomplete Vitest discovery')
    const node = discoverNode()
    return { inventory: [...inventory, ...node].sort((a, b) => a.file.localeCompare(b.file, 'en')), related: related.map(spec => local(spec.moduleId)) }
  } finally {
    await ctx.close()
    if (priorFiles !== undefined) process.env.LOGIC_TEST_FILES = priorFiles
  }
}
const sourceFile = file => /\.[cm]?[jt]sx?$/.test(file)
const testFile = file => /^tests\/.*\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file)
function snapshot(ref) {
  const files = new Set((ref ? git('ls-tree', '-r', '--name-only', ref) : git('ls-files')).split('\n').filter(Boolean))
  // Inspect every tracked text format for retirement/entry references (HTML,
  // CSS, extensionless build inputs, etc.), not just parsed JS/TS dependencies.
  const names = execFileSync('git', ['grep', '-I', '-l', '-z', '-e', '', ...(ref ? [ref] : []), '--'], { cwd: root, encoding: 'utf8' })
    .split('\0').filter(Boolean).map(file => ref ? file.slice(ref.length + 1) : file)
  const texts = new Map()
  if (ref) {
    // One Git read preserves the complete base tree, including removed helpers,
    // renamed tests, and existence of non-source dependency targets such as JSON.
    const output = execFileSync('git', ['cat-file', '--batch'], {
      cwd: root, input: names.map(file => `${ref}:${file}\n`).join(''), maxBuffer: 64 * 1024 * 1024,
    })
    let offset = 0
    for (const file of names) {
      const end = output.indexOf(10, offset)
      const header = output.subarray(offset, end).toString().split(' ')
      if (header[1] !== 'blob') relatedSelectionError(`Missing base blob: ${file}`)
      const size = Number(header[2])
      texts.set(file, output.subarray(end + 1, end + 1 + size).toString())
      offset = end + 2 + size
    }
  } else for (const file of names) if (existsSync(resolve(root, file))) texts.set(file, readFileSync(resolve(root, file), 'utf8'))
  for (const file of files) if (!ref && !existsSync(resolve(root, file))) files.delete(file)
  return { files, texts, sources: new Map([...texts].filter(([file]) => sourceFile(file))) }
}
function dependencyConsumers(inventory, tree = snapshot()) {
  return require('./dependencies.cjs').dependencyConsumers(inventory, tree.sources, file => tree.files.has(file))
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
  const documentation = changed.length > 0 && changed.every(item => docsOnly(item.file) && (!item.oldFile || docsOnly(item.oldFile)))
  if (documentation) return validateManifest({
    version: 1, planId: randomUUID(), requestedMode: mode, event, baseSha: base, headSha: head,
    checkoutSha, changedFiles: [...new Set(changed.flatMap(item => [item.file, ...(item.oldFile ? [item.oldFile] : [])]))].sort(), changes: changed, inventory: [],
    ...selectFiles([], changed, {}), shards: [],
  })
  const start = event === 'pull_request' ? git('merge-base', base, head) : base
  const currentTree = snapshot(), baseTree = snapshot(start)
  // Vitest's watch-mode force-rerun triggers are not runtime edges. Omit only
  // inputs proved byte-identical after Git-derived relocations from that query;
  // normal owner selection still processes them, and real config changes remain.
  const relocatedInputs = changed.filter(item => item.status === 'M' && require('./dependencies.cjs').relocationOnly(
    baseTree.texts.get(item.file), currentTree.texts.get(item.file), changed, baseTree.files, currentTree.files, item.file)).map(item => item.file)
  let found
  try { found = await discover({ relatedPaths: changed.filter(item => item.status !== 'D' && !relocatedInputs.includes(item.file)).map(item => item.file) }) }
  catch (error) { throw new Error(`Related dependency selection unavailable: ${error.message}. Full is reserved for main/release.`) }
  const consumers = dependencyConsumers(found.inventory, currentTree)
  const previousConsumers = dependencyConsumers([...baseTree.sources.keys()].filter(testFile).map(file => ({ file })), baseTree)
  const sources = currentTree.sources
  const previousSources = baseTree.sources
  const ranges = {}
  for (const item of changed.filter(item => ['A', 'M'].includes(item.status) && item.file.startsWith('src/') && /\.tsx?$/.test(item.file))) {
    const old = item.status === 'A' ? '' : execFileSync('git', ['show', `${start}:${item.file}`], { cwd: root, encoding: 'utf8' })
    previousSources.set(item.file, old)
    // Compare the tested checkout (PR merge ref) with the actual base source.
    // This also covers merge-ref edits and uncommitted representative probes.
    const diff = execFileSync('git', ['diff', '--no-ext-diff', '--unified=0', start, '--', item.file], { cwd: root, encoding: 'utf8' })
    ranges[item.file] = [[], []]
    for (const match of diff.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)) {
      ranges[item.file][0].push([+match[3], match[4] === undefined ? 1 : +match[4]])
      ranges[item.file][1].push([+match[1], match[2] === undefined ? 1 : +match[2]])
    }
    if (!ranges[item.file][0].length) relatedSelectionError(`Missing behavior diff: ${item.file}`)
  }
  const selection = selectFiles(found.inventory, changed, consumers, { sources, previousSources, ranges, previousConsumers, previousFiles: baseTree.files, previousTexts: baseTree.texts, files: currentTree.files, texts: currentTree.texts })
  // Native related results are candidates only. An unexplained native-only edge
  // is unsafe; never silently exclude it or unconditionally union it into leaves.
  for (const file of found.related) {
    if (!changed.some(item => (consumers[item.file] ?? []).includes(file) || policyConsumers(item.file, found.inventory).has(file) || item.file === file)) {
      relatedSelectionError(`Native-only dependency requires mapping: ${file}`)
    }
  }
  const selectedInventory = found.inventory.filter(item => selection.selected.includes(item.file))
    .map(item => ({ ...item, names: selection.selectedCases[item.file].map(i => item.names[i]) }))
  return validateManifest({
    version: 1, planId: randomUUID(), requestedMode: mode, event, baseSha: base, headSha: head,
    checkoutSha, changedFiles: [...new Set(changed.flatMap(item => [item.file, ...(item.oldFile ? [item.oldFile] : [])]))].sort(), changes: changed,
    inventory: found.inventory, ...selection, relocatedInputs, shards: planShards(selectedInventory, 'related'),
  })
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
  const evidence = `${selectionSummary(plan)}\nFallback: ${plan.fallback ?? 'none'}\n`
  console.log(evidence)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n### Logic test selection\n\n\`\`\`text\n${evidence}\`\`\`\n`)
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT,
    `matrix=${JSON.stringify({ include: plan.shards.map(shard => ({ shard: shard.id })) })}\nhas-tests=${plan.shards.length > 0}\n`)
})().catch(error => { console.error(error); process.exitCode = 1 })
module.exports = { snapshot, createPlan, shardFiles, planShards, validateManifest, selectFiles, selectionSummary, changes, options, discover, discoverNode, dependencyConsumers, docsOnly, selectedNames }
