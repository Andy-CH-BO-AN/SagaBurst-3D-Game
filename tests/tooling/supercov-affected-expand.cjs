'use strict'
// Private subprocess worker for public --test-file --json responses only.
// One bounded query per discovered Vitest file, with parallel CLI jobs.
// The caller reconciles every count and identity; this worker selects nothing.
const { execFile } = require('node:child_process')
const { readFileSync } = require('node:fs')
const { promisify } = require('node:util')
const run = promisify(execFile)
function formatFailure(file, runId, error) {
  const stderr = String(error?.stderr || error?.message || '').trim()
    .replace(/\s+/g, ' ').slice(0, 1200) || '(empty)'
  const timedOut = error?.code === 'ETIMEDOUT' ||
    (error?.killed === true && error?.signal === 'SIGTERM')
  return 'testFile=' + file + '; seedRun=' + runId +
    '; exitCode=' + (error?.code ?? 'null') +
    '; signal=' + (error?.signal ?? 'none') +
    '; timeout=' + timedOut + '; stderr=' + stderr
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
      try {
        const { stdout } = await run('npx', [
          '--yes', 'supercov@4.24.2', 'runs', runId, 'tests', 'affected',
          '--test-file', file, '--json',
        ], { cwd: process.cwd(), encoding: 'utf8',
          maxBuffer: 16 * 1024 * 1024, timeout: 90_000 })
        results[i] = JSON.parse(stdout)
      } catch (error) {
        throw new Error(formatFailure(file, runId, error))
      }
    }
  }
  await Promise.all(Array.from({length: Math.min(3, files.length)}, () => worker()))
  process.stdout.write(JSON.stringify(results))
}
if (require.main === module) main().catch(error => {
  process.stderr.write('Supercov filtered identity expansion failed closed: ' +
    (error.stderr || error.message || String(error)) + '\n')
  process.exitCode = 1
})
module.exports = { formatFailure }
