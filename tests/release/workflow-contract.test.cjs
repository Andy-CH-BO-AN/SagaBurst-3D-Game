const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { spawnSync } = require('node:child_process')
const yaml = require('js-yaml')
const { verifiedFullSha } = require('../../tools/tests/ci-run.cjs')

const workflowDir = resolve(__dirname, '../../.github/workflows')
const workflowFiles = ['ci.yml', 'logic-tests.yml', 'deploy-pages.yml', 'release.yml']
const loadWorkflow = name => yaml.load(readFileSync(resolve(workflowDir, name), 'utf8'))

function runBatchScenarios(cases) {
  const blocks = [
    'tee() { cat; }',
    'awk() { read -r first _ && printf "%s\\n" "$first"; }',
    ...cases.map((item, idx) => {
      const exports = Object.entries(item.env)
        .map(([k, v]) => `export ${k}=${JSON.stringify(v)}`)
        .join(' ')
      const script = item.script
        .replace(/set -euo pipefail\s*/g, '')
        .replaceAll('"$GITHUB_OUTPUT"', '/dev/stdout')
        .replaceAll('"$GITHUB_STEP_SUMMARY"', '/dev/null')
        .trim()
        .split('\n')
        .join(' && ')
      return `${exports}; out=""; rc=0; { out=$(${script}); } || rc=$?; printf "%s:%s:%s\\n" "${idx}" "$rc" "\${out//$'\\n'/|}"`
    }),
  ]
  const res = spawnSync('bash', ['-c', blocks.join('\n')], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH },
  })
  assert.equal(res.error, undefined)
  return res.stdout.trim().split('\n').map(line => {
    const first = line.indexOf(':')
    const second = line.indexOf(':', first + 1)
    return {
      status: Number(line.slice(first + 1, second)),
      output: line.slice(second + 1).replaceAll('|', '\n'),
    }
  })
}

test('push to main shares one Full gate with Pages and Release, bound to the exact SHA', () => {
  // Validate workflow syntax, expressions, reusable workflow inputs/outputs, permissions, and needs via actionlint.
  const lint = spawnSync('actionlint', ['-shellcheck=', '-pyflakes=', ...workflowFiles.map(file => resolve(workflowDir, file))], { encoding: 'utf8' })
  if (lint.error?.code !== 'ENOENT') {
    assert.equal(lint.status, 0, lint.stderr || lint.stdout)
  }

  const ci = loadWorkflow('ci.yml')
  const logicTests = loadWorkflow('logic-tests.yml')
  const pages = loadWorkflow('deploy-pages.yml')
  const release = loadWorkflow('release.yml')

  // Web job runs actionlint in CI so every runner environment enforces reusable workflow/permissions/needs lint.
  assert.ok(ci.jobs.web.steps.some(step => typeof step.run === 'string' && step.run.includes('actionlint')))

  for (const command of ['npx playwright install --with-deps chromium', 'npm run smoke:web']) {
    assert.equal(ci.jobs.web.steps.find(step => step.run === command).if, "github.event_name != 'push' || github.ref != 'refs/heads/dev'")
  }

  // Concurrency: main pushes are isolated per-SHA and never cancelled; other refs cancel in-progress runs.
  assert.match(ci.concurrency.group, /github\.event_name == 'push' && github\.ref == 'refs\/heads\/main' && github\.sha \|\| github\.ref/)
  assert.match(ci.concurrency['cancel-in-progress'], /!\(github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'\)/)

  // ci.yml orchestrates the single Full gate and passes verified-sha to both Pages and Release.
  assert.equal(ci.jobs.logic.uses, './.github/workflows/logic-tests.yml')
  assert.match(ci.jobs.logic.with.mode, /github\.ref == 'refs\/heads\/main' && 'full'/)
  assert.equal(logicTests.on.workflow_call.outputs['verified-sha'].value, '${{ jobs.aggregate.outputs.verified-sha }}')

  for (const id of ['pages', 'release']) {
    const job = ci.jobs[id]
    assert.deepEqual(job.needs, ['logic', 'web'])
    assert.equal(job.if, "github.event_name == 'push' && github.ref == 'refs/heads/main'")
    assert.equal(job.with['logic-verified-sha'], '${{ needs.logic.outputs.verified-sha }}')
  }
  assert.deepEqual(ci.jobs.pages.permissions, { contents: 'read', pages: 'write', 'id-token': 'write' })
  assert.deepEqual(ci.jobs.release.permissions, { contents: 'write' })

  // Neither publisher triggers itself on push -> main; Release still triggers on manual v* tags.
  assert.deepEqual(Object.keys(pages.on), ['workflow_call'])
  assert.equal(pages.on.workflow_call.inputs['logic-verified-sha'].required, true)
  assert.equal(pages.jobs.logic, undefined)
  assert.deepEqual(Object.keys(release.on).sort(), ['push', 'workflow_call'])
  assert.deepEqual(release.on.push, { tags: ['v*'] })

  // Release logic and gate structure: manual tag or missing verified-sha runs Full; verified-sha reuses same-run Full.
  assert.equal(release.jobs.logic.if, "inputs.logic-verified-sha == ''")
  assert.equal(release.jobs.logic.uses, './.github/workflows/logic-tests.yml')
  assert.equal(release.jobs.logic.with.mode, 'full')
  assert.equal(release.jobs.inspect.needs, 'gate')
  assert.deepEqual(release.jobs.validate.needs, ['inspect', 'gate'])
  assert.deepEqual(release.jobs.publish.needs, ['inspect', 'gate', 'validate', 'desktop'])
  assert.match(release.jobs.publish.if, /needs\.gate\.result == 'success'/)
  assert.doesNotMatch(release.jobs.publish.if, /needs\.logic\.result/)

  // Pages: serialized deploy concurrency, verified-sha gate, and out-of-order stale main commit skip.
  assert.deepEqual(pages.jobs.deploy.concurrency, { group: 'production-pages', 'cancel-in-progress': false })
  assert.equal(pages.jobs.deploy.if, "needs.build.outputs.is-latest == 'true'")
  const pagesDeployStep = pages.jobs.deploy.steps.find(step => step.id === 'deployment')
  assert.equal(pagesDeployStep.if, "steps.current.outputs.is-latest == 'true'")

  const sha = 'a'.repeat(40)
  const item = { file: 'tests/a.test.ts', runner: 'vitest', names: ['leaf'] }
  const full = { mode: 'full', inventory: [item], selected: [item.file], changedFiles: [], headSha: sha, checkoutSha: sha,
    shards: [{ id: 'logic-1', vitestFiles: [item.file], nodeFiles: [], expectedCount: 1 }] }
  assert.equal(verifiedFullSha(full), sha)
  assert.equal(verifiedFullSha({ ...full, checkoutSha: 'b'.repeat(40) }), '')
  assert.equal(verifiedFullSha({ ...full, headSha: '', checkoutSha: '' }), '')
  assert.equal(verifiedFullSha({ ...full, headSha: 'main', checkoutSha: 'main' }), '')
  assert.throws(() => verifiedFullSha({ ...full, shards: [] }), /Missing|Invalid|Empty/)
})

test('Release and Pages gate scripts enforce exact-SHA Full proof, tag fallback, and out-of-order stale deploy skip', () => {
  const pages = loadWorkflow('deploy-pages.yml')
  const release = loadWorkflow('release.yml')
  const pagesBuildGateScript = pages.jobs.build.steps[0].run
  const pagesBuildHeadScript = pages.jobs.build.steps.find(step => step.id === 'current-build').run
  const pagesDeployCheckScript = pages.jobs.deploy.steps.find(step => step.id === 'current').run
  const releaseGateScript = release.jobs.gate.steps[0].run
  const shaA = 'a'.repeat(40)
  const shaB = 'b'.repeat(40)
  const withStubRemote = (remoteSha, script) => `git() { printf '%s\\trefs/heads/main\\n' '${remoteSha}'; } && ${script}`

  const results = runBatchScenarios([
    // 0: Release valid same-run main push reuse
    { script: releaseGateScript, env: { VERIFIED_SHA: shaA, LOGIC_RESULT: 'skipped', GITHUB_SHA: shaA, GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main' } },
    // 1: Release manual tag fallback with passing Full logic
    { script: releaseGateScript, env: { VERIFIED_SHA: '', LOGIC_RESULT: 'success', GITHUB_SHA: shaA, GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/tags/v1.2.0' } },
    // 2..4: Release manual tag fallback with failed/cancelled/skipped Full logic -> fails closed
    { script: releaseGateScript, env: { VERIFIED_SHA: '', LOGIC_RESULT: 'failure', GITHUB_SHA: shaA, GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/tags/v1.2.0' } },
    { script: releaseGateScript, env: { VERIFIED_SHA: '', LOGIC_RESULT: 'cancelled', GITHUB_SHA: shaA, GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/tags/v1.2.0' } },
    { script: releaseGateScript, env: { VERIFIED_SHA: '', LOGIC_RESULT: 'skipped', GITHUB_SHA: shaA, GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/tags/v1.2.0' } },
    // 5..8: Release invalid reuse (SHA mismatch, non-push event, non-main ref, non-skipped logic) -> fails closed
    { script: releaseGateScript, env: { VERIFIED_SHA: shaA, LOGIC_RESULT: 'skipped', GITHUB_SHA: shaB, GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main' } },
    { script: releaseGateScript, env: { VERIFIED_SHA: shaA, LOGIC_RESULT: 'skipped', GITHUB_SHA: shaA, GITHUB_EVENT_NAME: 'pull_request', GITHUB_REF: 'refs/heads/main' } },
    { script: releaseGateScript, env: { VERIFIED_SHA: shaA, LOGIC_RESULT: 'skipped', GITHUB_SHA: shaA, GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/dev' } },
    { script: releaseGateScript, env: { VERIFIED_SHA: shaA, LOGIC_RESULT: 'failure', GITHUB_SHA: shaA, GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main' } },
    // 9: Pages build gate valid main push with matching verified-sha
    { script: pagesBuildGateScript, env: { VERIFIED_SHA: shaA, GITHUB_SHA: shaA, GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main' } },
    // 10..13: Pages build gate missing/mismatched verified-sha or wrong event/ref -> fails closed
    { script: pagesBuildGateScript, env: { VERIFIED_SHA: '', GITHUB_SHA: shaA, GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main' } },
    { script: pagesBuildGateScript, env: { VERIFIED_SHA: shaB, GITHUB_SHA: shaA, GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main' } },
    { script: pagesBuildGateScript, env: { VERIFIED_SHA: shaA, GITHUB_SHA: shaA, GITHUB_EVENT_NAME: 'pull_request', GITHUB_REF: 'refs/heads/main' } },
    { script: pagesBuildGateScript, env: { VERIFIED_SHA: shaA, GITHUB_SHA: shaA, GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/dev' } },
    // 14: Pages deploy latest main push (shaB == origin/main shaB) -> deploys
    { script: withStubRemote(shaB, pagesDeployCheckScript), env: { VERIFIED_SHA: shaB, GITHUB_SHA: shaB, GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main' } },
    // 15: Out-of-order older main push (shaA when origin/main is already shaB) -> skips deploy cleanly
    { script: withStubRemote(shaB, pagesDeployCheckScript), env: { VERIFIED_SHA: shaA, GITHUB_SHA: shaA, GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main' } },
    // 16: Out-of-order older main push at build artifact upload check -> skips upload cleanly
    { script: withStubRemote(shaB, pagesBuildHeadScript), env: { GITHUB_SHA: shaA } },
  ])

  assert.equal(results[0].status, 0)
  assert.equal(results[1].status, 0)
  for (const idx of [2, 3, 4, 5, 6, 7, 8]) assert.notEqual(results[idx].status, 0, `scenario ${idx} should fail`)
  assert.equal(results[9].status, 0)
  for (const idx of [10, 11, 12, 13]) assert.notEqual(results[idx].status, 0, `scenario ${idx} should fail`)
  assert.equal(results[14].status, 0)
  assert.match(results[14].output, /is-latest=true/)
  assert.equal(results[15].status, 0)
  assert.match(results[15].output, /is-latest=false/)
  assert.match(results[15].output, /Skipping stale Pages deploy/)
  assert.equal(results[16].status, 0)
  assert.match(results[16].output, /is-latest=false/)
  assert.match(results[16].output, /Skipping stale Pages artifact upload/)
})
