/**
 * Skills whose content comes from a Git tree the user named.
 *
 * A Skill is a directory with no version field, so "update this Skill" has no
 * meaning until someone says where its bytes should come from. This module is
 * that statement, and nothing more:
 *
 *   - the user registers a name, a remote and the exact subpath inside it;
 *   - the plugin keeps its own bare cache of that remote under its own storage,
 *     and runs every Git command with `--git-dir <cache>`. It never runs a Git
 *     command inside the Skill directory, so the user's checkout — branch,
 *     index and worktree — is not something this plugin can touch;
 *   - an update exports the tree of a commit into a sibling staging directory,
 *     fingerprints it, and only then swaps it in with two renames;
 *   - a Skill whose files no longer match the digest recorded at the last apply
 *     has local modifications, and it is refused rather than overwritten.
 *
 * What it deliberately refuses to do: guess a remote, fetch into a repository
 * the user owns, write anywhere but the registered directory, or claim that a
 * Skill has a version. Nothing here runs `checkout`, `reset`, `clean` or any
 * other command that changes a working tree.
 *
 * @module dsh-version-manager/lib/host/git-skill
 */

import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'

import { fingerprintTree } from './snapshot-store.js'
import { isSystemPath } from './skill-restore.js'
import { readGitState, snapshotSkill } from './skills.js'

const GIT_TIMEOUT_MS = 20000
const MAX_HISTORY = 30

/**
 * Run a bounded Git command that cannot prompt and cannot colour its output.
 *
 * @param {string[]} args
 * @param {{ cwd?: string, timeout?: number }} [options]
 * @returns {Promise<{ ok: boolean, stdout: string, stderr: string, code: string | null }>}
 */
function runGit(args, options = {}) {
  return new Promise((done) => {
    execFile(
      'git',
      args,
      {
        cwd: options.cwd,
        timeout: options.timeout ?? GIT_TIMEOUT_MS,
        windowsHide: true,
        shell: false,
        encoding: 'utf8',
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo', LC_ALL: 'C' },
        maxBuffer: 8 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          const code = error.code === 'ENOENT' ? 'git-not-found' : error.killed ? 'git-timeout' : 'git-failed'
          done({ ok: false, stdout: String(stdout ?? '').trim(), stderr: String(stderr ?? '').trim().slice(0, 800), code })
          return
        }
        done({ ok: true, stdout: String(stdout ?? '').trim(), stderr: '', code: null })
      },
    )
  })
}

/**
 * Run a bounded Git command whose stdout must stay bytes, not text.
 *
 * `git cat-file blob` returns file content, so decoding it would corrupt every
 * non-UTF-8 file in a Skill. This variant keeps the buffer.
 *
 * @param {string[]} args
 * @returns {Promise<{ ok: boolean, stdout: Buffer, stderr: string, code: string | null }>}
 */
function runGitBytes(args) {
  return new Promise((done) => {
    execFile(
      'git',
      args,
      {
        timeout: GIT_TIMEOUT_MS,
        windowsHide: true,
        shell: false,
        encoding: 'buffer',
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo', LC_ALL: 'C' },
        maxBuffer: 64 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          const code = error.code === 'ENOENT' ? 'git-not-found' : error.killed ? 'git-timeout' : 'git-failed'
          done({
            ok: false,
            stdout: Buffer.alloc(0),
            stderr: String(stderr ?? '').trim().slice(0, 800),
            code,
          })
          return
        }
        done({ ok: true, stdout: stdout, stderr: '', code: null })
      },
    )
  })
}

/**
 * Where the registry for one profile lives.
 *
 * @param {string} dshHome
 * @param {string} profileId
 * @returns {string}
 */
function registryPath(dshHome, profileId) {
  return join(dshHome, 'version-manager', 'git-skills', `${profileId.replace(/[^A-Za-z0-9._-]/g, '_')}.json`)
}

/**
 * A stable cache directory name for a remote.
 *
 * The name is derived from the remote so two Skills from one repository share
 * one cache, and so the directory never contains a URL that could be mistaken
 * for something to execute.
 *
 * @param {string} dshHome
 * @param {string} remote
 * @returns {string}
 */
function cachePath(dshHome, remote) {
  const digest = createHash('sha256').update(remote).digest('hex').slice(0, 32)
  return join(dshHome, 'version-manager', 'git-cache', `${digest}.git`)
}

/**
 * Read the registered Skills for a profile.
 *
 * A missing or unreadable registry is an empty registry: this file is a record
 * of what the user asked for, and guessing entries would be worse than having
 * none.
 *
 * @param {string} dshHome
 * @param {string} profileId
 * @returns {Promise<Array<object>>}
 */
export async function readRegistry(dshHome, profileId) {
  let text
  try {
    text = await readFile(registryPath(dshHome, profileId), 'utf8')
  } catch {
    return []
  }
  try {
    const parsed = JSON.parse(text)
    return Array.isArray(parsed?.skills) ? parsed.skills : []
  } catch {
    return []
  }
}

/**
 * Write the registry atomically.
 *
 * @param {string} dshHome
 * @param {string} profileId
 * @param {Array<object>} skills
 * @returns {Promise<void>}
 */
async function writeRegistry(dshHome, profileId, skills) {
  const path = registryPath(dshHome, profileId)
  await mkdir(dirname(path), { recursive: true })
  const body = { schemaVersion: 1, updatedAt: new Date().toISOString(), skills }
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporary, `${JSON.stringify(body, null, 2)}\n`, 'utf8')
  await rename(temporary, path)
}

/**
 * Which remotes this module is willing to fetch from.
 *
 * A local path is accepted because a Skill may be authored on the same machine
 * and tested from a directory; anything else has to name its transport, so a
 * typo cannot be interpreted as another kind of URL.
 *
 * @param {string} remote
 * @returns {boolean}
 */
export function isFetchableRemote(remote) {
  if (typeof remote !== 'string' || remote.trim() === '') return false
  const value = remote.trim()
  if (/^https?:\/\/[^\s]+$/i.test(value)) return true
  if (/^ssh:\/\/[^\s]+$/i.test(value)) return true
  if (/^git@[^\s:]+:[^\s]+$/.test(value)) return true
  if (/^file:\/\/[^\s]+$/i.test(value)) return true
  // A plain absolute path is a local repository; it must still look like one.
  if (/^[A-Za-z]:[\\/]/.test(value) || value.startsWith('/')) return true
  return false
}

/**
 * Normalise the subpath a Skill occupies inside its repository.
 *
 * `''` means the repository root is the Skill. Anything that escapes the
 * repository is rejected here, before it reaches a staging directory.
 *
 * @param {string} subpath
 * @returns {string | null} the normalised subpath, or null when it is unsafe
 */
export function normaliseSubpath(subpath) {
  if (subpath === undefined || subpath === null || subpath === '') return ''
  if (typeof subpath !== 'string') return null
  const value = subpath.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
  if (value === '') return ''
  if (value.startsWith('/')) return null
  const parts = value.split('/')
  if (parts.some((part) => part === '..' || part === '.' || part === '')) return null
  if (parts.some((part) => part === '.git')) return null
  return value
}

/**
 * Why a registered entry cannot be updated right now, or null.
 *
 * @param {object} entry
 * @param {{ digest: string | null, exists: boolean, inCheckout?: boolean }} current
 * @returns {string | null}
 */
export function gitUpdateRefusal(entry, current) {
  if (!entry || typeof entry.directory !== 'string' || entry.directory === '') return 'no-directory'
  if (isSystemPath(entry.directory)) return 'system-skill'
  if (!isFetchableRemote(entry.remote)) return 'unsupported-remote'
  if (entry.subpath === null) return 'bad-subpath'
  // A directory that is itself part of a checkout belongs to that repository's
  // working tree. Rewriting it would silently dirty someone else's branch, so
  // this plugin manages deployed copies and leaves checkouts to Git.
  if (current.inCheckout === true) return 'inside-git-checkout'
  if (current.exists === false) return null
  if (entry.populated === false) {
    // The registration was made against an empty directory and nothing has been
    // written yet, so there is no baseline to compare against. The only thing
    // to protect is the directory staying empty: anything appearing there was
    // put there by something else, and the first apply would delete it.
    if ((current.files ?? 0) > 0) return 'local-modifications'
    return null
  }
  if (current.digest !== null && entry.baselineDigest !== null && current.digest !== entry.baselineDigest) {
    // The files on disk are not the ones this plugin last wrote, so something
    // else edited them. Replacing that is a data loss, not an update.
    return 'local-modifications'
  }
  return null
}

/**
 * Whether a restore may write into this directory.
 *
 * Restore is the way back, and it takes a snapshot before it writes, so local
 * edits are not by themselves a reason to refuse: refusing here would strand a
 * user whose directory was edited by hand in a state where neither an update
 * nor a restore is possible. What still has to hold is that the directory is the
 * one this plugin is allowed to write at all (not a checkout, not a system
 * Skill, not a source it cannot read), and that it is not something it has never
 * populated -- restoring into a non-empty directory it did not write would
 * delete files it has no record of.
 *
 * @param {object} entry
 * @param {{ exists: boolean, digest: string | null, files: number | null, inCheckout: boolean }} current
 * @returns {string | null}
 */
export function gitRestoreRefusal(entry, current) {
  if (!entry || typeof entry.directory !== 'string' || entry.directory === '') return 'no-directory'
  if (isSystemPath(entry.directory)) return 'system-skill'
  if (!isFetchableRemote(entry.remote)) return 'unsupported-remote'
  if (entry.subpath === null) return 'bad-subpath'
  if (current.inCheckout === true) return 'inside-git-checkout'
  if (current.exists === false) return null
  if (entry.populated === false && (current.files ?? 0) > 0) {
    // Never written by this plugin and not empty now: those files belong to
    // something else, and a restore would replace them.
    return 'local-modifications'
  }
  return null
}

/**
 * Describe the directory a registration points at, once.
 *
 * @param {string} directory
 * @returns {Promise<{ exists: boolean, digest: string | null, files: number | null, inCheckout: boolean }>}
 */
export async function inspectTarget(directory) {
  const fingerprint = await fingerprintTree(directory).catch(() => null)
  if (fingerprint === null) return { exists: false, digest: null, files: null, inCheckout: false }
  const git = await readGitState(directory)
  return { exists: true, digest: fingerprint.digest, files: fingerprint.files, inCheckout: git.managed === true }
}

/**
 * Make sure a bare cache exists for a remote.
 *
 * @param {string} dshHome
 * @param {string} remote
 * @returns {Promise<{ path: string, created: boolean }>}
 */
async function ensureCache(dshHome, remote) {
  const path = cachePath(dshHome, remote)
  try {
    const info = await stat(join(path, 'HEAD'))
    if (info.isFile()) return { path, created: false }
  } catch {
    // fall through and create it
  }
  await mkdir(path, { recursive: true })
  const init = await runGit(['init', '--bare', '--quiet', path])
  if (!init.ok) throw new Error(`The Git cache could not be created: ${init.stderr || init.code}`)
  return { path, created: true }
}

/**
 * Fetch one remote ref into the cache and report the commit it resolved to.
 *
 * The fetch happens against the cache, never against a repository the user
 * owns, and it writes only remote-tracking state — no branch, index or working
 * tree is involved.
 *
 * @param {object} input
 * @param {string} input.dshHome
 * @param {string} input.remote
 * @param {string} [input.ref]
 * @returns {Promise<{ ok: boolean, reason: string | null, cache: string | null,
 *   revision: string | null, subject: string | null, message: string | null }>}
 */
export async function fetchRevision(input) {
  const { dshHome, remote, ref = 'HEAD' } = input
  if (!isFetchableRemote(remote)) {
    return { ok: false, reason: 'unsupported-remote', cache: null, revision: null, subject: null, message: null }
  }
  let cache
  try {
    cache = (await ensureCache(dshHome, remote)).path
  } catch (error) {
    return {
      ok: false,
      reason: 'cache-unavailable',
      cache: null,
      revision: null,
      subject: null,
      message: error instanceof Error ? error.message : String(error),
    }
  }
  const fetched = await runGit(['--git-dir', cache, 'fetch', '--quiet', '--no-tags', remote, ref])
  if (!fetched.ok) {
    return {
      ok: false,
      reason: fetched.code === 'git-not-found' ? 'git-not-found' : 'fetch-failed',
      cache,
      revision: null,
      subject: null,
      message: fetched.stderr || null,
    }
  }
  const resolved = await runGit(['--git-dir', cache, 'rev-parse', 'FETCH_HEAD^{commit}'])
  if (!resolved.ok) {
    return { ok: false, reason: 'ref-unresolved', cache, revision: null, subject: null, message: resolved.stderr || null }
  }
  const revision = resolved.stdout
  const subject = await runGit(['--git-dir', cache, 'log', '-1', '--format=%s', revision])
  return {
    ok: true,
    reason: null,
    cache,
    revision,
    subject: subject.ok && subject.stdout !== '' ? subject.stdout : null,
    message: null,
  }
}

/**
 * The files under `subpath` in one commit, as `git` reports a diff.
 *
 * @param {object} input
 * @param {string} input.cache
 * @param {string} input.fromRevision
 * @param {string} input.toRevision
 * @param {string} input.subpath
 * @returns {Promise<Array<{ status: string, path: string }>>}
 */
export async function diffRevisions(input) {
  const { cache, fromRevision, toRevision, subpath } = input
  const args = ['--git-dir', cache, 'diff', '--name-status', '--no-renames', fromRevision, toRevision]
  if (subpath !== '') args.push('--', subpath)
  const result = await runGit(args)
  if (!result.ok) return []
  const rows = []
  for (const line of result.stdout.split('\n')) {
    if (line.trim() === '') continue
    const [status, ...rest] = line.split('\t')
    const path = rest.join('\t')
    if (path === '') continue
    rows.push({ status: status === '' ? '?' : status.slice(0, 1), path })
  }
  return rows
}

/**
 * Every blob under one subpath of one commit, read straight from the object
 * database.
 *
 * This walks `git ls-tree` instead of asking `git archive` to produce a tar and
 * hoping an external `tar` binary exists to unpack it. `tar` is not guaranteed
 * on Windows, and on some Git-for-Windows builds `git -xf` is not a command at
 * all. Reading the objects directly means the export depends on nothing but the
 * `git` binary that is already required to fetch them.
 *
 * @param {object} input
 * @param {string} input.cache
 * @param {string} input.revision
 * @param {string} input.subpath
 * @param {string} input.into
 * @returns {Promise<{ ok: boolean, reason: string | null, message: string | null,
 *   files: number | null }>}
 */
export async function exportRevision(input) {
  const { cache, revision, subpath, into } = input
  const known = await runGit(['--git-dir', cache, 'cat-file', '-e', `${revision}^{commit}`])
  if (!known.ok) {
    return { ok: false, reason: 'revision-not-in-cache', message: null, files: null }
  }

  // `--full-tree` makes the paths relative to the repository root regardless of
  // where Git was invoked, so they can be trimmed against `subpath` reliably.
  const treeArgs = ['--git-dir', cache, 'ls-tree', '-r', '-z', '--full-tree', revision]
  if (subpath !== '') treeArgs.push('--', subpath)
  const listed = await runGitBytes(treeArgs)
  if (!listed.ok) {
    return { ok: false, reason: 'archive-failed', message: listed.stderr || null, files: null }
  }

  const prefix = subpath === '' ? '' : `${subpath}/`
  const blobs = []
  for (const record of listed.stdout.toString('utf8').split('\0')) {
    if (record === '') continue
    // "<mode> SP <type> SP <sha> TAB <path>"
    const tab = record.indexOf('\t')
    if (tab === -1) continue
    const meta = record.slice(0, tab).split(' ')
    const path = record.slice(tab + 1)
    const [mode, type, sha] = meta
    if (type !== 'blob') continue
    if (prefix !== '' && !path.startsWith(prefix)) continue
    const relativePath = prefix === '' ? path : path.slice(prefix.length)
    if (relativePath === '') continue
    blobs.push({ path, relativePath, mode, sha })
  }
  if (blobs.length === 0) {
    // An empty directory cannot be represented in a tree, so "no blobs" means
    // either the path is not there or it holds nothing this plugin can write.
    // Either way it is not something to offer as an update.
    return { ok: false, reason: 'subpath-missing', message: null, files: null }
  }

  const target = resolve(into)
  for (const blob of blobs) {
    const parts = blob.relativePath.split('/')
    if (parts.some((part) => part === '' || part === '.' || part === '..')) {
      // A tree entry that would escape the target is not written. Git cannot
      // normally produce one, but this is the boundary that matters.
      return { ok: false, reason: 'path-escapes-target', message: null, files: null }
    }
    if (blob.mode === '120000') {
      // A symlink cannot be written on Windows without extra privileges, and
      // writing its target as a regular file would silently change what the
      // Skill is. A Skill made of links is refused rather than approximated.
      return { ok: false, reason: 'unsupported-entry', message: `symlink: ${blob.relativePath}`, files: null }
    }
    if (blob.mode !== '100644' && blob.mode !== '100755') {
      // Submodules and other tree types have no content to export.
      return { ok: false, reason: 'unsupported-entry', message: `${blob.mode}: ${blob.relativePath}`, files: null }
    }
    const destination = join(target, ...parts)
    const content = await runGitBytes(['--git-dir', cache, 'cat-file', 'blob', blob.sha])
    if (!content.ok) {
      return { ok: false, reason: 'blob-unreadable', message: content.stderr || null, files: null }
    }
    await mkdir(dirname(destination), { recursive: true })
    // Bytes, not text: a Skill may ship an image, a font or a zip.
    await writeFile(destination, content.stdout)
    await chmod(destination, blob.mode === '100755' ? 0o755 : 0o644).catch(() => {})
  }
  return { ok: true, reason: null, message: null, files: blobs.length }
}

/**
 * Replace a directory with a prepared one, leaving a way back.
 *
 * The replacement is assembled beside the target and swapped in with two
 * renames on the same volume. The old directory is parked, not deleted, until
 * the new one has been verified.
 *
 * @param {object} input
 * @param {string} input.target
 * @param {(staging: string) => Promise<{ ok: boolean, reason?: string, message?: string }>} input.prepare
 * @param {string} [input.expectedDigest]
 * @returns {Promise<{ ok: boolean, reason: string | null, message: string | null,
 *   evidence: object | null }>}
 */
export async function replaceDirectory(input) {
  const { target, prepare, expectedDigest } = input
  const parent = dirname(target)
  const base = target.slice(parent.length).replace(/^[\\/]+/, '')
  const suffix = randomUUID().slice(0, 8)
  const staging = join(parent, `.${base}.version-manager git-${suffix}`)
  const parked = join(parent, `.${base}.version-manager git-old-${suffix}`)
  let existed = false
  try {
    const info = await stat(target)
    existed = info.isDirectory()
    if (!existed) return { ok: false, reason: 'target-not-a-directory', message: null, evidence: null }
  } catch {
    existed = false
  }

  await rm(staging, { recursive: true, force: true }).catch(() => {})
  const prepared = await prepare(staging)
  if (!prepared.ok) {
    await rm(staging, { recursive: true, force: true }).catch(() => {})
    return { ok: false, reason: prepared.reason ?? 'prepare-failed', message: prepared.message ?? null, evidence: null }
  }
  const staged = await fingerprintTree(staging)
  if (staged === null || (expectedDigest !== undefined && staged.digest !== expectedDigest)) {
    await rm(staging, { recursive: true, force: true }).catch(() => {})
    return { ok: false, reason: 'staged-copy-corrupt', message: null, evidence: { stagedDigest: staged?.digest ?? null } }
  }

  let parkedOk = false
  try {
    if (existed) {
      await rename(target, parked)
      parkedOk = true
    }
    await rename(staging, target)
  } catch (error) {
    if (parkedOk) await rename(parked, target).catch(() => {})
    await rm(staging, { recursive: true, force: true }).catch(() => {})
    return {
      ok: false,
      reason: 'swap-failed',
      message: error instanceof Error ? error.message : String(error),
      evidence: { parked: parkedOk ? parked : null },
    }
  }

  const placed = await fingerprintTree(target)
  if (placed === null || placed.digest !== staged.digest) {
    return {
      ok: false,
      reason: 'verification-failed',
      message: null,
      evidence: { parked: parkedOk ? parked : null, placedDigest: placed?.digest ?? null },
    }
  }
  if (parkedOk) await rm(parked, { recursive: true, force: true }).catch(() => {})

  return {
    ok: true,
    reason: null,
    message: null,
    evidence: {
      digest: placed.digest,
      files: placed.files,
      bytes: placed.bytes,
      created: existed === false,
    },
  }
}

/**
 * The digest of one commit's subtree, computed by exporting it out of the cache.
 *
 * This is how a registration checks that its claimed baseline is real: the
 * directory on disk must already hold exactly these bytes, or the claim is a
 * guess and guessing is what this module refuses to do.
 *
 * @param {{ cache: string, revision: string, subpath: string }} input
 * @returns {Promise<{ ok: boolean, reason: string | null, digest: string | null, files: number | null }>}
 */
export async function treeDigest(input) {
  const { cache, revision, subpath } = input
  const scratch = await mkdtemp(join(tmpdir(), 'dsh-vm-tree-'))
  try {
    const exported = await exportRevision({ cache, revision, subpath, into: join(scratch, 'tree') })
    if (!exported.ok) return { ok: false, reason: exported.reason, digest: null, files: null }
    const fingerprint = await fingerprintTree(join(scratch, 'tree'))
    if (fingerprint === null) return { ok: false, reason: 'subpath-missing', digest: null, files: null }
    return { ok: true, reason: null, digest: fingerprint.digest, files: fingerprint.files }
  } finally {
    await rm(scratch, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Register one Skill as coming from a Git tree.
 *
 * Registration is a claim about intent, so it does not touch the Skill
 * directory: it records where future content should come from and pins the
 * revision the directory currently corresponds to.
 *
 * @param {object} input
 * @param {string} input.dshHome
 * @param {string} input.profileId
 * @param {string} input.name
 * @param {string} input.remote
 * @param {string} [input.subpath]
 * @param {string} [input.ref]
 * @param {string | null} [input.directory]
 * @returns {Promise<{ ok: boolean, reason: string | null, message: string | null, entry: object | null }>}
 */
export async function registerGitSkill(input) {
  const { dshHome, profileId, name, remote, subpath, ref = 'HEAD', directory = null } = input
  if (typeof name !== 'string' || name.trim() === '') {
    return { ok: false, reason: 'missing-name', message: null, entry: null }
  }
  if (!isFetchableRemote(remote)) {
    return { ok: false, reason: 'unsupported-remote', message: null, entry: null }
  }
  const normalised = normaliseSubpath(subpath)
  if (normalised === null) return { ok: false, reason: 'bad-subpath', message: null, entry: null }
  if (directory === null) {
    return { ok: false, reason: 'no-directory', message: null, entry: null }
  }
  if (isSystemPath(directory)) return { ok: false, reason: 'system-skill', message: null, entry: null }

  const registry = await readRegistry(dshHome, profileId)
  const existing = registry.find((entry) => entry.name === name)
  if (existing !== undefined && (existing.remote !== remote.trim() || existing.subpath !== normalised)) {
    // Re-pointing a Skill at another repository silently would make its history
    // fictional, so the caller has to remove the old registration first. This is
    // checked before any fetch: a refusal should not cost a network round trip.
    return { ok: false, reason: 'already-registered', message: null, entry: null }
  }

  const pinned = await fetchRevision({ dshHome, remote, ref })
  if (!pinned.ok) {
    return { ok: false, reason: pinned.reason, message: pinned.message, entry: null }
  }

  const current = await inspectTarget(directory)
  const expected = await treeDigest({ cache: pinned.cache, revision: pinned.revision, subpath: normalised })
  if (!expected.ok) {
    return { ok: false, reason: expected.reason, message: null, entry: null }
  }
  // The baseline is the tree the registration names, not whatever happened to be
  // on disk: "the revision this directory corresponds to" is only a fact if the
  // bytes agree. A directory that already holds exactly that tree is populated;
  // an empty one is a placeholder waiting for its first update.
  const populated = current.digest === expected.digest
  if (current.exists && current.digest !== expected.digest && (current.files ?? 0) > 0) {
    // Something is there and it is not this revision. Guessing which commit it
    // came from would make every later refusal meaningless.
    return { ok: false, reason: 'baseline-unknown', message: null, entry: null }
  }

  const entry = {
    name,
    remote: remote.trim(),
    subpath: normalised,
    ref,
    directory: resolve(directory),
    revision: pinned.revision,
    revisionSubject: pinned.subject,
    baselineDigest: expected.digest,
    files: expected.files,
    // `false` means the directory has never been written by this plugin, so the
    // next update fills it instead of reporting nothing to apply.
    populated,
    registeredAt: existing?.registeredAt ?? new Date().toISOString(),
    updatedAt: existing?.updatedAt ?? null,
    history: Array.isArray(existing?.history) ? existing.history : [],
  }
  const next = [...registry.filter((row) => row.name !== name), entry]
  await writeRegistry(dshHome, profileId, next)
  return { ok: true, reason: null, message: null, entry }
}

/**
 * Forget one registration. The files are left exactly as they are.
 *
 * @param {object} input
 * @param {string} input.dshHome
 * @param {string} input.profileId
 * @param {string} input.name
 * @returns {Promise<{ ok: boolean, reason: string | null }>}
 */
export async function unregisterGitSkill(input) {
  const { dshHome, profileId, name } = input
  const registry = await readRegistry(dshHome, profileId)
  const next = registry.filter((entry) => entry.name !== name)
  if (next.length === registry.length) return { ok: false, reason: 'not-registered' }
  await writeRegistry(dshHome, profileId, next)
  return { ok: true, reason: null }
}

/**
 * Everything an update would change, without changing it.
 *
 * @param {object} input
 * @param {string} input.dshHome
 * @param {string} input.profileId
 * @param {string} input.name
 * @param {string} [input.ref]
 * @returns {Promise<{ ok: boolean, reason: string | null, message: string | null, detail: object | null }>}
 */
export async function previewGitUpdate(input) {
  const { dshHome, profileId, name, ref } = input
  const registry = await readRegistry(dshHome, profileId)
  const entry = registry.find((row) => row.name === name)
  if (entry === undefined) return { ok: false, reason: 'not-registered', message: null, detail: null }

  const current = await inspectTarget(entry.directory)
  const refusal = gitUpdateRefusal(entry, current)
  if (refusal !== null) return { ok: false, reason: refusal, message: null, detail: null }

  const target = await fetchRevision({ dshHome, remote: entry.remote, ref: ref ?? entry.ref ?? 'HEAD' })
  if (!target.ok) {
    return { ok: false, reason: target.reason, message: target.message, detail: null }
  }
  // A directory this plugin has never written holds no revision at all, so
  // "already at that revision" would be false comfort: the tree still has to be
  // exported once. `populated === false` is the record that says so.
  const populated = entry.populated !== false
  const changes =
    target.revision === entry.revision
      ? []
      : await diffRevisions({
          cache: target.cache,
          fromRevision: entry.revision,
          toRevision: target.revision,
          subpath: entry.subpath,
        })
  return {
    ok: true,
    reason: null,
    message: null,
    detail: {
      name,
      directory: entry.directory,
      remote: entry.remote,
      subpath: entry.subpath,
      from: { revision: entry.revision, subject: entry.revisionSubject ?? null },
      to: { revision: target.revision, subject: target.subject },
      populated,
      // `alreadyAtRevision` is evidence, not an error: the panel says "nothing
      // to apply" instead of offering a no-op update.
      alreadyAtRevision: populated && target.revision === entry.revision,
      changes,
      changeCount: changes.length,
      localFiles: { digest: current.digest, files: current.files, baselineDigest: entry.baselineDigest },
    },
  }
}

/**
 * Apply the fetched revision to the Skill directory.
 *
 * @param {object} input
 * @param {string} input.dshHome
 * @param {string} input.profileId
 * @param {string} input.name
 * @param {string} [input.ref]
 * @returns {Promise<{ ok: boolean, reason: string | null, message: string | null,
 *   evidence: object | null, fromRevision: string | null, toRevision: string | null,
 *   snapshot: object | null }>}
 */
export async function applyGitUpdate(input) {
  const { dshHome, profileId, name, ref } = input
  const preview = await previewGitUpdate({ dshHome, profileId, name, ref })
  if (!preview.ok) {
    return {
      ok: false,
      reason: preview.reason,
      message: preview.message,
      evidence: null,
      fromRevision: null,
      toRevision: null,
      snapshot: null,
    }
  }
  const { detail } = preview
  if (detail.alreadyAtRevision) {
    return {
      ok: false,
      reason: 'already-at-revision',
      message: null,
      evidence: detail,
      fromRevision: detail.from.revision,
      toRevision: detail.to.revision,
      snapshot: null,
    }
  }

  const registry = await readRegistry(dshHome, profileId)
  const entry = registry.find((row) => row.name === name)
  if (entry === undefined) {
    return { ok: false, reason: 'not-registered', message: null, evidence: null, fromRevision: null, toRevision: null, snapshot: null }
  }

  // Keep the bytes that are about to be replaced, so the update itself has a
  // documented way back even after the directory has changed.
  let snapshot = null
  const exists = (await inspectTarget(entry.directory)).exists
  if (exists) {
    try {
      const saved = await snapshotSkill({
        dshHome,
        profileId,
        name,
        directory: entry.directory,
        git: {
          managed: true,
          reason: null,
          root: entry.remote,
          revision: entry.revision,
          remote: entry.remote,
          subpath: entry.subpath,
          dirty: false,
          changes: 0,
        },
        reason: `before git update to ${detail.to.revision.slice(0, 7)}`,
      })
      snapshot = { file: saved.path, digest: saved.manifest.skill.digest }
    } catch (error) {
      return {
        ok: false,
        reason: 'undo-snapshot-failed',
        message: error instanceof Error ? error.message : String(error),
        evidence: null,
        fromRevision: entry.revision,
        toRevision: detail.to.revision,
        snapshot: null,
      }
    }
  }

  const cache = (await ensureCache(dshHome, entry.remote)).path
  const applied = await replaceDirectory({
    target: entry.directory,
    prepare: async (staging) => exportRevision({ cache, revision: detail.to.revision, subpath: entry.subpath, into: staging }),
  })
  if (!applied.ok) {
    return {
      ok: false,
      reason: applied.reason,
      message: applied.message,
      evidence: applied.evidence,
      fromRevision: entry.revision,
      toRevision: detail.to.revision,
      snapshot,
    }
  }

  const updated = {
    ...entry,
    revision: detail.to.revision,
    revisionSubject: detail.to.subject,
    baselineDigest: applied.evidence.digest,
    files: applied.evidence.files,
    // The tree on disk is now this revision's tree, so the record can say so.
    populated: true,
    updatedAt: new Date().toISOString(),
    history: [
      {
        revision: detail.to.revision,
        subject: detail.to.subject ?? null,
        at: new Date().toISOString(),
        reason: 'update',
        previous: entry.revision,
      },
      ...(Array.isArray(entry.history) ? entry.history : []),
    ].slice(0, MAX_HISTORY),
  }
  await writeRegistry(dshHome, profileId, [...registry.filter((row) => row.name !== name), updated])

  return {
    ok: true,
    reason: null,
    message: null,
    evidence: applied.evidence,
    fromRevision: entry.revision,
    toRevision: detail.to.revision,
    snapshot,
  }
}

/**
 * Put a Skill directory back to an earlier revision of its own Git tree.
 *
 * The bytes come from the plugin's cache, not from the user's repository, so
 * no branch or worktree is consulted. When the cache no longer holds that
 * commit the caller is told so and can restore a snapshot instead.
 *
 * @param {object} input
 * @param {string} input.dshHome
 * @param {string} input.profileId
 * @param {string} input.name
 * @param {string} input.revision
 * @returns {Promise<{ ok: boolean, reason: string | null, message: string | null,
 *   evidence: object | null, fromRevision: string | null, toRevision: string | null,
 *   snapshot: object | null }>}
 */
export async function restoreGitRevision(input) {
  const { dshHome, profileId, name, revision } = input
  if (typeof revision !== 'string' || !/^[0-9a-f]{4,40}$/i.test(revision)) {
    return { ok: false, reason: 'bad-revision', message: null, evidence: null, fromRevision: null, toRevision: null, snapshot: null }
  }
  const registry = await readRegistry(dshHome, profileId)
  const entry = registry.find((row) => row.name === name)
  if (entry === undefined) {
    return { ok: false, reason: 'not-registered', message: null, evidence: null, fromRevision: null, toRevision: null, snapshot: null }
  }
  const current = await inspectTarget(entry.directory)
  const refusal = gitRestoreRefusal(entry, current)
  if (refusal !== null) {
    return { ok: false, reason: refusal, message: null, evidence: null, fromRevision: entry.revision, toRevision: revision, snapshot: null }
  }

  const cache = (await ensureCache(dshHome, entry.remote)).path
  const known = await runGit(['--git-dir', cache, 'cat-file', '-e', `${revision}^{commit}`])
  if (!known.ok) {
    return {
      ok: false,
      reason: 'revision-not-in-cache',
      message: null,
      evidence: null,
      fromRevision: entry.revision,
      toRevision: revision,
      snapshot: null,
    }
  }
  const resolved = await runGit(['--git-dir', cache, 'rev-parse', `${revision}^{commit}`])
  const full = resolved.ok ? resolved.stdout : revision
  const subject = await runGit(['--git-dir', cache, 'log', '-1', '--format=%s', full])

  let snapshot = null
  if (current.exists) {
    try {
      const saved = await snapshotSkill({
        dshHome,
        profileId,
        name,
        directory: entry.directory,
        git: null,
        reason: `before git restore to ${full.slice(0, 7)}`,
      })
      snapshot = { file: saved.path, digest: saved.manifest.skill.digest }
    } catch (error) {
      return {
        ok: false,
        reason: 'undo-snapshot-failed',
        message: error instanceof Error ? error.message : String(error),
        evidence: null,
        fromRevision: entry.revision,
        toRevision: full,
        snapshot: null,
      }
    }
  }

  const applied = await replaceDirectory({
    target: entry.directory,
    prepare: async (staging) => exportRevision({ cache, revision: full, subpath: entry.subpath, into: staging }),
  })
  if (!applied.ok) {
    return {
      ok: false,
      reason: applied.reason,
      message: applied.message,
      evidence: applied.evidence,
      fromRevision: entry.revision,
      toRevision: full,
      snapshot,
    }
  }

  const updated = {
    ...entry,
    revision: full,
    revisionSubject: subject.ok && subject.stdout !== '' ? subject.stdout : null,
    baselineDigest: applied.evidence.digest,
    files: applied.evidence.files,
    // Restoring writes a tree too, so the directory is populated afterwards.
    populated: true,
    updatedAt: new Date().toISOString(),
    history: [
      {
        revision: full,
        subject: subject.ok && subject.stdout !== '' ? subject.stdout : null,
        at: new Date().toISOString(),
        reason: 'restore',
        previous: entry.revision,
      },
      ...(Array.isArray(entry.history) ? entry.history : []),
    ].slice(0, MAX_HISTORY),
  }
  await writeRegistry(dshHome, profileId, [...registry.filter((row) => row.name !== name), updated])

  return {
    ok: true,
    reason: null,
    message: null,
    evidence: applied.evidence,
    fromRevision: entry.revision,
    toRevision: full,
    snapshot,
  }
}

/**
 * A directory's path relative to a skill root, for display and assertions.
 *
 * @param {string} root
 * @param {string} path
 * @returns {string}
 */
export function relativeTo(root, path) {
  return relative(root, path).split(sep).join('/')
}

/**
 * The revisions this plugin has recorded for one Skill, newest first.
 *
 * @param {object} entry
 * @returns {Array<{ revision: string, subject: string | null, at: string | null, reason: string }>}
 */
export function revisionHistory(entry) {
  if (!entry) return []
  const seen = new Set()
  const rows = []
  for (const item of Array.isArray(entry.history) ? entry.history : []) {
    if (typeof item?.revision !== 'string' || seen.has(item.revision)) continue
    seen.add(item.revision)
    rows.push({
      revision: item.revision,
      subject: item.subject ?? null,
      at: item.at ?? null,
      reason: item.reason ?? 'update',
    })
  }
  if (typeof entry.revision === 'string' && !seen.has(entry.revision)) {
    rows.unshift({ revision: entry.revision, subject: entry.revisionSubject ?? null, at: entry.updatedAt ?? null, reason: 'current' })
  }
  return rows
}

/**
 * Entries whose registry row has no usable directory any more.
 *
 * @param {Array<object>} registry
 * @returns {Promise<Array<object>>}
 */
export async function describeRegistry(registry) {
  const rows = []
  for (const entry of registry) {
    const current = await inspectTarget(entry.directory)
    const refusal = gitUpdateRefusal(entry, current)
    const restoreRefusal = gitRestoreRefusal(entry, current)
    rows.push({
      name: entry.name,
      remote: entry.remote,
      subpath: entry.subpath,
      ref: entry.ref,
      directory: entry.directory,
      revision: entry.revision,
      revisionSubject: entry.revisionSubject ?? null,
      registeredAt: entry.registeredAt ?? null,
      updatedAt: entry.updatedAt ?? null,
      baselineDigest: entry.baselineDigest ?? null,
      files: current.files,
      currentDigest: current.digest,
      inCheckout: current.inCheckout,
      // `false` means the registration was made against an empty directory and
      // the tree has not been written yet, so the panel offers a first apply
      // instead of saying the Skill is already at that revision.
      populated: entry.populated !== false,
      // Read off the refusal rather than compared again here. Two copies of the
      // same rule drift: this one used to call an empty, never-written directory
      // "modified" because its digest differs from the commit tree, while the
      // update path allowed it -- so the row warned about a refusal that would
      // not happen.
      localModifications: refusal === 'local-modifications',
      refusal,
      // Restore has its own, narrower rule: it snapshots before writing, so a
      // hand-edited directory is recoverable rather than blocked. Reported
      // separately so the panel can offer the way back while still refusing the
      // way forward.
      restoreRefusal,
      history: revisionHistory(entry),
    })
  }
  return rows
}

/**
 * Whether a directory listing exists, used before offering to create one.
 *
 * @param {string} path
 * @returns {Promise<boolean>}
 */
export async function directoryExists(path) {
  try {
    const info = await stat(path)
    return info.isDirectory()
  } catch {
    return false
  }
}

/**
 * Read a directory's entries, or `[]`.
 *
 * @param {string} path
 * @returns {Promise<string[]>}
 */
export async function entriesOf(path) {
  try {
    return await readdir(path)
  } catch {
    return []
  }
}
