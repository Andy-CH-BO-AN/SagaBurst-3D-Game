'use strict'
// Private subprocess worker for public --test-file --json responses only.
// One bounded query per discovered Vitest file, with parallel CLI jobs.
// The caller reconciles every count and identity; this worker selects nothing.
const { execFile } = require('node:child_process')
const { readFileSync } = require('node:fs')
const { promisify } = require('node:util')
const run = promisify(execFile)
function diagnose(file, runId, error) {
  const summary = String(error?.stderr || '').trim().slice(-1200).replace(/\s+/g, ' ')
  const code = error?.code ?? error?.status ?? 'unknown'
  const signal = error?.signal ?? 'none'
  const timedOut = error?.killed === true || code === 'ETIMEDOUT'
  return 'testFile=' + file + '; seedRunId=' + runId +
    '; exitCode=' + code + '; signal=' + signal +
    '; timeout=' + timedOut + '; stderr=' + (summary || '(empty)') +
    '; error=' + (error?.message || String(error))
}
async function main() {
  const request = JSON.parse(readFileSync(0, 'utf8'))
  const runId = request?.runId
  const files = request?.files
  if (!/^run_[a-z0-9]+$/i.test(runId || '') ||
      !Array.isArray(files) || files.length < 1 || files.length > 1000 ||
      new Set(files).size !== files.length ||
      files.some(x => typeof x !== 'string' || x.length > 300 ||
        !/^tests\/.*\.(test|spec)\.[cm]?[jt]sx?$/.test(x))) {
    throw new Error('Unsafe Supercov filtered-identity worker input')
  }
  const results = new Array(files.length)
  let next = 0
  async function worker() {
    while (next < files.length) {
      const i = next++
      const file = files[i]
      let stdout
      try {
        ({ stdout } = await run('npx', [
          '--yes', 'supercov@4.24.2', 'runs', runId, 'tests', 'affected',
          '--test-file', file, '--json',
        ], { cwd: process.cwd(), encoding: 'utf8',
          maxBuffer: 16 * 1024 * 1024, timeout: 90_000 }))
      } catch (error) { throw new Error(diagnose(file, runId, error)) }
      try { results[i] = JSON.parse(stdout) }
      catch (error) {
        throw new Error('Invalid JSON for testFile=' + file + '; seedRunId=' + runId +
          '; outputBytes=' + stdout.length + '; error=' + error.message)
      }
    }
  }
  await Promise.all(Array.from({length: Math.min(6, files.length)}, () => worker()))
  process.stdout.write(JSON.stringify(results))
}
if (require.main === module) main().catch(error => {
  process.stderr.write('Supercov filtered identity expansion failed closed: ' +
    (error.message || String(error)) + '\n')
  process.exitCode = 1
})
module.exports = { diagnose }
