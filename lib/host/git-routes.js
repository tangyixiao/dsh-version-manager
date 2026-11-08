/**
 * HTTP handlers for the Git-managed Skill surface.
 *
 * These live beside `routes.js` rather than inside it because they share no
 * state with the plugin-version half of the panel, and because a 1,600-line
 * file is harder to review than two focused ones.
 *
 * Every handler receives the profile context that `routes.js` already resolved
 * and a parsed body; none of them trusts a path from the request. A directory
 * is always looked up in the host's own catalog, or derived from the profile
 * home when the caller asked this plugin to create it.
 *
 * @module lib/host/git-routes
 */

import { join } from 'node:path'

import {
  applyGitUpdate,
  describeRegistry,
  previewGitUpdate,
  readRegistry,
  registerGitSkill,
  restoreGitRevision,
  unregisterGitSkill,
} from './git-skill.js'
import { beginOperation, transition } from './operations.js'
import { readSkills } from './skills.js'

/** A Skill name is one path segment, so it can never walk out of a root. */
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/**
 * Where a Skill named `name` lives, according to the host.
 *
 * @param {any} ctx
 * @param {{ home: string | null, id: string, cwd: string | null }} profile
 * @param {string} name
 * @param {{ create?: boolean }} [options]
 * @returns {Promise<{ ok: true, directory: string, source: string | null, listed: boolean }
 *   | { ok: false, status: number, body: object }>}
 */
export async function resolveSkillDirectory(ctx, profile, name, options = {}) {
  if (profile.home === null || profile.id === 'unknown') {
    return { ok: false, status: 409, body: { error: 'profile-identity-unknown' } }
  }
  if (typeof name !== 'string' || name.trim() === '') {
    return { ok: false, status: 400, body: { error: 'missing-name' } }
  }
  const trimmed = name.trim()
  const catalog = await readSkills(ctx, { cwd: profile.cwd })
  const listed = catalog.skills.find((entry) => entry.name === trimmed)
  if (listed !== undefined) {
    if (listed.directory === null) {
      return {
        ok: false,
        status: 409,
        body: { error: 'no-directory', message: 'This Skill is a single file, so there is no directory to manage.' },
      }
    }
    return { ok: true, directory: listed.directory, source: listed.source ?? null, listed: true }
  }
  if (options.create === true) {
    if (!NAME_PATTERN.test(trimmed)) {
      return {
        ok: false,
        status: 400,
        body: {
          error: 'bad-name',
          message: 'A Skill name becomes a directory name, so it may only contain letters, digits, dot, dash and underscore.',
        },
      }
    }
    return { ok: true, directory: join(profile.home, 'skills', trimmed), source: null, listed: false }
  }
  return {
    ok: false,
    status: 404,
    body: {
      error: 'unknown-skill',
      message: catalog.available
        ? 'That Skill is not in the host catalog. Register it with create:true to let this plugin make the directory.'
        : catalog.reason,
    },
  }
}

/**
 * Everything the Git half of the Skills tab needs, without writing anything.
 *
 * @param {any} ctx
 * @param {{ home: string | null, id: string, cwd: string | null }} profile
 * @returns {Promise<{ status: number, body: object }>}
 */
export async function listGitSkills(ctx, profile) {
  if (profile.home === null || profile.id === 'unknown') {
    return { status: 409, body: { error: 'profile-identity-unknown' } }
  }
  try {
    const registry = await readRegistry(profile.home, profile.id)
    return {
      status: 200,
      body: {
        schemaVersion: 1,
        observedAt: new Date().toISOString(),
        profile: { id: profile.id, dir: profile.dir, home: profile.home },
        skills: await describeRegistry(registry),
      },
    }
  } catch (error) {
    return { status: 500, body: { error: 'git-list-failed', message: messageOf(error) } }
  }
}

/**
 * Record that a Skill comes from one subtree of one repository.
 *
 * Registration writes the registry only: the files in the directory are left
 * untouched. That is deliberate — a claim about intent should not be able to
 * destroy content if the claim turns out to be wrong.
 *
 * @param {any} ctx
 * @param {object} profile
 * @param {{ name?: string, remote?: string, subpath?: string, ref?: string, create?: boolean }} body
 * @returns {Promise<{ status: number, body: object }>}
 */
export async function registerGitRoute(ctx, profile, body) {
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const located = await resolveSkillDirectory(ctx, profile, name, { create: body.create === true })
  if (!located.ok) return { status: located.status, body: located.body }
  if (located.source === 'bundled') {
    // A bundled Skill is DSH's own file tree; pointing a Git registration at it
    // would make the next update overwrite the host's own files.
    return { status: 409, body: { error: 'bundled-skill', message: null } }
  }
  try {
    const result = await registerGitSkill({
      dshHome: profile.home,
      profileId: profile.id,
      name,
      remote: typeof body.remote === 'string' ? body.remote : '',
      subpath: typeof body.subpath === 'string' ? body.subpath : '',
      ref: typeof body.ref === 'string' && body.ref.trim() !== '' ? body.ref.trim() : 'HEAD',
      directory: located.directory,
    })
    if (!result.ok) {
      return { status: 409, body: { error: result.reason, message: result.message, entry: null } }
    }
    return {
      status: 200,
      body: {
        ok: true,
        entry: result.entry,
        // Said out loud because the caller may expect registration to download
        // the tree. It pins a revision; the bytes arrive on the first update.
        note: 'Registration records where future content comes from and pins the revision the directory currently matches. It does not copy files. Run an update to fetch that revision.',
      },
    }
  } catch (error) {
    return { status: 500, body: { error: 'register-failed', message: messageOf(error) } }
  }
}

/**
 * Forget a registration. Files are left exactly as they are.
 *
 * @param {object} profile
 * @param {{ name?: string }} body
 * @returns {Promise<{ status: number, body: object }>}
 */
export async function unregisterGitRoute(profile, body) {
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (name === '') return { status: 400, body: { error: 'missing-name' } }
  try {
    const result = await unregisterGitSkill({ dshHome: profile.home, profileId: profile.id, name })
    if (!result.ok) return { status: 409, body: { error: result.reason, message: null } }
    return {
      status: 200,
      body: { ok: true, note: 'The registration is gone. The Skill directory was not changed.' },
    }
  } catch (error) {
    return { status: 500, body: { error: 'unregister-failed', message: messageOf(error) } }
  }
}

/**
 * Say what an update would change, without changing it.
 *
 * This fetches into the plugin's own bare cache, which is why it is a POST: it
 * is not free, and a GET that reaches the network is a lie about safety. It
 * still writes nothing the user owns.
 *
 * @param {object} profile
 * @param {{ name?: string, ref?: string }} body
 * @returns {Promise<{ status: number, body: object }>}
 */
export async function previewGitRoute(profile, body) {
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (name === '') return { status: 400, body: { error: 'missing-name' } }
  try {
    const result = await previewGitUpdate({
      dshHome: profile.home,
      profileId: profile.id,
      name,
      ref: typeof body.ref === 'string' && body.ref.trim() !== '' ? body.ref.trim() : undefined,
    })
    // A refusal here is an answer, not a failure of the request: the panel reads
    // `ok` and shows the reason next to the Skill.
    return { status: 200, body: { ok: result.ok, reason: result.reason, message: result.message, detail: result.detail } }
  } catch (error) {
    return { status: 500, body: { error: 'git-preview-failed', message: messageOf(error) } }
  }
}

/**
 * Apply the newest revision of a registered Skill.
 *
 * @param {object} profile
 * @param {{ name?: string, ref?: string }} body
 * @returns {Promise<{ status: number, body: object }>}
 */
export async function updateGitRoute(profile, body) {
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (name === '') return { status: 400, body: { error: 'missing-name' } }
  const ref = typeof body.ref === 'string' && body.ref.trim() !== '' ? body.ref.trim() : undefined
  let record
  try {
    const preview = await previewGitUpdate({ dshHome: profile.home, profileId: profile.id, name, ref })
    if (!preview.ok) {
      return { status: 409, body: { error: preview.reason, message: preview.message, detail: null } }
    }
    const { detail } = preview
    if (detail.alreadyAtRevision) {
      return { status: 200, body: { ok: false, error: 'already-at-revision', message: null, detail } }
    }
    record = await beginOperation({
      dshHome: profile.home,
      profileId: profile.id,
      target: {
        kind: 'skill',
        targetId: name,
        installedVersion: detail.from.revision,
        declaredSpec: `git:${detail.remote}#${detail.subpath === '' ? '.' : detail.subpath}`,
        source: { kind: 'git' },
      },
      toVersion: detail.to.revision,
    })
    await transition(profile.home, profile.id, record, 'applying')
    const result = await applyGitUpdate({ dshHome: profile.home, profileId: profile.id, name, ref })
    if (!result.ok) {
      await transition(profile.home, profile.id, record, 'failed', { error: result.reason })
      return {
        status: 409,
        body: {
          ok: false,
          error: result.reason,
          message: result.message,
          evidence: result.evidence,
          operationId: record.id,
          snapshot: result.snapshot,
          detail,
        },
      }
    }
    await transition(profile.home, profile.id, record, 'succeeded', { snapshotId: result.snapshot?.file ?? null })
    const after = await describeOne(profile, name)
    return {
      status: 200,
      body: {
        ok: true,
        operationId: record.id,
        name,
        fromRevision: result.fromRevision,
        toRevision: result.toRevision,
        changed: detail.changeCount,
        evidence: result.evidence,
        snapshot: result.snapshot,
        message: null,
        current: after,
      },
    }
  } catch (error) {
    if (record !== undefined) {
      await transition(profile.home, profile.id, record, 'failed', { error: 'handler-failed' }).catch(() => {})
    }
    return { status: 500, body: { error: 'git-update-failed', message: messageOf(error) } }
  }
}

/**
 * Put a Skill back to an earlier commit of its own tree.
 *
 * @param {object} profile
 * @param {{ name?: string, revision?: string }} body
 * @returns {Promise<{ status: number, body: object }>}
 */
export async function restoreGitRoute(profile, body) {
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const revision = typeof body.revision === 'string' ? body.revision.trim() : ''
  if (name === '') return { status: 400, body: { error: 'missing-name' } }
  if (revision === '') return { status: 400, body: { error: 'missing-revision' } }
  let record
  try {
    record = await beginOperation({
      dshHome: profile.home,
      profileId: profile.id,
      target: {
        kind: 'skill',
        targetId: name,
        installedVersion: null,
        declaredSpec: null,
        source: { kind: 'git' },
      },
      toVersion: revision.slice(0, 12),
    })
    await transition(profile.home, profile.id, record, 'applying')
    const result = await restoreGitRevision({ dshHome: profile.home, profileId: profile.id, name, revision })
    if (!result.ok) {
      await transition(profile.home, profile.id, record, 'failed', { error: result.reason })
      return {
        status: 409,
        body: {
          ok: false,
          error: result.reason,
          message: result.message,
          evidence: result.evidence,
          operationId: record.id,
          snapshot: result.snapshot,
        },
      }
    }
    await transition(profile.home, profile.id, record, 'succeeded', { snapshotId: result.snapshot?.file ?? null })
    return {
      status: 200,
      body: {
        ok: true,
        operationId: record.id,
        name,
        fromRevision: result.fromRevision,
        toRevision: result.toRevision,
        evidence: result.evidence,
        snapshot: result.snapshot,
        message: null,
        current: await describeOne(profile, name),
      },
    }
  } catch (error) {
    if (record !== undefined) {
      await transition(profile.home, profile.id, record, 'failed', { error: 'handler-failed' }).catch(() => {})
    }
    return { status: 500, body: { error: 'git-restore-failed', message: messageOf(error) } }
  }
}

/**
 * One registry row after a write, so the panel can render the new state without
 * a second request.
 *
 * @param {object} profile
 * @param {string} name
 * @returns {Promise<object | null>}
 */
async function describeOne(profile, name) {
  const registry = await readRegistry(profile.home, profile.id)
  const rows = await describeRegistry(registry.filter((entry) => entry.name === name))
  return rows[0] ?? null
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function messageOf(error) {
  if (error instanceof Error) return error.message
  return String(error)
}
