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
const rejected = []
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
  if (!trustedPublication(workflow, candidate.sha)) {
    rejected.push({ candidate, workflow })
    continue
  }
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
const runs = JSON.parse(gh(['api', 'repos/' + repo +
  '/actions/runs?head_sha=' + comparisonBase + '&per_page=100']))
if (!Array.isArray(runs.workflow_runs)) fail('GitHub workflow-runs API returned no list')
const canonical = runs.workflow_runs.filter(run =>
  run?.head_sha === comparisonBase &&
  run.path === '.github/workflows/ci.yml' &&
  ['dev', 'main'].includes(run.head_branch) &&
  (run.event === 'push' || run.event === 'workflow_dispatch'))
  .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
const latest = canonical[0]
const link = run => run?.html_url ? ' ' + run.html_url : ''
if (latest && latest.status !== 'completed') {
  fail('exact dev baseline seed pending: canonical Full run ' + latest.id +
    ' for PR base SHA ' + comparisonBase + ' is ' + latest.status + '.' +
    link(latest) + ' No Full fallback.')
}
if (latest && latest.conclusion !== 'success') {
  fail('exact dev baseline seed blocked: canonical Full run ' + latest.id +
    ' for PR base SHA ' + comparisonBase + ' completed with conclusion ' +
    (latest.conclusion || 'unknown') + '; failed Full runs never publish a seed.' +
    link(latest) + ' No older SHA may substitute.')
}
if (latest && rejected.length) {
  fail('exact dev baseline seed unsafe: an exact-SHA artifact exists but its canonical ' +
    'publisher provenance was rejected for PR base SHA ' + comparisonBase +
    '; run ' + latest.id + '.' + link(latest) + ' No untrusted artifact may substitute.')
}
if (latest) {
  fail('exact dev baseline seed artifact missing: canonical Full run ' + latest.id +
    ' succeeded for PR base SHA ' + comparisonBase +
    ' but supercov-seed-' + comparisonBase + ' is absent or expired.' +
    link(latest) + ' No Full fallback.')
}
if (rejected.length) {
  fail('exact dev baseline seed unsafe: artifact supercov-seed-' + comparisonBase +
    ' exists but no trusted canonical dev/main Full publisher matches it. No fallback.')
}
fail('exact dev baseline seed pending: no canonical dev/main Full run found for PR base SHA ' +
  comparisonBase + '. No older SHA or PR-created Full evidence may substitute.')
