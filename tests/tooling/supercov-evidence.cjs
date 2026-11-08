'use strict'
// A seed artifact is repository-scoped; unlike branch/PR GitHub caches it is
// readable by a later dev push or sibling PR. All trust checks are fail-closed.
const { execFileSync, spawnSync } = require('node:child_process')
const { existsSync, readFileSync, mkdirSync, rmSync } = require('node:fs')
const { resolve, join } = require('node:path')
const { isGitAncestor, requireExactBaseSeed, trustedPublication } = require('./supercov-evidence-policy.cjs')
const { validSeedMetadata } = require('./supercov-measured-evidence.cjs')
const root = resolve(__dirname, '../..')
const fail = message => { throw new Error('Supercov evidence artifact unsafe: ' + message) }
if (process.argv[2] !== 'restore' || process.env.GITHUB_ACTIONS !== 'true' ||
    !process.env.GH_TOKEN || !process.env.GITHUB_REPOSITORY) {
  fail('Artifact restore only runs in authorized GitHub Actions Related planning')
}
const repo = process.env.GITHUB_REPOSITORY
const read = file => JSON.parse(readFileSync(resolve(root, file), 'utf8'))
const sha = /^[0-9a-f]{40}$/
const seedFile = 'output/supercov-seed.json'
const comparisonBase = process.env.SUPERCOV_EVIDENCE_BASE
const checkoutHead = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' })
if (!sha.test(comparisonBase || '') || checkoutHead.status !== 0) {
  fail('Missing verified PR/dev TEST_BASE; refusing feature-branch evidence')
}
const headSha = checkoutHead.stdout.trim()
const exactBase = candidate => candidate === comparisonBase &&
  isGitAncestor(comparisonBase, headSha, root)
function seedOk(expectedSha) {
  if (!existsSync(resolve(root, seedFile))) return false
  try {
    const seed = read(seedFile)
    return validSeedMetadata(seed) && seed.sha === expectedSha &&
      exactBase(seed.sha) && /^run_[a-z0-9]+$/i.test(seed.runId) &&
      existsSync(resolve(root, '.supercov/runs', seed.runId))
  } catch { return false }
}
// Do not accept a branch-scoped cache or preexisting unverified local seed.
 // Only a verified canonical GitHub Actions artifact can supply the baseline.
function gh(args) {
  const run = spawnSync('gh', args, { cwd: root, encoding: 'utf8',
    maxBuffer: 12 * 1024 * 1024, env: process.env })
  if (run.status !== 0 || run.error) fail('GitHub artifact lookup failed: ' +
    (run.stderr || run.error?.message || run.status))
  return run.stdout
}
const candidates = []
for (let page = 1; page <= 10; page++) {
  const data = JSON.parse(gh(['api', 'repos/' + repo +
    '/actions/artifacts?per_page=100&page=' + page]))
  if (!Array.isArray(data.artifacts)) fail('GitHub artifacts API returned no list')
  for (const item of data.artifacts) {
    const name = item.name || ''
    const match = /^supercov-seed-([0-9a-f]{40})$/.exec(name)
    if (match && item.expired === false && exactBase(match[1]) &&
      Number.isSafeInteger(item.workflow_run?.id)) {
      candidates.push({ name, sha: match[1], runId: item.workflow_run.id,
        timestamp: item.created_at, id: item.id })
    }
  }
  if (data.artifacts.length < 100) break
}
candidates.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
for (const candidate of candidates) {
  const workflow = JSON.parse(gh(['api', 'repos/' + repo +
    '/actions/runs/' + candidate.runId]))
  if (!trustedPublication(workflow, candidate.sha)) continue
  const target = resolve(root, 'output/supercov-artifact-restore')
  rmSync(target, { recursive: true, force: true })
  mkdirSync(target, { recursive: true })
  const download = spawnSync('gh', ['run', 'download', String(candidate.runId),
    '--repo', repo, '--name', candidate.name, '--dir', target],
    { cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024, env: process.env })
  if (download.status !== 0 || download.error) fail('Cannot download candidate artifact: ' + candidate.name)
  const archive = join(target, 'supercov-evidence.tar.gz')
  if (!existsSync(archive)) fail('Candidate seed archive missing: ' + candidate.name)
  const listing = execFileSync('tar', ['-tzf', archive], { cwd: root, encoding: 'utf8' }).trim().split('\n')
  if (!listing.length || listing.some(entry => !(
      entry === '.supercov/runs' || entry.startsWith('.supercov/runs/') ||
      entry === 'output/supercov-seed.json') ||
      entry.startsWith('/') || entry.split('/').includes('..'))) {
    fail('Seed archive contains unexpected paths')
  }
  rmSync(resolve(root, '.supercov/runs'), { recursive: true, force: true })
  rmSync(resolve(root, seedFile), { force: true })
  execFileSync('tar', ['-xzf', archive, '-C', root], { cwd: root })
  // Repeat exact PR-base verification on extracted bytes; filename alone
  // cannot attest the seed lineage.
  const extracted = read(seedFile)
  requireExactBaseSeed(extracted.sha, comparisonBase)
  if (!seedOk(candidate.sha)) fail('Downloaded seed is untrusted or differs from exact PR base')
  const seed = read(seedFile)
  console.log('Restored repository-scoped Supercov seed ' + seed.runId +
    ' @ ' + seed.sha + ' from Actions run ' + candidate.runId)
  process.exit(0)
}
// A failed/pending Full is a blocker, not a gameplay-test failure in this PR.
let diagnostic = 'No matching canonical dev Full run was found'
try {
  const history = JSON.parse(gh(['api', 'repos/' + repo +
    '/actions/workflows/ci.yml/runs?branch=dev&event=push&head_sha=' +
    comparisonBase + '&per_page=30']))
  const runs = (history.workflow_runs ?? []).filter(item =>
    item.head_sha === comparisonBase && item.event === 'push' && item.head_branch === 'dev')
  if (runs.length) {
    const mostRecent = runs.sort((a,b) => b.run_number - a.run_number)[0]
    diagnostic = 'Canonical dev Full run ' + mostRecent.id + ' (status=' +
      mostRecent.status + ', conclusion=' + (mostRecent.conclusion ?? 'pending') + ')'
    if (mostRecent.status === 'completed' && mostRecent.conclusion === 'success')
      diagnostic += '; artifact is missing/expired/untrusted or publisher did not finish'
    else if (mostRecent.status === 'completed')
      diagnostic += '; Full gate failed, so no seed may be published'
    else diagnostic += '; Full gate has not completed'
  }
} catch (error) { diagnostic += '; workflow lookup: ' + error.message }
fail('exact dev baseline seed pending: no trusted SHA-exact Full artifact for PR base ' +
  comparisonBase + '. ' + diagnostic + '. No ancestor seed or automatic Full fallback.')
