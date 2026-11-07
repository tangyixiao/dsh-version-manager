import assert from 'node:assert/strict'
import test from 'node:test'

import {
  SPEC_KINDS,
  classifySpec,
  declaredSpecMatches,
  isExactVersion,
  isPrerelease,
  splitRegistrySpec,
  updateRefusal,
} from '../lib/host/spec.js'

test('splitRegistrySpec keeps scoped names whole', () => {
  assert.deepEqual(splitRegistrySpec('@scope/name@1.2.3'), { name: '@scope/name', range: '1.2.3' })
  assert.deepEqual(splitRegistrySpec('@scope/name'), { name: '@scope/name', range: null })
  assert.deepEqual(splitRegistrySpec('plain'), { name: 'plain', range: null })
  assert.deepEqual(splitRegistrySpec('plain@^2.0.0'), { name: 'plain', range: '^2.0.0' })
})

test('splitRegistrySpec treats a trailing @ as no range', () => {
  // `pkg@` is a broken spec, but returning a null range is better than an empty
  // string that would later read as "any version".
  assert.deepEqual(splitRegistrySpec('pkg@'), { name: 'pkg', range: null })
})

test('classifySpec recognises every documented kind', () => {
  assert.equal(classifySpec('1.2.3').kind, 'registry')
  assert.equal(classifySpec('^1.2.3').kind, 'registry')
  assert.equal(classifySpec('file:C:/tmp/pkg-1.0.0.tgz').kind, 'tarball')
  assert.equal(classifySpec('file:../local-pkg').kind, 'file')
  assert.equal(classifySpec('link:../local-pkg').kind, 'link')
  assert.equal(classifySpec('workspace:*').kind, 'workspace')
  assert.equal(classifySpec('npm:other-name@1.0.0').kind, 'alias')
  assert.equal(classifySpec('git+https://example.com/a/b.git').kind, 'git')
  assert.equal(classifySpec('git@github.com:a/b.git').kind, 'git')
  assert.equal(classifySpec('github:a/b').kind, 'git')
  assert.equal(classifySpec('owner/repo').kind, 'git')
  assert.equal(classifySpec('https://example.com/pkg.tgz').kind, 'tarball')
  assert.equal(classifySpec('https://example.com/archive/tarball/main').kind, 'tarball')
  assert.equal(classifySpec('https://example.com/a/b.git').kind, 'git')
  assert.equal(classifySpec('', { official: true }).kind, 'builtin')
})

test('classifySpec refuses to guess', () => {
  assert.equal(classifySpec(undefined).kind, 'unknown')
  assert.equal(classifySpec('   ').kind, 'unknown')
  assert.equal(classifySpec('a:b:c').kind, 'unknown')
  assert.ok(SPEC_KINDS.includes(classifySpec('@scope/name@1').kind))
})

test('a renamed key does not turn a Git or file dependency into a registry row', () => {
  // This is the shape the host reports for every dependency whose key differs
  // from the package name: `dsh-bili-whale@https://github.com/.../tarball/main`.
  // Reading it as a registry row would both mislabel the source and offer an
  // update that cannot work.
  const git = classifySpec('dsh-bili-whale@https://github.com/a/b/tarball/main')
  assert.equal(git.kind, 'tarball')
  assert.equal(git.name, 'dsh-bili-whale')
  assert.equal(git.detail, 'https://github.com/a/b/tarball/main')

  const local = classifySpec('dsh-bili-scroll@file:C:/Users/x/packages/dsh-bili-scroll-2.3.1.tgz')
  assert.equal(local.kind, 'tarball')
  assert.equal(local.detail, 'C:/Users/x/packages/dsh-bili-scroll-2.3.1.tgz')

  const linked = classifySpec('pkg@link:../pkg')
  assert.equal(linked.kind, 'link')

  // A plain range is still a registry row, and so is a range that merely holds a
  // scope (the `:` inside a name must not trip the inner-spec branch).
  assert.equal(classifySpec('pkg@^1.2.3').kind, 'registry')
  assert.equal(classifySpec('@scope/pkg@1.2.3').kind, 'registry')
})

test('an official bundle is builtin even when it carries a registry spec', () => {
  const parsed = classifySpec('1.2.3', { official: true })
  assert.equal(parsed.kind, 'builtin')
  // The kind carries the meaning; prose lives in the panel, not the model.
  assert.equal(parsed.detail, null)
})

test('isExactVersion separates a pin from a range', () => {
  assert.equal(isExactVersion('1.2.3'), true)
  assert.equal(isExactVersion('1.2.3-beta.1'), true)
  assert.equal(isExactVersion('^1.2.3'), false)
  assert.equal(isExactVersion('~1.2.3'), false)
  assert.equal(isExactVersion('1.x'), false)
  assert.equal(isExactVersion(null), false)
})

test('isPrerelease looks only at the version string', () => {
  assert.equal(isPrerelease('0.2.2-rc.1'), true)
  assert.equal(isPrerelease('1.0.0'), false)
  assert.equal(isPrerelease(undefined), false)
  assert.equal(isPrerelease(3), false)
})

test('updateRefusal names the first condition that fails', () => {
  const base = {
    name: 'pkg',
    official: false,
    availability: 'profile',
    installed: true,
    source: 'pkg@1.2.3',
    version: '1.2.3',
    readOnlyReason: undefined,
  }
  // The host builds `source` as `<name>@<declared range>`, so the fixtures use
  // that shape: a bare `1.2.3` would parse as a package literally named "1.2.3".
  const parsedBase = classifySpec('pkg@1.2.3')
  assert.equal(updateRefusal(base, parsedBase), null)

  // Refusals are reason codes, not prose: the panel owns the sentence, so the
  // reason has to survive translation and be assertable.
  assert.equal(updateRefusal({ ...base, official: true }, parsedBase), 'official-bundle')
  assert.equal(updateRefusal({ ...base, availability: 'missing' }, parsedBase), 'not-installed-here')
  assert.equal(updateRefusal({ ...base, installed: false }, parsedBase), 'not-installed')
  assert.equal(
    updateRefusal({ ...base, readOnlyReason: 'management-required' }, parsedBase),
    'read-only:management-required',
  )
  assert.equal(updateRefusal({ ...base, source: undefined }, classifySpec(undefined)), 'no-declared-spec')
  assert.equal(updateRefusal(base, classifySpec('file:C:/tmp/x.tgz')), 'not-registry:tarball')
  assert.equal(updateRefusal(base, classifySpec('pkg@npm:other@1')), 'alias-substitution')
  assert.equal(updateRefusal({ ...base, version: '' }, parsedBase), 'no-installed-version')
})

test('updateRefusal refuses a spec that would replace the package', () => {
  const row = {
    name: 'pkg',
    official: false,
    availability: 'profile',
    installed: true,
    source: 'npm:someone-else@2.0.0',
    version: '1.2.3',
  }
  const refusal = updateRefusal(row, classifySpec(row.source))
  assert.match(refusal, /substitution/)
})

test('a tarball spec is never offered an update even when its name matches', () => {
  const row = {
    name: 'pkg',
    official: false,
    availability: 'profile',
    installed: true,
    source: 'file:C:/tmp/pkg-2.0.0.tgz',
    version: '1.0.0',
  }
  assert.notEqual(updateRefusal(row, classifySpec(row.source)), null)
})

test('an ordinary install does not look like declared-spec drift', () => {
  // The host reports "name@1.7.3"; the profile manifest stores "1.7.3".
  assert.equal(declaredSpecMatches('dsh-update-checker@1.7.3', '1.7.3', 'dsh-update-checker'), true)
  assert.equal(declaredSpecMatches('pkg@^0.4.0', '^0.4.0', 'pkg'), true)
  assert.equal(declaredSpecMatches('^0.4.0', '^0.4.0', 'pkg'), true)
})

test('a range rewritten in the manifest is reported as drift', () => {
  assert.equal(declaredSpecMatches('pkg@1.7.3', '^1.7.0', 'pkg'), false)
  assert.equal(declaredSpecMatches('pkg@1.7.3', null, 'pkg'), false)
  assert.equal(declaredSpecMatches(null, '1.7.3', 'pkg'), false)
})
