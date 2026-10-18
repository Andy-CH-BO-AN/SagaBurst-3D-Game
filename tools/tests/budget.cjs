const { readFileSync } = require('node:fs')

const MAX_CASES_PER_SHARD = 500
const MAX_CASE_MS = 100

function validateReports(reports, { runId, runners = ['vitest', 'node'] } = {}) {
  const errors = []
  if (!Array.isArray(reports)) throw new Error('Missing test reports')
  for (const runner of runners) {
    if (reports.filter(report => report?.runner === runner).length !== 1) errors.push(`Missing or duplicate ${runner} report`)
  }
  let count = 0
  for (const report of reports) {
    if (!report || !runners.includes(report.runner)) { errors.push('Unexpected runner report'); continue }
    if (runId && report.runId !== runId) errors.push(`${report.runner}: stale report`)
    if (report.complete !== true || report.errors?.length || !Array.isArray(report.cases) || !report.cases.length) {
      errors.push(`${report.runner}: empty, incomplete or failed collection/run`)
    }
    errors.push(...(report.errors ?? []).map(message => `${report.runner}: ${message}`))
    const identities = new Set()
    for (const item of report.cases ?? []) {
      count++
      const identity = `${item.file} > ${item.name}`
      if (!item.file || !item.name || identities.has(item.id ?? identity)) errors.push(`${report.runner}: missing/duplicate case identity: ${identity}`)
      identities.add(item.id ?? identity)
      if (item.state !== 'passed') errors.push(`${identity}: ${item.state}`)
      if (!Number.isFinite(item.ms) || item.ms < 0) errors.push(`${identity}: missing duration`)
      else if (item.ms > MAX_CASE_MS) errors.push(`${identity}: ${item.ms.toFixed(3)}ms > ${MAX_CASE_MS}ms (hooks and cleanup included)`)
      if (item.retry || item.repeats || item.mode === 'only') errors.push(`${identity}: retry, repeat or focused case is prohibited`)
    }
  }
  if (count === 0 || count > MAX_CASES_PER_SHARD) errors.push(`Logic case count ${count}; required 1–${MAX_CASES_PER_SHARD}`)
  if (errors.length) throw new Error(errors.join('\n'))
  return { count, maxMs: Math.max(...reports.flatMap(report => report.cases.map(item => item.ms))) }
}

function readReport(file, runId) {
  const report = JSON.parse(readFileSync(file, 'utf8'))
  if (report.runId !== runId) throw new Error(`Stale report: ${file}`)
  return report
}

module.exports = { MAX_CASES_PER_SHARD, MAX_CASE_MS, validateReports, readReport }
