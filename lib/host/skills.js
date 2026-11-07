/**
 * Skill inventory.
 *
 * Skills are directories, not packages: the host discovers them from a fixed
 * list of roots and there is no version field anywhere. So this module reports
 * only what it can prove — which root a skill came from, where its files live,
 * what a Git checkout says about it, and a content fingerprint. Nothing here
 * claims a version, because nothing on disk records one.
 *
 * Everything is read-only. `snapshotSkill` copies a directory into the
 * snapshot store and re-reads the copy to prove the bytes match; it never
 * writes inside the skill itself.
 */

import { execFile } from 'node:child_process'
import { cp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

import { fingerprintTree } from './snapshot-store.js'

const GIT_TIMEOUT_MS = 5000
const MAX_SKILL_FILES = 5000

/**
 * Run a bounded Git command.
 *
 * @param {string[]} args
 * @param {string} cwd
 * @returns {Promise<{ ok: boolean, stdout: string, code: string | null }>}
 */
function runGit(args, cwd) {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      {
        cwd,
        timeout: GIT_TIMEOUT_MS,
        windowsHide: true,
        shell: false,
        encoding: 'utf8',
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
        maxBuffer: 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          // A missing git binary and a directory that is not a repository both
          // land here; the caller only needs "not a checkout I can describe".
          const code = error.code === 'ENOENT' ? 'git-not-found' : 'not-a-repository'
          resolve({ ok: false, stdout: '', code, stderr: String(stderr ?? '').slice(0, 400) })
          return
        }
        resolve({ ok: true, stdout: String(stdout ?? '').trim(), code: null })
      },
    )
  })
}

/**
 * Describe the Git checkout that owns a skill directory, if there is one.
 *
 * The question "is this skill managed by a checkout" cannot be answered from a
 * path alone: a skill can sit inside a larger repository. `rev-parse
 * --show-toplevel` answers it without touching the working tree.
 *
 * @param {string} directory
 * @returns {Promise<{ managed: boolean, reason: string | null, root: string | null,
 *   revision: string | null, remote: string | null, subpath: string | null,
 *   dirty: boolean | null, changes: number | null }>}
 */
export async function readGitState(directory) {
  const empty = {
    managed: false,
    reason: null,
    root: null,
    revision: null,
    remote: null,
    subpath: null,
    dirty: null,
    changes: null,
  }
  const top = await runGit(['rev-parse', '--show-toplevel'], directory)
  if (!top.ok) {
    return {
      ...empty,
      reason: top.code === 'git-not-found' ? 'Git is not installed on this machine.' : 'Not inside a Git checkout.',
    }
  }
  const root = top.stdout
  const revision = await runGit(['rev-parse', '--short', 'HEAD'], directory)
  const remote = await runGit(['remote', 'get-url', 'origin'], directory)
  // `status --porcelain -- .` counts only changes under this skill, so a dirty
  // sibling directory does not make this skill look modified.
  const status = await runGit(['status', '--porcelain', '--', '.'], directory)
  const lines = status.ok && status.stdout !== '' ? status.stdout.split('\n').filter(Boolean) : []
  return {
    managed: true,
    reason: null,
    root,
    revision: revision.ok ? revision.stdout : null,
    remote: remote.ok ? remote.stdout : null,
    subpath: relative(root, directory).split('\\').join('/') || '.',
    dirty: status.ok ? lines.length > 0 : null,
    changes: status.ok ? lines.length : null,
  }
}

/**
 * Walk a skill directory to count files without following links out of it.
 *
 * @param {string} root
 * @returns {Promise<{ files: number, truncated: boolean }>}
 */
async function countFiles(root) {
  let files = 0
  let truncated = false
  const queue = [root]
  while (queue.length > 0) {
    const current = queue.shift()
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (files >= MAX_SKILL_FILES) {
        truncated = true
        break
      }
      if (entry.isDirectory()) queue.push(join(current, entry.name))
      else if (entry.isFile()) files += 1
    }
    if (truncated) break
  }
  return { files, truncated }
}

/**
 * Read the skill catalog the host itself serves.
 *
 * The `skills` service is the only supported view: it applies root priority and
 * reports `complete`, which says whether discovery finished. When it is absent
 * the answer is "cannot be read here", never an empty list.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {{ cwd?: string }} [options]
 */
export async function readSkills(ctx, options = {}) {
  const service = ctx.get('skills')
  if (service === undefined || service === null) {
    return {
      available: false,
      reason: 'The host exposes no skills service in this process.',
      provider: null,
      complete: null,
      skills: [],
    }
  }
  const view = options.cwd === undefined ? {} : { cwd: options.cwd }
  let snapshot
  try {
    snapshot = await service.snapshot(view)
  } catch (error) {
    return {
      available: false,
      reason: `The skills service refused the request: ${String(error?.message ?? error)}`,
      provider: null,
      complete: null,
      skills: [],
    }
  }
  const list = Array.isArray(snapshot?.skills) ? snapshot.skills : []
  const rows = []
  for (const skill of list) {
    const directory = skill.resourceBase?.path ?? null
    const kind = skill.resourceBase?.kind ?? null
    const files = directory === null ? null : await countFiles(directory)
    const git = directory === null ? null : await readGitState(directory)
    rows.push({
      name: skill.name,
      description: skill.description ?? null,
      whenToUse: skill.whenToUse ?? null,
      source: skill.source ?? null,
      provider: skill.provider ?? null,
      // A skill can be a single `<name>.md` file; then there is no directory to
      // fingerprint and the panel says so instead of showing an empty tree.
      directory,
      resourceKind: kind,
      fileCount: files === null ? null : files.files,
      fileCountTruncated: files === null ? null : files.truncated,
      git: git === null ? { managed: false, reason: 'This skill has no directory.', ...emptyGit() } : git,
      invocable: {
        model: skill.invocation?.modelInvocable ?? null,
        user: skill.invocation?.userInvocable ?? null,
      },
    })
  }
  return {
    available: true,
    reason: null,
    provider: rows.length > 0 ? rows[0].provider : null,
    complete: snapshot?.complete ?? null,
    skills: rows.sort((left, right) => left.name.localeCompare(right.name)),
  }
}

function emptyGit() {
  return { root: null, revision: null, remote: null, subpath: null, dirty: null, changes: null }
}

/**
 * Copy one skill directory into the snapshot store and prove the copy matches.
 *
 * @param {object} input
 * @param {string} input.dshHome
 * @param {string} input.profileId
 * @param {string} input.name
 * @param {string} input.directory
 * @param {object} [input.git]
 * @returns {Promise<{ path: string, manifest: object }>}
 */
export async function snapshotSkill(input) {
  const { dshHome, profileId, name, directory, git, reason } = input
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const root = join(dshHome, 'version-manager', 'skills', profileId, name)
  const directoryCopy = join(root, `${stamp}-files`)
  await mkdir(root, { recursive: true })

  const before = await fingerprintTree(directory)
  if (before === null) throw new Error(`The skill directory disappeared: ${directory}`)
  await cp(directory, directoryCopy, { recursive: true, dereference: false, force: false, errorOnExist: true })
  const after = await fingerprintTree(directoryCopy)
  if (after === null || after.digest !== before.digest || after.files !== before.files) {
    throw new Error('The copied skill does not match what was read, so the snapshot was discarded.')
  }

  const manifest = {
    schemaVersion: 1,
    kind: 'skill',
    takenAt: new Date().toISOString(),
    profile: { id: profileId },
    skill: {
      name,
      directory,
      fileCount: before.files,
      bytes: before.bytes,
      digest: before.digest,
    },
    git: git ?? null,
    // `before-restore` marks the copies this plugin takes of a directory it is
    // about to replace, so an undo candidate is never mistaken for a baseline
    // the user chose.
    reason: typeof reason === 'string' ? reason : 'manual',
    copy: relative(root, directoryCopy).split('\\').join('/'),
    // Not a version: skills carry no version field, so a snapshot records the
    // bytes and the checkout revision and nothing else.
    note: 'A skill has no version field; this snapshot records its files and Git revision.',
  }
  const manifestPath = join(root, `${stamp}.json`)
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  return { path: manifestPath, manifest }
}

/**
 * List previous skill snapshots for one skill.
 *
 * @param {string} dshHome
 * @param {string} profileId
 * @param {string} name
 */
export async function listSkillSnapshots(dshHome, profileId, name) {
  const root = join(dshHome, 'version-manager', 'skills', profileId, name)
  let entries
  try {
    entries = await readdir(root)
  } catch {
    return []
  }
  const found = []
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue
    try {
      const text = await readFile(join(root, entry), 'utf8')
      const manifest = JSON.parse(text)
      found.push({
        file: entry,
        takenAt: manifest.takenAt ?? null,
        reason: manifest.reason ?? null,
        digest: manifest.skill?.digest ?? null,
        fileCount: manifest.skill?.fileCount ?? null,
        revision: manifest.git?.revision ?? null,
      })
    } catch {
      found.push({ file: entry, takenAt: null, reason: null, digest: null, fileCount: null, revision: null, unreadable: true })
    }
  }
  return found.sort((left, right) => String(right.takenAt ?? '').localeCompare(String(left.takenAt ?? '')))
}

/**
 * Check that a skill directory is still the one a snapshot described.
 *
 * @param {string} directory
 * @param {string} digest
 */
export async function skillUnchanged(directory, digest) {
  const current = await fingerprintTree(directory)
  if (current === null) return { same: false, reason: 'The skill directory is gone.' }
  if (current.digest !== digest) return { same: false, reason: 'The skill files changed since the snapshot.' }
  return { same: true, reason: null }
}

/**
 * Report whether a directory exists, for callers that need to distinguish
 * "no such skill" from "exists but unreadable".
 *
 * @param {string} path
 */
export async function directoryState(path) {
  try {
    const info = await stat(path)
    return info.isDirectory() ? 'directory' : 'not-a-directory'
  } catch {
    return 'missing'
  }
}
