'use strict'
const { execFileSync } = require('node:child_process')
const { existsSync, readFileSync, writeFileSync } = require('node:fs')
const { resolve } = require('node:path')

const root = resolve(__dirname, '../..')
const version = '4.24.2'
const idFile = resolve(root, 'output/supercov-run.id')
if (!existsSync(idFile)) throw new Error('Supercov did not publish a Full run ID')
const runId = readFileSync(idFile, 'utf8').trim()
if (!/^run_[a-z0-9]+$/i.test(runId) || !existsSync(resolve(root, '.supercov/runs', runId))) {
  throw new Error('Missing Supercov Full run evidence')
}
const response = JSON.parse(execFileSync('npx', ['--yes', 'supercov@' + version, 'runs', runId, '--json'],
  { cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024 }))
if (response.schemaVersion !== 1 || response.ok !== true || response.data?.valid !== true ||
    response.data?.complete !== true || response.data?.testExitCode !== 0) {
  throw new Error('Supercov Full evidence is not valid and complete; refusing to publish the seed')
}
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
writeFileSync(resolve(root, 'output/supercov-seed.json'),
  JSON.stringify({ version, sha, runId, valid: true, complete: true }, null, 2) + '\n')
console.log('Published authoritative Supercov Full seed ' + runId + ' @ ' + sha)
