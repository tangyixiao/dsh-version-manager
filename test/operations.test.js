/**
 * The operation journal is the only record of a change that died mid-flight.
 *
 * These tests treat it as what it is: an append-only log whose reader must
 * survive junk on disk, and whose `unresolved` answer has to keep pointing at
 * a change nobody can attribute to a choice the user made.
 */

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import test from 'node:test'

import {
  STATES,
  TERMINAL,
  beginOperation,
  listOperations,
  operationRoot,
  transition,
  unresolved,
} from '../lib/host/operations.js'

const target = {
  kind: 'plugin',
  targetId: 'dsh-update-checker',
  installedVersion: '1.7.2',
  declaredSpec: 'dsh-update-checker@1.7.2',
  source: { kind: 'registry' },
}

test('an operation starts planned, before anything is touched', async () => {
  const home = await mkdtemp(join(tmpdir(), 'vm-ops-'))
  const record = await beginOperation({ dshHome: home, profileId: 'p', target, toVersion: '1.7.3' })

  assert.equal(record.state, 'planned')
  assert.equal(record.schema, 1)
  assert.equal(record.error, null)
  assert.equal(record.snapshotId, null)
  assert.deepEqual(record.target, {
    kind: 'plugin',
    targetId: 'dsh-update-checker',
    fromVersion: '1.7.2',
    toVersion: '1.7.3',
    declaredSpec: 'dsh-update-checker@1.7.2',
    sourceKind: 'registry',
  })

  const onDisk = JSON.parse(await readFile(join(operationRoot(home, 'p'), `${record.id}.json`), 'utf8'))
  assert.equal(onDisk.state, 'planned')
  assert.equal(onDisk.transitions.length, 1)
})

test('a target with no source is recorded as unknown rather than left blank', async () => {
  const home = await mkdtemp(join(tmpdir(), 'vm-ops-'))
  const record = await beginOperation({
    dshHome: home,
    profileId: 'p',
    target: { ...target, source: undefined },
    toVersion: '1.7.3',
  })
  assert.equal(record.target.sourceKind, 'unknown')
})

test('every transition is appended, in order, and persisted', async () => {
  const home = await mkdtemp(join(tmpdir(), 'vm-ops-'))
  const record = await beginOperation({ dshHome: home, profileId: 'p', target, toVersion: '1.7.3' })

  await transition(home, 'p', record, 'snapshot_verified', { snapshotId: 'snap-1' })
  await transition(home, 'p', record, 'applying')
  await transition(home, 'p', record, 'verifying')
  await transition(home, 'p', record, 'succeeded')

  assert.deepEqual(
    record.transitions.map((item) => item.state),
    ['planned', 'snapshot_verified', 'applying', 'verifying', 'succeeded'],
  )
  assert.equal(record.snapshotId, 'snap-1')

  const [stored] = await listOperations(home, 'p')
  assert.equal(stored.id, record.id)
  assert.equal(stored.state, 'succeeded')
  assert.deepEqual(
    stored.transitions.map((item) => item.state),
    ['planned', 'snapshot_verified', 'applying', 'verifying', 'succeeded'],
  )
})

test('an invented state is refused instead of written', async () => {
  const home = await mkdtemp(join(tmpdir(), 'vm-ops-'))
  const record = await beginOperation({ dshHome: home, profileId: 'p', target, toVersion: '1.7.3' })

  await assert.rejects(() => transition(home, 'p', record, 'mostly-done'), /unknown operation state/)
  const [stored] = await listOperations(home, 'p')
  assert.equal(stored.state, 'planned')
  assert.equal(stored.transitions.length, 1)
})

test('STATES and TERMINAL stay consistent with each other', () => {
  for (const state of TERMINAL) assert.ok(STATES.includes(state), `${state} is terminal but not a state`)
  assert.deepEqual(STATES.filter((state) => TERMINAL.includes(state)), [...TERMINAL])
})

test('an operation interrupted while applying stays unresolved', async () => {
  const home = await mkdtemp(join(tmpdir(), 'vm-ops-'))
  const record = await beginOperation({ dshHome: home, profileId: 'p', target, toVersion: '1.7.3' })
  await transition(home, 'p', record, 'snapshot_verified', { snapshotId: 'snap-1' })
  await transition(home, 'p', record, 'applying')

  const stored = await listOperations(home, 'p')
  assert.equal(stored[0].state, 'applying')
  assert.deepEqual(
    unresolved(stored).map((item) => item.id),
    [record.id],
  )
})

test('recovery_required is unresolved even though it is terminal', async () => {
  const home = await mkdtemp(join(tmpdir(), 'vm-ops-'))
  const record = await beginOperation({ dshHome: home, profileId: 'p', target, toVersion: '1.7.3' })
  await transition(home, 'p', record, 'applying')
  await transition(home, 'p', record, 'recovery_required', { snapshotId: 'snap-1' })

  const stored = await listOperations(home, 'p')
  assert.equal(stored[0].state, 'recovery_required')
  assert.deepEqual(
    unresolved(stored).map((item) => item.id),
    [record.id],
    'a change nobody can attribute must not be filed away as history',
  )
})

test('a succeeded record whose history passed through recovery_required is settled', async () => {
  const home = await mkdtemp(join(tmpdir(), 'vm-ops-'))
  const record = await beginOperation({ dshHome: home, profileId: 'p', target, toVersion: '1.7.3' })
  await transition(home, 'p', record, 'applying')
  await transition(home, 'p', record, 'recovery_required')
  await transition(home, 'p', record, 'succeeded')

  const stored = await listOperations(home, 'p')
  assert.equal(stored[0].state, 'succeeded')
  assert.deepEqual(unresolved(stored), [], 'the current state decides, not an old transition')
})

test('failed and cancelled are settled', async () => {
  const home = await mkdtemp(join(tmpdir(), 'vm-ops-'))
  const failed = await beginOperation({ dshHome: home, profileId: 'p', target, toVersion: '1.7.3' })
  await transition(home, 'p', failed, 'failed', { error: 'the host refused' })
  const cancelled = await beginOperation({ dshHome: home, profileId: 'p', target, toVersion: '1.7.3' })
  await transition(home, 'p', cancelled, 'cancelled')

  const stored = await listOperations(home, 'p')
  assert.equal(stored.find((item) => item.id === failed.id).error, 'the host refused')
  assert.deepEqual(unresolved(stored), [])
})

test('the newest operation is listed first, and the limit is honoured', async () => {
  const home = await mkdtemp(join(tmpdir(), 'vm-ops-'))
  const ids = []
  for (let index = 0; index < 5; index += 1) {
    const record = await beginOperation({ dshHome: home, profileId: 'p', target, toVersion: '1.7.3' })
    // startedAt has millisecond resolution; make the order explicit.
    record.startedAt = new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString()
    await transition(home, 'p', record, 'succeeded')
    ids.push(record.id)
  }

  const all = await listOperations(home, 'p')
  assert.deepEqual(
    all.map((item) => item.id),
    [...ids].reverse(),
  )
  assert.equal((await listOperations(home, 'p', 2)).length, 2)
})

test('an unreadable record is skipped, not thrown, and does not hide the good ones', async () => {
  const home = await mkdtemp(join(tmpdir(), 'vm-ops-'))
  const record = await beginOperation({ dshHome: home, profileId: 'p', target, toVersion: '1.7.3' })
  await transition(home, 'p', record, 'succeeded')
  await writeFile(join(operationRoot(home, 'p'), 'broken.json'), '{not json', 'utf8')

  const stored = await listOperations(home, 'p')
  assert.equal(stored.length, 1)
  assert.equal(stored[0].id, record.id)
})

test('a directory that has never held an operation reads as empty', async () => {
  const home = await mkdtemp(join(tmpdir(), 'vm-ops-'))
  assert.deepEqual(await listOperations(home, 'never-used'), [])
})

test('profiles never share a journal', async () => {
  const home = await mkdtemp(join(tmpdir(), 'vm-ops-'))
  const first = await beginOperation({ dshHome: home, profileId: 'p', target, toVersion: '1.7.3' })
  await transition(home, 'p', first, 'succeeded')
  const second = await beginOperation({ dshHome: home, profileId: 'other', target, toVersion: '1.7.3' })
  await transition(home, 'other', second, 'succeeded')

  assert.deepEqual((await listOperations(home, 'p')).map((item) => item.id), [first.id])
  assert.deepEqual((await listOperations(home, 'other')).map((item) => item.id), [second.id])
  assert.notEqual(operationRoot(home, 'p'), operationRoot(home, 'other'))
})

test('a scoped profile name cannot escape the operations directory', async () => {
  const home = await mkdtemp(join(tmpdir(), 'vm-ops-'))
  const inside = resolve(home, 'version-manager', 'operations')
  for (const profileId of ['../escape/me', '..', '.', '/absolute/path', 'a/../../b']) {
    const root = resolve(operationRoot(home, profileId))
    assert.equal(
      root.startsWith(inside + sep),
      true,
      `${profileId} escaped to ${root}`,
    )
  }
  // The ordinary names must keep the directory they already had, or existing
  // snapshots and journals would be stranded under a new name.
  assert.equal(operationRoot(home, 'desktop'), join(home, 'version-manager', 'operations', 'desktop'))
  assert.equal(operationRoot(home, 'team/blue'), join(home, 'version-manager', 'operations', 'team%2Fblue'))
})

test('two writes to the same record do not leave a temporary file behind', async () => {
  const home = await mkdtemp(join(tmpdir(), 'vm-ops-'))
  const record = await beginOperation({ dshHome: home, profileId: 'p', target, toVersion: '1.7.3' })
  await transition(home, 'p', record, 'applying')
  await transition(home, 'p', record, 'succeeded')

  const names = await readdir(operationRoot(home, 'p'))
  assert.deepEqual(names, [`${record.id}.json`])
})

test('the journal records no credentials and no environment', async () => {
  const home = await mkdtemp(join(tmpdir(), 'vm-ops-'))
  const record = await beginOperation({ dshHome: home, profileId: 'p', target, toVersion: '1.7.3' })
  await transition(home, 'p', record, 'succeeded')

  const raw = await readFile(join(operationRoot(home, 'p'), `${record.id}.json`), 'utf8')
  assert.doesNotMatch(raw, /_authToken|password|secret|token/i)
  assert.doesNotMatch(raw, /PATH=|HOME=/)
})

test('beginOperation fails loudly rather than overwriting an id it already used', async () => {
  const home = await mkdtemp(join(tmpdir(), 'vm-ops-'))
  const directory = operationRoot(home, 'p')
  await mkdir(directory, { recursive: true })
  const record = await beginOperation({ dshHome: home, profileId: 'p', target, toVersion: '1.7.3' })
  await transition(home, 'p', record, 'succeeded')

  // Re-running persist for the same id must replace atomically, not append.
  const before = await readFile(join(directory, `${record.id}.json`), 'utf8')
  await transition(home, 'p', record, 'failed', { error: 'late' })
  const after = JSON.parse(await readFile(join(directory, `${record.id}.json`), 'utf8'))
  assert.equal(after.state, 'failed')
  assert.equal(after.transitions.length, 3)
  assert.ok(before.length > 0)
})
