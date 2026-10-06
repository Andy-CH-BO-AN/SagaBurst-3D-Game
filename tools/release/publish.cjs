const { execFileSync } = require('node:child_process')
const { appendFileSync, statSync } = require('node:fs')
const { basename, join } = require('node:path')
const { validateVersion } = require('./validate-tag.cjs')

function downloadNames(version) {
  return [`SagaBurst-v${version}-Windows-x64.zip`, `SagaBurst-v${version}-macOS-arm64.zip`]
}
function validateAsset(asset) {
  if (asset.state !== 'uploaded' || !Number.isSafeInteger(asset.size) || asset.size <= 0
    || !/^sha256:[a-f0-9]{64}$/.test(asset.digest ?? '')) {
    throw new Error(`Release download is incomplete: ${asset.name}`)
  }
}
function findAsset(release, name) {
  const matches = release.assets.filter(asset => asset.name === name)
  if (matches.length > 1) throw new Error(`Duplicate release download: ${name}`)
  if (matches[0]) validateAsset(matches[0])
  return matches[0]
}
function verifyDownloads(release, tag, names) {
  if (release.tag_name !== tag || release.prerelease) throw new Error(`Unexpected release for ${tag}`)
  for (const name of names) {
    if (!findAsset(release, name)) throw new Error(`Missing release download: ${name}`)
  }
}
async function inspectRelease(client, tag, names) {
  const release = await client.read()
  if (!release || release.draft) return false
  verifyDownloads(release, tag, names)
  return true
}
async function publishRelease(client, tag, paths) {
  const names = paths.map(path => basename(path))
  let release = await client.read()
  const alreadyPublished = () => {
    if (!release || release.draft) return false
    verifyDownloads(release, tag, names)
    return true
  }
  if (alreadyPublished()) return { changed: false }
  if (!release) { await client.createDraft(); release = await client.read() }
  if (alreadyPublished()) return { changed: false }
  if (!release?.draft || release.tag_name !== tag || release.prerelease) throw new Error('Expected a release draft')
  for (const path of paths) {
    // Re-read before every upload. No command can replace an existing asset.
    release = await client.read()
    if (alreadyPublished()) return { changed: false }
    if (!release?.draft || release.tag_name !== tag || release.prerelease) throw new Error('Expected a release draft')
    if (!findAsset(release, basename(path))) await client.upload(path)
  }
  release = await client.read()
  if (alreadyPublished()) return { changed: false }
  if (!release?.draft) throw new Error('Expected a release draft')
  verifyDownloads(release, tag, names)
  await client.publish()
  release = await client.read()
  if (!release || release.draft) throw new Error('Release was not published')
  verifyDownloads(release, tag, names)
  return { changed: true }
}
function createGhClient(repo, tag, run = args => execFileSync('gh', args, {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 300000,
})) {
  return {
    read() {
      try { return JSON.parse(run(['api', `repos/${repo}/releases/tags/${encodeURIComponent(tag)}`])) }
      catch (error) {
        // Authentication, rate limiting and server failures must never mean "absent".
        if (/\(HTTP 404\)/.test(String(error.stderr ?? ''))) return null
        throw error
      }
    },
    createDraft() { run(['release', 'create', tag, '--repo', repo, '--draft', '--verify-tag',
      '--title', `SagaBurst ${tag}`, '--notes-file', `docs/releases/${tag}.md`]) },
    upload(path) {
      if (!statSync(path).isFile() || statSync(path).size <= 0) throw new Error(`Missing local download: ${path}`)
      run(['release', 'upload', tag, path, '--repo', repo])
    },
    publish() { run(['release', 'edit', tag, '--repo', repo, '--draft=false']) },
  }
}
async function main() {
  const { version } = require('../../package.json')
  const lock = require('../../package-lock.json')
  const tag = process.env.RELEASE_TAG || process.env.GITHUB_REF_NAME
  const repo = process.env.GITHUB_REPOSITORY
  validateVersion(version, lock, tag)
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? '')) throw new Error('GITHUB_REPOSITORY is required')
  const client = createGhClient(repo, tag), names = downloadNames(version)
  if (process.argv.includes('--check')) {
    const published = await inspectRelease(client, tag, names)
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `published=${published}\n`)
    console.log(published ? `${tag}: verified published downloads; no changes needed` : `${tag}: publication pending`)
  } else {
    const { changed } = await publishRelease(client, tag, names.map(name => join('release', name)))
    console.log(changed ? `${tag}: published complete downloads` : `${tag}: verified published downloads; left unchanged`)
  }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1 })
module.exports = { downloadNames, verifyDownloads, inspectRelease, publishRelease, createGhClient }
