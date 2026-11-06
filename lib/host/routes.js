/**
 * The JSON surface the panel talks to.
 *
 * Every route is read-only unless its name says otherwise, and the two write
 * routes (`snapshot`, `update`) demand an explicit `{ confirm: true }` body in
 * addition to passing the host's own admission check. There is no timer here and
 * no work starts on its own: a refresh is a request, and a change is a request,
 * which keeps the plugin's cost equal to what the user asked for.
 *
 * Admission comes from `connection.admit(req)`, the same check the host applies
 * to its own browser traffic. When that service is absent the route refuses
 * rather than falling back to "it is localhost so it is fine" — a local port is
 * shared by every process on the machine.
 *
 * @module dsh-version-manager/lib/host/routes
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  buildPluginRows,
  readLoaderPhases,
  readProfileManifest,
  registryFromLockfile,
} from './inventory.js'
import { TERMINAL, beginOperation, listOperations, transition, unresolved } from './operations.js'
import {
  deleteSnapshot,
  fingerprintTree,
  listSnapshots,
  recoveryVerdict,
  snapshotsBeyondRetention,
  writeSnapshot,
} from './snapshot-store.js'
import { classifySpec, isPrerelease, updateRefusal } from './spec.js'

/** Every route this plugin publishes, so the panel and the tests share one list. */
export const ROUTE_BASE = '/dsh-version-manager'

/** Bodies are tiny here; anything larger is not a request this plugin serves. */
const MAX_BODY = 64 * 1024

/**
 * Send JSON and never let a rejected promise silence the response.
 *
 * @param {import('node:http').ServerResponse} response
 * @param {number} status
 * @param {unknown} body
 */
export function sendJson(response, status, body) {
  const text = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    // A version panel that answers with a cached body describes a machine state
    // that may no longer exist, and every row shows its own `observedAt`.
    'cache-control': 'no-store',
  })
  response.end(text)
}

/**
 * Read a JSON body, bounded.
 *
 * @param {import('node:http').IncomingMessage} request
 * @returns {Promise<{ ok: true, value: any } | { ok: false, status: number, message: string }>}
 */
export async function readJsonBody(request) {
  const chunks = []
  let size = 0
  try {
    for await (const chunk of request) {
      size += chunk.length
      if (size > MAX_BODY) return { ok: false, status: 413, message: 'request body too large' }
      chunks.push(chunk)
    }
  } catch {
    return { ok: false, status: 400, message: 'request body could not be read' }
  }
  if (size === 0) return { ok: true, value: {} }
  try {
    return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  } catch {
    return { ok: false, status: 400, message: 'request body was not JSON' }
  }
}

/**
 * Is this request allowed to run anything at all?
 *
 * @param {any} ctx
 * @param {import('node:http').IncomingMessage} request
 * @returns {{ ok: true, principal: string } | { ok: false, status: number }}
 */
export function admit(ctx, request) {
  const connection = ctx?.get?.('connection')
  if (connection === undefined || connection === null || typeof connection.admit !== 'function') {
    // No admission service means no way to tell the browser from any other local
    // process. Refusing is the only answer that does not invent a security model.
    return { ok: false, status: 401 }
  }
  let admission
  try {
    admission = connection.admit(request)
  } catch {
    return { ok: false, status: 401 }
  }
  if (admission === null || typeof admission !== 'object') return { ok: false, status: 401 }
  if ('rejection' in admission) return { ok: false, status: admission.rejection }
  const kind = admission.peer?.principal?.kind
  if (kind !== 'owner') return { ok: false, status: 403 }
  return { ok: true, principal: kind }
}

/**
 * Everything the panel needs to draw the first screen.
 *
 * @param {any} ctx
 * @returns {Promise<Object>}
 */
export async function buildOverview(ctx) {
  const profile = readProfileContext(ctx)
  const pluginManager = ctx?.get?.('pluginManager')

  let bundles = []
  let inventoryError = null
  if (pluginManager === undefined || pluginManager === null) {
    inventoryError = 'The plugin manager service is not available in this host.'
  } else {
    try {
      bundles = await pluginManager.listBundles()
    } catch (error) {
      inventoryError = error instanceof Error ? error.message : String(error)
    }
  }

  const phases = await readLoaderPhases(ctx)
  const manifest = await readManifest(profile.dir)
  const lock = await readLockfile(profile.dir)
  const { runtimeVersion } = readRuntime(ctx)

  const rows = buildPluginRows({
    bundles: Array.isArray(bundles) ? bundles : [],
    phases: phases.byName,
    phaseAvailable: phases.available,
    phaseDiagnostic: phases.diagnostic,
    profileId: profile.id,
    runtimeVersion,
  })

  for (const row of rows) {
    const fromLock = registryFromLockfile(row.targetId, lock)
    row.source.registry = fromLock.registry
    row.source.registryReason = fromLock.reason
    const declared = manifest.dependencies[row.targetId]
    row.declaredSpecObserved = typeof declared === 'string' ? declared : null
    row.declaredSpecMatchesManifest =
      row.declaredSpec !== null && row.declaredSpec === row.declaredSpecObserved
    row.snapshots = (await listSnapshots(profile.home, profile.id, row.targetId)).map(summarise)
  }

  const operations = await listOperations(profile.home, profile.id, 30)

  return {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    profile: {
      id: profile.id,
      // A directory is a local fact. The panel shows it; a shared report does not.
      dir: profile.dir ?? null,
      home: profile.home ?? null,
      kind: profile.kind,
      identitySource: profile.identitySource,
    },
    host: {
      runtimeVersion,
      node: process.versions?.node ?? null,
      platform: process.platform,
      pluginManager: pluginManager !== undefined && pluginManager !== null,
      loader: phases.available,
    },
    counts: {
      total: rows.length,
      updatable: rows.filter((row) => row.updateRefusal === null).length,
      official: rows.filter((row) => row.official).length,
    },
    plugins: rows,
    operations: operations.map(summariseOperation),
    unresolved: unresolved(operations).map((record) => record.id),
    error: inventoryError,
  }
}

/**
 * @param {object} row
 * @returns {object}
 */
function summarise(row) {
  return {
    seq: row.seq,
    id: row.id,
    takenAt: row.takenAt,
    reason: row.reason,
    installedVersion: row.installedVersion,
    file: row.file,
  }
}

/**
 * @param {object} record
 * @returns {object}
 */
function summariseOperation(record) {
  return {
    id: record.id,
    startedAt: record.startedAt,
    state: record.state,
    targetId: record.target?.targetId ?? null,
    fromVersion: record.target?.fromVersion ?? null,
    toVersion: record.target?.toVersion ?? null,
    snapshotId: record.snapshotId ?? null,
    error: record.error ?? null,
    terminal: TERMINAL.includes(record.state),
    transitions: record.transitions ?? [],
  }
}

/**
 * Read the profile identity from the host, and say where each part came from.
 *
 * A profile whose identity cannot be established is not a profile this plugin
 * will write into: snapshots are keyed by it, so a guessed key would put two
 * different profiles' history in one place.
 *
 * @param {any} ctx
 * @returns {{ id: string, dir: string | null, home: string | null, kind: string, identitySource: string }}
 */
export function readProfileContext(ctx) {
  const profile = ctx?.get?.('profileContext')
  const name = profile?.name
  const home = profile?.home ?? process.env.DSH_HOME ?? null
  if (typeof name === 'string' && name !== '') {
    return {
      id: name,
      dir: typeof profile?.dir === 'string' ? profile.dir : null,
      home,
      kind: 'dsh-profile',
      identitySource: 'profileContext',
    }
  }
  return {
    id: 'unknown',
    dir: null,
    home,
    kind: 'unknown',
    identitySource: 'no profileContext service',
  }
}

/**
 * Read the host's runtime version, or admit that it is not readable.
 *
 * `pluginContext`-independent: the version DSH writes into compatibility checks
 * belongs to the app-boot package, and importing it here would tie this plugin to
 * a peer that a newer host may move. The panel therefore reports what it could
 * observe and marks the rest unknown.
 *
 * @param {any} ctx
 * @returns {{ runtimeVersion: string | null }}
 */
export function readRuntime(ctx) {
  const fromHost = ctx?.get?.('dshRuntimeVersion')
  if (typeof fromHost === 'string' && fromHost !== '') return { runtimeVersion: fromHost }
  const env = process.env.DSH_VERSION
  if (typeof env === 'string' && env !== '') return { runtimeVersion: env }
  return { runtimeVersion: null }
}

/**
 * @param {string | null} dir
 * @returns {Promise<object | null>}
 */
async function readManifest(dir) {
  if (dir === null) return null
  try {
    return JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
  } catch {
    return null
  }
}

/**
 * @param {string | null} dir
 * @returns {Promise<object | null>}
 */
async function readLockfile(dir) {
  if (dir === null) return null
  try {
    return JSON.parse(await readFile(join(dir, 'pnpm-lock.yaml'), 'utf8'))
  } catch {
    // A YAML lockfile is not JSON. Rather than ship a YAML parser for one field,
    // the registry is left unknown with a reason, which is the honest answer.
    return null
  }
}

/**
 * Versions newer than the installed one, with the facts needed to decide.
 *
 * Prereleases are separated rather than filtered away: a user who is already on
 * a prerelease must see their own channel, and a user on a stable release must
 * not be pushed onto one by default.
 *
 * @param {any} ctx
 * @param {string} name
 * @param {{ registry?: string }} options
 * @returns {Promise<object>}
 */
export async function readVersions(ctx, name, options = {}) {
  const profile = readProfileContext(ctx)
  const pluginManager = ctx?.get?.('pluginManager')
  if (pluginManager === undefined || pluginManager === null) {
    return { status: 'unavailable', reason: 'no-plugin-manager', versions: [] }
  }

  let bundles = []
  try {
    bundles = await pluginManager.listBundles()
  } catch (error) {
    return { status: 'unavailable', reason: 'inventory-failed', message: messageOf(error), versions: [] }
  }
  const row = bundles.find((bundle) => bundle.name === name)
  if (row === undefined) {
    return { status: 'unknown-target', reason: 'not-in-profile', versions: [] }
  }
  const parsed = classifySpec(row.source, { official: row.official })
  const refusal = updateRefusal(row, parsed)
  if (refusal !== null) {
    return {
      status: 'read_only',
      reason: 'update-not-offered',
      message: refusal,
      versions: [],
    }
  }

  let result
  try {
    result = await pluginManager.listVersions(name, options.registry === undefined ? undefined : { registry: options.registry })
  } catch (error) {
    return { status: 'error', reason: 'list-failed', message: messageOf(error), versions: [] }
  }
  if (result === null || typeof result !== 'object') {
    return { status: 'error', reason: 'bad-response', versions: [] }
  }
  if (result.status === 'refused') {
    return {
      status: 'read_only',
      reason: result.problem ?? 'refused',
      message: typeof result.reason === 'string' ? result.reason : null,
      versions: [],
    }
  }

  const versions = Array.isArray(result.versions) ? result.versions : []
  const stable = []
  const prerelease = []
  for (const entry of versions) {
    const item = {
      version: typeof entry.version === 'string' ? entry.version : null,
      publishedAt: entry.publishedAt ?? null,
      deprecated: entry.deprecated ?? null,
      isBundle: entry.bundle === true,
      compatibility: entry.compatibility ?? null,
      prerelease: isPrerelease(entry.version),
    }
    if (item.version === null) continue
    if (item.prerelease) prerelease.push(item)
    else stable.push(item)
  }

  return {
    status: 'ok',
    observedAt: new Date().toISOString(),
    profileId: profile.id,
    installed: typeof row.version === 'string' ? row.version : null,
    registry: result.registry ?? null,
    attempts: result.attempts ?? [],
    omitted: result.omitted ?? 0,
    stable,
    prerelease,
    versions: [...stable, ...prerelease],
  }
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function messageOf(error) {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * Take a snapshot of one installed target.
 *
 * @param {any} ctx
 * @param {{ targetId: string, reason?: string }} body
 * @returns {Promise<{ status: number, body: object }>}
 */
export async function takeSnapshot(ctx, body) {
  const profile = readProfileContext(ctx)
  if (profile.dir === null || profile.id === 'unknown') {
    return { status: 409, body: { error: 'profile-identity-unknown' } }
  }
  const overview = await buildOverview(ctx)
  const row = overview.plugins.find((entry) => entry.targetId === body.targetId)
  if (row === undefined) return { status: 404, body: { error: 'unknown-target' } }

  const directory = join(profile.dir, 'node_modules', row.targetId)
  const fingerprint = await fingerprintTree(directory).catch(() => null)
  if (fingerprint === null) {
    return {
      status: 409,
      body: {
        error: 'not-installed',
        message: 'The package directory could not be read, so there is nothing to fingerprint.',
      },
    }
  }
  const document = await writeSnapshot({
    dshHome: profile.home,
    profileId: profile.id,
    target: row,
    fingerprint,
    reason: typeof body.reason === 'string' ? body.reason : 'manual',
  })
  return {
    status: 200,
    body: {
      ok: true,
      snapshot: { id: document.id, seq: document.seq, takenAt: document.takenAt },
    },
  }
}

/**
 * Update one target to one version, recording every step.
 *
 * The order is: verify the target is still updatable, snapshot, verify the
 * snapshot, mark applying, hand off to the host, then read the result back. The
 * host is the only writer of the profile; this function never edits
 * `package.json` itself.
 *
 * @param {any} ctx
 * @param {{ targetId: string, toVersion: string, allowPrerelease?: boolean }} body
 * @returns {Promise<{ status: number, body: object }>}
 */
export async function runUpdate(ctx, body) {
  const profile = readProfileContext(ctx)
  if (profile.dir === null || profile.id === 'unknown') {
    return { status: 409, body: { error: 'profile-identity-unknown' } }
  }
  const pluginManager = ctx?.get?.('pluginManager')
  if (pluginManager === undefined || pluginManager === null) {
    return { status: 409, body: { error: 'no-plugin-manager' } }
  }
  const toVersion = body.toVersion
  if (typeof toVersion !== 'string' || toVersion === '') {
    return { status: 400, body: { error: 'missing-version' } }
  }

  const overview = await buildOverview(ctx)
  const row = overview.plugins.find((entry) => entry.targetId === body.targetId)
  if (row === undefined) return { status: 404, body: { error: 'unknown-target' } }
  if (row.updateRefusal !== null) {
    return { status: 409, body: { error: 'not-updatable', message: row.updateRefusal } }
  }
  if (isPrerelease(toVersion) && body.allowPrerelease !== true) {
    return {
      status: 409,
      body: {
        error: 'prerelease-not-confirmed',
        message: 'The target version is a prerelease and this request did not opt in.',
      },
    }
  }
  if (toVersion === row.installedVersion) {
    return { status: 409, body: { error: 'already-at-version' } }
  }

  const directory = join(profile.dir, 'node_modules', row.targetId)
  const fingerprint = await fingerprintTree(directory).catch(() => null)
  const snapshot = await writeSnapshot({
    dshHome: profile.home,
    profileId: profile.id,
    target: row,
    fingerprint,
    reason: `before update to ${toVersion}`,
  })

  // Verify the snapshot can be read back before anything is touched: a snapshot
  // taken but unreadable is the same as no snapshot.
  const written = await listSnapshots(profile.home, profile.id, row.targetId)
  const verified = written.find((entry) => entry.id === snapshot.id)
  if (verified === undefined) {
    return { status: 500, body: { error: 'snapshot-not-verifiable', snapshotId: snapshot.id } }
  }

  const record = await beginOperation({
    dshHome: profile.home,
    profileId: profile.id,
    target: row,
    toVersion,
  })
  await transition(profile.home, profile.id, record, 'snapshot_verified', {
    snapshotId: snapshot.id,
  })
  await transition(profile.home, profile.id, record, 'applying')

  // The host owns every write to the profile. An update is its removal plus its
  // installation; a failure between them is the host's `restore` path, not ours.
  let result
  try {
    result = await pluginManager.updateBundle(row.targetId, toVersion, {})
  } catch (error) {
    await transition(profile.home, profile.id, record, 'failed', { error: messageOf(error) })
    return {
      status: 502,
      body: { error: 'update-threw', message: messageOf(error), operationId: record.id, snapshotId: snapshot.id },
    }
  }

  await transition(profile.home, profile.id, record, 'verifying')
  const outcome = classifyUpdateResult(result)
  const finalState = outcome.ok ? 'succeeded' : 'recovery_required'
  await transition(profile.home, profile.id, record, finalState, {
    error: outcome.message,
  })

  const after = await buildOverview(ctx)
  const afterRow = after.plugins.find((entry) => entry.targetId === body.targetId)

  return {
    status: outcome.ok ? 200 : 502,
    body: {
      ok: outcome.ok,
      operationId: record.id,
      snapshotId: snapshot.id,
      fromVersion: row.installedVersion,
      toVersion,
      observedVersion: afterRow?.installedVersion ?? null,
      result,
      message: outcome.message,
    },
  }
}

/**
 * Did the host's update actually change anything?
 *
 * `changed: false` is not a failure of the request — it is the host saying the
 * application did not run. Reporting that as success would be the "claimed but
 * never happened" bug this plugin exists to avoid.
 *
 * @param {unknown} result
 * @returns {{ ok: boolean, message: string | null }}
 */
export function classifyUpdateResult(result) {
  if (result === null || typeof result !== 'object') {
    return { ok: false, message: 'The host returned no update result.' }
  }
  if (result.changed !== true) {
    const application = result.application ?? result.result?.application ?? 'not-applied'
    const detail = result.error?.message ?? result.result?.error?.message ?? result.diagnostic ?? null
    return {
      ok: false,
      message: detail === null ? `The host reported "${application}" without applying the update.` : String(detail),
    }
  }
  return { ok: true, message: null }
}

/**
 * Restore a target from one snapshot.
 *
 * Only the version is restored, and only when the files still match the
 * fingerprint taken before that change. Configuration, the dependency tree and
 * agent presets are explicitly out of scope, and the reply says so.
 *
 * @param {any} ctx
 * @param {{ targetId: string, snapshotId: string }} body
 * @returns {Promise<{ status: number, body: object }>}
 */
export async function restoreSnapshot(ctx, body) {
  const profile = readProfileContext(ctx)
  if (profile.dir === null || profile.id === 'unknown') {
    return { status: 409, body: { error: 'profile-identity-unknown' } }
  }
  const pluginManager = ctx?.get?.('pluginManager')
  if (pluginManager === undefined || pluginManager === null) {
    return { status: 409, body: { error: 'no-plugin-manager' } }
  }

  const rows = await listSnapshots(profile.home, profile.id, body.targetId)
  const chosen = rows.find((entry) => entry.id === body.snapshotId)
  if (chosen === undefined) return { status: 404, body: { error: 'unknown-snapshot' } }

  const document = await readSnapshotDocument(profile.home, profile.id, body.targetId, chosen.file)
  if (document === null) return { status: 409, body: { error: 'snapshot-unreadable' } }

  const directory = join(profile.dir, 'node_modules', body.targetId)
  const current = await fingerprintTree(directory).catch(() => null)
  const verdict = recoveryVerdict(document, current)

  if (!verdict.ok) {
    return {
      status: 409,
      body: {
        error: verdict.reason,
        message: verdict.detail,
        // Restoring is refused, and the reason names the exact condition that
        // failed so the user can decide what to do instead of retrying blindly.
        note: 'Version restore only; configuration, dependency tree and presets are not rolled back.',
      },
    }
  }

  const targetVersion = document.target.installedVersion
  const overview = await buildOverview(ctx)
  const row = overview.plugins.find((entry) => entry.targetId === body.targetId)
  const record = await beginOperation({
    dshHome: profile.home,
    profileId: profile.id,
    target: row ?? { kind: 'plugin', targetId: body.targetId, installedVersion: current?.digest ?? null, declaredSpec: document.target.declaredSpec, source: { kind: 'registry' } },
    toVersion: targetVersion,
  })
  await transition(profile.home, profile.id, record, 'snapshot_verified', { snapshotId: body.snapshotId })
  await transition(profile.home, profile.id, record, 'applying', {
    detail: 'restoring a recorded version',
  })

  let result
  try {
    result = await pluginManager.installBundle(`${body.targetId}@${targetVersion}`, {
      saveExact: true,
      registry: undefined,
      enabled: true,
    })
  } catch (error) {
    await transition(profile.home, profile.id, record, 'failed', { error: messageOf(error) })
    return { status: 502, body: { error: 'restore-threw', message: messageOf(error), operationId: record.id } }
  }

  await transition(profile.home, profile.id, record, 'verifying')
  const ok = result?.result?.application === 'applied' || result?.application === 'applied' || result?.changed === true
  await transition(profile.home, profile.id, record, ok ? 'succeeded' : 'recovery_required', {
    error: ok ? null : 'The host did not report an applied restore.',
  })

  return {
    status: ok ? 200 : 502,
    body: {
      ok,
      operationId: record.id,
      restoredVersion: targetVersion,
      result,
      note: 'Version restore only; configuration, dependency tree and presets are not rolled back.',
    },
  }
}

/**
 * Read one stored snapshot document by its file name.
 *
 * @param {string} dshHome
 * @param {string} profileId
 * @param {string} targetId
 * @param {string} file
 * @returns {Promise<object | null>}
 */
async function readSnapshotDocument(dshHome, profileId, targetId, file) {
  if (typeof file !== 'string' || file.includes('/') || file.includes('\\') || file.includes('..')) {
    return null
  }
  const path = join(
    dshHome,
    'version-manager',
    'snapshots',
    String(profileId).replace(/\//g, '%2F'),
    String(targetId).replace(/\//g, '%2F'),
    file,
  )
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return null
  }
}

export { snapshotsBeyondRetention, deleteSnapshot }

/**
 * Register every route on the host webserver.
 *
 * @param {any} ctx
 * @param {{ webServer: { register: (route: any) => () => void } }} scope
 * @returns {() => void[]} disposers
 */
export function registerRoutes(ctx, scope) {
  const { webServer } = scope
  const disposers = []
  const publish = (path, handler) => {
    const dispose = webServer.register({ kind: 'exact', path: `${ROUTE_BASE}${path}`, handler })
    disposers.push(dispose)
  }

  /** @param {(request: any, response: any, body: any) => Promise<{status: number, body: unknown}>} run */
  const writeRoute = (path, run) => {
    publish(path, async (request, response) => {
      const allowed = admit(ctx, request)
      if (!allowed.ok) {
        sendJson(response, allowed.status, { error: allowed.status === 403 ? 'forbidden' : 'unauthorized' })
        return
      }
      if (request.method !== 'POST') {
        response.writeHead(405, { allow: 'POST' })
        response.end()
        return
      }
      const parsed = await readJsonBody(request)
      if (!parsed.ok) {
        sendJson(response, parsed.status, { error: parsed.message })
        return
      }
      if (parsed.value?.confirm !== true) {
        // The confirmation is per request. A UI that forgets to send it gets a
        // refusal, not a silent write.
        sendJson(response, 400, { error: 'confirm required' })
        return
      }
      try {
        const result = await run(request, response, parsed.value)
        sendJson(response, result.status, result.body)
      } catch (error) {
        // A thrown handler would be turned into a bare 400 by the host, losing
        // which step failed. Answering here keeps the reason.
        sendJson(response, 500, { error: 'handler-failed', message: messageOf(error) })
      }
    })
  }

  publish('/overview', async (request, response) => {
    const allowed = admit(ctx, request)
    if (!allowed.ok) {
      sendJson(response, allowed.status, { error: allowed.status === 403 ? 'forbidden' : 'unauthorized' })
      return
    }
    if (request.method !== 'GET') {
      response.writeHead(405, { allow: 'GET' })
      response.end()
      return
    }
    try {
      sendJson(response, 200, await buildOverview(ctx))
    } catch (error) {
      sendJson(response, 500, { error: 'overview-failed', message: messageOf(error) })
    }
  })

  publish('/versions', async (request, response) => {
    const allowed = admit(ctx, request)
    if (!allowed.ok) {
      sendJson(response, allowed.status, { error: allowed.status === 403 ? 'forbidden' : 'unauthorized' })
      return
    }
    if (request.method !== 'GET') {
      response.writeHead(405, { allow: 'GET' })
      response.end()
      return
    }
    const url = new URL(request.url ?? '/', 'http://localhost')
    const name = url.searchParams.get('target')
    if (name === null || name === '') {
      sendJson(response, 400, { error: 'missing target' })
      return
    }
    try {
      sendJson(response, 200, await readVersions(ctx, name))
    } catch (error) {
      sendJson(response, 500, { error: 'versions-failed', message: messageOf(error) })
    }
  })

  writeRoute('/snapshot', async (_request, _response, body) => takeSnapshot(ctx, body))
  writeRoute('/update', async (_request, _response, body) => runUpdate(ctx, body))
  writeRoute('/restore', async (_request, _response, body) => restoreSnapshot(ctx, body))

  return disposers
}
