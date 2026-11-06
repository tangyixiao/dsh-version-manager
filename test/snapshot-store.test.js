import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, mkdir, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  SNAPSHOT_SCHEMA,
  deleteSnapshot,
  encodeTarget,
  fingerprintTree,
  listSnapshots,
  recoveryVerdict,
  snapshotsBeyondRetention,
  writeSnapshot,
} from '../lib/host/snapshot-store.js'

/** @returns {Promise<string>} a throwaway DSH home */
async function home() {
  return mkdtemp(join(tmpdir(), 'dvm-snap-'))
}

/** @returns {object} an inventory row, the only shape writeSnapshot accepts */
function row(overrides = {}) {
  return {
    kind: 'plugin',
    targetId: 'example-pkg',
    declaredSpec: 'example-pkg@1.2.3',
    installedVersion: '1.2.3',
    source: { kind: 'registry', registryName: 'example-pkg', registryRange: '1.2.3', detail: null },
    enabledState: 'enabled',
    compatibility: { verdict: 'accepted' },
    ...overrides,
  }
}

test('encodeTarget keeps scoped names path-safe', () => {
  assert.equal(encodeTarget('@scope/name'), '@scope%2Fname')
  assert.equal(encodeTarget('plain'), 'plain')
  assert.equal(encodeTarget('../../etc/passwd').includes('/'), false)
})

test('fingerprintTree is stable and notices a change', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dvm-fp-'))
  try {
    await writeFile(join(root, 'a.txt'), 'one')
    await mkdir(join(root, 'nested'))
    await writeFile(join(root, 'nested', 'b.txt'), 'two')

    const first = await fingerprintTree(root)
    const second = await fingerprintTree(root)
    assert.equal(first.digest, second.digest)
    assert.equal(first.files, 2)

    await writeFile(join(root, 'a.txt'), 'changed')
    const third = await fingerprintTree(root)
    assert.notEqual(third.digest, first.digest)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('fingerprintTree returns null for a directory that is not there', async () => {
  assert.equal(await fingerprintTree('C:/definitely/not/a/real/path/for/dvm'), null)
})

test('a snapshot is written, listed, and keeps the facts needed to restore', async () => {
  const root = await home()
  try {
    const document = await writeSnapshot({
      dshHome: root,
      profileId: 'desktop',
      target: row(),
      fingerprint: { digest: 'abc', files: 3, bytes: 30 },
      reason: 'manual',
    })
    assert.equal(document.schema, SNAPSHOT_SCHEMA)
    assert.equal(document.seq, 1)

    const listed = await listSnapshots(root, 'desktop', 'example-pkg')
    assert.equal(listed.length, 1)
    assert.equal(listed[0].id, document.id)
    assert.equal(listed[0].installedVersion, '1.2.3')
    assert.equal(listed[0].fingerprint.digest, 'abc')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('snapshots for different profiles never share a directory', async () => {
  const root = await home()
  try {
    await writeSnapshot({ dshHome: root, profileId: 'a', target: row(), fingerprint: null })
    await writeSnapshot({ dshHome: root, profileId: 'b', target: row(), fingerprint: null })
    assert.equal((await listSnapshots(root, 'a', 'example-pkg')).length, 1)
    assert.equal((await listSnapshots(root, 'b', 'example-pkg')).length, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a second snapshot gets a new sequence number and leaves the first alone', async () => {
  const root = await home()
  try {
    const first = await writeSnapshot({ dshHome: root, profileId: 'p', target: row(), fingerprint: null })
    const second = await writeSnapshot({ dshHome: root, profileId: 'p', target: row(), fingerprint: null })
    assert.equal(first.seq, 1)
    assert.equal(second.seq, 2)
    assert.notEqual(first.id, second.id)
    const listed = await listSnapshots(root, 'p', 'example-pkg')
    assert.deepEqual(
      listed.map((entry) => entry.seq),
      [1, 2],
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a snapshot never records credentials or environment', async () => {
  const root = await home()
  try {
    process.env.DVM_TEST_TOKEN = 'should-not-appear'
    const document = await writeSnapshot({
      dshHome: root,
      profileId: 'p',
      target: row(),
      fingerprint: null,
    })
    const text = JSON.stringify(document)
    assert.equal(text.includes('should-not-appear'), false)
    assert.equal(text.includes('DVM_TEST_TOKEN'), false)
    assert.equal(/token|credential|password|secret/i.test(text), false)
  } finally {
    delete process.env.DVM_TEST_TOKEN
    await rm(root, { recursive: true, force: true })
  }
})

test('an unreadable snapshot is reported, not thrown, and does not hide the good ones', async () => {
  const root = await home()
  try {
    const document = await writeSnapshot({ dshHome: root, profileId: 'p', target: row(), fingerprint: null })
    const directory = join(root, 'version-manager', 'snapshots', 'p', 'example-pkg')
    await writeFile(join(directory, '9999-broken.json'), '{ not json')

    const listed = await listSnapshots(root, 'p', 'example-pkg')
    assert.equal(listed.length, 2)
    const broken = listed.find((entry) => entry.reason === 'unreadable')
    assert.ok(broken !== undefined)
    assert.ok(listed.some((entry) => entry.id === document.id))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('retention reports the overflow instead of deleting it', async () => {
  const snapshots = Array.from({ length: 25 }, (_, index) => ({ seq: index + 1 }))
  const beyond = snapshotsBeyondRetention(snapshots, 20)
  assert.equal(beyond.length, 5)
  assert.deepEqual(
    beyond.map((entry) => entry.seq),
    [1, 2, 3, 4, 5],
  )
  assert.deepEqual(snapshotsBeyondRetention(snapshots.slice(0, 20), 20), [])
})

test('deleteSnapshot refuses a traversal and deletes a real file', async () => {
  const root = await home()
  try {
    const document = await writeSnapshot({ dshHome: root, profileId: 'p', target: row(), fingerprint: null })
    assert.equal(await deleteSnapshot(root, 'p', 'example-pkg', '../../package.json'), false)
    const listed = await listSnapshots(root, 'p', 'example-pkg')
    assert.equal(await deleteSnapshot(root, 'p', 'example-pkg', listed[0].file), true)
    assert.equal(document.id, listed[0].id)
    assert.equal((await readdir(join(root, 'version-manager', 'snapshots', 'p', 'example-pkg'))).length, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('recovery reports what is missing and whether files moved', () => {
  const snapshot = {
    target: {
      targetId: 'example-pkg',
      installedVersion: '1.2.3',
      source: { kind: 'registry', registryName: 'example-pkg' },
      fingerprint: { digest: 'abc' },
    },
  }
  assert.deepEqual(recoveryVerdict(snapshot, { digest: 'abc' }), {
    ok: true,
    reason: null,
    detail: null,
    filesMatch: true,
  })

  // The interesting case: an update replaced the files, which is exactly the
  // situation a snapshot exists for. Restoring is still allowed, and the
  // mismatch is carried as evidence rather than as a refusal.
  assert.deepEqual(recoveryVerdict(snapshot, { digest: 'different' }), {
    ok: true,
    reason: null,
    detail: null,
    filesMatch: false,
  })

  assert.equal(recoveryVerdict({ target: null }, { digest: 'abc' }).reason, 'snapshot-incomplete')
  assert.equal(
    recoveryVerdict({ target: { ...snapshot.target, installedVersion: null } }, { digest: 'abc' }).reason,
    'no-version',
  )
  assert.equal(
    recoveryVerdict({ target: { ...snapshot.target, source: { kind: 'git' } } }, { digest: 'abc' }).reason,
    'source-not-replayable',
  )
  assert.equal(
    recoveryVerdict({ target: { ...snapshot.target, source: { kind: 'registry', registryName: 'other' } } }, { digest: 'abc' }).reason,
    'source-substitution',
  )
  assert.equal(recoveryVerdict(snapshot, null).reason, 'not-installed')
  assert.equal(
    recoveryVerdict({ target: { ...snapshot.target, fingerprint: null } }, { digest: 'abc' }).filesMatch,
    null,
  )
})

test('recovery refuses a git-installed package even when the files match', () => {
  const verdict = recoveryVerdict(
    {
      target: {
        installedVersion: '1.0.0',
        source: { kind: 'git', detail: 'https://example.com/a/b.git' },
        fingerprint: { digest: 'abc' },
      },
    },
    { digest: 'abc' },
  )
  assert.equal(verdict.ok, false)
  assert.equal(verdict.reason, 'source-not-replayable')
})
