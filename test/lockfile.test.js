import { test } from 'node:test'
import assert from 'node:assert/strict'

import { lockfileTarball, registryFor, registryOfTarball } from '../lib/host/lockfile.js'

const LOCK = `lockfileVersion: '9.0'

settings:
  autoInstallPeers: false

importers:

  .:
    dependencies:
      dsh-update-checker:
        specifier: 1.7.3
        version: 1.7.3
      @scope/thing:
        specifier: 2.0.0
        version: 2.0.0

packages:

  dsh-update-checker@1.7.3:
    resolution: {integrity: sha512-FrtDKnBPrHjnxMcQE2/zdE4MWgMgXVu6sgNSiBQKOcxcfhrKdXwnvp9excew7ZVrRqU9mUkPU+5HamAeE73PNA==}
    peerDependencies:
      react: ^18.2.0

  '@scope/thing@2.0.0':
    resolution: {integrity: sha512-abc, tarball: https://registry.npmmirror.com/@scope/thing/-/thing-2.0.0.tgz}

  dsh-version-manager@file:../../../vm-pack/dsh-version-manager-0.1.0.tgz:
    resolution: {integrity: sha512-5bBj76, tarball: file:../../../vm-pack/dsh-version-manager-0.1.0.tgz}
    version: 0.1.0

snapshots:

  dsh-update-checker@1.7.3: {}
`

test('lockfileTarball finds an explicit registry tarball', () => {
  assert.equal(
    lockfileTarball(LOCK, '@scope/thing'),
    'https://registry.npmmirror.com/@scope/thing/-/thing-2.0.0.tgz',
  )
})

test('lockfileTarball finds a file tarball and keeps its scheme', () => {
  assert.equal(lockfileTarball(LOCK, 'dsh-version-manager'), 'file:../../../vm-pack/dsh-version-manager-0.1.0.tgz')
})

test('lockfileTarball returns null when the package has no tarball', () => {
  assert.equal(lockfileTarball(LOCK, 'dsh-update-checker'), null)
  assert.equal(lockfileTarball(LOCK, 'not-installed'), null)
  assert.equal(lockfileTarball('', 'anything'), null)
})

test('registryOfTarball keeps only scheme and host', () => {
  assert.equal(registryOfTarball('https://registry.npmjs.org/a/-/a-1.0.0.tgz'), 'https://registry.npmjs.org/')
  // A non-http tarball is a local path, not a registry.
  assert.equal(registryOfTarball('file:../x.tgz'), null)
  assert.equal(registryOfTarball('not a url'), null)
})

test('registryFor prefers the lockfile tarball', () => {
  const result = registryFor({
    name: '@scope/thing',
    lockText: LOCK,
    lockfileReadable: true,
    declaredSpec: '2.0.0',
  })
  assert.equal(result.registry, 'https://registry.npmmirror.com/')
  assert.equal(result.reason, null)
})

test('registryFor explains a local install instead of naming a registry', () => {
  const result = registryFor({
    name: 'dsh-bili-scroll',
    lockText: LOCK,
    lockfileReadable: true,
    declaredSpec: 'file:C:/Users/x/packages/pkg.tgz',
  })
  assert.equal(result.registry, null)
  assert.match(result.reason, /local path/)
})

test('registryFor explains a git install', () => {
  const result = registryFor({
    name: 'dsh-speak-up',
    lockText: LOCK,
    lockfileReadable: true,
    declaredSpec: 'https://github.com/x/y/tarball/main',
  })
  assert.equal(result.registry, null)
  assert.match(result.reason, /Git|tarball/)
})

test('a plain registry install leaves the host unrecorded, with a reason', () => {
  const result = registryFor({
    name: 'dsh-update-checker',
    lockText: LOCK,
    lockfileReadable: true,
    declaredSpec: '1.7.3',
  })
  // npmjs is the default, but the lockfile does not say so. The panel must not
  // invent it.
  assert.equal(result.registry, null)
  assert.match(result.reason, /not stored/)
})

test('a missing lockfile is reported as missing', () => {
  const result = registryFor({
    name: 'anything',
    lockText: null,
    lockfileReadable: false,
    declaredSpec: '1.0.0',
  })
  assert.equal(result.registry, null)
  assert.match(result.reason, /No lockfile/)
})
