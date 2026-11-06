'use strict'
// A seed artifact is repository-scoped; unlike branch/PR GitHub caches it is
// readable by a later dev push or sibling PR. All trust checks are fail-closed.
const { execFileSync, spawnSync } = require('node:child_process')
const { existsSync, readFileSync, mkdirSync, rmSync } = require('node:fs')
const { resolve, join } = require('node:path')
const { isGitAncestor, requireBaseAncestor, trustedPublication, generation } = require('./supercov-evidence-policy.cjs')
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
const ancestor = candidate => isGitAncestor(candidate, comparisonBase, root) &&
  isGitAncestor(candidate, headSha, root)
function seedOk(expectedSha) {
  if (!existsSync(resolve(root, seedFile))) return false
  try {
    const seed = read(seedFile)
    return validSeedMetadata(seed) && seed.sha === expectedSha &&
      ancestor(seed.sha) && /^run_[a-z0-9]+$/i.test(seed.runId) &&
      existsSync(resolve(root, '.supercov/runs', seed.runId)) &&
      generation(seed) <= 16
  } catch { return false }
}
if (existsSync(resolve(root, seedFile))) {
  try {
    const cached = read(seedFile)
    if (seedOk(cached.sha)) {
      console.log('Using ancestor Supercov evidence cache: ' + cached.runId + ' @ ' + cached.sha)
      process.exit(0)
    }
  } catch {}
}
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
    if (match && item.expired === false && ancestor(match[1]) &&
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
  // Repeat the base check after extraction: don't trust artifact filenames.
  requireBaseAncestor(candidate.sha, comparisonBase,
    (seedSha, baseSha) => isGitAncestor(seedSha, baseSha, root))
  if (!seedOk(candidate.sha)) fail('Downloaded seed is untrusted or not based on PR/dev TEST_BASE')
  const seed = read(seedFile)
  console.log('Restored repository-scoped Supercov seed ' + seed.runId +
    ' @ ' + seed.sha + ' from Actions run ' + candidate.runId)
  process.exit(0)
}
fail('No PR/dev TEST_BASE ancestor Full/strict-Related seed artifact was found. Use explicit dev bootstrap; never fall back to Full in PR or push-dev.')
