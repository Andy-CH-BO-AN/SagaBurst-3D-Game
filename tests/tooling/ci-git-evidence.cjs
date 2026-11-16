'use strict'
const { execFileSync } = require('node:child_process')
const { readFileSync } = require('node:fs')
const SHA = /^[a-f0-9]{40}$/
function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}
function diffChanges(cwd, start, end) {
  const raw = execFileSync('git', ['diff', '--name-status', '-z', '--find-renames', start, end],
    { cwd, encoding: 'utf8' }).split('\0')
  const changed = []
  for (let i = 0; i < raw.length && raw[i];) {
    const status = raw[i++], file = raw[i++]
    if (/^[RC]/.test(status)) changed.push({ status, oldFile: file, file: raw[i++] })
    else changed.push({ status, file })
  }
  return changed
}
// The native query sees the checkout. Its diff must be against the exact seed,
// including merge conflict resolutions, rather than a different head tree.
function validateGitIdentity({ base, head, event, checkoutSha, mergeBaseSha, parents }) {
    if (event === 'pull_request') {
      if (checkoutSha === head) {
        // A local head checkout is equivalent only when it already contains base.
        if (mergeBaseSha !== base) throw Error('Diverged PR head requires its actual merge checkout')
      } else if (parents.length !== 2 || parents[0] !== base || parents[1] !== head) {
        throw Error('PR merge checkout parents disagree with requested base/head')
      }
    } else if (checkoutSha !== head) throw Error('Checkout differs from requested head')
}
function gitEvidence({ base, head, event }, cwd, env = process.env) {
  try {
    if (!SHA.test(base || '') || !SHA.test(head || '')) throw Error('Missing valid base/head SHA')
    for (const sha of [base, head]) git(cwd, 'cat-file', '-e', sha + '^{commit}')
    const checkoutSha = git(cwd, 'rev-parse', 'HEAD')
    const mergeBaseSha = git(cwd, 'merge-base', base, head)
    const parents = git(cwd, 'show', '-s', '--format=%P', checkoutSha).split(' ')
    validateGitIdentity({ base, head, event, checkoutSha, mergeBaseSha, parents })
    if (env.GITHUB_ACTIONS === 'true') {
      if (env.GITHUB_SHA !== checkoutSha) throw Error('GITHUB_SHA differs from checkout')
      if (event === 'pull_request') {
        const pr = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8')).pull_request
        if (pr?.base?.sha !== base || pr?.head?.sha !== head || checkoutSha === head) {
          throw Error('PR event payload or merge checkout differs from requested evidence')
        }
      }
      if (git(cwd, 'status', '--porcelain', '--untracked-files=no')) throw Error('Tracked checkout differs from commit')
    }
    return { baseSha: base, headSha: head, checkoutSha, mergeBaseSha,
      mergeRefSha: checkoutSha === head ? null : checkoutSha,
      diffBaseSha: base, diffHeadSha: checkoutSha,
      changes: diffChanges(cwd, base, checkoutSha) }
  } catch (error) { throw Error('Related Git evidence unsafe: ' + error.message) }
}
module.exports = { gitEvidence, diffChanges, validateGitIdentity }
