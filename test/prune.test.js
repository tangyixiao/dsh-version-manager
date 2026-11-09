import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listSnapshots, snapshotsBeyondRetention, writeSnapshot } from '../lib/host/snapshot-store.js'
import { fingerprintTree } from '../lib/host/snapshot-store.js'
import { pruneSnapshots } from '../lib/host/routes.js'

/** A host stub that answers only what `pruneSnapshots` asks for. */
function fakeHost(dshHome, profileId) {
  const services = {
    profileContext: { name: profileId, home: dshHome, dir: join(dshHome, 'profiles', profileId) },
  }
  return { get: (name) => services[name] }
}

/**
 * A snapshot row needs a target with a version and a replayable source; these
 * tests care about the count, so the source is the one a restore could use.
 */
function target(installedVersion) {
  return {
    targetId: 'example-pkg',
    declaredSpec: `example-pkg@${installedVersion}`,
    installedVersion,
    source: { kind: 'registry', registryName: 'example-pkg', detail: null, registry: null },
    enabledState: 'enabled',
    compatibility: { verdict: 'satisfied' },
  }
}

async function seed(dshHome) {
  const directory = join(dshHome, 'deploy', 'example-pkg')
  const { mkdir, writeFile } = await import('node:fs/promises')
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'index.js'), 'export const x = 1\n')
  const fingerprint = await fingerprintTree(directory)
  for (let index = 0; index < 25; index += 1) {
    await writeSnapshot({
      dshHome,
      profileId: 'p',
      target: target(`1.0.${index}`),
      fingerprint,
      reason: 'manual',
    })
  }
  return directory
}

test('retention puts the oldest snapshots past the limit and keeps the newest', async () => {
  const dshHome = await mkdtemp(join(tmpdir(), 'vm-prune-'))
  await seed(dshHome)

  const stored = await listSnapshots(dshHome, 'p', 'example-pkg')
  assert.equal(stored.length, 25)

  const beyond = snapshotsBeyondRetention(stored)
  assert.equal(beyond.length, 5)
  // `beyond` holds the oldest ones, which is what a prune would remove.
  assert.deepEqual(
    beyond.map((entry) => entry.installedVersion),
    ['1.0.0', '1.0.1', '1.0.2', '1.0.3', '1.0.4'],
  )
})

test('a listing within the limit reports nothing to prune', async () => {
  const dshHome = await mkdtemp(join(tmpdir(), 'vm-prune-'))
  await seed(dshHome)
  const stored = await listSnapshots(dshHome, 'p', 'example-pkg')
  assert.deepEqual(snapshotsBeyondRetention(stored.slice(0, 20)), [])
  assert.deepEqual(snapshotsBeyondRetention(stored.slice(0, 20), 21), [])
})

test('pruning removes exactly the overflow and leaves the rest restorable', async () => {
  const dshHome = await mkdtemp(join(tmpdir(), 'vm-prune-'))
  await seed(dshHome)
  const before = await listSnapshots(dshHome, 'p', 'example-pkg')

  const result = await pruneSnapshots(fakeHost(dshHome, 'p'), { targetId: 'example-pkg' })
  assert.equal(result.status, 200)
  assert.equal(result.body.removed.length, 5)
  assert.deepEqual(result.body.failed, [])
  assert.equal(result.body.stored, 20)

  const after = await listSnapshots(dshHome, 'p', 'example-pkg')
  assert.equal(after.length, 20)
  // The newest 20 survive: the retained set is the tail of what was there.
  const removedFiles = new Set(result.body.removed)
  for (const entry of after) {
    assert.equal(removedFiles.has(entry.file), false)
  }
  assert.deepEqual(
    after.map((entry) => entry.installedVersion),
    before.slice(5).map((entry) => entry.installedVersion),
  )
})

test('pruning within the limit is a no-op, not a delete', async () => {
  const dshHome = await mkdtemp(join(tmpdir(), 'vm-prune-'))
  await seed(dshHome)
  const first = await pruneSnapshots(fakeHost(dshHome, 'p'), { targetId: 'example-pkg' })
  assert.equal(first.body.removed.length, 5)

  const second = await pruneSnapshots(fakeHost(dshHome, 'p'), { targetId: 'example-pkg' })
  assert.equal(second.status, 200)
  assert.deepEqual(second.body.removed, [])
  assert.equal(second.body.stored, 20)
  assert.match(second.body.note, /within the 20 kept/)
})

test('pruning refuses to guess a target it was not given', async () => {
  const dshHome = await mkdtemp(join(tmpdir(), 'vm-prune-'))
  const missing = await pruneSnapshots(fakeHost(dshHome, 'p'), {})
  assert.equal(missing.status, 400)
  assert.equal(missing.body.error, 'missing-target')

  const unknownProfile = await pruneSnapshots({ get: () => undefined }, { targetId: 'example-pkg' })
  assert.equal(unknownProfile.status, 409)
  assert.equal(unknownProfile.body.error, 'profile-identity-unknown')
})
