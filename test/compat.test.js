import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  dshRequirements,
  evaluateCompatibility,
  manifestVersion,
  parseVersion,
  satisfiesRange,
} from '../lib/host/compat.js'

test('parseVersion reads a release and a prerelease', () => {
  assert.deepEqual(parseVersion('1.2.3'), { major: 1, minor: 2, patch: 3, prerelease: [] })
  assert.deepEqual(parseVersion('0.2.2-rc.1'), { major: 0, minor: 2, patch: 2, prerelease: ['rc', '1'] })
  assert.equal(parseVersion('not a version'), null)
  assert.equal(parseVersion(undefined), null)
})

test('a prerelease does not satisfy a range that excludes it, but prereleases are included', () => {
  // The host evaluates with includePrerelease, so >=0.2.0 admits 0.2.2-rc.1.
  assert.equal(satisfiesRange('0.2.2-rc.1', '>=0.2.0'), true)
  assert.equal(satisfiesRange('0.2.2-rc.1', '>=0.2.3'), false)
  assert.equal(satisfiesRange('0.2.2-rc.1', '0.2.2-rc.1'), true)
})

test('caret and tilde stay inside their own minor or patch', () => {
  assert.equal(satisfiesRange('1.4.0', '^1.2.3'), true)
  assert.equal(satisfiesRange('2.0.0', '^1.2.3'), false)
  assert.equal(satisfiesRange('0.2.9', '^0.2.3'), true)
  assert.equal(satisfiesRange('0.3.0', '^0.2.3'), false)
  assert.equal(satisfiesRange('1.2.9', '~1.2.3'), true)
  assert.equal(satisfiesRange('1.3.0', '~1.2.3'), false)
})

test('unions and conjunctions both work', () => {
  assert.equal(satisfiesRange('0.3.0', '>=0.1.0 <0.3.0 || >=1.0.0'), false)
  assert.equal(satisfiesRange('1.0.0', '>=0.1.0 <0.3.0 || >=1.0.0'), true)
  assert.equal(satisfiesRange('0.2.2-rc.1', '0.2.1-rc.2 || 0.2.2-rc.1'), true)
})

test('an unreadable range is unknown, not false', () => {
  // A range this module cannot read must not be turned into a rejection: the
  // panel would then show a broken plugin as blocked by DSH.
  assert.equal(satisfiesRange('1.0.0', 'next'), null)
  assert.equal(satisfiesRange('1.0.0', ''), null)
  assert.equal(satisfiesRange('banana', '>=1.0.0'), null)
})

test('engines.dsh wins over peer dependencies', () => {
  const manifest = {
    engines: { dsh: '>=0.2.2-rc.1' },
    peerDependencies: { '@deepseek-ai/dsh-llm': '^9.0.0' },
  }
  const requirements = dshRequirements(manifest)
  assert.equal(requirements.length, 1)
  assert.equal(requirements[0].field, 'engines.dsh')
})

test('without engines.dsh the DSH peers are the requirement', () => {
  const manifest = {
    peerDependencies: {
      '@deepseek-ai/dsh-llm': '>=0.2.0',
      '@deepseek-ai/dsh-tools': '^0.2.0',
      react: '^18.2.0',
    },
  }
  const requirements = dshRequirements(manifest)
  assert.deepEqual(requirements.map((item) => item.field), [
    'peerDependencies.@deepseek-ai/dsh-llm',
    'peerDependencies.@deepseek-ai/dsh-tools',
  ])
})

test('workspace ranges are always satisfied', () => {
  const manifest = { peerDependencies: { '@deepseek-ai/dsh': 'workspace:^' } }
  const verdict = evaluateCompatibility({ manifest, runtimeVersion: '0.0.1' })
  assert.equal(verdict.verdict, 'satisfied')
})

test('evaluateCompatibility separates satisfied, unsatisfied and unknown', () => {
  const ok = evaluateCompatibility({
    manifest: { engines: { dsh: '>=0.2.0' } },
    runtimeVersion: '0.2.2-rc.1',
  })
  assert.equal(ok.verdict, 'satisfied')
  assert.deepEqual(ok.unmet, [])

  const bad = evaluateCompatibility({
    manifest: { engines: { dsh: '>=0.3.0' } },
    runtimeVersion: '0.2.2-rc.1',
  })
  assert.equal(bad.verdict, 'unsatisfied')
  assert.equal(bad.unmet.length, 1)

  // No runtime version: the answer is that we cannot answer.
  const unknown = evaluateCompatibility({
    manifest: { engines: { dsh: '>=0.3.0' } },
    runtimeVersion: null,
  })
  assert.equal(unknown.verdict, 'unknown')
  assert.deepEqual(unknown.unmet, [])

  // No manifest at all is also unknown, never "fine".
  const missing = evaluateCompatibility({ manifest: null, runtimeVersion: '0.2.2-rc.1' })
  assert.equal(missing.verdict, 'unknown')
})

test('a granted exemption turns an unsatisfied range into exempted', () => {
  const verdict = evaluateCompatibility({
    manifest: { engines: { dsh: '>=0.3.0' } },
    runtimeVersion: '0.2.2-rc.1',
    packageVersion: '1.2.3',
    exemptionKey: 'some-plugin@1.2.3',
    exemptions: { 'some-plugin@1.2.3': ['0.2.2-rc.1'] },
  })
  assert.equal(verdict.verdict, 'exempted')
})

test('an exemption for another version does not apply', () => {
  const verdict = evaluateCompatibility({
    manifest: { engines: { dsh: '>=0.3.0' } },
    runtimeVersion: '0.2.2-rc.1',
    packageVersion: '1.2.4',
    exemptionKey: 'some-plugin@1.2.4',
    exemptions: { 'some-plugin@1.2.3': ['0.2.2-rc.1'] },
  })
  assert.equal(verdict.verdict, 'unsatisfied')
})

test('a manifest with no DSH claim is accepted', () => {
  const verdict = evaluateCompatibility({ manifest: { version: '1.0.0' }, runtimeVersion: '0.2.2-rc.1' })
  assert.equal(verdict.verdict, 'satisfied')
  assert.deepEqual(verdict.requirements, [])
})

test('manifestVersion ignores a missing or empty field', () => {
  assert.equal(manifestVersion({ version: '1.0.0' }), '1.0.0')
  assert.equal(manifestVersion({ version: '' }), null)
  assert.equal(manifestVersion(null), null)
})
