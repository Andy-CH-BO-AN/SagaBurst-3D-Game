'use strict'
// External read-only diagnosis, not another job in the possibly broken workflow.
// An older successful attempt/head never establishes current verification.
const { execFileSync } = require('node:child_process')
const { writeFileSync } = require('node:fs')
function assessJobs(run, jobs, expectedHead, expectedMerge, { latestRun, historical = false } = {}) {
  const reasons = []
  if (!historical && (!latestRun || latestRun.id !== run.id || latestRun.run_attempt !== run.run_attempt)) reasons.push('newer run exists or latest validation is unproven')
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
  return { result: reasons.length ? 'unverified' : historical ? 'historical-passed' : 'passed', scope: historical ? 'historical' : 'current', required, reasons,
    headSha: run.head_sha, attempt: run.run_attempt, url: run.html_url }
}
if (require.main === module) {
  try {
    const args = process.argv.slice(2), historical = args.includes('--historical')
    const [repo, prNumber, runId, out] = args.filter(a => a !== '--historical')
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '') || !/^\d+$/.test(prNumber || '') || !/^\d+$/.test(runId || '')) throw Error('Usage: node tests/tooling/ci-check-jobs.cjs OWNER/REPO PR RUN [report.json]')
    const api = path => JSON.parse(execFileSync('gh', ['api', 'repos/' + repo + '/' + path], { encoding: 'utf8' }))
    const pr = api('pulls/' + prNumber), run = api('actions/runs/' + runId)
    if (run.event !== 'pull_request' || run.path !== '.github/workflows/ci.yml') throw Error('Expected PR CI validation run')
    let jobs = []
    for (let page = 1; ; page++) {
      const result = api('actions/runs/' + runId + '/attempts/' + run.run_attempt + '/jobs?per_page=100&page=' + page)
      jobs.push(...result.jobs)
      if (jobs.length >= result.total_count) break
      if (!result.jobs.length) throw Error('Incomplete job pagination')
    }
    let latestRun
    if (!historical) {
      const candidates = []
      for (let page = 1; ; page++) {
        const list = api('actions/workflows/ci.yml/runs?event=pull_request&head_sha=' + pr.head.sha + '&per_page=100&page=' + page)
        if (!Array.isArray(list.workflow_runs)) throw Error('Missing workflow history')
        candidates.push(...list.workflow_runs.filter(r => r.head_sha === pr.head.sha && r.head_branch === pr.head.ref &&
          (!r.pull_requests?.length || r.pull_requests.some(p => p.number === Number(prNumber)))))
        if (list.workflow_runs.length < 100) break
      }
      latestRun = candidates.sort((a, b) => b.id - a.id)[0]
      // Get the current attempt after job enumeration, never reuse list defaults.
      if (latestRun) latestRun = api('actions/runs/' + latestRun.id)
    }
    const report = assessJobs(run, jobs, pr.head.sha, historical ? undefined : pr.merge_commit_sha, { latestRun, historical })
    const message = JSON.stringify(report, null, 2)
    console.log(message)
    if (out) writeFileSync(out, message + '\n')
    if (!['passed', 'historical-passed'].includes(report.result)) process.exitCode = 1
  } catch (error) { console.error(error); process.exitCode = 1 }
}
module.exports = { assessJobs }
