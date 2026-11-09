import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildPluginRows,
  phaseName,
  readLoaderPhases,
  readProfileManifest,
  worstPhase,
} from '../lib/host/inventory.js'

/** A loader stand-in with the one method the reader uses. */
function fakeLoader(entries) {
  return { loader: { entries: () => entries } }
}

function entry(name, state, extra = {}) {
  return { options: { name, ...extra }, fiber: { state } }
}

test('phaseName maps the loader fiber states and nothing else', () => {
  assert.equal(phaseName(0), 'pending')
  assert.equal(phaseName(1), 'loading')
  assert.equal(phaseName(2), 'active')
  assert.equal(phaseName(3), 'failed')
  assert.equal(phaseName(5), 'unloading')
  assert.equal(phaseName(99), 'unknown')
  // A fiber that exposes no numeric state is not "pending": it is unreadable.
  assert.equal(phaseName(undefined), null)
  assert.equal(phaseName(null), null)
  assert.equal(phaseName('2'), null)
})

test('worstPhase reports the row a user would complain about', () => {
  assert.equal(worstPhase(undefined), null)
  assert.equal(worstPhase([]), null)
  assert.equal(worstPhase(['active', 'active']), 'active')
  assert.equal(worstPhase(['active', 'failed']), 'failed')
  assert.equal(worstPhase(['active', 'pending']), 'pending')
  // An unrecognised phase must not outrank a real one.
  assert.equal(worstPhase(['active', 'weird']), 'active')
})

test('readLoaderPhases groups by name and skips group rows', async () => {
  const ctx = fakeLoader([
    entry('a', 2),
    entry('a', 3),
    entry('b', 2),
    { options: { group: true }, fiber: { state: 2 } },
    { options: {}, fiber: { state: 2 } },
  ])
  const result = await readLoaderPhases(ctx)
  assert.equal(result.available, true)
  assert.deepEqual(result.byName.get('a'), ['active', 'failed'])
  assert.deepEqual(result.byName.get('b'), ['active'])
  assert.equal(result.byName.size, 2)
})

test('readLoaderPhases says so when the loader cannot be read', async () => {
  assert.equal((await readLoaderPhases({})).available, false)
  assert.equal((await readLoaderPhases({ loader: {} })).available, false)
  assert.equal(
    (
      await readLoaderPhases({
        loader: {
          entries() {
            throw new Error('boom')
          },
        },
      })
    ).available,
    false,
  )
})

test('a failed row carries the first rejection message, without its stack', async () => {
  const ctx = fakeLoader([
    {
      options: { name: 'broken' },
      fiber: {
        state: 3,
        await: () => Promise.reject(new Error('cannot resolve peer\n    at somewhere (file:///x.js:1:1)')),
      },
    },
  ])
  const result = await readLoaderPhases(ctx)
  assert.equal(result.diagnostic, 'cannot resolve peer')
})

test('buildPluginRows keeps the four facts apart and explains a missing phase', () => {
  const bundles = [
    {
      name: 'third-party',
      official: false,
      availability: 'profile',
      installed: true,
      enabled: true,
      version: '1.2.3',
      source: 'third-party@1.2.3',
    },
    {
      name: 'shipped',
      official: true,
      availability: 'installation',
      installed: false,
      enabled: true,
      version: '0.2.2-rc.1',
      source: undefined,
    },
  ]
  const rows = buildPluginRows({
    bundles,
    phases: new Map([['third-party', ['active']]]),
    phaseAvailable: true,
    phaseDiagnostic: undefined,
    profileId: 'demo',
    runtimeVersion: '0.2.2-rc.1',
  })

  assert.equal(rows.length, 2)
  const third = rows[0]
  assert.equal(third.targetId, 'third-party')
  assert.equal(third.installedVersion, '1.2.3')
  assert.equal(third.enabledState, 'enabled')
  assert.equal(third.loadState, 'active')
  assert.equal(third.loadStateReason, null)
  // Writable, not "updatable": this row says the host would accept a write,
  // never that a newer version exists.
  assert.equal(third.recoverability, 'writable')
  assert.equal(third.updateRefusal, null)
  // A row that has not had its manifest read is not a passing row.
  assert.equal(third.compatibility.verdict, 'unknown')
  assert.equal(third.prerelease, false)

  const shipped = rows[1]
  assert.equal(shipped.source.kind, 'builtin')
  assert.equal(shipped.recoverability, 'read_only')
  assert.equal(shipped.updateRefusal, 'official-bundle')
  // No loader entry under the bundle name is a fact, not a failure.
  assert.equal(shipped.loadState, null)
  assert.equal(shipped.loadStateReason, 'no-loader-entry')
  assert.equal(shipped.prerelease, true)
})

test('buildPluginRows distinguishes an unreadable loader from a missing entry', () => {
  const rows = buildPluginRows({
    bundles: [{ name: 'pkg', official: false, availability: 'profile', installed: true, enabled: false, version: '1.0.0', source: 'pkg@1.0.0' }],
    phases: new Map(),
    phaseAvailable: false,
    phaseDiagnostic: undefined,
    profileId: 'demo',
    runtimeVersion: null,
  })
  assert.equal(rows[0].loadState, null)
  assert.equal(rows[0].loadStateReason, 'loader-unavailable')
  assert.equal(rows[0].enabledState, 'disabled')
  assert.equal(rows[0].compatibility.runtimeVersion, null)
})

test('readProfileManifest reads both halves and ignores junk', () => {
  const manifest = {
    dependencies: { a: '1.0.0', b: 'file:./x.tgz', c: 42, d: null },
    dsh: { profile: { bundles: ['a', 7, null, 'b'] } },
  }
  assert.deepEqual(readProfileManifest(manifest), {
    dependencies: { a: '1.0.0', b: 'file:./x.tgz' },
    bundles: ['a', 'b'],
  })
  assert.deepEqual(readProfileManifest(undefined), { dependencies: {}, bundles: [] })
})
