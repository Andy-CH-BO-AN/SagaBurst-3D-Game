'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { validateGitIdentity } = require('../tooling/ci-git-evidence.cjs')
const base = 'a'.repeat(40), head = 'b'.repeat(40), merge = 'c'.repeat(40)
test('Merge 身分必須與 Base、Head 及實際 Checkout 一致', () => {
  const evidence = { base, head, checkoutSha: merge, mergeBaseSha: base, event: 'pull_request', parents: [base, head] }
  assert.doesNotThrow(() => validateGitIdentity(evidence))
  assert.throws(() => validateGitIdentity({ ...evidence, parents: [head, base] }), /parents disagree/)
  assert.throws(() => validateGitIdentity({ ...evidence, head: 'd'.repeat(40) }), /parents disagree/)
})
test('已 Rebase 的 Head 可驗證，分岔或過期 Checkout 必須拒絕', () => {
  const evidence = { base, head, checkoutSha: head, mergeBaseSha: base, event: 'pull_request', parents: [base] }
  assert.doesNotThrow(() => validateGitIdentity(evidence))
  assert.throws(() => validateGitIdentity({ ...evidence, mergeBaseSha: 'd'.repeat(40) }), /Diverged PR head/)
  assert.throws(() => validateGitIdentity({ ...evidence, event: 'push', checkoutSha: merge }), /Checkout differs/)
})
