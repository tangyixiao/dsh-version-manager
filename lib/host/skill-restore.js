/**
 * Putting one skill directory back to a snapshot that was taken of it.
 *
 * This is the only module in the plugin that writes into a user's skill
 * directory, so it is written to fail closed and to leave a way back:
 *
 *   1. the snapshot must be about *this* skill and *this* directory;
 *   2. the stored copy is re-fingerprinted and must still match its manifest,
 *      because a snapshot whose bytes drifted is not a baseline;
 *   3. the directory as it stands right now is snapshotted first, so the
 *      restore itself can be undone;
 *   4. the replacement is assembled in a sibling staging directory, verified
 *      against the same digest, and only then swapped in — same volume, two
 *      renames, with the old directory parked beside it rather than deleted.
 *
 * Two things this module deliberately never does:
 *
 * - It never runs a Git command. Not `checkout`, not `reset`, not `clean`. The
 *   snapshot store already holds the exact bytes, so there is nothing a
 *   checkout could add and plenty it could ruin.
 * - It refuses to write into a directory that belongs to a Git checkout, and
 *   into the host's own `.system` tree. A restore that silently rewrites
 *   tracked files, or that edits the skills shipped with the host, is not a
 *   restore a user can reason about.
 *
 * @module dsh-version-manager/lib/host/skill-restore
 */

import { randomUUID } from 'node:crypto'
import { cp, mkdir, readFile, readdir, rename, rm } from 'node:fs/promises'
import { dirname, join, sep } from 'node:path'

import { fingerprintTree } from './snapshot-store.js'
import { directoryState, listSkillSnapshots, readGitState, snapshotSkill } from './skills.js'

/**
 * @param {string} dshHome
 * @param {string} profileId
 * @param {string} name
 * @returns {string}
 */
function skillRoot(dshHome, profileId, name) {
  return join(dshHome, 'version-manager', 'skills', profileId, name)
}

/**
 * True when a path contains a `.system` segment.
 *
 * The host's filesystem provider skips `.system` when it discovers skills, so a
 * skill can never legitimately live there; a path that reaches it came from
 * somewhere other than the catalog.
 *
 * @param {string} path
 * @returns {boolean}
 */
export function isSystemPath(path) {
  const parts = String(path).split(/[\\/]+/)
  return parts.some((part) => part === '.system')
}

/**
 * Read one stored manifest and confirm it still describes its own copy.
 *
 * @param {object} input
 * @param {string} input.dshHome
 * @param {string} input.profileId
 * @param {string} input.name
 * @param {string} input.file - a manifest file name from listSkillSnapshots
 * @returns {Promise<{ ok: boolean, reason: string | null, document: object | null, copy: string | null }>}
 */
export async function readSkillSnapshot(input) {
  const { dshHome, profileId, name, file } = input
  if (typeof file !== 'string' || file === '' || file.includes('/') || file.includes('\\') || file.includes('..')) {
    return { ok: false, reason: 'bad-snapshot-file', document: null, copy: null }
  }
  const root = skillRoot(dshHome, profileId, name)
  let document
  try {
    document = JSON.parse(await readFile(join(root, file), 'utf8'))
  } catch {
    return { ok: false, reason: 'snapshot-unreadable', document: null, copy: null }
  }
  if (document?.kind !== 'skill' || document?.skill?.name !== name) {
    return { ok: false, reason: 'snapshot-mismatch', document: null, copy: null }
  }
  const copy = typeof document.copy === 'string' && document.copy !== '' ? join(root, document.copy) : null
  if (copy === null) return { ok: false, reason: 'snapshot-copy-missing', document: null, copy: null }
  const state = await directoryState(copy)
  if (state !== 'directory') return { ok: false, reason: 'snapshot-copy-missing', document: null, copy: null }
  return { ok: true, reason: null, document, copy }
}

/**
 * Whether a catalog row may be written at all, independent of any snapshot.
 *
 * The panel asks this once per row so a restore button is disabled for a
 * reason the user can read, instead of failing after the click.
 *
 * @param {{ directory: string | null, source?: string | null, git?: { managed?: boolean } | null }} skill
 * @returns {string | null} a reason code, or null when a restore is allowed
 */
export function skillRestoreRefusal(skill) {
  if (skill.directory === null || skill.directory === undefined) return 'no-directory'
  if (isSystemPath(skill.directory)) return 'system-skill'
  if (skill.git?.managed === true) return 'inside-git-checkout'
  if (skill.source === 'bundled') return 'bundled-skill'
  return null
}

/**
 * Everything a restore would do, without doing it.
 *
 * The panel calls this before showing its confirmation bar: a restore that is
 * going to be refused should say so while the user is reading, not after they
 * click.
 *
 * @param {object} input
 * @param {string} input.dshHome
 * @param {string} input.profileId
 * @param {string} input.name
 * @param {string} input.directory
 * @param {string} input.file
 * @returns {Promise<{ ok: boolean, reason: string | null, detail: object | null }>}
 */
export async function previewSkillRestore(input) {
  const { dshHome, profileId, name, directory, file } = input
  const read = await readSkillSnapshot({ dshHome, profileId, name, file })
  if (!read.ok) return { ok: false, reason: read.reason, detail: null }

  const document = read.document
  if (document.skill.directory !== directory) {
    // A snapshot of a different directory can never be the baseline for this
    // one, even when both happen to carry the same skill name.
    return { ok: false, reason: 'snapshot-directory-mismatch', detail: null }
  }
  const refusal = skillRestoreRefusal({ directory, git: await readGitState(directory) })
  if (refusal !== null) return { ok: false, reason: refusal, detail: null }

  const recordedDigest = typeof document.skill.digest === 'string' ? document.skill.digest : null
  const copyFingerprint = await fingerprintTree(read.copy)
  if (recordedDigest === null || copyFingerprint === null || copyFingerprint.digest !== recordedDigest) {
    return { ok: false, reason: 'snapshot-copy-corrupt', detail: null }
  }

  const current = await fingerprintTree(directory)
  return {
    ok: true,
    reason: null,
    detail: {
      recordedDigest,
      currentDigest: current === null ? null : current.digest,
      // `sameFiles` is evidence, not a gate: a restore exists precisely because
      // the directory moved away from the snapshot.
      sameFiles: current === null ? null : current.digest === recordedDigest,
      digestVerified: true,
      files: copyFingerprint.files,
      bytes: copyFingerprint.bytes,
      takenAt: document.takenAt ?? null,
      revision: document.git?.revision ?? null,
    },
  }
}

/**
 * Put one skill directory back to a stored snapshot.
 *
 * @param {object} input
 * @param {string} input.dshHome
 * @param {string} input.profileId
 * @param {string} input.name
 * @param {string} input.directory
 * @param {string} input.file
 * @returns {Promise<{ ok: boolean, reason: string | null, message: string | null,
 *   evidence: object | null, restoredTo: string | null, undo: string | null }>}
 */
export async function restoreSkillSnapshot(input) {
  const { dshHome, profileId, name, directory, file } = input
  const preview = await previewSkillRestore({ dshHome, profileId, name, directory, file })
  if (!preview.ok) {
    return { ok: false, reason: preview.reason, message: null, evidence: null, restoredTo: null, undo: null }
  }

  const read = await readSkillSnapshot({ dshHome, profileId, name, file })
  if (!read.ok || read.copy === null) {
    return { ok: false, reason: read.reason, message: null, evidence: null, restoredTo: null, undo: null }
  }
  const target = directory
  const witness = 'version-manager restore'
  const parent = dirname(target)
  const base = target.slice(parent.length).replace(/^[\\/]+/, '')
  const suffix = randomUUID().slice(0, 8)
  const staging = join(parent, `.${base}.${witness}-${suffix}`)
  const parked = join(parent, `.${base}.${witness}-old-${suffix}`)

  const state = await directoryState(target)
  if (state !== 'directory' && state !== 'missing') {
    return { ok: false, reason: 'not-a-directory', message: null, evidence: null, restoredTo: null, undo: null }
  }

  // Keep a way back before touching anything. A directory that is already gone
  // has nothing worth keeping, and reporting a snapshot that does not exist
  // would be worse than reporting none.
  let undo = null
  if (state === 'directory') {
    try {
      const saved = await snapshotSkill({
        dshHome,
        profileId,
        name,
        directory: target,
        git: null,
        reason: 'before-restore',
      })
      undo = saved.manifest.skill.digest
    } catch (error) {
      return {
        ok: false,
        reason: 'undo-snapshot-failed',
        message: error instanceof Error ? error.message : String(error),
        evidence: null,
        restoredTo: null,
        undo: null,
      }
    }
  }

  const cleanup = async () => {
    await rm(staging, { recursive: true, force: true }).catch(() => {})
  }

  try {
    await mkdir(staging, { recursive: true })
    await cp(read.copy, staging, { recursive: true, dereference: false, force: true, errorOnExist: false })
  } catch (error) {
    await cleanup()
    return {
      ok: false,
      reason: 'staging-failed',
      message: error instanceof Error ? error.message : String(error),
      evidence: null,
      restoredTo: null,
      undo,
    }
  }

  const staged = await fingerprintTree(staging)
  const expected = read.document.skill.digest
  if (staged === null || staged.digest !== expected) {
    await cleanup()
    return {
      ok: false,
      reason: 'staged-copy-corrupt',
      message: null,
      evidence: null,
      restoredTo: null,
      undo,
    }
  }

  let parkedOk = state === 'missing'
  try {
    if (state === 'directory') {
      await rename(target, parked)
      parkedOk = true
    }
    await rename(staging, target)
  } catch (error) {
    // Put the original back if the swap did not complete. If even that fails,
    // say so with the parked path rather than claiming a clean failure.
    if (parkedOk && state === 'directory') {
      await rename(parked, target).catch(() => {})
    }
    await cleanup()
    return {
      ok: false,
      reason: 'swap-failed',
      message: error instanceof Error ? error.message : String(error),
      evidence: { parked },
      restoredTo: null,
      undo,
    }
  }

  const placed = await fingerprintTree(target)
  if (placed === null || placed.digest !== expected) {
    return {
      ok: false,
      reason: 'verification-failed',
      message: null,
      evidence: { parked: parkedOk ? parked : null, placedDigest: placed === null ? null : placed.digest },
      restoredTo: null,
      undo,
    }
  }

  if (parkedOk && state === 'directory') {
    await rm(parked, { recursive: true, force: true }).catch(() => {})
  }

  return {
    ok: true,
    reason: null,
    message: null,
    evidence: {
      digest: placed.digest,
      files: placed.files,
      recordedDigest: expected,
      previousDigest: preview.detail?.currentDigest ?? null,
      directoryExisted: state === 'directory',
    },
    restoredTo: read.document.takenAt ?? null,
    undo,
  }
}

/**
 * The snapshot files for one skill, for a caller that wants to offer undo.
 *
 * @param {string} dshHome
 * @param {string} profileId
 * @param {string} name
 * @returns {Promise<object[]>}
 */
export async function listRestorableSnapshots(dshHome, profileId, name) {
  const rows = await listSkillSnapshots(dshHome, profileId, name)
  return rows.filter((row) => row.unreadable !== true && row.digest !== null)
}

/**
 * Path segments of a directory, used by tests to assert nothing escaped.
 *
 * @param {string} path
 * @returns {string[]}
 */
export function segments(path) {
  return String(path).split(sep)
}
