const childProcess = require('node:child_process')
const { resolve } = require('node:path')
const defaultRoot = resolve(__dirname, '../..')
function git(root, ...args) {
  return childProcess.execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim()
}
// This pure boundary makes the accepted lineage explicit; event metadata is
// never substituted for the first parent of the commit actually under test.
function comparisonLineage({ event, base, head, checkout, parents = [], intentBase, targetDescendsFromEventBase }) {
  if (!base || !head || /^0+$/.test(base)) throw new Error('Missing base/head SHA or initial push')
  const metadata = { eventBaseSha: base, requestedHeadSha: head, checkoutSha: checkout }
  if (event === 'pull_request') {
    if (parents.length !== 2 || parents[1] !== head) throw new Error('Invalid PR tested merge lineage: expected two parents with requested head as second parent')
    if (!intentBase) throw new Error('Missing PR intent merge-base history')
    if (base !== parents[0] && targetDescendsFromEventBase !== true) throw new Error('Unsupported PR target lineage: event base is not a verified ancestor of tested target parent (rewritten or unrelated target history)')
    return { ...metadata, kind: 'pr-tested-merge', beforeSha: parents[0], afterSha: checkout,
      targetParentSha: parents[0], eventBaseMismatch: base !== parents[0], targetDescendsFromEventBase: true,
      intent: { beforeSha: intentBase, afterSha: head } }
  }
  if (checkout !== head) throw new Error('Snapshot mismatch: checkout must equal requested head')
  if (event === 'push') return { ...metadata, kind: 'push-event', beforeSha: base, afterSha: head }
  if (event !== 'local') throw new Error(`Unsupported comparison event: ${event}`)
  if (!intentBase) throw new Error('Missing local intent merge-base history')
  return { ...metadata, kind: 'local-head-intent', beforeSha: intentBase, afterSha: head,
    intent: { beforeSha: intentBase, afterSha: head } }
}
function assertCleanCheckout(root = defaultRoot, expectedSha) {
  if (expectedSha && git(root, 'rev-parse', 'HEAD') !== expectedSha) throw new Error('Stale checkout: manifest is for a different commit')
  if (git(root, 'status', '--porcelain', '--untracked-files=all')) throw new Error('Snapshot mismatch: tracked or untracked working-tree changes; commit or isolate the analysis snapshot')
}
function comparison({ base, head, event = 'local', repositoryRoot = defaultRoot }) {
  if (!base || !head || /^0+$/.test(base)) throw new Error('Missing base/head SHA or initial push')
  // rev-parse verifies availability and normalizes abbreviated refs once. All
  // subsequent file, source, AST and rename reads use these immutable objects.
  base = git(repositoryRoot, 'rev-parse', '--verify', `${base}^{commit}`)
  head = git(repositoryRoot, 'rev-parse', '--verify', `${head}^{commit}`)
  const checkout = git(repositoryRoot, 'rev-parse', '--verify', 'HEAD^{commit}')
  const parents = git(repositoryRoot, 'show', '-s', '--format=%P', checkout).split(' ').filter(Boolean)
  const intentBase = event === 'pull_request' || event === 'local' ? git(repositoryRoot, 'merge-base', base, head) : undefined
  let targetDescendsFromEventBase
  if (event === 'pull_request' && parents.length === 2 && base !== parents[0]) {
    try {
      git(repositoryRoot, 'merge-base', '--is-ancestor', base, parents[0])
      targetDescendsFromEventBase = true
    } catch (error) {
      if (error.status !== 1) throw error // Missing history is not a negative ancestry proof.
      targetDescendsFromEventBase = false
    }
  }
  const result = comparisonLineage({ event, base, head, checkout, parents, intentBase, targetDescendsFromEventBase })
  // A shallow boundary can appear parentless; resolving every selected parent
  // explicitly ensures missing history fails before collection or selection.
  git(repositoryRoot, 'cat-file', '-e', `${result.beforeSha}^{commit}`)
  assertCleanCheckout(repositoryRoot, checkout)
  return result
}
function changedFiles(before, after, root = defaultRoot) {
  const entries = childProcess.execFileSync('git', ['diff', '--no-ext-diff', '--name-status', '-z', '--find-renames', before, after], { cwd: root, encoding: 'utf8' }).split('\0')
  const result = []
  for (let i = 0; i < entries.length && entries[i];) {
    const status = entries[i++], file = entries[i++]
    if (/^[RC]/.test(status)) result.push({ status, oldFile: file, file: entries[i++] })
    else result.push({ status, file })
  }
  return result
}
function diffRanges(before, after, file, root = defaultRoot) {
  const diff = childProcess.execFileSync('git', ['diff', '--no-ext-diff', '--no-textconv', '--unified=0', before, after, '--', file], { cwd: root, encoding: 'utf8' })
  const ranges = [[], []]
  for (const match of diff.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)) {
    ranges[0].push([+match[3], match[4] === undefined ? 1 : +match[4]])
    ranges[1].push([+match[1], match[2] === undefined ? 1 : +match[2]])
  }
  return ranges
}
module.exports = { comparisonLineage, comparison, assertCleanCheckout, changedFiles, diffRanges }
