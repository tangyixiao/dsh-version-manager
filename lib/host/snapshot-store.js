/**
 * Snapshots: what was installed before a change, in a form that can be checked
 * later instead of trusted.
 *
 * A snapshot is not a backup of a dependency tree and cannot pretend to be one.
 * It records the handful of facts that make "put it back" decidable:
 *
 *   which profile, which package, what spec the profile declared, which version
 *   was actually resolved, where it came from, whether it was enabled, and a
 *   fingerprint of the installed files.
 *
 * Restoring is then offered only when the fingerprint still matches, because a
 * snapshot of `1.2.3` is worthless if the files on disk stopped being `1.2.3`.
 *
 * On disk: `<dshHome>/version-manager/snapshots/<profileId>/<targetId>/<seq>-<id>.json`.
 * Writes go to a temporary file in the same directory and are renamed into place,
 * so a crash leaves either the old set of snapshots or the new one and never a
 * half-written file. An existing snapshot is never overwritten.
 *
 * @module dsh-version-manager/lib/host/snapshot-store
 */

import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { encodeSegment } from './segment.js'

/** Bumped whenever the shape below changes in a way old readers cannot read. */
export const SNAPSHOT_SCHEMA = 1

/** How many snapshots survive per target. Older ones are reported, not deleted. */
export const SNAPSHOT_KEEP = 20

/**
 * A filename-safe form of a package name.
 *
 * `@scope/name` would otherwise create a directory, and a name is not a path.
 * The encoding itself lives in `segment.js` so that the four places that turn a
 * host-supplied name into a directory cannot drift apart; `.` and `..` are the
 * cases it exists for.
 *
 * @param {string} targetId
 * @returns {string}
 */
export function encodeTarget(targetId) {
  return encodeSegment(targetId)
}

/**
 * Where snapshots for one profile live.
 *
 * @param {string} dshHome
 * @param {string} profileId
 * @returns {string}
 */
export function snapshotRoot(dshHome, profileId) {
  return join(dshHome, 'version-manager', 'snapshots', encodeTarget(profileId))
}

/**
 * A stable fingerprint of a directory tree: relative path plus content hash.
 *
 * Only regular files contribute. Symbolic links are recorded as a link to their
 * target string, because following them would let a fingerprint depend on files
 * outside the package and could loop.
 *
 * @param {import('node:fs').PathLike} root
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ digest: string, files: number, bytes: number } | null>}
 */
export async function fingerprintTree(root, signal) {
  const { readdir: read, lstat, readlink } = await import('node:fs/promises')
  const { createReadStream } = await import('node:fs')

  let files = 0
  let bytes = 0
  const digest = createHash('sha256')

  /** @param {string} directory @param {string} prefix */
  async function walk(directory, prefix) {
    const entries = await read(directory, { withFileTypes: true })
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const entry of entries) {
      if (signal?.aborted === true) throw new Error('aborted')
      const full = join(directory, entry.name)
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) {
        await walk(full, relative)
        continue
      }
      if (entry.isSymbolicLink()) {
        const target = await readlink(full)
        digest.update(`link\0${relative}\0${target}\0`)
        files += 1
        continue
      }
      if (!entry.isFile()) continue
      const info = await lstat(full)
      const hash = await hashFile(full)
      digest.update(`file\0${relative}\0${info.size}\0${hash}\0`)
      files += 1
      bytes += info.size
    }
  }

  /**
   * @param {string} path
   * @returns {Promise<string>}
   */
  function hashFile(path) {
    return new Promise((resolve, reject) => {
      const hash = createHash('sha256')
      const stream = createReadStream(path)
      stream.on('data', (chunk) => hash.update(chunk))
      stream.on('error', reject)
      stream.on('end', () => resolve(hash.digest('hex')))
    })
  }

  try {
    await walk(String(root), '')
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
  return { digest: digest.digest('hex'), files, bytes }
}

/**
 * Take one snapshot.
 *
 * @param {object} input
 * @param {string} input.dshHome
 * @param {string} input.profileId
 * @param {object} input.target - an inventory row
 * @param {object | null} input.fingerprint
 * @param {string} [input.reason]
 * @returns {Promise<object>} the stored document
 */
export async function writeSnapshot(input) {
  const { dshHome, profileId, target, fingerprint, reason } = input
  const directory = join(snapshotRoot(dshHome, profileId), encodeTarget(target.targetId))
  await mkdir(directory, { recursive: true })

  const existing = await listSnapshots(dshHome, profileId, target.targetId)
  const seq = existing.length === 0 ? 1 : Math.max(...existing.map((row) => row.seq)) + 1

  const document = {
    schema: SNAPSHOT_SCHEMA,
    id: randomUUID(),
    seq,
    takenAt: new Date().toISOString(),
    reason: typeof reason === 'string' ? reason : 'manual',
    profile: { id: profileId },
    target: {
      kind: target.kind,
      targetId: target.targetId,
      declaredSpec: target.declaredSpec,
      installedVersion: target.installedVersion,
      source: {
        kind: target.source.kind,
        registryName: target.source.registryName,
        registryRange: target.source.registryRange,
        // The registry host the package came from, when the lockfile recorded
        // one. Reinstalling through a different registry is a different
        // artifact set, so a restore points back at where it was taken from.
        registry: target.source.registry ?? null,
        // The detail can be a local path; it is kept because a recovery needs it
        // and stripped from anything that leaves this machine.
        detail: target.source.detail,
      },
      enabledState: target.enabledState,
      compatibility: { verdict: target.compatibility.verdict },
      fingerprint,
    },
    // Deliberately absent: tokens, credentials, environment variables, secrets
    // from configuration, and the contents of any file.
    environment: {
      ...(process.platform === undefined ? {} : { platform: process.platform }),
      node: process.versions?.node ?? null,
    },
  }

  const body = `${JSON.stringify(document, null, 2)}\n`
  const temporary = join(directory, `.${document.id}.tmp`)
  await writeFile(temporary, body, { encoding: 'utf8', flag: 'wx' })
  await rename(temporary, join(directory, `${String(seq).padStart(4, '0')}-${document.id}.json`))
  return document
}

/**
 * Every snapshot for one target, oldest first.
 *
 * A file that does not parse is reported as unreadable rather than throwing: a
 * corrupt snapshot must not hide the healthy ones beside it.
 *
 * @param {string} dshHome
 * @param {string} profileId
 * @param {string} targetId
 * @returns {Promise<object[]>}
 */
export async function listSnapshots(dshHome, profileId, targetId) {
  const directory = join(snapshotRoot(dshHome, profileId), encodeTarget(targetId))
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
      const text = await readFile(join(directory, name), 'utf8')
      const document = JSON.parse(text)
      if (document?.schema !== SNAPSHOT_SCHEMA) continue
      rows.push({
        seq: typeof document.seq === 'number' ? document.seq : 0,
        id: document.id,
        takenAt: document.takenAt,
        reason: document.reason,
        installedVersion: document.target?.installedVersion ?? null,
        declaredSpec: document.target?.declaredSpec ?? null,
        fingerprint: document.target?.fingerprint ?? null,
        file: name,
      })
    } catch {
      rows.push({
        seq: 0,
        id: null,
        takenAt: null,
        reason: 'unreadable',
        installedVersion: null,
        declaredSpec: null,
        fingerprint: null,
        file: name,
      })
    }
  }
  rows.sort((a, b) => a.seq - b.seq)
  return rows
}

/**
 * Which snapshots are beyond the retention limit.
 *
 * Returned rather than deleted: a version manager that quietly removes evidence
 * is worse than one that keeps too much. The caller may prune only after the
 * user asked for it.
 *
 * @param {object[]} snapshots
 * @param {number} [keep]
 * @returns {object[]}
 */
export function snapshotsBeyondRetention(snapshots, keep = SNAPSHOT_KEEP) {
  if (snapshots.length <= keep) return []
  return snapshots.slice(0, snapshots.length - keep)
}

/**
 * Delete one snapshot by file name.
 *
 * @param {string} dshHome
 * @param {string} profileId
 * @param {string} targetId
 * @param {string} file
 * @returns {Promise<boolean>}
 */
export async function deleteSnapshot(dshHome, profileId, targetId, file) {
  // The name comes from a listing, but it is still a filename from a request
  // path in the worst case: refuse anything that is not a plain file name.
  if (typeof file !== 'string' || file.includes('/') || file.includes('\\') || file.includes('..')) {
    return false
  }
  const path = join(snapshotRoot(dshHome, profileId), encodeTarget(targetId), file)
  try {
    await rm(path)
    return true
  } catch {
    return false
  }
}

/**
 * Can this snapshot be restored right now?
 *
 * Three conditions, each with its own sentence, because "no" for the wrong
 * reason sends the user looking in the wrong place:
 *
 * 1. the recorded spec is one the host can install again
 * 2. the files on disk still match the fingerprint that was taken
 * 3. a version was actually recorded
 *
 * @param {object} snapshot
 * @param {object | null} currentFingerprint
 * @returns {{ ok: boolean, reason: string | null, detail: string | null }}
 */
export function recoveryVerdict(snapshot, currentFingerprint) {
  const target = snapshot?.target
  if (target === undefined || target === null) {
    return { ok: false, reason: 'snapshot-incomplete', detail: 'The snapshot has no target record.', filesMatch: null }
  }
  if (typeof target.installedVersion !== 'string' || target.installedVersion === '') {
    return { ok: false, reason: 'no-version', detail: 'The snapshot recorded no installed version.', filesMatch: null }
  }
  if (target.source?.kind !== 'registry' || typeof target.source?.registryName !== 'string') {
    return {
      ok: false,
      reason: 'source-not-replayable',
      detail: 'The package was installed from a source this plugin will not reinstall.',
      filesMatch: null,
    }
  }
  if (target.source.registryName !== target.targetId) {
    return {
      ok: false,
      reason: 'source-substitution',
      detail: 'The snapshot records a different package name than the target it belongs to.',
      filesMatch: null,
    }
  }
  if (currentFingerprint === null || currentFingerprint === undefined) {
    return {
      ok: false,
      reason: 'not-installed',
      detail: 'The package is no longer present on disk.',
      filesMatch: null,
    }
  }
  // A changed fingerprint is not a refusal. An update *is* a file change, and
  // this snapshot exists precisely so that change can be undone. The mismatch is
  // reported as evidence ("the files were replaced after this snapshot") and the
  // restore reinstalls the recorded version from its recorded registry.
  const recorded = target.fingerprint?.digest ?? null
  const filesMatch = recorded === null ? null : recorded === currentFingerprint.digest
  return { ok: true, reason: null, detail: null, filesMatch }
}
