import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyMigration, archiveDigest, canMigrate, previewMigration } from '../lib/host/registry-migration.js'
import { runUpdate } from '../lib/host/routes.js'

async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'dvm-migration-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const dir = join(home, 'profiles', 'test')
  await mkdir(join(dir, 'node_modules', 'demo'), { recursive: true })
  await writeFile(join(dir, 'node_modules', 'demo', 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0' }))
  const archive = join(home, 'demo.tgz')
  await writeFile(archive, 'original archive fixture')
  const row = { targetId: 'demo', installedVersion: '1.0.0', declaredSpec: `file:${archive}`, official: false,
    availability: 'profile', updateRefusal: 'not-registry:tarball', source: { kind: 'tarball' }, enabledState: 'disabled', compatibility: { runtimeVersion: '0.2.2-rc.3' } }
  const manifest = { name: 'demo', version: '1.1.0', dsh: { bundle: { patch: './cordis.patch.yml' } }, engines: { dsh: '>=0.2.2-rc.1' }, dist: { integrity: 'sha512-fixture' } }
  return { home, dir, row, archive, manifest, fetch: async () => Response.json(manifest) }
}

test('local migration requires a genuine named installed archive and checks stable registry identity and compatibility', async t => {
  const f = await fixture(t)
  const data = await previewMigration(f.row, f, { fetch: f.fetch })
  assert.equal(data.sourceMigration.from, f.row.declaredSpec)
  assert.match(data.sourceMigration.archiveDigest, /^[a-f0-9]{64}$/)
  assert.equal(data.stable[0].version, '1.1.0')
  for (const patch of [{ name: 'other' }, { version: '0.9.0' }, { version: '2.0.0-beta.1' }, { deprecated: 'withdrawn' }, { engines: { dsh: '>=9.0.0' } }, { dsh: {} }, { dist: {} }]) {
    await assert.rejects(previewMigration(f.row, f, { fetch: async () => Response.json({ ...f.manifest, ...patch }) }))
  }
  for (const patch of [{ official: true }, { source: { kind: 'git' } }, { updateRefusal: 'read-only:management-required' }, { declaredSpec: 'https://example.com/demo.tgz' }]) assert.equal(canMigrate({ ...f.row, ...patch }), false)
})

test('migration supports the same version without silently downgrading a newer local package', async t => {
  const f = await fixture(t)
  f.manifest.version = '1.0.0'
  assert.equal((await previewMigration(f.row, f, { fetch: f.fetch })).stable[0].version, '1.0.0')
  await writeFile(join(f.dir, 'node_modules', 'demo', 'package.json'), JSON.stringify({ name: 'other', version: '1.0.0' }))
  await assert.rejects(previewMigration(f.row, f, { fetch: f.fetch }), /identity changed/)
})

test('migration preserves disabled state and uses host removal only for an already-installed result', async t => {
  const f = await fixture(t)
  const calls = []
  const manager = {
    installBundle: async (spec, options) => { calls.push({ spec, options }); return calls.length === 1 ? { changed: false, error: { code: 'already-installed' } } : { changed: true, application: 'applied' } },
    removeBundle: async name => { calls.push({ remove: name }); return { changed: true, application: 'applied' } },
  }
  const result = await applyMigration(manager, f.row, '1.1.0', f, await archiveDigest(f.row, f.dir))
  assert.equal(result.application, 'applied')
  assert.equal(calls[0].spec, 'demo@1.1.0')
  assert.equal(calls[0].options.enabled, false)
  assert.equal(calls[0].options.registry, 'https://registry.npmjs.org/')
  assert.equal(calls[1].remove, 'demo')
})

test('failed npm installation reinstalls the unchanged original archive; a changed archive blocks rollback', async t => {
  const f = await fixture(t)
  const calls = []
  const digest = await archiveDigest(f.row, f.dir)
  const manager = { installBundle: async spec => { calls.push(spec); return spec.startsWith('file:') ? { changed: true, application: 'applied' } : { changed: false, application: 'failed' } } }
  assert.equal((await applyMigration(manager, f.row, '1.1.0', f, digest)).rollback.ok, true)
  assert.equal(calls[1], f.row.declaredSpec)
  await writeFile(f.archive, 'changed')
  const result = await applyMigration(manager, f.row, '1.1.0', f, digest)
  assert.equal(result.rollback.ok, false)
  assert.match(result.rollback.message, /archive changed/)
})

test('the update route refuses migration without an exact confirmed source and installed baseline', async t => {
  const f = await fixture(t)
  let touched = false
  const ctx = { get(name) {
    if (name === 'profileContext') return { name: 'test', home: f.home, dir: f.dir }
    if (name === 'pluginManager') return {
      listBundles: async () => [{ name: 'demo', version: '1.0.0', source: f.row.declaredSpec, installed: true, availability: 'profile' }],
      installBundle: async () => { touched = true },
    }
  } }
  const result = await runUpdate(ctx, { targetId: 'demo', toVersion: '1.1.0', migrateToRegistry: true, fromVersion: '1.0.0' }, { fetch: f.fetch })
  assert.equal(result.body.error, 'source-confirmation-required')
  assert.equal(touched, false)
})

test('the update route snapshots, changes the source through the host and verifies the installed result', async t => {
  const f = await fixture(t)
  delete f.manifest.engines
  let version = '1.0.0', source = f.row.declaredSpec, installs = 0
  const ctx = { get(name) {
    if (name === 'profileContext') return { name: 'test', home: f.home, dir: f.dir }
    if (name === 'pluginManager') return {
      listBundles: async () => [{ name: 'demo', version, source, installed: true, availability: 'profile' }],
      installBundle: async spec => { installs++; source = spec; version = '1.1.0'; await writeFile(join(f.dir, 'node_modules/demo/package.json'), JSON.stringify({ name: 'demo', version })); return { changed: true, application: 'applied' } },
    }
  } }
  const request = { targetId: 'demo', toVersion: '1.1.0', migrateToRegistry: true, fromVersion: '1.0.0', expectedSource: source, archiveDigest: await archiveDigest(f.row, f.dir) }
  const result = await runUpdate(ctx, request, { fetch: f.fetch })
  assert.equal(result.body.ok, true)
  assert.equal(result.body.observedVersion, '1.1.0')
  assert.ok(result.body.snapshotId)
  assert.equal(installs, 1)
  assert.equal(source, 'demo@1.1.0')
})
