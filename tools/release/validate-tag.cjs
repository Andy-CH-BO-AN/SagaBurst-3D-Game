const { execFileSync } = require('node:child_process')

function validateVersion(version, lock, tag) {
  if (!/^\d+\.\d+\.\d+$/.test(version) || tag !== `v${version}`) throw new Error(`Release tag ${tag} must equal v${version}`)
  if (lock.version !== version || lock.packages[''].version !== version) throw new Error('package-lock version mismatch')
}
function validateRelease(version, lock, tag, git) {
  validateVersion(version, lock, tag)
  const tagged = git(`${tag}^{commit}`)
  if (git('HEAD') !== tagged || git('origin/main') !== tagged) throw new Error('Release tag must point at current main HEAD')
  return tagged
}
if (require.main === module) {
  const { version } = require('../../package.json')
  const lock = require('../../package-lock.json')
  const tag = process.env.RELEASE_TAG || process.env.GITHUB_REF_NAME
  const git = ref => execFileSync('git', ['rev-parse', ref], { encoding: 'utf8' }).trim()
  console.log(`Validated ${tag} at main HEAD ${validateRelease(version, lock, tag, git)}`)
}
module.exports = { validateRelease, validateVersion }
