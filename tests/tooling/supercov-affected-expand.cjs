'use strict'
// Private subprocess worker for public --test-file --json responses only.
// One bounded query per file or directory filter, with parallel CLI jobs.
// The caller reconciles every count and identity; this worker selects nothing.
const { execFile } = require('node:child_process')
const { readFileSync } = require('node:fs')
const { promisify } = require('node:util')
const run = promisify(execFile)
function diagnose(file, runId, error) {
  const summary = String(error?.stderr || '').trim().slice(-1200).replace(/\s+/g, ' ')
  const code = error?.code ?? error?.status ?? null
  const exitCode = Number.isInteger(code) ? code : 'none'
  const errorCode = typeof code === 'string' ? code : 'none'
  const signal = error?.signal ?? 'none'
  const maxBufferExceeded = errorCode === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
  // Node execFile timeout terminates with killed=true and SIGTERM; a signal
  // alone is not a timeout. maxBuffer is an independent failure even if killed.
  const timedOut = !maxBufferExceeded &&
    (errorCode === 'ETIMEDOUT' || (error?.killed === true && signal === 'SIGTERM'))
  const failureType = maxBufferExceeded ? 'maxBuffer' : timedOut ? 'timeout'
    : signal !== 'none' ? 'signal' : Number.isInteger(code) ? 'nonzero-exit' : 'spawn-error'
  return 'testFile=' + file + '; seedRunId=' + runId +
    '; failureType=' + failureType +
    '; exitCode=' + exitCode + '; errorCode=' + errorCode +
    '; signal=' + signal + '; timeout=' + timedOut +
    '; maxBufferExceeded=' + maxBufferExceeded +
    '; stderr=' + (summary || '(empty)') +
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
        !/^tests(\/[^/]+)+$/.test(x))) {
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
