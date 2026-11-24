'use strict'
// Rejects AI-service session links ("<Name>-Session: <url>", any service, any case) in commit
// messages and pull request text. This repository is public: a session link exposes a private
// conversation, so it never belongs in history, PR titles or PR descriptions.
const { execFileSync } = require('node:child_process')

const SESSION_LINK = /\b[\w.-]+-session\s*[:=]\s*<?https?:\/\/\S+/i
const ZERO_SHA = /^0+$/

/** Lines of `text` that carry a session link. */
function sessionLinkLines(text) {
  return String(text ?? '').split(/\r?\n/).filter(line => SESSION_LINK.test(line))
}

/** `sources` are `{ label, text }`; returns one `{ label, line }` per offending line. */
function findSessionLinks(sources) {
  return sources.flatMap(({ label, text }) => sessionLinkLines(text).map(line => ({ label, line: line.trim() })))
}

/** Commit messages introduced by `head` over `base`; without a usable base, only `head` itself. */
function commitMessages(base, head, git = args => execFileSync('git', args, { encoding: 'utf8' })) {
  const range = !base || ZERO_SHA.test(base) ? ['-1', head] : [`${base}..${head}`]
  return git(['log', '--format=%H%x00%B%x1e', ...range]).split('\x1e').map(entry => entry.trim()).filter(Boolean)
    .map(entry => {
      const [sha, text = ''] = entry.split('\x00')
      return { label: `commit ${sha.slice(0, 12)}`, text }
    })
}

function main() {
  const [base, head = 'HEAD'] = process.argv.slice(2)
  const sources = [...commitMessages(base, head)]
  if (process.env.PR_TITLE !== undefined) sources.push({ label: 'pull request title', text: process.env.PR_TITLE })
  if (process.env.PR_BODY !== undefined) sources.push({ label: 'pull request description', text: process.env.PR_BODY })
  const found = findSessionLinks(sources)
  if (!found.length) {
    console.log(`No AI session links in ${sources.length} commit message(s) / PR field(s).`)
    return
  }
  console.error('AI session links are not allowed in this public repository. Remove these lines:')
  for (const { label, line } of found) console.error(`  ${label}: ${line}`)
  process.exitCode = 1
}

if (require.main === module) main()

module.exports = { sessionLinkLines, findSessionLinks, commitMessages }
