const { test } = require('node:test')
const assert = require('node:assert/strict')
const { sessionLinkLines, findSessionLinks, commitMessages } = require('../../.github/scripts/lint-session-links.cjs')

test('rejects a session link from any AI service, in any case or separator', () => {
  const text = [
    'perf: faster planner',
    '',
    'Claude-Session: https://claude.ai/code/session_abc',
    'codex-session: http://chatgpt.example/c/1',
    'Gemini-Session = <https://gemini.example/app/2>',
  ].join('\n')
  assert.deepEqual(sessionLinkLines(text), text.split('\n').slice(2))
})

test('keeps ordinary trailers, links and session wording without a session link', () => {
  const text = [
    'Co-Authored-By: Someone <someone@example.com>',
    'Refs: https://github.com/owner/repo/pull/1',
    'Claude-Session: removed',
    'fix(coop): keep the guest session alive after https://example.com/docs',
  ].join('\n')
  assert.deepEqual(sessionLinkLines(text), [])
})

test('labels offenders per commit over the pushed range, or the head alone without a base', () => {
  const calls = []
  const git = args => {
    calls.push(args)
    return 'aaaaaaaaaaaaaaaa\x00feat: one\n\nCursor-Session: https://cursor.example/s/9\n\x1e\nbbbbbbbbbbbbbbbb\x00docs: two\n\x1e\n'
  }
  assert.deepEqual(findSessionLinks(commitMessages('base1', 'head1', git)),
    [{ label: 'commit aaaaaaaaaaaa', line: 'Cursor-Session: https://cursor.example/s/9' }])
  commitMessages('0000000000000000000000000000000000000000', 'head2', git)
  assert.deepEqual(calls.map(args => args.slice(2)), [['base1..head1'], ['-1', 'head2']])
})
