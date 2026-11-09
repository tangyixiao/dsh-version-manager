/**
 * Two different questions about turning a name into a path segment.
 *
 * `encodeSegment` is for names the host hands us as identifiers — package names
 * and profile ids. Those have to *work*, so the encoding is total: anything
 * comes out as one segment. `safeSegment` is for names that are already
 * directory names (Skill names, which may be any script) and must be accepted
 * as they are or refused; rewriting `离线诊断` into ASCII would silently move
 * every snapshot of it to a new directory.
 *
 * Both exist because `path.join(root, '..')` climbs out of `root`. That is the
 * whole risk these functions are shaped around.
 */

import assert from 'node:assert/strict'
import { join, resolve, sep } from 'node:path'
import test from 'node:test'

import { encodeSegment, safeSegment } from '../lib/host/segment.js'

const ROOT = resolve('/tmp/vm-root')

function staysInside(segment) {
  const target = resolve(join(ROOT, segment))
  return target.startsWith(ROOT + sep) || target === ROOT
}

test('an ordinary name is left exactly as it was', () => {
  for (const name of ['desktop', 'dsh-update-checker', 'a.b_c-d', '@scope%2Fname']) {
    assert.equal(encodeSegment(name), name, name)
  }
})

test('a slash becomes an escape, so a scoped name stays one directory', () => {
  assert.equal(encodeSegment('@scope/name'), '@scope%2Fname')
  assert.equal(staysInside(encodeSegment('@scope/name')), true)
})

test('dots alone cannot mean "up"', () => {
  assert.equal(encodeSegment('..'), '%2E%2E')
  assert.equal(encodeSegment('.'), '%2E')
  assert.equal(encodeSegment('...'), '%2E%2E%2E')
  for (const name of ['..', '.', '...', '../..']) {
    assert.equal(staysInside(encodeSegment(name)), true, name)
  }
})

test('a traversal attempt is flattened rather than followed', () => {
  const encoded = encodeSegment('../escape/me')
  // The dots survive as characters; the slashes do not. That is the point: as
  // one directory name, `..%2Fescape%2Fme` means nothing to a filesystem.
  assert.equal(encoded, '..%2Fescape%2Fme')
  assert.equal(encoded.includes('/'), false, encoded)
  assert.equal(encoded.includes('\\'), false, encoded)
  assert.equal(staysInside(encoded), true)
})

test('characters a filesystem dislikes become underscores', () => {
  assert.equal(encodeSegment('a b'), 'a_b')
  assert.equal(encodeSegment('a:b'), 'a:b'.replace(':', '_'))
  assert.equal(encodeSegment('a\u0000b'), 'a_b')
})

test('an empty name still produces one segment, not the parent directory', () => {
  assert.equal(encodeSegment(''), '_')
  assert.equal(encodeSegment(null), '_')
  assert.equal(encodeSegment(undefined), '_')
  assert.equal(staysInside(encodeSegment('')), true)
})

test('safeSegment accepts a non-ASCII directory name unchanged', () => {
  for (const name of ['office', '离线诊断', 'with space', 'with.dot']) {
    assert.equal(safeSegment(name), name, name)
  }
})

test('safeSegment refuses what could leave or confuse the store', () => {
  for (const name of ['', '.', '..', 'a/b', 'a\\b', 'a\u0000b', null, undefined, 42, {}]) {
    assert.equal(safeSegment(name), null, String(name))
  }
})

test('a name safeSegment refuses cannot reach a directory outside the store', () => {
  // The pairing that matters: whenever safeSegment says no, a caller that
  // ignores it and falls back to encodeSegment is still contained.
  for (const name of ['..', '../escape', 'a/../../b']) {
    assert.equal(safeSegment(name), null, name)
    const fallback = safeSegment(name) ?? encodeSegment(name)
    assert.equal(staysInside(fallback), true, name)
  }
})
