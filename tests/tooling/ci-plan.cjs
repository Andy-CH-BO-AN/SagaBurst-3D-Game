'use strict'
const { execFileSync } = require('node:child_process')
const { readdirSync, writeFileSync, mkdirSync, appendFileSync } = require('node:fs')
const { resolve, relative, dirname } = require('node:path')
const { randomUUID } = require('node:crypto')
const { MAX_RELATED_CASES } = require('./budget.cjs')
const root = resolve(__dirname, '../..')
const slash = file => file.replaceAll('\\', '/')
const local = file => slash(relative(root, resolve(root, file)))
function walk(dir) {
  return readdirSync(resolve(root, dir), { withFileTypes: true }).flatMap(item =>
    item.isDirectory() ? walk(dir + '/' + item.name) : [dir + '/' + item.name]).sort()
}
function git(...args) { return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim() }
function changes(base, head, event) {
  if (!base || !head || /^0+$/.test(base)) throw new Error('Missing Git base/head for Related')
  git('cat-file', '-e', base + '^{commit}')
  git('cat-file', '-e', head + '^{commit}')
  const start = event === 'pull_request' ? git('merge-base', base, head) : base
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
const docsOnly = file => /^(README(?:\.[\w-]+)?\.md|(?:docs|ai_share)\/.*\.md|tests\/(?:AGENTS|tooling\/README)\.md|tools\/horse\/README\.md|CLAUDE\.md|\.claude\/[\w/-]+\.md)$/.test(file)
  && !file.startsWith('docs/releases/')
const cssOnlyAsset = file => /^src\/ui\/[\w/-]+\.css$/.test(file)
// The exact same decision powers pre-seed gating and final planning.
// Reject unknown inputs, deletes/renames and link-target changes; only verified
// new agent-skill links to unchanged existing repo directories are safe.
function regularTrackedFile(sha, file) {
  const raw = git('ls-tree', sha, '--', file)
  return /^100644 blob [0-9a-f]{40}\t/.test(raw)
}
function safeGitignore(base, head) {
  const diff = execFileSync('git', ['diff', '--unified=0', base, head, '--', '.gitignore'],
    { cwd: root, encoding: 'utf8' })
  const lines = diff.split('\n')
  // A safe addition only hides ephemeral Claude local state, not code or assets.
  if (lines.some(line => line.startsWith('-') && !line.startsWith('---'))) return false
  return lines.some(line => line.startsWith('+') && !line.startsWith('+++')) &&
    lines.filter(line => line.startsWith('+') && !line.startsWith('+++'))
      .every(line => /^\+(?:#.*|\s*|\.claude\/worktrees\/|\.claude\/settings\.local\.json)$/.test(line))
}
// A new Claude skill alias cannot change runtime code: its exact link target
// must be a pre-existing agent-only directory with unchanged tree SHA.
// Read the symlink blob as raw bytes: the regular git() helper trims whitespace
// and would incorrectly accept a different target ending in spaces/newlines.
function readLinkBlob(sha, file) {
  return execFileSync('git', ['show', sha + ':' + file], { cwd: root })
}
function safeNewAgentLink(base, head, file, readGit = git, readLink = readLinkBlob) {
  if (!/^\.claude\/skills\/[a-z0-9][a-z0-9-]*$/.test(file)) return false
  const name = file.slice('.claude/skills/'.length)
  const target = 'ai_share/skills/' + name
  try {
    if (!/^120000 blob [0-9a-f]{40}\t/.test(readGit('ls-tree', head, '--', file))) return false
    const pointer = readLink(head, file)
    if (!Buffer.isBuffer(pointer) ||
        !pointer.equals(Buffer.from('../../' + target, 'utf8'))) return false
    const original = readGit('ls-tree', base, '--', target)
    return /^040000 tree [0-9a-f]{40}\t/.test(original) &&
      original === readGit('ls-tree', head, '--', target)
  } catch { return false }
}
function noSeedPolicy(changed, base, head, {
  regular = regularTrackedFile, gitignore = safeGitignore,
  agentLink = safeNewAgentLink,
} = {}) {
  if (!changed.length) return null
  let hasCss = false
  for (const change of changed) {
    if (!/^(A|M)$/.test(change.status) || change.oldFile) return null
    if (change.status === 'A' && agentLink(base, head, change.file)) continue
    if (!regular(head, change.file) ||
        (change.status === 'M' && !regular(base, change.file))) return null
    if (cssOnlyAsset(change.file)) { hasCss = true; continue }
    if (docsOnly(change.file)) continue
    if (change.file === '.gitignore' && gitignore(base, head)) continue
    return null
  }
  return hasCss ? 'css-only' : 'docs-only'
}
function probeSeed({mode, base, head, event}) {
  if (mode !== 'related') return true
  return !noSeedPolicy(changes(base, head, event), base, head)
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
function selectedCount(plan) {
  return plan.selected.reduce((sum, file) => sum + selectedNames(plan, file).length, 0)
}
function requireRelatedBudget(count) {
  if (count > MAX_RELATED_CASES) {
    throw new Error('Related selection exceeds the ' + MAX_RELATED_CASES + '-case limit: ' + count +
      ' unique cases. Split the feature PR; no Full fallback or second run bypass.')
  }
}
function validateManifest(plan) {
  if (!['related', 'full'].includes(plan.mode) || !Array.isArray(plan.inventory) ||
    !Array.isArray(plan.selected)) throw new Error('Invalid plan')
  // A manifest has exactly one execution. Splitting one is how a limit gets dodged.
  if (Object.hasOwn(plan, 'shards')) throw new Error('Logic plans cannot be sharded')
  if (plan.mode === 'full' && plan.selectedCases) throw new Error('Full cannot filter individual tests')
  const files = plan.inventory.map(item => item.file)
  if (new Set(files).size !== files.length) throw new Error('Duplicate inventory files')
  if (plan.inventory.some(item => !item.names?.length)) throw new Error('Empty test file in inventory')
  if (new Set(plan.selected).size !== plan.selected.length ||
      plan.selected.some(file => !files.includes(file))) {
    throw new Error('Missing/duplicate/unexpected test file selection')
  }
  if (plan.mode === 'full' && plan.selected.length !== files.length) {
    throw new Error('Missing/duplicate/unexpected test file selection')
  }
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
  const count = selectedCount(plan)
  if (count !== plan.expectedCount) throw new Error('Plan expected case count disagrees with its selection')
  if (plan.mode === 'related') requireRelatedBudget(count)
  if (!count && !(plan.mode === 'related' && (plan.docsOnly || plan.cssOnly))) throw new Error('Empty code selection')
  return plan
}
function relatedSelectionLines(plan) {
  const b = plan.breakdown
  if (!b) return []
  return [
    'Related selection:',
    '  Native affected runnable cases: ' + b.nativeAffected,
    '  Native undetermined runnable cases: ' + b.nativeUndetermined,
    '  Added/modified test cases: ' + b.directTests,
    '  Fixed Node contracts: ' + b.nodeContracts,
    '  Duplicates removed: ' + b.duplicatesRemoved,
    '  Final unique selected cases: ' + b.total + ' / ' + MAX_RELATED_CASES,
    ...(plan.newSources ?? []).map(item => 'New runtime source ' + item.file + ': ' + item.verdict),
  ]
}
function selectionSummary(plan) {
  const total = plan.inventory.reduce((sum, item) => sum + item.names.length, 0)
  const count = selectedCount(plan)
  const pct = total ? (100 * count / total).toFixed(1) : '0.0'
  return [
    'Mode: ' + (plan.mode === 'full' ? 'Full' : 'Related'),
    'Selection source: ' + (plan.source || (plan.docsOnly ? 'Safe documents / agent config' : plan.cssOnly ? 'CSS-only: Web build and static validation' : 'Explicit Full')),
    'Base SHA: ' + (plan.baseSha || '-') + '; Head SHA: ' + (plan.headSha || '-'),
    'Total suite: ' + total + ' leaves; Selected: ' + count + ' leaves (' + pct + '%); Files: ' + plan.selected.length,
    'Related health: ' + (plan.mode !== 'related' ? 'N/A' : count > 500 ? 'FAIL' : count > 300 ? 'Very broad' : count > 200 ? 'Broad' : count > 100 ? 'Normal' : 'Excellent'),
    'Case limit: ' + (plan.mode === 'related' ? MAX_RELATED_CASES + ' hard limit' : 'none (Full runs everything)'),
    ...(plan.native ? ['Supercov ' + plan.supercovRun + ': affected ' + plan.native.affected +
      ', undetermined ' + plan.native.undetermined + ', run-wide: ' + (plan.native.runWide.join(', ') || 'none')] : []),
    ...relatedSelectionLines(plan),
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
      selected: inventory.map(item => item.file), reasons: {}, fallback: null,
      expectedCount: inventory.reduce((sum, item) => sum + item.names.length, 0),
    })
  }
  let changed
  try { changed = changes(base, head, event) }
  catch (error) { throw new Error('Related Git history unavailable: ' + error.message) }
  if (!changed.length) throw new Error('Related change evidence empty; refusing unknown selection')
  const changedFiles = [...new Set(changed.flatMap(item => [item.file, ...(item.oldFile ? [item.oldFile] : [])]))].sort()
  const noSeed = noSeedPolicy(changed, base, head)
  if (noSeed) {
    return validateManifest({
      version: 1, planId: randomUUID(), requestedMode: mode, mode, event,
      baseSha: base, headSha: head, checkoutSha, changedFiles, changes: changed,
      docsOnly: noSeed === 'docs-only', cssOnly: noSeed === 'css-only',
      inventory: [], selected: [], reasons: {}, fallback: null, expectedCount: 0,
    })
  }
  const inventory = await discover()
  const selection = require('./supercov-related.cjs').nativeSelection(inventory, changed, { base, event })
  const expectedCount = selection.selected.reduce((sum, file) => sum + selection.selectedCases[file].length, 0)
  return validateManifest({
    version: 1, planId: randomUUID(), requestedMode: mode, event, baseSha: base, headSha: head,
    checkoutSha, changedFiles, changes: changed, inventory, ...selection, expectedCount,
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
  if (args.probe === 'seed') {
    const required = probeSeed(args)
    const message = 'requires-seed=' + required + '\n'
    process.stdout.write(message)
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, message)
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
    'has-tests=' + (plan.expectedCount > 0) + '\n')
})().catch(error => { console.error(error); process.exitCode = 1 })
module.exports = { createPlan, discover, discoverNode, docsOnly, changes, options,
  requireRelatedBudget, selectedNames, selectionSummary, validateManifest,
  regularTrackedFile, safeGitignore, safeNewAgentLink, noSeedPolicy, probeSeed }
