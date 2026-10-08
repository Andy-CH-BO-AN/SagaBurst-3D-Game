const { test } = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, basename } = require('node:path')
const { downloadNames, inspectRelease, publishRelease, createGhClient } = require('../../tools/release/publish.cjs')

const tag = 'v1.2.3'
const names = downloadNames('1.2.3')
const paths = names.map(name => join('release', name))
const asset = name => ({ name, state: 'uploaded', size: 1024, digest: `sha256:${'a'.repeat(64)}` })
const release = (draft, assets = names.map(asset)) => ({ tag_name: tag, draft, prerelease: false, assets })
function fakeClient(initial) {
  let current = structuredClone(initial)
  const calls = []
  return {
    calls,
    read() { return structuredClone(current) },
    createDraft() { calls.push('draft'); current = release(true, []) },
    upload(path) { calls.push(`upload:${basename(path)}`); current.assets.push(asset(basename(path))) },
    publish() { calls.push('publish'); current.draft = false },
  }
}

test('published releases, including immutable ones, need no files or mutations', async () => {
  for (const immutable of [false, true]) {
    const client = fakeClient({ ...release(false), immutable })
    assert.equal(await inspectRelease(client, tag, names), true)
    assert.deepEqual(await publishRelease(client, tag, paths), { changed: false })
    assert.deepEqual(client.calls, [])
  }
})
test('missing or incomplete published downloads fail without mutation', async () => {
  for (const assets of [[], [asset(names[0])],
    [asset(names[0]), { ...asset(names[1]), size: 0 }],
    [asset(names[0]), { ...asset(names[1]), state: 'starter' }],
    [asset(names[0]), { ...asset(names[1]), digest: null }],
    [asset(names[0]), { ...asset(names[1]), digest: 'sha256:bad' }],
    [...names.map(asset), asset(names[0])]]) {
    const client = fakeClient(release(false, assets))
    await assert.rejects(inspectRelease(client, tag, names), /download/)
    await assert.rejects(publishRelease(client, tag, paths), /download/)
    assert.deepEqual(client.calls, [])
  }
})
test('wrong tags and prereleases are never modified', async () => {
  for (const state of [{ ...release(false), tag_name: 'v9.9.9' },
    { ...release(false), prerelease: true }, { ...release(true), tag_name: 'v9.9.9' },
    { ...release(true), prerelease: true }]) {
    const client = fakeClient(state)
    await assert.rejects(publishRelease(client, tag, paths), /Unexpected|Expected/)
    assert.deepEqual(client.calls, [])
  }
})
test('a new release remains a draft until both downloads are present', async () => {
  const client = fakeClient(null)
  assert.equal(await inspectRelease(client, tag, names), false)
  const upload = client.upload.bind(client)
  client.upload = path => { assert.equal(client.read().draft, true); upload(path) }
  const publish = client.publish.bind(client)
  client.publish = () => { assert.deepEqual(client.read().assets.map(a => a.name), names); publish() }
  assert.deepEqual(await publishRelease(client, tag, paths), { changed: true })
  assert.deepEqual(client.calls, ['draft', ...names.map(name => `upload:${name}`), 'publish'])
})
test('partial drafts retain the existing download and upload only the missing one', async () => {
  const retained = { ...asset(names[0]), id: 42, digest: `sha256:${'b'.repeat(64)}` }
  const client = fakeClient(release(true, [retained]))
  assert.equal(await inspectRelease(client, tag, names), false)
  await publishRelease(client, tag, paths)
  assert.deepEqual(client.calls, [`upload:${names[1]}`, 'publish'])
  assert.deepEqual(client.read().assets[0], retained)
})
test('a failed upload can be retried without replacing the first download', async () => {
  const client = fakeClient(null), upload = client.upload.bind(client)
  client.upload = path => {
    if (basename(path) === names[1]) throw new Error('connection lost')
    upload(path)
  }
  await assert.rejects(publishRelease(client, tag, paths), /connection lost/)
  assert.equal(client.read().draft, true)
  assert.deepEqual(client.read().assets.map(a => a.name), [names[0]])
  client.upload = upload
  await publishRelease(client, tag, paths)
  assert.deepEqual(client.calls, ['draft', ...names.map(name => `upload:${name}`), 'publish'])
})
test('retry after a publish failure does not upload either file again', async () => {
  const client = fakeClient(release(true)), publish = client.publish.bind(client)
  client.publish = () => { throw new Error('publication unavailable') }
  await assert.rejects(publishRelease(client, tag, paths), /publication unavailable/)
  assert.deepEqual(client.calls, [])
  client.publish = publish
  await publishRelease(client, tag, paths)
  assert.deepEqual(client.calls, ['publish'])
})
test('incomplete existing draft assets fail without deletion or replacement', async () => {
  const client = fakeClient(release(true, [{ ...asset(names[0]), size: 0 }]))
  await assert.rejects(publishRelease(client, tag, paths), /incomplete/)
  assert.deepEqual(client.calls, [])
})
test('an upload that does not finish is never published', async () => {
  const client = fakeClient(release(true, [])), upload = client.upload.bind(client)
  client.upload = path => { if (basename(path) === names[0]) upload(path) }
  await assert.rejects(publishRelease(client, tag, paths), /Missing release download/)
  assert.equal(client.read().draft, true)
  assert.equal(client.calls.includes('publish'), false)
})
test('publication during a retry is detected before any subsequent mutation', async () => {
  const client = fakeClient(release(true)), read = client.read.bind(client)
  let reads = 0
  client.read = () => { reads++; return reads === 1 ? read() : release(false) }
  assert.deepEqual(await publishRelease(client, tag, paths), { changed: false })
  assert.deepEqual(client.calls, [])
})
test('tag and draft lookup API failures never mean an absent release', () => {
  for (const status of [401, 403, 429, 500]) {
    const error = Object.assign(new Error('API failed'), { stderr: `gh: failure (HTTP ${status})` })
    const client = createGhClient('owner/repo', tag, () => { throw error })
    assert.throws(() => client.read(), error)
    const drafts = createGhClient('owner/repo', tag, args => {
      if (args[1].includes('/tags/')) {
        throw Object.assign(new Error('missing'), { stderr: 'gh: Not Found (HTTP 404)' })
      }
      throw error
    })
    assert.throws(() => drafts.read(), error)
  }
  const client = createGhClient('owner/repo', tag, args => {
    if (args[1].includes('/tags/')) {
      throw Object.assign(new Error('missing'), { stderr: 'gh: Not Found (HTTP 404)' })
    }
    return '[[]]'
  })
  assert.equal(client.read(), null)
  assert.throws(() => createGhClient('owner/repo', tag, () => 'not JSON').read(), SyntaxError)
})
test('a newly created draft is found across release pages and published with both downloads', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'sagaburst-release-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const localPaths = names.map(name => join(dir, name))
  for (const path of localPaths) writeFileSync(path, 'PK-test')
  let current = null
  const mutations = []
  const client = createGhClient('owner/repo', tag, args => {
    if (args[0] === 'api') {
      if (args[1].includes('/tags/')) {
        if (current && !current.draft) return JSON.stringify(current)
        throw Object.assign(new Error('missing'), { stderr: 'gh: Not Found (HTTP 404)' })
      }
      return JSON.stringify([[{ ...release(false), tag_name: 'v9.9.9' }], current ? [current] : []])
    }
    mutations.push(args[1])
    if (args[1] === 'create') current = release(true, [])
    if (args[1] === 'upload') current.assets.push(asset(basename(args[3])))
    if (args[1] === 'edit') {
      assert.deepEqual(current.assets.map(a => a.name), names)
      current.draft = false
    }
    return ''
  })
  assert.deepEqual(await publishRelease(client, tag, localPaths), { changed: true })
  assert.deepEqual(current, release(false))
  assert.deepEqual(mutations, ['create', 'upload', 'upload', 'edit'])
})
test('duplicate drafts for the same tag fail before any mutation', async () => {
  const client = createGhClient('owner/repo', tag, args => {
    assert.equal(args[0], 'api')
    if (args[1].includes('/tags/')) {
      throw Object.assign(new Error('missing'), { stderr: 'gh: Not Found (HTTP 404)' })
    }
    return JSON.stringify([[release(true)], [release(true)]])
  })
  await assert.rejects(publishRelease(client, tag, paths), /Duplicate release/)
})
test('GitHub commands create a verified draft and upload without overwrite', t => {
  const dir = mkdtempSync(join(tmpdir(), 'sagaburst-release-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const path = join(dir, names[0]); writeFileSync(path, 'PK-test')
  const calls = [], client = createGhClient('owner/repo', tag, args => { calls.push(args); return '{}' })
  client.createDraft(); client.upload(path); client.publish()
  assert.deepEqual(calls, [
    ['release', 'create', tag, '--repo', 'owner/repo', '--draft', '--verify-tag',
      '--title', `SagaBurst ${tag}`, '--notes-file', `docs/releases/${tag}.md`],
    ['release', 'upload', tag, path, '--repo', 'owner/repo'],
    ['release', 'edit', tag, '--repo', 'owner/repo', '--draft=false'],
  ])
  writeFileSync(path, '')
  assert.throws(() => client.upload(path), /Missing local download/)
  assert.equal(calls.length, 3)
})
