/**
 * Taking a version from "planned" to "verified", one step at a time.
 *
 * The host's own update path is two profile operations (remove, then install),
 * so a process that dies in the middle leaves the profile in a state nobody
 * chose. This module does not try to make that atomic — it cannot, and claiming
 * otherwise would be the single most dangerous lie a version manager can tell.
 * What it does instead is write the intent down before the first byte changes,
 * so the panel can say afterwards which step was reached:
 *
 *   planned → snapshot_verified → applying → verifying → succeeded
 *                                              ↘ failed / cancelled / recovery_required
 *
 * Every transition is appended to an operation record on disk. A record that
 * ends in `applying` is a record of a change whose outcome is unknown, and that
 * is exactly what a `recovery_required` badge is for.
 *
 * @module dsh-version-manager/lib/host/operations
 */

import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

/** The states a change can be in. Order matters: it is the order they occur. */
export const STATES = Object.freeze([
  'planned',
  'snapshot_verified',
  'applying',
  'verifying',
  'succeeded',
  'failed',
  'cancelled',
  'recovery_required',
])

/** States after which nothing more will happen without a new explicit action. */
export const TERMINAL = Object.freeze(['succeeded', 'failed', 'cancelled', 'recovery_required'])

/**
 * Where operation records live for one profile.
 *
 * @param {string} dshHome
 * @param {string} profileId
 * @returns {string}
 */
export function operationRoot(dshHome, profileId) {
  return join(dshHome, 'version-manager', 'operations', encodeSegment(profileId))
}

/**
 * @param {string} value
 * @returns {string}
 */
function encodeSegment(value) {
  return value.replace(/\//g, '%2F').replace(/[^A-Za-z0-9%._@-]/g, '_')
}

/**
 * Start a record.
 *
 * Written before anything is touched, and written with `flag: 'wx'` so an id
 * collision fails loudly instead of overwriting another operation's history.
 *
 * @param {object} input
 * @param {string} input.dshHome
 * @param {string} input.profileId
 * @param {object} input.target
 * @param {string} input.toVersion
 * @returns {Promise<object>}
 */
export async function beginOperation(input) {
  const { dshHome, profileId, target, toVersion } = input
  const directory = operationRoot(dshHome, profileId)
  await mkdir(directory, { recursive: true })

  const record = {
    schema: 1,
    id: randomUUID(),
    startedAt: new Date().toISOString(),
    state: 'planned',
    profile: { id: profileId },
    target: {
      kind: target.kind,
      targetId: target.targetId,
      fromVersion: target.installedVersion,
      toVersion,
      declaredSpec: target.declaredSpec,
      sourceKind: target.source?.kind ?? 'unknown',
    },
    transitions: [{ state: 'planned', at: new Date().toISOString() }],
    error: null,
    snapshotId: null,
  }

  await writeFile(join(directory, `${record.id}.json`), JSON.stringify(record, null, 2), {
    encoding: 'utf8',
    flag: 'wx',
  })
  return record
}

/**
 * Append one transition and persist it.
 *
 * @param {string} dshHome
 * @param {string} profileId
 * @param {object} record
 * @param {string} state
 * @param {{ error?: string | null, snapshotId?: string | null, detail?: string | null }} [extra]
 * @returns {Promise<object>}
 */
export async function transition(dshHome, profileId, record, state, extra = {}) {
  if (!STATES.includes(state)) throw new Error(`unknown operation state: ${state}`)
  record.state = state
  record.transitions.push({ state, at: new Date().toISOString() })
  if (extra.error !== undefined) record.error = extra.error
  if (extra.snapshotId !== undefined) record.snapshotId = extra.snapshotId
  if (extra.detail !== undefined) record.detail = extra.detail
  await persist(dshHome, profileId, record)
  return record
}

/**
 * @param {string} dshHome
 * @param {string} profileId
 * @param {object} record
 */
async function persist(dshHome, profileId, record) {
  const directory = operationRoot(dshHome, profileId)
  const target = join(directory, `${record.id}.json`)
  const temporary = join(directory, `.${record.id}.tmp`)
  await writeFile(temporary, JSON.stringify(record, null, 2), { encoding: 'utf8', flag: 'w' })
  await rename(temporary, target)
}

/**
 * The newest records first.
 *
 * @param {string} dshHome
 * @param {string} profileId
 * @param {number} [limit]
 * @returns {Promise<object[]>}
 */
export async function listOperations(dshHome, profileId, limit = 20) {
  const directory = operationRoot(dshHome, profileId)
  let names
  try {
    names = await readdir(directory)
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
  const rows = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    try {
      rows.push(JSON.parse(await readFile(join(directory, name), 'utf8')))
    } catch {
      // An unreadable record is not a reason to hide the readable ones.
    }
  }
  rows.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))
  return rows.slice(0, limit)
}

/**
 * Records that claim a change started but never reached a terminal state.
 *
 * This is the one place where "we do not know" has to be surfaced as its own
 * answer: the process died mid-change, so the profile may be fine, may be
 * half-updated, or may be broken, and no reading of the current state can tell
 * which. The panel shows these as `recovery_required` and points at the
 * snapshot, rather than reporting the current version as if it were chosen.
 *
 * @param {object[]} operations
 * @returns {object[]}
 */
export function unresolved(operations) {
  return operations.filter(
    (record) =>
      !TERMINAL.includes(record.state) ||
      record.state === 'recovery_required',
  )
}
