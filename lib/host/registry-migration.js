import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { classifySpec } from './spec.js'
import { evaluateCompatibility, parseVersion } from './compat.js'

export const REGISTRY = 'https://registry.npmjs.org/'

export function canMigrate(row) {
  if (!row || row.official || row.availability !== 'profile' || row.source?.kind !== 'tarball') return false
  if (row.updateRefusal !== 'not-registry:tarball') return false
  const spec = row.declaredSpec ?? ''
  return /^file:/i.test(spec) || spec.startsWith(`${row.targetId}@file:`)
}

export async function archiveDigest(row, profileDir) {
  if (!canMigrate(row)) throw new Error('Only installed local archives can change to a registry source.')
  const source = classifySpec(row.declaredSpec)
  const file = resolve(profileDir, source.detail)
  const info = await stat(file)
  if (!info.isFile() || info.size > 32 * 1024 * 1024) throw new Error('The original archive is missing or exceeds 32 MiB.')
  return createHash('sha256').update(await readFile(file)).digest('hex')
}

export async function previewMigration(row, profile, options = {}) {
  if (!canMigrate(row)) throw new Error('This source cannot migrate to npm.')
  if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/.test(row.targetId)) throw new Error('Invalid npm package name.')
  const installed = JSON.parse(await readFile(resolve(profile.dir, 'node_modules', row.targetId, 'package.json'), 'utf8'))
  if (installed.name !== row.targetId || installed.version !== row.installedVersion) throw new Error('The installed package identity changed.')
  const digest = await archiveDigest(row, profile.dir)
  const response = await (options.fetch ?? fetch)(`${REGISTRY}${encodeURIComponent(row.targetId)}/latest`, {
    redirect: 'error', signal: AbortSignal.timeout(15000), headers: { accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`npm metadata request failed: HTTP ${response.status}`)
  const reader = response.body.getReader()
  const chunks = []
  let bytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > 1024 * 1024) throw new Error('npm metadata exceeds 1 MiB.')
      chunks.push(Buffer.from(value))
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  const manifest = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  const version = parseVersion(manifest.version)
  const current = parseVersion(row.installedVersion)
  if (manifest.name !== row.targetId || !version || !current || version.prerelease.length || manifest.deprecated ||
      typeof manifest.dsh?.bundle?.patch !== 'string' || !manifest.dsh.bundle.patch || !manifest.dist?.integrity) throw new Error('npm latest is not a verified stable bundle with the same package name.')
  const numeric = v => [v.major, v.minor, v.patch]
  const latestParts = numeric(version), currentParts = numeric(current)
  const differing = latestParts.findIndex((part, index) => part !== currentParts[index])
  if (differing >= 0 && latestParts[differing] < currentParts[differing]) throw new Error('npm latest is older than the installed version.')
  const compatibility = evaluateCompatibility({ manifest, runtimeVersion: row.compatibility?.runtimeVersion })
  if (compatibility.verdict !== 'satisfied') throw new Error('npm latest compatibility could not be confirmed.')
  return {
    status: 'ok', installed: row.installedVersion, registry: REGISTRY,
    sourceMigration: { from: row.declaredSpec, to: `${row.targetId}@${manifest.version}`, archiveDigest: digest },
    stable: [{ version: manifest.version, isBundle: true, prerelease: false, deprecated: null, incompatible: null }],
    prerelease: [], versions: [{ version: manifest.version, isBundle: true, prerelease: false, deprecated: null, incompatible: null }],
  }
}

function applied(result) {
  const inner = result?.result ?? result
  return inner?.changed === true && inner?.application === 'applied'
}

export async function applyMigration(manager, row, version, profile, digest) {
  const replace = async (spec, expectedVersion, registry) => {
    const settings = { saveExact: true, enabled: row.enabledState !== 'disabled', expected: { name: row.targetId, version: expectedVersion }, ...(registry ? { registry } : {}) }
    let result = await manager.installBundle(spec, settings)
    if ((result?.result ?? result)?.error?.code === 'already-installed') {
      const removed = await manager.removeBundle(row.targetId)
      if (!applied(removed)) throw new Error('The host did not remove the previous bundle.')
      result = await manager.installBundle(spec, settings)
    }
    if (!applied(result)) throw new Error('The host did not apply the requested installation.')
    return result
  }
  try {
    return await replace(`${row.targetId}@${version}`, version, REGISTRY)
  } catch (error) {
    let rollback
    try {
      if (await archiveDigest(row, profile.dir) !== digest) throw new Error('The original archive changed; automatic rollback refused.')
      rollback = { ok: true, result: await replace(`file:${classifySpec(row.declaredSpec).detail}`, row.installedVersion) }
    } catch (restoreError) { rollback = { ok: false, message: restoreError.message } }
    return { changed: false, application: 'failed', error: { message: error.message }, rollback }
  }
}
