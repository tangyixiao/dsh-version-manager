import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { restoreSnapshot } from '../lib/host/routes.js'
import { fingerprintTree, listSnapshots, writeSnapshot } from '../lib/host/snapshot-store.js'

const TARGET = 'dsh-update-checker'

/**
 * A throwaway home with one installed package inside one profile.
 *
 * The directory is real because a restore fingerprints real files: a fake tree
 * would let the test pass while the plugin could not tell the versions apart.
 */
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'dvm-undo-'))
  const dir = join(home, 'profiles', 'test')
  const installed = join(dir, 'node_modules', TARGET)
  await mkdir(installed, { recursive: true })
  await writeFile(join(installed, 'package.json'), JSON.stringify({ name: TARGET, version: '1.7.3' }))
  await writeFile(join(installed, 'index.js'), 'export const version = "1.7.3"\n')
  return { home, dir, installed }
}

/** A plugin manager whose installed version is whatever `state.version` says. */
function fakePluginManager(state) {
  return {
    async listBundles() {
      return [
        {
          name: TARGET,
          official: false,
          availability: 'profile',
          source: `${TARGET}@${state.version}`,
          enabled: true,
          installed: true,
          version: state.version,
        },
      ]
    },
    async installBundle(spec) {
      state.installs.push(spec)
      state.version = spec.slice(spec.lastIndexOf('@') + 1)
      return { from: null, to: state.version, step: 'install', result: { changed: true, application: 'applied' } }
    },
    async removeBundle() {
      state.removals += 1
      return { result: { changed: true, application: 'applied' } }
    },
  }
}

function context(home, dir, manager) {
  return {
    get(name) {
      if (name === 'profileContext') return { name: 'test', home, dir, cwd: dir }
      if (name === 'pluginManager') return manager
      return undefined
    },
  }
}

/** One snapshot of the package as it stands, the way the update path writes it. */
async function snapshotOf(home, version) {
  return writeSnapshot({
    dshHome: home,
    profileId: 'test',
    target: {
      kind: 'plugin',
      targetId: TARGET,
      declaredSpec: `${TARGET}@${version}`,
      installedVersion: version,
      source: { kind: 'registry', registryName: TARGET, registryRange: version, detail: null },
      enabledState: 'enabled',
      compatibility: { verdict: 'satisfied' },
    },
    fingerprint: await fingerprintTree(join(home, 'profiles', 'test', 'node_modules', TARGET)),
    reason: 'manual',
  })
}

test('a restore records the version it replaced, so the restore itself can be undone', async () => {
  const { home, dir } = await fixture()
  const state = { version: '1.7.3', installs: [], removals: 0 }
  const manager = fakePluginManager(state)
  const ctx = context(home, dir, manager)

  // The snapshot the user is restoring to: the version they were on before.
  const recorded = await snapshotOf(home, '1.7.2')

  const response = await restoreSnapshot(ctx, { targetId: TARGET, snapshotId: recorded.id })

  assert.equal(response.status, 200)
  assert.equal(response.body.ok, true)
  assert.equal(response.body.restoredVersion, '1.7.2')

  // The swap happened…
  assert.deepEqual(state.installs, [`${TARGET}@1.7.2`])
  // …and it left a way back: a snapshot of 1.7.3, taken before the reinstall.
  const rows = await listSnapshots(home, 'test', TARGET)
  const undo = rows.find((row) => row.reason === 'before restore to 1.7.2')
  assert.notEqual(undo, undefined, 'a restore must snapshot what it replaces')
  assert.equal(undo.installedVersion, '1.7.3')

  // The reply names that snapshot, so a caller does not have to scan to find it.
  assert.equal(response.body.undo.id, undo.id)
  assert.equal(response.body.undo.version, '1.7.3')

  // And the operation says which snapshot protects the change it made.
  assert.equal(response.body.operationId.length > 0, true)

  await rm(home, { recursive: true, force: true })
})

test('a restore that finds the profile already there records nothing to undo', async () => {
  const { home, dir } = await fixture()
  // Already on 1.7.2: there is nothing to replace, so nothing should be written.
  const state = { version: '1.7.2', installs: [], removals: 0 }
  const ctx = context(home, dir, fakePluginManager(state))

  const recorded = await snapshotOf(home, '1.7.2')
  const before = await listSnapshots(home, 'test', TARGET)

  const response = await restoreSnapshot(ctx, { targetId: TARGET, snapshotId: recorded.id })

  assert.equal(response.status, 200)
  assert.equal(response.body.alreadyAtVersion, true)
  assert.deepEqual(state.installs, [])
  const after = await listSnapshots(home, 'test', TARGET)
  assert.equal(after.length, before.length, 'an unchanged profile gets no extra snapshot')

  await rm(home, { recursive: true, force: true })
})
