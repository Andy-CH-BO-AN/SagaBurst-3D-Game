'use strict'
/**
 * Evidence provenance and storage policy. No test ownership/selector logic.
 * Each successful canonical dev/main push may publish a new immutable Full seed.
 */
const { spawnSync } = require('node:child_process')
const { readFileSync, statSync, readdirSync } = require('node:fs')
const { resolve, join } = require('node:path')
const { validSeedMetadata } = require('./supercov-measured-evidence.cjs')

const SHA = /^[a-f0-9]{40}$/
const MAX_UNPACKED_BYTES = 1024 * 1024 * 1024 // 1 GiB
const MAX_ARCHIVE_BYTES = 500 * 1024 * 1024 // 500 MiB
const fail = message => { throw new Error('Supercov evidence policy unsafe: ' + message) }

function isGitAncestor(candidate, target, cwd = process.cwd()) {
  if (!SHA.test(candidate || '') || !SHA.test(target || '')) return false
  const result = spawnSync('git', ['merge-base', '--is-ancestor', candidate, target],
    { cwd, encoding: 'utf8' })
  return !result.error && result.status === 0
}

function requireExactBaseSeed(seedSha, comparisonBase) {
  if (!SHA.test(seedSha || '') || !SHA.test(comparisonBase || '')) {
    fail('Missing valid exact PR base SHA or authoritative seed SHA')
  }
  // A previous canonical Full seed is NEVER allowed as a substitute for the
  // current PR base. If push-dev Full is still publishing, fail closed.
  if (seedSha !== comparisonBase) {
    fail('exact dev baseline seed pending: seed SHA must equal PR base SHA')
  }
}

function trustedPublication(workflow, seedSha) {
  if (workflow?.status !== 'completed' || workflow.conclusion !== 'success' ||
      workflow.path !== '.github/workflows/ci.yml' || !SHA.test(seedSha || '')) return false
  // Only a successful run tied to its own actual canonical branch commit
  // may publish authoritative evidence. No feature-branch exception.
  return ['dev', 'main'].includes(workflow.head_branch) &&
    workflow.head_sha === seedSha &&
    (workflow.event === 'push' || workflow.event === 'workflow_dispatch')
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
  if (!validSeedMetadata(seed) || !SHA.test(seed.sha || '')) {
    fail('Only fully measured, valid and SHA-bound evidence may be published')
  }
  const archiveBytes = statSync(archive).size
  const rawBytes = directoryBytes(join(root, '.supercov/runs'))
  if (archiveBytes > MAX_ARCHIVE_BYTES || rawBytes > MAX_UNPACKED_BYTES) {
    fail('Evidence exceeds 500 MiB packed or 1 GiB unpacked: explicit clean Full dev bootstrap required')
  }
  console.log('Supercov immutable Full artifact budget: packed ' +
    archiveBytes + '/' + MAX_ARCHIVE_BYTES + ', runs ' + rawBytes +
    '/' + MAX_UNPACKED_BYTES + ' bytes')
  return { archiveBytes, rawBytes }
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
module.exports = { isGitAncestor, requireExactBaseSeed, trustedPublication,
  validateArchive, MAX_UNPACKED_BYTES, MAX_ARCHIVE_BYTES }
