'use strict'
/**
 * Evidence provenance and storage policy. No test ownership/selector logic.
 * The one-time bootstrap is always explicit; hitting a limit never runs Full.
 */
const { spawnSync } = require('node:child_process')
const { readFileSync, statSync, readdirSync } = require('node:fs')
const { resolve, join } = require('node:path')
const { validSeedMetadata } = require('./supercov-measured-evidence.cjs')

const SHA = /^[a-f0-9]{40}$/
const MAX_REFRESH_GENERATIONS = 16
const MAX_UNPACKED_BYTES = 1024 * 1024 * 1024 // 1 GiB
const MAX_ARCHIVE_BYTES = 500 * 1024 * 1024 // 500 MiB
const fail = message => { throw new Error('Supercov evidence policy unsafe: ' + message) }

function isGitAncestor(candidate, target, cwd = process.cwd()) {
  if (!SHA.test(candidate || '') || !SHA.test(target || '')) return false
  const result = spawnSync('git', ['merge-base', '--is-ancestor', candidate, target],
    { cwd, encoding: 'utf8' })
  return !result.error && result.status === 0
}

function requireBaseAncestor(seedSha, comparisonBase, checker = isGitAncestor) {
  if (!SHA.test(seedSha || '') || !SHA.test(comparisonBase || '')) {
    fail('Missing valid seed or PR/dev TEST_BASE SHA')
  }
  // Never use HEAD ancestry alone. The PR base is the canonical governance
  // boundary, even if a feature branch deliberately creates its own Full run.
  if (!checker(seedSha, comparisonBase)) {
    fail('Seed SHA is not an ancestor of PR/dev TEST_BASE: feature-seed bypass forbidden')
  }
}

function trustedPublication(workflow, seedSha) {
  if (workflow?.status !== 'completed' || workflow.conclusion !== 'success' ||
      workflow.path !== '.github/workflows/ci.yml' || !SHA.test(seedSha || '')) return false
  const canonical = ['dev', 'main'].includes(workflow.head_branch)
  if (canonical && workflow.head_sha === seedSha &&
      (workflow.event === 'push' || workflow.event === 'workflow_dispatch')) return true
  // This one special branch dispatch is a controller only. Its workflow
  // checks out origin/dev and binds the artifact name/metadata to THAT SHA.
  // No arbitrary feature-branch manual Full may enter the Related lineage.
  return workflow.event === 'workflow_dispatch' &&
    workflow.head_branch === 'ci/supercov-per-test-impact-poc'
}

function generation(seed) {
  const value = seed?.generation ?? 0
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_REFRESH_GENERATIONS) {
    fail('Invalid evidence refresh generation')
  }
  return value
}

function requireRefreshAllowed(seed) {
  const current = generation(seed)
  if (current >= MAX_REFRESH_GENERATIONS) {
    fail('16 dev Related refreshes reached: explicitly bootstrap a fresh Full dev seed; no automatic Full')
  }
  return current + 1
}

function directoryBytes(dir) {
  let total = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) total += directoryBytes(path)
    else if (entry.isFile()) total += statSync(path).size
    else fail('Evidence directory has a non-file or symlink: ' + path)
    if (total > MAX_UNPACKED_BYTES) return total
  }
  return total
}

function validateArchive(root, archive) {
  const seed = JSON.parse(readFileSync(join(root, 'output/supercov-seed.json'), 'utf8'))
  const depth = generation(seed)
  if (!validSeedMetadata(seed) || !SHA.test(seed.sha || '')) {
    fail('Only fully measured, valid and SHA-bound evidence may be published')
  }
  const archiveBytes = statSync(archive).size
  const rawBytes = directoryBytes(join(root, '.supercov/runs'))
  if (archiveBytes > MAX_ARCHIVE_BYTES || rawBytes > MAX_UNPACKED_BYTES) {
    fail('Evidence exceeds 500 MiB packed or 1 GiB unpacked: explicit clean Full dev bootstrap required')
  }
  console.log('Supercov artifact budget: generation ' + depth + '/' + MAX_REFRESH_GENERATIONS +
    ', packed ' + archiveBytes + '/' + MAX_ARCHIVE_BYTES +
    ', runs ' + rawBytes + '/' + MAX_UNPACKED_BYTES + ' bytes')
  return { generation: depth, archiveBytes, rawBytes }
}

if (require.main === module) {
  try {
    const root = resolve(process.argv[2] || '.')
    const archive = resolve(process.argv[3] || join(root, 'output/supercov-evidence.tar.gz'))
    validateArchive(root, archive)
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  }
}
module.exports = { isGitAncestor, requireBaseAncestor, trustedPublication,
  generation, requireRefreshAllowed, validateArchive,
  MAX_REFRESH_GENERATIONS, MAX_UNPACKED_BYTES, MAX_ARCHIVE_BYTES }
