'use strict'
// External read-only diagnosis, not another job in the possibly broken workflow.
// An older successful attempt/head never establishes current verification.
const { execFileSync } = require('node:child_process')
const { writeFileSync } = require('node:fs')
function assessJobs(run, jobs, expectedHead, expectedMerge) {
  const reasons = []
  if (run.head_sha !== expectedHead) reasons.push('stale PR head')
  if (run.status !== 'completed' || run.conclusion !== 'success') reasons.push('workflow is not completed successfully')
  if (expectedMerge && !run.referenced_workflows?.some(w => w.path.includes('/logic-tests.yml@') && w.sha === expectedMerge)) reasons.push('merge ref differs from expected validation revision')
  const required = Object.fromEntries(['logic / gate', 'web'].map(name => {
    const matches = jobs.filter(j => j.name === name)
    const item = matches.length === 1 ? matches[0] : null
    const status = !matches.length ? 'missing' : matches.length !== 1 ? 'duplicate'
      : item.run_attempt !== run.run_attempt ? 'stale-attempt'
      : item.head_sha !== expectedHead ? 'stale-head'
      : item.status !== 'completed' ? item.status : item.conclusion
    if (status !== 'success') reasons.push(name + ': ' + status)
    return [name, status]
  }))
  return { result: reasons.length ? 'unverified' : 'passed', required, reasons,
    headSha: run.head_sha, attempt: run.run_attempt, url: run.html_url }
}
if (require.main === module) {
  try {
    const [repo, prNumber, runId, out] = process.argv.slice(2)
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '') || !/^\d+$/.test(prNumber || '') || !/^\d+$/.test(runId || '')) throw Error('Usage: node tests/tooling/ci-check-jobs.cjs OWNER/REPO PR RUN [report.json]')
    const api = path => JSON.parse(execFileSync('gh', ['api', 'repos/' + repo + '/' + path], { encoding: 'utf8' }))
    const pr = api('pulls/' + prNumber), run = api('actions/runs/' + runId)
    if (run.event !== 'pull_request') throw Error('Expected PR validation run')
    let jobs = []
    for (let page = 1; ; page++) {
      const result = api('actions/runs/' + runId + '/attempts/' + run.run_attempt + '/jobs?per_page=100&page=' + page)
      jobs.push(...result.jobs)
      if (jobs.length >= result.total_count) break
      if (!result.jobs.length) throw Error('Incomplete job pagination')
    }
    const report = assessJobs(run, jobs, pr.head.sha, pr.merge_commit_sha)
    const message = JSON.stringify(report, null, 2)
    console.log(message)
    if (out) writeFileSync(out, message + '\n')
    if (report.result !== 'passed') process.exitCode = 1
  } catch (error) { console.error(error); process.exitCode = 1 }
}
module.exports = { assessJobs }
