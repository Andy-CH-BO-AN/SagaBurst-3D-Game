'use strict'
const { execFileSync } = require('node:child_process')
const { readdirSync, writeFileSync, mkdirSync, appendFileSync } = require('node:fs')
const { resolve, relative, dirname } = require('node:path')
const { randomUUID } = require('node:crypto')
const { MAX_CASES_PER_SHARD } = require('./budget.cjs')
const root = resolve(__dirname, '../..')
const slash = file => file.replaceAll('\\', '/')
const local = file => slash(relative(root, resolve(root, file)))
function walk(dir) {
  return readdirSync(resolve(root, dir), { withFileTypes: true }).flatMap(item =>
    item.isDirectory() ? walk(dir + '/' + item.name) : [dir + '/' + item.name]).sort()
}
function git(...args) { return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim() }
function comparisonStart(base, head, event) {
  if (!base || !head || /^0+$/.test(base)) throw new Error('Missing Git base/head for Related')
  git('cat-file', '-e', base + '^{commit}')
  git('cat-file', '-e', head + '^{commit}')
  return event === 'pull_request' ? git('merge-base', base, head) : base
}
function changes(base, head, event) {
  const start = comparisonStart(base, head, event)
  const raw = execFileSync('git', ['diff', '--name-status', '-z', '--find-renames', start, head],
    { cwd: root, encoding: 'utf8' }).split('\0')
  const result = []
  for (let i = 0; i < raw.length && raw[i];) {
    const status = raw[i++], old = raw[i++]
    if (/^[RC]/.test(status)) result.push({ status, oldFile: old, file: raw[i++] })
    else result.push({ status, file: old })
  }
  return result
}
const docsOnly = file => /^(README(?:\.[\w-]+)?\.md|(?:docs|ai_share)\/.*\.md|tests\/(?:AGENTS|tooling\/README)\.md|tools\/horse\/README\.md)$/.test(file)
  && !file.startsWith('docs/releases/')
const nonRuntimePath = file => docsOnly(file) || file === 'CLAUDE.md'
const cssPath = file => /^src\/.*\.css$/.test(file)
const skillLink = file => /^\.claude\/skills\/([A-Za-z0-9._-]+)$/.exec(file)

function modeAt(ref, file) {
  try {
    const raw = execFileSync('git', ['ls-tree', ref, '--', file], { cwd: root, encoding: 'utf8' })
    return /^(\d{6})\s/.exec(raw)?.[1] ?? ''
  } catch { return '' }
}
const regularAt = (ref, file) => modeAt(ref, file) === '100644'
function lifecycleRegular(change, start, head, pathCheck) {
  if (!pathCheck(change.file) || change.oldFile && !pathCheck(change.oldFile)) return false
  if (change.status === 'A') return regularAt(head, change.file)
  if (change.status === 'M') return regularAt(start, change.file) && regularAt(head, change.file)
  if (change.status === 'D') return regularAt(start, change.file)
  if (/^R\d+$/.test(change.status)) {
    return Boolean(change.oldFile) && regularAt(start, change.oldFile) && regularAt(head, change.file)
  }
  return false
}
function safeGitignoreChange(change, start, head) {
  if (change.file !== '.gitignore' || change.status !== 'M' ||
      !regularAt(start, change.file) || !regularAt(head, change.file)) return false
  const diff = execFileSync('git', ['diff', '--unified=0', start, head, '--', '.gitignore'],
    { cwd: root, encoding: 'utf8' })
  const edited = diff.split(/\r?\n/).filter(line =>
    (/^[+-]/.test(line) && !/^\+\+\+|^---/.test(line)))
  return edited.length > 0 && edited.every(line => {
    const value = line.slice(1).trim()
    return !value || value.startsWith('#') || value.startsWith('.claude/')
  })
}
function safeSkillChange(change, start, head) {
  const current = skillLink(change.file)
  const previous = change.oldFile ? skillLink(change.oldFile) : null
  if (change.status === 'A' && current) {
    if (modeAt(head, change.file) !== '120000') return false
    try {
      const target = git('show', head + ':' + change.file)
      const targetPath = 'ai_share/skills/' + current[1]
      return target === '../../' + targetPath &&
        git('cat-file', '-t', head + ':' + targetPath) === 'tree'
    } catch { return false }
  }
  if (change.status === 'D' && current) return modeAt(start, change.file) === '120000'
  // Modifying or renaming a symlink changes its target/identity: never whitelist it.
  return false
}
function safeNonRuntimeChange(change, start, head) {
  if (change.file === '.gitignore') return safeGitignoreChange(change, start, head)
  if (skillLink(change.file) || change.oldFile && skillLink(change.oldFile)) {
    return safeSkillChange(change, start, head)
  }
  return lifecycleRegular(change, start, head, nonRuntimePath)
}
function safeStyleChange(change, start, head) {
  return lifecycleRegular(change, start, head, cssPath)
}
function classifyRelated(changed, { base, head, event }) {
  const start = comparisonStart(base, head, event)
  const safe = new Set(), styles = new Set()
  changed.forEach((change, index) => {
    if (safeNonRuntimeChange(change, start, head)) safe.add(index)
    else if (safeStyleChange(change, start, head)) styles.add(index)
    else if (cssPath(change.file) || change.oldFile && cssPath(change.oldFile)) {
      throw new Error('Unsafe CSS lifecycle or file mode: ' +
        (change.oldFile ? change.oldFile + ' -> ' : '') + change.file)
    } else if (nonRuntimePath(change.file) || change.file === '.gitignore' ||
        skillLink(change.file) || change.oldFile && (nonRuntimePath(change.oldFile) || skillLink(change.oldFile))) {
      throw new Error('Non-runtime whitelist candidate failed regular-file/symlink policy: ' +
        (change.oldFile ? change.oldFile + ' -> ' : '') + change.file)
    }
  })
  if (safe.size === changed.length) {
    return { kind: 'non-runtime-only', needsSeed: false, selectorChanges: [] }
  }
  if (safe.size + styles.size === changed.length && styles.size > 0) {
    return { kind: 'style-only', needsSeed: false, selectorChanges: [] }
  }
  const selectorChanges = changed.filter((_, index) => !safe.has(index) && !styles.has(index))
  if (!selectorChanges.length) throw new Error('Related policy produced an empty unsafe selector set')
  return { kind: 'related', needsSeed: true, selectorChanges }
}

function discoverNode() {
  const files = walk('tests').filter(file => /\.test\.cjs$/.test(file))
  if (!files.length) throw new Error('Node tooling tests missing')
  return JSON.parse(execFileSync(process.execPath, ['tests/tooling/node-collect.cjs', ...files],
    { cwd: root, encoding: 'utf8' }))
}
async function discover() {
  const { createVitest } = await import('vitest/node')
  const previous = process.env.LOGIC_TEST_FILES
  delete process.env.LOGIC_TEST_FILES
  const ctx = await createVitest('test', { root, watch: false, includeTaskLocation: true, reporters: [] })
  try {
    const specs = await ctx.globTestSpecifications()
    const { testModules, unhandledErrors } = await ctx.collectTests(specs)
    if (unhandledErrors.length) throw new Error(unhandledErrors.map(error => error.message).join('\n'))
    const vitest = testModules.map(module => {
      if (module.errors().length || [...module.children.allSuites()].some(s => s.errors().length)) {
        throw new Error('Collection error: ' + module.moduleId)
      }
      const tests = [...module.children.allTests()]
      if (!tests.length || tests.some(test => test.result().state === 'skipped')) {
        throw new Error('Empty or skipped registration: ' + module.moduleId)
      }
      const names = tests.map(test => test.fullName)
      const nativeNames = tests.map(test => {
        const parts = [test.name]
        for (let parent = test.parent; parent.type !== 'module'; parent = parent.parent) parts.unshift(parent.name)
        return parts.join(' ')
      })
      return { runner: 'vitest', file: local(module.moduleId), names, nativeNames,
        locations: tests.map(test => test.location) }
    })
    if (vitest.length !== specs.length) throw new Error('Incomplete Vitest collection')
    return [...vitest, ...discoverNode()].sort((a, b) => a.file.localeCompare(b.file, 'en'))
  } finally {
    await ctx.close()
    if (previous !== undefined) process.env.LOGIC_TEST_FILES = previous
  }
}
function selectedNames(plan, file) {
  const item = plan.inventory.find(item => item.file === file)
  if (!item) throw new Error('Missing inventory identity: ' + file)
  return plan.mode === 'related' && plan.selectedCases?.[file]
    ? plan.selectedCases[file].map(index => item.names[index]) : item.names
}
function shardFiles(files) {
  const result = []
  for (const file of [...files].sort((a, b) => a.file.localeCompare(b.file, 'en'))) {
    if (!file.names?.length || file.names.length > MAX_CASES_PER_SHARD) {
      throw new Error('File exceeds 500 leaves or is empty: ' + file.file)
    }
    let shard = result.at(-1)
    if (!shard || shard.expectedCount + file.names.length > MAX_CASES_PER_SHARD) {
      shard = { id: 'logic-' + (result.length + 1), vitestFiles: [], nodeFiles: [], expectedCount: 0 }
      result.push(shard)
    }
    shard[file.runner === 'node' ? 'nodeFiles' : 'vitestFiles'].push(file.file)
    shard.expectedCount += file.names.length
  }
  return result
}
function planShards(files, mode) {
  if (mode === 'full') return shardFiles(files)
  const sorted = [...files].sort((a, b) => a.file.localeCompare(b.file, 'en'))
  const total = sorted.reduce((sum, item) => sum + item.names.length, 0)
  // Aggregate limit is checked before any shard is created.
  if (total > MAX_CASES_PER_SHARD) {
    throw new Error('Related selection exceeds the 500-leaf limit: ' + total +
      ' affected leaves. Split/refactor the PR; no Full fallback or shard bypass.')
  }
  if (!sorted.length) return []
  if (sorted.some(item => !item.names?.length)) throw new Error('Empty selected test file')
  return [{ id: 'logic-related',
    vitestFiles: sorted.filter(item => item.runner === 'vitest').map(item => item.file),
    nodeFiles: sorted.filter(item => item.runner === 'node').map(item => item.file),
    expectedCount: total }]
}
function validateManifest(plan) {
  if (!['related', 'full'].includes(plan.mode) || !Array.isArray(plan.inventory) ||
    !Array.isArray(plan.selected) || !Array.isArray(plan.shards)) throw new Error('Invalid plan')
  if (plan.mode === 'full' && plan.selectedCases) throw new Error('Full cannot filter individual tests')
  const files = plan.inventory.map(item => item.file)
  if (new Set(files).size !== files.length) throw new Error('Duplicate inventory files')
  if (plan.selectedCases) {
    if (Object.keys(plan.selectedCases).sort().join('|') !== [...plan.selected].sort().join('|')) {
      throw new Error('Missing or unexpected exact selection')
    }
    for (const [file, indices] of Object.entries(plan.selectedCases)) {
      const item = plan.inventory.find(item => item.file === file)
      if (!item || !Array.isArray(indices) || !indices.length || new Set(indices).size !== indices.length ||
        indices.some(i => !Number.isInteger(i) || i < 0 || i >= item.names.length)) {
        throw new Error('Invalid selected test identity: ' + file)
      }
      if (indices.length < item.names.length && (new Set(item.names).size !== item.names.length ||
        (item.nativeNames && new Set(item.nativeNames).size !== item.nativeNames.length))) {
        throw new Error('Ambiguous partial leaf identity: ' + file)
      }
    }
  }
  const expected = plan.mode === 'full' ? files : plan.selected
  const assigned = plan.shards.flatMap(shard => [...shard.vitestFiles, ...shard.nodeFiles])
  if (new Set(plan.shards.map(s => s.id)).size !== plan.shards.length ||
      new Set(assigned).size !== assigned.length ||
      expected.slice().sort().join('|') !== assigned.slice().sort().join('|')) {
    throw new Error('Missing/duplicate/unexpected test file assignment')
  }
  const count = plan.shards.reduce((sum, shard) => {
    const filesInShard = [...shard.vitestFiles, ...shard.nodeFiles]
    const leaves = filesInShard.reduce((subtotal, file) => subtotal + selectedNames(plan, file).length, 0)
    if (!leaves || leaves > MAX_CASES_PER_SHARD || leaves !== shard.expectedCount) {
      throw new Error('Invalid shard leaf budget')
    }
    for (const file of shard.vitestFiles) {
      if (plan.inventory.find(item => item.file === file)?.runner !== 'vitest') throw new Error('Wrong Vitest runner assignment')
    }
    for (const file of shard.nodeFiles) {
      if (plan.inventory.find(item => item.file === file)?.runner !== 'node') throw new Error('Wrong Node runner assignment')
    }
    return sum + leaves
  }, 0)
  if (plan.mode === 'related' && (plan.shards.length > 1 || count > MAX_CASES_PER_SHARD)) {
    throw new Error('Related aggregate exceeds 500')
  }
  if (!assigned.length && !(plan.mode === 'related' &&
      (plan.docsOnly || plan.nonRuntimeOnly || plan.styleOnly))) throw new Error('Empty code selection')
  return plan
}
function selectionSummary(plan) {
  const total = plan.inventory.reduce((sum, item) => sum + item.names.length, 0)
  const count = plan.selected.reduce((sum, file) => sum + selectedNames(plan, file).length, 0)
  const pct = total ? (100 * count / total).toFixed(1) : '0.0'
  return [
    'Mode: ' + (plan.mode === 'full' ? 'Full' : 'Related'),
    'Selection source: ' + (plan.source || (plan.styleOnly ? 'CSS-only web build/static validation'
      : plan.nonRuntimeOnly ? 'Strict non-runtime-only policy'
      : plan.docsOnly ? 'Docs only' : 'Explicit Full')),
    'Base SHA: ' + (plan.baseSha || '-') + '; Head SHA: ' + (plan.headSha || '-'),
    'Total suite: ' + total + ' leaves; Selected: ' + count + ' leaves (' + pct + '%); Files: ' + plan.selected.length,
    'Related health: ' + (count > 500 ? 'FAIL' : count > 300 ? 'Very broad' : count > 200 ? 'Broad' : count > 100 ? 'Normal' : 'Excellent'),
    'Aggregate cap: ' + (plan.mode === 'related' ? '500 hard limit' : 'Full per-shard 500'),
    ...(plan.native ? ['Supercov ' + plan.supercovRun + ': affected ' + plan.native.affected +
      ', undetermined ' + plan.native.undetermined + ', run-wide: ' + (plan.native.runWide.join(', ') || 'none')] : []),
    'Shards: ' + plan.shards.length,
    'Fallback: none',
  ].join('\n')
}
async function createPlan({ mode = 'full', base = '', head = '', event = 'local' } = {}) {
  if (!['related', 'full'].includes(mode)) throw new Error('Unknown test mode')
  const checkoutSha = git('rev-parse', 'HEAD')
  if (mode === 'full') {
    const inventory = await discover()
    return validateManifest({
      version: 1, planId: randomUUID(), requestedMode: mode, mode, event,
      baseSha: base, headSha: head, checkoutSha, changedFiles: [], changes: [], inventory,
      selected: inventory.map(item => item.file), reasons: {},
      shards: planShards(inventory, 'full'), fallback: null,
    })
  }
  let changed
  try { changed = changes(base, head, event) }
  catch (error) { throw new Error('Related Git history unavailable: ' + error.message) }
  if (!changed.length) throw new Error('Related change evidence empty; refusing unknown selection')
  const changedFiles = [...new Set(changed.flatMap(item => [item.file, ...(item.oldFile ? [item.oldFile] : [])]))].sort()
  const classification = classifyRelated(changed, { base, head, event })
  if (classification.kind !== 'related') {
    const isDocsOnly = changed.every(item => docsOnly(item.file) && (!item.oldFile || docsOnly(item.oldFile)))
    return validateManifest({
      version: 1, planId: randomUUID(), requestedMode: mode, mode, event,
      baseSha: base, headSha: head, checkoutSha, changedFiles, changes: changed,
      docsOnly: isDocsOnly, nonRuntimeOnly: classification.kind === 'non-runtime-only',
      styleOnly: classification.kind === 'style-only',
      source: classification.kind === 'style-only' ? 'CSS-only web build/static validation'
        : 'Strict non-runtime-only policy',
      inventory: [], selected: [], reasons: {}, fallback: null, shards: [],
    })
  }
  const inventory = await discover()
  const selection = require('./supercov-related.cjs').nativeSelection(
    inventory, classification.selectorChanges, { base, event })
  const selectedInventory = inventory.filter(item => selection.selected.includes(item.file))
    .map(item => ({ ...item, names: selection.selectedCases[item.file].map(i => item.names[i]) }))
  return validateManifest({
    version: 1, planId: randomUUID(), requestedMode: mode, event, baseSha: base, headSha: head,
    checkoutSha, changedFiles, changes: changed, inventory, ...selection,
    shards: planShards(selectedInventory, 'related'),
  })
}
function options(args) {
  const result = {}
  for (let i = 0; i < args.length; i += 2) {
    if (!/^--[a-z-]+$/.test(args[i]) || args[i + 1] === undefined) throw new Error('Invalid option: ' + args[i])
    result[args[i].slice(2)] = args[i + 1]
  }
  return result
}
if (require.main === module) (async () => {
  const args = options(process.argv.slice(2))
  if (args.preflight === 'true') {
    const changed = changes(args.base, args.head, args.event)
    if (!changed.length) throw new Error('Related change evidence empty; refusing unknown selection')
    const policy = classifyRelated(changed, { base: args.base, head: args.head, event: args.event })
    const message = 'Related preflight policy: ' + policy.kind + '; seed=' +
      (policy.needsSeed ? 'required' : 'not required')
    console.log(message)
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      '\n### Related preflight\n\n' + message + '\n')
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT,
      'needs-seed=' + policy.needsSeed + '\npolicy=' + policy.kind + '\n')
    return
  }
  const plan = await createPlan(args)
  const out = args.out ?? 'output/test-plan.json'
  mkdirSync(dirname(resolve(root, out)), { recursive: true })
  writeFileSync(out, JSON.stringify(plan, null, 2))
  const message = selectionSummary(plan) + '\n'
  console.log(message)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    '\n### Logic test selection\n\n\`\`\`text\n' + message + '\`\`\`\n')
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT,
    'matrix=' + JSON.stringify({ include: plan.shards.map(shard => ({ shard: shard.id })) }) +
    '\nhas-tests=' + (plan.shards.length > 0) + '\n')
})().catch(error => { console.error(error); process.exitCode = 1 })
module.exports = { createPlan, discover, discoverNode, docsOnly, nonRuntimePath, cssPath,
  classifyRelated, changes, options, shardFiles, planShards, selectedNames,
  selectionSummary, validateManifest }
