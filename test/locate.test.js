/**
 * Reading a package manifest out of a tree the plugin only reads.
 *
 * These tests cover the half of `locate.js` that can be tested without a
 * running host: the two places a bundle can live and the order they are tried.
 * `hostInfo()` itself is deliberately not in here — its whole job is to ask the
 * live process where it came from, and a test that faked that would be
 * measuring the fake.
 */

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { readInstalledManifest, resetHostCache } from '../lib/host/locate.js'

async function placeManifest(root, name, manifest) {
  const directory = join(root, 'node_modules', ...name.split('/'))
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'package.json'), JSON.stringify(manifest), 'utf8')
  return directory
}

test('the profile copy wins over the host copy', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vm-locate-'))
  const profileDir = join(root, 'profile')
  const hostRoot = join(root, 'host')
  await placeManifest(profileDir, 'demo-plugin', { name: 'demo-plugin', version: '1.0.0' })
  await placeManifest(hostRoot, 'demo-plugin', { name: 'demo-plugin', version: '2.0.0' })

  const manifest = readInstalledManifest('demo-plugin', { profileDir, hostRoot })
  assert.equal(manifest.version, '1.0.0', 'an installed profile copy is what runs')
})

test('the host copy is used when the profile does not have one', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vm-locate-'))
  const profileDir = join(root, 'profile')
  const hostRoot = join(root, 'host')
  await mkdir(profileDir, { recursive: true })
  await placeManifest(hostRoot, 'demo-plugin', { name: 'demo-plugin', version: '2.0.0' })

  const manifest = readInstalledManifest('demo-plugin', { profileDir, hostRoot })
  assert.equal(manifest.version, '2.0.0')
})

test('a scoped package name is read from its own directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vm-locate-'))
  const profileDir = join(root, 'profile')
  await placeManifest(profileDir, '@scope/demo', { name: '@scope/demo', version: '3.1.0' })

  const manifest = readInstalledManifest('@scope/demo', { profileDir, hostRoot: null })
  assert.equal(manifest.name, '@scope/demo')
  assert.equal(manifest.version, '3.1.0')
})

test('an unreadable manifest is null, not an exception', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vm-locate-'))
  const profileDir = join(root, 'profile')
  const directory = join(profileDir, 'node_modules', 'broken')
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'package.json'), '{ half a file', 'utf8')

  assert.equal(readInstalledManifest('broken', { profileDir, hostRoot: null }), null)
})

test('an empty name or missing roots answer null without touching the disk', () => {
  assert.equal(readInstalledManifest('', { profileDir: 'x', hostRoot: null }), null)
  assert.equal(readInstalledManifest(null, { profileDir: 'x', hostRoot: null }), null)
  // A package that exists nowhere still has to answer, not throw.
  assert.equal(readInstalledManifest('definitely-not-installed-anywhere', {}), null)
})

test('resetHostCache exists so a test can ask again', () => {
  // The cache is module state; this asserts the switch is there and is safe to
  // call repeatedly, which is all the plugin itself needs from it.
  resetHostCache()
  resetHostCache()
})
